/**
 * WHY this file exists:
 *   Electron has no password manager or autofill, so Bow builds its own. This helper runs inside every top-level web
 *   page of a profile (main registers it with session.registerPreloadScript, never for private windows). It notices
 *   sign-in fields and submitted forms and tells main; it fills a login only when main says so. It runs in Electron's
 *   isolated world, so page scripts cannot see its variables or ipcRenderer, and it exposes nothing: no contextBridge,
 *   no globals, no attributes or elements added to the page. Main treats every message as untrusted and takes the
 *   site from the sending frame.
 *
 * Data source:
 *   The page's own DOM (inputs, forms) and real user input events (isTrusted). Messages from main (fill, fillValue).
 *
 * Data flow:
 *   user clicks / tabs / types in a field → FORMS_CHANNELS.fieldFocused / fieldLeft → main (formsBridge.ts)
 *   form submit / Enter / button click → FORMS_CHANNELS.submitted (and later loginFinished) → main
 *   main → FORMS_CHANNELS.fill / fillValue → this helper writes into the field the user is in
 *   The classification functions at the top are pure (no DOM) so tests/formsPreload.test.ts can run them in Node.
 */
import { ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type {
  FORMS_CHANNELS,
  FieldFocusedMessage,
  FieldRole,
  FillMessage,
  FillValueMessage,
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
};

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

/** Input types that behave like free text and can hold a username or an address part. */
const TEXT_LIKE_TYPES = ["text", "email", "tel"];

/** autocomplete words that only say which address or phone a field belongs to, not what it is. */
const AUTOCOMPLETE_MODIFIER_PATTERN = /^(section-.*|shipping|billing|home|work|mobile|fax|pager)$/;

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

function scopeOf(element: Element): ParentNode {
  const enclosingForm = element.closest("form");
  return enclosingForm ?? document.body ?? document.documentElement;
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

function isInput(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement;
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
  if (window.top !== window) {
    return;
  }
  if (!ALLOWED_PAGE_PROTOCOLS.includes(location.protocol)) {
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

  function isRecent(time: number): boolean {
    return performance.now() - time <= TRUSTED_FOCUS_WINDOW_MS;
  }

  function reportField(input: HTMLInputElement): void {
    const scopeInfo = readScope(scopeOf(input));
    const role = roleOfInput(input, scopeInfo);
    if (role === null) {
      return;
    }
    const isPasswordRole = role === "password" || role === "newPassword";
    const box = input.getBoundingClientRect();
    const message: FieldFocusedMessage = {
      role,
      // A password is never sent while it is typed: suggestions do not narrow by password.
      typed: isPasswordRole ? "" : input.value.slice(0, MAX_TYPED),
      rect: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
      hasPasswordField: scopeInfo.visiblePasswordFields.length > 0,
    };
    reportedField = input;
    fillTargetField = input;
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

  function reportSubmission(scope: ParentNode): void {
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
    const message: SubmittedMessage = {
      username: password === "" ? "" : (scopeInfo.usernameField?.value.trim() ?? ""),
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

  function scopeHasPassword(scope: ParentNode, requireValue: boolean): boolean {
    const scopeInfo = readScope(scope);
    if (!requireValue) {
      return scopeInfo.visiblePasswordFields.length > 0;
    }
    return scopeInfo.visiblePasswordFields.some((input) => input.value !== "");
  }

  function setInputValue(input: HTMLInputElement, value: string): void {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    nativeSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    typedInputs.delete(input);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!event.isTrusted) {
      return;
    }
    const target = event.target;
    lastPointerTarget = target;
    lastPointerTime = performance.now();
    if (!isInput(target) || document.activeElement !== target) {
      return;
    }
    // Clicking a field that already has focus reopens the list; the focus settles first.
    setTimeout(() => {
      if (document.activeElement === target) {
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
    if (!event.isTrusted || !(target instanceof Element)) {
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
    if (event.target instanceof HTMLFormElement) {
      reportSubmission(event.target);
    }
  }

  function handlePageHide(): void {
    reportFieldLeft();
    fillTargetField = null;
    stopLoginWatch();
  }

  window.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("focusin", handleFocusIn, true);
  window.addEventListener("focusout", handleFocusOut, true);
  window.addEventListener("input", handleTypedInput, true);
  window.addEventListener("paste", handlePaste, true);
  window.addEventListener("click", handleClick, true);
  window.addEventListener("submit", handleSubmit, true);
  window.addEventListener("scroll", reportFieldLeft, { capture: true, passive: true });
  window.addEventListener("resize", reportFieldLeft);
  window.addEventListener("pagehide", handlePageHide);

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
