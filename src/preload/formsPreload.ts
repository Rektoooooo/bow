/**
 * WHY this file exists:
 *   Electron has no password manager or autofill, so Bow builds its own. This helper runs inside every web page of a
 *   profile and every frame embedded in it (main registers it with session.registerPreloadScript, never for private
 *   windows; Apple's sign-in, for one, is an embedded frame). It notices sign-in fields and submitted forms and tells
 *   main; it fills a login only when main says so. It runs in Electron's isolated world, so page scripts cannot see its
 *   variables or ipcRenderer, and it exposes nothing: no contextBridge, no globals, no attributes or elements added to
 *   the page. Main treats every message as untrusted and takes the site from the sending frame. An embedded frame
 *   posts a random key to its parent window when the user is in one of its fields, so the parent's helper can tell
 *   main where that frame sits (the list under a field needs the field's place in the whole tab). Electron runs no
 *   helper in a same-origin frame whose first empty window Chromium keeps for the real page (Apple Developer's
 *   sign-in); the parent's helper reaches into such a frame and handles its fields as part of its own page.
 *
 * Data source:
 *   The page's own DOM (inputs, forms) and real user input events (isTrusted). Messages from main (fill, fillValue).
 *
 * Data flow:
 *   user clicks / tabs / types in a field → FORMS_CHANNELS.fieldFocused / fieldLeft → main (formsBridge.ts)
 *   form submit / Enter / button click → FORMS_CHANNELS.submitted (and later loginFinished) → main
 *   main → FORMS_CHANNELS.fill / fillValue → this helper writes into the field the user is in
 *   embedded frame: posts { bowFormsFrameKey } to its parent; main → FORMS_CHANNELS.locateFrame → the parent's helper
 *   → FORMS_CHANNELS.frameLocated (where that child frame's page starts in the parent's viewport) → main
 *   The classification functions at the top are pure (no DOM) so tests/formsPreload.test.ts can run them in Node.
 */
import { ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type {
  FORMS_CHANNELS,
  FRAME_KEY_LENGTH,
  FRAME_KEY_MESSAGE_FIELD,
  FieldFocusedMessage,
  FieldRole,
  FillMessage,
  FillValueMessage,
  FrameLocatedMessage,
  LocateFrameMessage,
  MAX_SUBMITTED_ENTRIES,
  MAX_TYPED_LENGTH,
  SubmittedEntry,
  SubmittedMessage,
} from "../shared/forms";
import type { FORM_FIELD_KINDS, FormFieldKind } from "../shared/passwords";

/** Same names as FORMS_CHANNELS: sandboxed preloads cannot import our files, so the type check guards them. */
const CHANNELS: typeof FORMS_CHANNELS = {
  fieldFocused: "forms:field-focused",
  fieldLeft: "forms:field-left",
  submitted: "forms:submitted",
  loginFinished: "forms:login-finished",
  fill: "forms:fill",
  fillValue: "forms:fill-value",
  locateFrame: "forms:locate-frame",
  frameLocated: "forms:frame-located",
};

/** Same as FRAME_KEY_MESSAGE_FIELD in shared/forms.ts (typed against it). */
const FRAME_KEY_FIELD: typeof FRAME_KEY_MESSAGE_FIELD = "bowFormsFrameKey";

/** Same as FRAME_KEY_LENGTH in shared/forms.ts (typed against it). */
const FRAME_KEY_DIGITS: typeof FRAME_KEY_LENGTH = 32;

/** A frame key: lower-case hex, FRAME_KEY_DIGITS long. */
const FRAME_KEY_PATTERN = new RegExp(`^[0-9a-f]{${FRAME_KEY_DIGITS}}$`);

/** Most child frames one page keeps keys for. Our choice: a key arrives only when the user is in a frame's field. */
const MAX_KNOWN_CHILD_FRAMES = 100;

/** Same list as FORM_FIELD_KINDS (the type check fails when it drifts). Used by tests to check every kind we return. */
export const KNOWN_FIELD_KINDS: typeof FORM_FIELD_KINDS = [
  "email",
  "name",
  "givenName",
  "familyName",
  "tel",
  "organization",
  "streetAddress",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "country",
] as const;

/** Same value as MAX_TYPED_LENGTH in shared/forms.ts (typed against it). */
const MAX_TYPED: typeof MAX_TYPED_LENGTH = 200;

/** Same value as MAX_SUBMITTED_ENTRIES in shared/forms.ts (typed against it). */
const MAX_ENTRIES: typeof MAX_SUBMITTED_ENTRIES = 50;

/** A click or Tab counts for a focus this long. Our choice: a real click focuses the field within a few frames. */
const TRUSTED_FOCUS_WINDOW_MS = 1000;

/** The same form is reported at most once in this time. Our choice: click, Enter and the submit event arrive together. */
const SUBMIT_REPEAT_GUARD_MS = 1000;

/** How long after a submit we watch for the sign-in form to go away. Our choice: slow networks and redirects. */
const LOGIN_FINISHED_WATCH_MS = 20000;

/** How often that watch looks. Our choice: fast enough to feel instant, cheap enough to ignore. */
const LOGIN_FINISHED_POLL_MS = 500;

/** Longest username or password main may ask us to fill. Our choice: same bound main applies to saved logins. */
const MAX_FILL_LENGTH = 1024;

const ALLOWED_PAGE_PROTOCOLS = ["http:", "https:"];

/**
 * Set on a frame's window, in Bow's isolated world only (page scripts never see it), to the document that frame's own
 * helper watches. A parent's helper leaves a same-origin frame alone while it names the frame's current document.
 */
const OWN_HELPER_MARKER = "bowFormsHelper";

/**
 * True for a web page (http or https). Checked for the page of each field the helper would report: it also handles the
 * pages of same-origin frames, and a page it watches can be an empty about:blank one.
 */
function isWebPage(pageDocument: Document): boolean {
  const protocol = pageDocument.defaultView?.location.protocol ?? "";
  return ALLOWED_PAGE_PROTOCOLS.includes(protocol);
}

/** Input types that behave like free text and can hold a username or an address part. */
const TEXT_LIKE_TYPES = ["text", "email", "tel"];

/**
 * autocomplete words that only say which address or phone a field belongs to, not what it is, and "webauthn", which
 * the HTML standard puts after the field name when the field also takes a passkey (Apple's: "username webauthn").
 */
const AUTOCOMPLETE_MODIFIER_PATTERN = /^(section-.*|shipping|billing|home|work|mobile|fax|pager|webauthn)$/;

/** What the page itself says a field is (autocomplete), mapped to our kinds. Anything else the page says → null. */
const KIND_BY_AUTOCOMPLETE_NAME: Readonly<Record<string, FormFieldKind>> = {
  email: "email",
  name: "name",
  "given-name": "givenName",
  "family-name": "familyName",
  tel: "tel",
  "tel-national": "tel",
  organization: "organization",
  "street-address": "streetAddress",
  "address-line1": "streetAddress",
  "address-line2": "addressLine2",
  "address-level2": "city",
  "address-level1": "region",
  "postal-code": "postalCode",
  country: "country",
  "country-name": "country",
};

/**
 * Fields that must never be remembered, whatever else their name says: payment, identity numbers, one-time codes,
 * secrets, free text. Tested on the normalized name and id (lower case, words split by spaces).
 */
const DENIED_NAME_PATTERN =
  /\b(card|cc ?num|cvv|cvc|csc|security ?code|expir|iban|account ?(number|no)|routing|ssn|social|tax|passport|otp|one ?time|verif|2fa|mfa|token|passcode|captcha|passw|search|query|comment|message|subject|coupon|promo)/;

/** A deny word that must stand alone ("pin" is a secret, "pine" and "spinner" are not). */
const DENIED_WHOLE_WORD_PATTERN = /\bpin\b/;

/** Name or id patterns → kind, checked in this order (first match wins). Tested on the normalized name and id. */
const KIND_BY_NAME_PATTERNS: ReadonlyArray<{ pattern: RegExp; kind: FormFieldKind }> = [
  { pattern: /\be ?mail/, kind: "email" },
  { pattern: /\b(first ?name|given ?name|fname|forename)\b/, kind: "givenName" },
  { pattern: /\b(last ?name|family ?name|surname|lname)\b/, kind: "familyName" },
  { pattern: /\b(full ?name|your ?name)\b/, kind: "name" },
  { pattern: /\btel\b|\b(phone|telephone|mobile|cell ?phone)/, kind: "tel" },
  { pattern: /\b(zip|postal|postcode|post ?code)/, kind: "postalCode" },
  { pattern: /\b(city|town)\b/, kind: "city" },
  { pattern: /\b(state|province|region|county)\b/, kind: "region" },
  { pattern: /\bcountry/, kind: "country" },
  { pattern: /\b(company|organi[sz]ation|business)/, kind: "organization" },
  { pattern: /\baddress ?(line ?)?2\b|\b(apartment|suite|apt)\b/, kind: "addressLine2" },
  { pattern: /\b(street|address)/, kind: "streetAddress" },
];

/** A field whose whole name (or id) is this word is the person's full name. */
const WHOLE_NAME_FOR_FULL_NAME = "name";

/** A field whose whole name is this letter is a search box (?q=). */
const WHOLE_NAME_FOR_SEARCH = "q";

export interface FieldDescription {
  autocomplete: string;
  type: string;
  name: string;
  id: string;
}

/**
 * Lower-cases a name or id and turns separators and camelCase into single spaces, so "firstName", "first_name" and
 * "first-name" all read "first name".
 */
function normalizeAttribute(rawValue: string): string {
  const splitCamelCase = rawValue.replace(/([a-z])([A-Z])/g, "$1 $2");
  const lowerCased = splitCamelCase.toLowerCase();
  const wordsOnly = lowerCased.replace(/[^a-z0-9]+/g, " ");
  return wordsOnly.trim();
}

/** The field name of an autocomplete value ("shipping given-name" → "given-name"); "" when the page named none. */
export function autocompleteFieldName(autocomplete: string): string {
  const tokens = autocomplete.toLowerCase().split(/\s+/).filter((token) => token !== "");
  const meaningfulTokens = tokens.filter((token) => !AUTOCOMPLETE_MODIFIER_PATTERN.test(token));
  const lastToken = meaningfulTokens.at(-1);
  return lastToken ?? "";
}

/** The kind a name or id suggests, or null (deny words win over every mapping). */
function kindFromNameAndId(name: string, id: string): FormFieldKind | null {
  const normalizedName = normalizeAttribute(name);
  const normalizedId = normalizeAttribute(id);
  if (normalizedName === WHOLE_NAME_FOR_SEARCH) {
    return null;
  }
  const combined = `${normalizedName} ${normalizedId}`;
  if (DENIED_NAME_PATTERN.test(combined) || DENIED_WHOLE_WORD_PATTERN.test(combined)) {
    return null;
  }
  for (const entry of KIND_BY_NAME_PATTERNS) {
    if (entry.pattern.test(combined)) {
      return entry.kind;
    }
  }
  const isWholeName = normalizedName === WHOLE_NAME_FOR_FULL_NAME || normalizedId === WHOLE_NAME_FOR_FULL_NAME;
  return isWholeName ? "name" : null;
}

/**
 * Which remembered kind a field is, or null. An allow-list: only the kinds in FORM_FIELD_KINDS are ever returned,
 * everything unsure is null. What the page says in autocomplete wins and is never second-guessed.
 */
export function fieldKindFor(field: FieldDescription): FormFieldKind | null {
  const fieldType = field.type.toLowerCase() === "" ? "text" : field.type.toLowerCase();
  if (fieldType === "password" || fieldType === "hidden") {
    return null;
  }
  const declaredName = autocompleteFieldName(field.autocomplete);
  const pageDeclaredNothing = declaredName === "" || declaredName === "on";
  if (!pageDeclaredNothing) {
    const declaredKind = KIND_BY_AUTOCOMPLETE_NAME[declaredName];
    return declaredKind ?? null;
  }
  if (!TEXT_LIKE_TYPES.includes(fieldType)) {
    return null;
  }
  if (fieldType === "email") {
    return "email";
  }
  if (fieldType === "tel") {
    return "tel";
  }
  return kindFromNameAndId(field.name, field.id);
}

export interface UsernameCandidate {
  autocompleteName: string;
  type: string;
}

/**
 * Picks the username field among the text-like inputs that come before a password field (nearest to the password
 * wins when several qualify): autocomplete username or email first, then type email, then simply the last one.
 * Returns its index, or -1 when there are none.
 */
export function pickUsernameCandidate(candidates: readonly UsernameCandidate[]): number {
  const declaredIndex = candidates.findLastIndex(
    (candidate) => candidate.autocompleteName === "username" || candidate.autocompleteName === "email",
  );
  if (declaredIndex !== -1) {
    return declaredIndex;
  }
  const emailTypeIndex = candidates.findLastIndex((candidate) => candidate.type === "email");
  if (emailTypeIndex !== -1) {
    return emailTypeIndex;
  }
  return candidates.length - 1;
}

export interface RoleFacts {
  type: string;
  autocompleteName: string;
  isUsernameField: boolean;
  isNewPasswordForm: boolean;
  fieldKind: FormFieldKind | null;
}

/** What a focused input is for. null → Bow reports nothing for it. */
export function roleForFacts(facts: RoleFacts): FieldRole | null {
  if (facts.type === "password") {
    return facts.isNewPasswordForm ? "newPassword" : "password";
  }
  const declaresUsername = facts.autocompleteName === "username";
  if (facts.isUsernameField && (!facts.isNewPasswordForm || declaresUsername)) {
    return "username";
  }
  return facts.fieldKind;
}

/** The pieces of a sign-in form around one input. */
interface ScopeInfo {
  scope: ParentNode;
  visiblePasswordFields: HTMLInputElement[];
  isNewPasswordForm: boolean;
  usernameField: HTMLInputElement | null;
}

function isVisible(element: Element): boolean {
  return element.getClientRects().length > 0;
}

function scopeOf(element: Element): Element {
  const enclosingForm = element.closest("form");
  const ownerDocument = element.ownerDocument;
  return enclosingForm ?? ownerDocument.body ?? ownerDocument.documentElement;
}

function inputsIn(scope: ParentNode): HTMLInputElement[] {
  return Array.from(scope.querySelectorAll("input"));
}

function isTextLikeVisible(input: HTMLInputElement): boolean {
  return TEXT_LIKE_TYPES.includes(input.type) && isVisible(input);
}

function findUsernameField(allInputs: HTMLInputElement[], passwordFields: HTMLInputElement[]): HTMLInputElement | null {
  if (passwordFields.length === 0) {
    // Two-step sign-ins show the email alone first: only a page-declared username counts there.
    const declared = allInputs.find(
      (input) => isTextLikeVisible(input) && autocompleteFieldName(input.autocomplete) === "username",
    );
    return declared ?? null;
  }
  const firstPasswordIndex = allInputs.indexOf(passwordFields[0]);
  const inputsBeforePassword = allInputs.slice(0, firstPasswordIndex).filter(isTextLikeVisible);
  const candidates = inputsBeforePassword.map((input) => ({
    autocompleteName: autocompleteFieldName(input.autocomplete),
    type: input.type,
  }));
  const pickedIndex = pickUsernameCandidate(candidates);
  return pickedIndex === -1 ? null : inputsBeforePassword[pickedIndex];
}

function readScope(scope: ParentNode): ScopeInfo {
  const allInputs = inputsIn(scope);
  const visiblePasswordFields = allInputs.filter((input) => input.type === "password" && isVisible(input));
  const declaresNewPassword = visiblePasswordFields.some(
    (input) => autocompleteFieldName(input.autocomplete) === "new-password",
  );
  const isNewPasswordForm = declaresNewPassword || visiblePasswordFields.length >= 2;
  const usernameField = findUsernameField(allInputs, visiblePasswordFields);
  return { scope, visiblePasswordFields, isNewPasswordForm, usernameField };
}

function fieldDescriptionOf(input: HTMLInputElement): FieldDescription {
  return { autocomplete: input.autocomplete, type: input.type, name: input.name, id: input.id };
}

function roleOfInput(input: HTMLInputElement, scopeInfo: ScopeInfo): FieldRole | null {
  if (input.disabled || input.readOnly) {
    return null;
  }
  return roleForFacts({
    type: input.type,
    autocompleteName: autocompleteFieldName(input.autocomplete),
    isUsernameField: scopeInfo.usernameField === input,
    isNewPasswordForm: scopeInfo.isNewPasswordForm,
    fieldKind: fieldKindFor(fieldDescriptionOf(input)),
  });
}

/** The password that was typed: the new one in a sign-up form, the only one in a sign-in form. */
function chosenPasswordField(scopeInfo: ScopeInfo): HTMLInputElement | null {
  const passwordFields = scopeInfo.visiblePasswordFields;
  if (!scopeInfo.isNewPasswordForm) {
    return passwordFields[0] ?? null;
  }
  const declaredNew = passwordFields.find(
    (input) => autocompleteFieldName(input.autocomplete) === "new-password" && input.value !== "",
  );
  if (declaredNew) {
    return declaredNew;
  }
  const withValue = passwordFields.filter((input) => input.value !== "");
  return withValue.at(-1) ?? null;
}

/**
 * An element of this page or of a same-origin frame's page this helper handles. That page is another realm, where
 * `instanceof HTMLInputElement` says no, so these checks look at the node itself.
 */
function isElement(target: EventTarget | null): target is Element {
  return target !== null && (target as Node).nodeType === Node.ELEMENT_NODE;
}

function isInput(target: EventTarget | null): target is HTMLInputElement {
  return isElement(target) && target.localName === "input";
}

function isFrameElement(target: EventTarget | null): target is HTMLIFrameElement | HTMLFrameElement {
  return isElement(target) && (target.localName === "iframe" || target.localName === "frame");
}

function isMessageRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseFillMessage(value: unknown): FillMessage | null {
  if (!isMessageRecord(value)) {
    return null;
  }
  const { username, password } = value;
  if (typeof username !== "string" || typeof password !== "string") {
    return null;
  }
  if (username.length > MAX_FILL_LENGTH || password.length > MAX_FILL_LENGTH) {
    return null;
  }
  return { username, password };
}

function parseLocateFrameMessage(value: unknown): LocateFrameMessage | null {
  if (!isMessageRecord(value)) {
    return null;
  }
  const { requestId, frameKey } = value;
  if (typeof requestId !== "number" || !Number.isSafeInteger(requestId)) {
    return null;
  }
  if (typeof frameKey !== "string" || !FRAME_KEY_PATTERN.test(frameKey)) {
    return null;
  }
  return { requestId: requestId, frameKey: frameKey };
}

/** A new random frame key (getRandomValues works on http pages too, randomUUID only on https). */
function makeFrameKey(): string {
  const randomBytes = new Uint8Array(FRAME_KEY_DIGITS / 2);
  crypto.getRandomValues(randomBytes);
  const hexPairs = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0"));
  return hexPairs.join("");
}

/** Where a child frame's page starts in this page's viewport: inside the frame element's border and padding. */
function contentBoxStart(element: HTMLIFrameElement | HTMLFrameElement): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  const pageWindow = element.ownerDocument.defaultView ?? window;
  const style = pageWindow.getComputedStyle(element);
  const paddingLeft = Number.parseFloat(style.paddingLeft);
  const paddingTop = Number.parseFloat(style.paddingTop);
  return { x: Math.round(box.x + element.clientLeft + paddingLeft), y: Math.round(box.y + element.clientTop + paddingTop) };
}

function frameElementsIn(pageDocument: Document): Array<HTMLIFrameElement | HTMLFrameElement> {
  return Array.from(pageDocument.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>("iframe, frame"));
}

/** The iframe or frame element of this page that shows that child window, or null. */
function findFrameElement(childWindow: MessageEventSource): HTMLIFrameElement | HTMLFrameElement | null {
  const match = frameElementsIn(document).find((element) => element.contentWindow === childWindow);
  return match ?? null;
}

/** True when this helper may handle that frame's page: reachable from here and of exactly this page's origin. */
function isSameOriginFrame(frameWindow: Window): boolean {
  try {
    // Reading a cross-origin frame's location throws; document.domain cannot make another origin pass this check.
    return frameWindow.location.origin === window.location.origin;
  } catch {
    return false;
  }
}

function parseFillValueMessage(value: unknown): FillValueMessage | null {
  if (!isMessageRecord(value)) {
    return null;
  }
  const text = value.value;
  if (typeof text !== "string" || text.length > MAX_TYPED) {
    return null;
  }
  return { value: text };
}

/** Everything runs in here, so importing this file in Node (tests) touches no DOM and no ipcRenderer. */
function startFormsHelper(): void {
  if (typeof document === "undefined") {
    return;
  }

  // Inputs the user typed or pasted into. A page cannot plant values into Bow's memory by script.
  const typedInputs = new WeakSet<HTMLInputElement>();
  const lastSubmitTimeByScope = new WeakMap<object, number>();
  let lastPointerTarget: EventTarget | null = null;
  let lastPointerTime = Number.NEGATIVE_INFINITY;
  let lastTabTime = Number.NEGATIVE_INFINITY;
  let reportedField: HTMLInputElement | null = null;
  // The field a fill goes to. It outlives reportedField: picking from Bow's list with the mouse takes the focus away
  // from the page (the field reports leaving) before main's fill message arrives.
  let fillTargetField: HTMLInputElement | null = null;
  let loginWatchTimer: ReturnType<typeof setInterval> | null = null;
  // The last username the user typed in each page this helper handles: two-step sign-ins (Apple's) hide or remove it
  // once the password shows, and a login saved without it would have no name.
  const lastTypedUsernameByPage = new WeakMap<Document, string>();

  const isTopFrame = window.top === window;
  // An embedded frame's key (shared/forms.ts), posted to the parent window once the user is in one of its fields.
  const ownFrameKey = isTopFrame ? "" : makeFrameKey();
  let hasAnnouncedFrame = false;
  // Child frames that posted their key to this page. The first post of a key wins: a page script repeating a key it
  // saw cannot point it at another window.
  const childFramesByKey = new Map<string, MessageEventSource>();
  // A locate request that came before the child's post (they travel separately).
  let waitingLocate: LocateFrameMessage | null = null;
  // True once this page told main where a child frame is: this page scrolling moves that frame's field and its list.
  let hasLocatedChildFrame = false;

  function isRecent(time: number): boolean {
    return performance.now() - time <= TRUSTED_FOCUS_WINDOW_MS;
  }

  /** Tells the parent window's helper this frame's key, once: main asks the parent where this frame is. */
  function announceFrameToParent(): void {
    if (isTopFrame || hasAnnouncedFrame) {
      return;
    }
    hasAnnouncedFrame = true;
    window.parent.postMessage({ [FRAME_KEY_FIELD]: ownFrameKey }, "*");
  }

  /** Where a page starts in this helper's own page: (0, 0) for its own, plus each frame's place for a handled frame. */
  function offsetInOwnPage(pageDocument: Document): { x: number; y: number } {
    let offsetX = 0;
    let offsetY = 0;
    let pageWindow = pageDocument.defaultView;
    while (pageWindow !== null && pageWindow !== window && pageWindow.frameElement !== null) {
      const start = contentBoxStart(pageWindow.frameElement as HTMLIFrameElement);
      offsetX = offsetX + start.x;
      offsetY = offsetY + start.y;
      pageWindow = pageWindow.frameElement.ownerDocument.defaultView;
    }
    return { x: offsetX, y: offsetY };
  }

  function reportField(input: HTMLInputElement): void {
    const pageDocument = input.ownerDocument;
    if (!isWebPage(pageDocument)) {
      return;
    }
    const scopeInfo = readScope(scopeOf(input));
    const role = roleOfInput(input, scopeInfo);
    if (role === null) {
      return;
    }
    if (role === "username" && typedInputs.has(input)) {
      lastTypedUsernameByPage.set(pageDocument, input.value.trim().slice(0, MAX_FILL_LENGTH));
    }
    const isPasswordRole = role === "password" || role === "newPassword";
    const box = input.getBoundingClientRect();
    const pageOffset = offsetInOwnPage(pageDocument);
    const message: FieldFocusedMessage = {
      role,
      // A password is never sent while it is typed: suggestions do not narrow by password.
      typed: isPasswordRole ? "" : input.value.slice(0, MAX_TYPED),
      rect: {
        x: Math.round(box.x + pageOffset.x),
        y: Math.round(box.y + pageOffset.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
      hasPasswordField: scopeInfo.visiblePasswordFields.length > 0,
      frameKey: ownFrameKey,
    };
    reportedField = input;
    fillTargetField = input;
    announceFrameToParent();
    ipcRenderer.send(CHANNELS.fieldFocused, message);
  }

  function reportFieldLeft(): void {
    if (reportedField === null) {
      return;
    }
    reportedField = null;
    ipcRenderer.send(CHANNELS.fieldLeft);
  }

  function stopLoginWatch(): void {
    if (loginWatchTimer === null) {
      return;
    }
    clearInterval(loginWatchTimer);
    loginWatchTimer = null;
  }

  function watchLoginFinished(passwordField: HTMLInputElement): void {
    stopLoginWatch();
    const startedAt = performance.now();
    loginWatchTimer = setInterval(() => {
      const hasGone = !passwordField.isConnected || !isVisible(passwordField);
      if (hasGone) {
        stopLoginWatch();
        ipcRenderer.send(CHANNELS.loginFinished);
        return;
      }
      if (performance.now() - startedAt > LOGIN_FINISHED_WATCH_MS) {
        stopLoginWatch();
      }
    }, LOGIN_FINISHED_POLL_MS);
  }

  function collectEntries(scopeInfo: ScopeInfo): SubmittedEntry[] {
    const entries: SubmittedEntry[] = [];
    for (const input of inputsIn(scopeInfo.scope)) {
      if (entries.length >= MAX_ENTRIES) {
        break;
      }
      const kind = input.type === "password" ? null : fieldKindFor(fieldDescriptionOf(input));
      const value = input.value.trim().slice(0, MAX_TYPED);
      if (kind !== null && value !== "" && typedInputs.has(input)) {
        entries.push({ kind, value });
      }
    }
    return entries;
  }

  function reportSubmission(scope: Element): void {
    if (!isWebPage(scope.ownerDocument)) {
      return;
    }
    const now = performance.now();
    const lastTime = lastSubmitTimeByScope.get(scope) ?? Number.NEGATIVE_INFINITY;
    if (now - lastTime < SUBMIT_REPEAT_GUARD_MS) {
      return;
    }
    const scopeInfo = readScope(scope);
    const passwordField = chosenPasswordField(scopeInfo);
    const password = passwordField?.value ?? "";
    const entries = collectEntries(scopeInfo);
    if (password === "" && entries.length === 0) {
      return;
    }
    lastSubmitTimeByScope.set(scope, now);
    const usernameInForm = scopeInfo.usernameField?.value.trim() ?? "";
    const typedEarlier = lastTypedUsernameByPage.get(scope.ownerDocument) ?? "";
    // Two-step sign-ins: the username step may be hidden or gone by the time the password is sent.
    const username = usernameInForm === "" ? typedEarlier : usernameInForm;
    const message: SubmittedMessage = {
      username: password === "" ? "" : username,
      password,
      isNewPassword: password !== "" && scopeInfo.isNewPasswordForm,
      wasTyped: passwordField !== null && password !== "" && typedInputs.has(passwordField),
      entries,
    };
    ipcRenderer.send(CHANNELS.submitted, message);
    if (passwordField !== null && password !== "") {
      watchLoginFinished(passwordField);
    }
  }

  function scopeHasPassword(scope: Element, requireValue: boolean): boolean {
    const scopeInfo = readScope(scope);
    if (!requireValue) {
      return scopeInfo.visiblePasswordFields.length > 0;
    }
    return scopeInfo.visiblePasswordFields.some((input) => input.value !== "");
  }

  function setInputValue(input: HTMLInputElement, value: string): void {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    nativeSetter?.call(input, value);
    // Events made in the field's own page, so its code sees ordinary events (a handled frame's page is another realm).
    const PageEvent = input.ownerDocument.defaultView?.Event ?? Event;
    input.dispatchEvent(new PageEvent("input", { bubbles: true }));
    input.dispatchEvent(new PageEvent("change", { bubbles: true }));
    typedInputs.delete(input);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!event.isTrusted) {
      return;
    }
    const target = event.target;
    lastPointerTarget = target;
    lastPointerTime = performance.now();
    if (!isInput(target) || target.ownerDocument.activeElement !== target) {
      return;
    }
    // Clicking a field that already has focus reopens the list; the focus settles first.
    setTimeout(() => {
      if (target.ownerDocument.activeElement === target) {
        reportField(target);
      }
    }, 0);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (!event.isTrusted) {
      return;
    }
    if (event.key === "Tab") {
      lastTabTime = performance.now();
      return;
    }
    const target = event.target;
    if (event.key === "Enter" && isInput(target) && scopeHasPassword(scopeOf(target), false)) {
      reportSubmission(scopeOf(target));
    }
  }

  function handleFocusIn(event: FocusEvent): void {
    const target = event.target;
    if (!isInput(target)) {
      return;
    }
    const clickedIt = lastPointerTarget === target && isRecent(lastPointerTime);
    const tabbedToIt = isRecent(lastTabTime);
    if (clickedIt || tabbedToIt) {
      reportField(target);
    }
  }

  function handleFocusOut(event: FocusEvent): void {
    if (event.target === reportedField) {
      reportFieldLeft();
    }
  }

  function handleTypedInput(event: Event): void {
    const target = event.target;
    if (!event.isTrusted || !isInput(target)) {
      return;
    }
    typedInputs.add(target);
    // Typing a password closes the list: it lists saved logins, and the user is typing a new one instead.
    if (target.type === "password") {
      reportFieldLeft();
      return;
    }
    reportField(target);
  }

  function handlePaste(event: ClipboardEvent): void {
    const target = event.target;
    if (event.isTrusted && isInput(target)) {
      typedInputs.add(target);
    }
  }

  function handleClick(event: MouseEvent): void {
    const target = event.target;
    if (!event.isTrusted || !isElement(target)) {
      return;
    }
    const button = target.closest("button, input[type=submit], input[type=button], [role=button]");
    if (button === null) {
      return;
    }
    const scope = scopeOf(button);
    if (scopeHasPassword(scope, true)) {
      reportSubmission(scope);
    }
  }

  function handleSubmit(event: Event): void {
    const target = event.target;
    if (isElement(target) && target.localName === "form") {
      reportSubmission(target);
    }
  }

  function handlePageHide(): void {
    reportFieldLeft();
    fillTargetField = null;
    stopLoginWatch();
  }

  /** This page scrolled or resized: a list under a field here, or in a child frame, no longer sits under it. */
  function handleViewportMoved(): void {
    reportFieldLeft();
    if (!hasLocatedChildFrame) {
      return;
    }
    hasLocatedChildFrame = false;
    ipcRenderer.send(CHANNELS.fieldLeft);
  }

  /** Answers main with where a child frame's page starts in this page. No answer when the frame is not ours to find. */
  function answerLocate(request: LocateFrameMessage): void {
    if (!isWebPage(document)) {
      return;
    }
    const childWindow = childFramesByKey.get(request.frameKey);
    if (childWindow === undefined) {
      return;
    }
    const element = findFrameElement(childWindow);
    if (element === null) {
      return;
    }
    const start = contentBoxStart(element);
    hasLocatedChildFrame = true;
    // Main asks this frame's own parent next, if there is one.
    announceFrameToParent();
    const answer: FrameLocatedMessage = { requestId: request.requestId, x: start.x, y: start.y, frameKey: ownFrameKey };
    ipcRenderer.send(CHANNELS.frameLocated, answer);
  }

  function rememberChildFrame(event: MessageEvent): void {
    const data: unknown = event.data;
    if (!isMessageRecord(data) || event.source === null) {
      return;
    }
    const frameKey = data[FRAME_KEY_FIELD];
    if (typeof frameKey !== "string" || !FRAME_KEY_PATTERN.test(frameKey)) {
      return;
    }
    if (childFramesByKey.has(frameKey) || childFramesByKey.size >= MAX_KNOWN_CHILD_FRAMES) {
      return;
    }
    childFramesByKey.set(frameKey, event.source);
    if (waitingLocate !== null && waitingLocate.frameKey === frameKey) {
      const request = waitingLocate;
      waitingLocate = null;
      answerLocate(request);
    }
  }

  // The pages whose root element the observer below watches.
  const watchedDocuments = new WeakSet<Document>();
  // document.open() erases every listener on a window and its page. It also swaps the page's root element, which this
  // observer sees (observers are not erased), and the listeners go back on. addEventListener ignores a listener that
  // is already there, so none is ever added twice.
  const rootObserver = new MutationObserver((records) => {
    for (const record of records) {
      const pageWindow = (record.target as Document).defaultView;
      if (pageWindow !== null) {
        installListenersOn(pageWindow);
      }
    }
  });

  /**
   * Handles a same-origin frame that has no helper of its own watching its page: Electron runs none in a frame whose
   * first empty window Chromium keeps for the real page (Apple Developer's sign-in). Its fields then count as fields of
   * this helper's page, at the frame's place. A frame of another origin is left alone: it has its own helper.
   */
  function handleFrameIfAlone(element: HTMLIFrameElement | HTMLFrameElement): void {
    const frameWindow = element.contentWindow;
    if (frameWindow === null || !isSameOriginFrame(frameWindow)) {
      return;
    }
    if (Reflect.get(frameWindow, OWN_HELPER_MARKER) === frameWindow.document) {
      return;
    }
    installListenersOn(frameWindow);
  }

  function handleFrameLoaded(event: Event): void {
    const target = event.target;
    if (isFrameElement(target)) {
      handleFrameIfAlone(target);
    }
  }

  function installListenersOn(pageWindow: Window): void {
    const pageDocument = pageWindow.document;
    const isNewPage = !watchedDocuments.has(pageDocument);
    if (isNewPage) {
      watchedDocuments.add(pageDocument);
      rootObserver.observe(pageDocument, { childList: true });
    }
    pageWindow.addEventListener("pointerdown", handlePointerDown, true);
    pageWindow.addEventListener("keydown", handleKeyDown, true);
    pageWindow.addEventListener("focusin", handleFocusIn, true);
    pageWindow.addEventListener("focusout", handleFocusOut, true);
    pageWindow.addEventListener("input", handleTypedInput, true);
    pageWindow.addEventListener("paste", handlePaste, true);
    pageWindow.addEventListener("click", handleClick, true);
    pageWindow.addEventListener("submit", handleSubmit, true);
    pageWindow.addEventListener("scroll", handleViewportMoved, { capture: true, passive: true });
    pageWindow.addEventListener("resize", handleViewportMoved);
    // A frame's load passes its page's document on the way down (capture). It never reaches the window: the DOM leaves
    // the window out of every load event's path.
    pageDocument.addEventListener("load", handleFrameLoaded, true);
    if (pageWindow === window) {
      Reflect.set(window, OWN_HELPER_MARKER, document);
      window.addEventListener("pagehide", handlePageHide);
      window.addEventListener("message", rememberChildFrame);
      return;
    }
    // A frame's page taken over just now has loaded with its own frames (its load comes after theirs), so their loads
    // went by before these listeners. Never done for this helper's own page: touching a frame before its first page
    // has loaded makes Chromium keep the frame's empty window, and Electron then runs no helper in it.
    if (isNewPage) {
      for (const element of frameElementsIn(pageDocument)) {
        handleFrameIfAlone(element);
      }
    }
  }

  installListenersOn(window);

  ipcRenderer.on(CHANNELS.locateFrame, (_event: IpcRendererEvent, rawMessage: unknown) => {
    const request = parseLocateFrameMessage(rawMessage);
    if (request === null) {
      return;
    }
    if (!childFramesByKey.has(request.frameKey)) {
      // The child's post may still be on its way: rememberChildFrame answers when it comes.
      waitingLocate = request;
      return;
    }
    answerLocate(request);
  });

  ipcRenderer.on(CHANNELS.fill, (_event: IpcRendererEvent, rawMessage: unknown) => {
    const message = parseFillMessage(rawMessage);
    if (message === null || fillTargetField === null || !fillTargetField.isConnected) {
      return;
    }
    const scopeInfo = readScope(scopeOf(fillTargetField));
    // A sign-up form has no saved login to fill: only its username box can take one.
    const passwordField = scopeInfo.isNewPasswordForm ? null : (scopeInfo.visiblePasswordFields[0] ?? null);
    if (scopeInfo.usernameField !== null) {
      setInputValue(scopeInfo.usernameField, message.username);
    }
    if (passwordField !== null) {
      setInputValue(passwordField, message.password);
    }
  });

  ipcRenderer.on(CHANNELS.fillValue, (_event: IpcRendererEvent, rawMessage: unknown) => {
    const message = parseFillValueMessage(rawMessage);
    if (message === null || fillTargetField === null || !fillTargetField.isConnected) {
      return;
    }
    setInputValue(fillTargetField, message.value);
  });
}

startFormsHelper();
