/**
 * WHY this file exists:
 *   When the user clicks, tabs or types into a sign-in or address field on a page, Bow shows a small list right under
 *   it: the saved logins of that site (username and dots, never the password), or remembered emails, names and
 *   addresses. Nothing is filled before the user picks. The list is a view of our own above the page (a web page
 *   cannot read or restyle it). Because the field's place is reported by the page, the list is only ever put inside
 *   that tab's own view (autofillPlacement.ts), and the password is read from the vault again at the moment of the
 *   pick, so it is never held here while the list is open.
 *
 * Data source:
 *   Field reports from formsBridge.ts (the site, the profile, what role the field has and what was typed), the
 *   profile's vault (passwordVault.ts; rules in passwords.ts and formMemory.ts), the tab's view and key events.
 *
 * Data flow:
 *   page helper → formsBridge onFieldFocused → rows from the vault → the list's view above the tab → AUTOFILL show
 *   arrow keys / Return / Escape on the tab's page (before-input-event) or a pointer press on a row (AUTOFILL choose)
 *   → pickRow() → vault read → fillLogin / fillValue (formsBridge.ts) → the page helper writes into the field
 *   the "Manage passwords…" footer (a press: AUTOFILL manage; keys: pickRow) → closeAutofillPopup() → Library › Passwords
 *   field left, navigation, tab switch, another window or an open panel → closeAutofillPopup()
 */
import { ipcMain, nativeTheme, WebContentsView } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from "electron";
import * as path from "node:path";
import { AUTOFILL_CHANNELS } from "../shared/autofill";
import type { AutofillItem, AutofillShowMessage } from "../shared/autofill";
import type { FieldReport } from "./formsBridge";
import type { FieldRect } from "../shared/forms";
import type { FormFieldKind } from "../shared/passwords";
import type { ItemId, ProfileId } from "../shared/types";
import { addAfterSyncHook, getState, getWindow } from "./browserCore";
import { computePopupPlacement } from "./autofillPlacement";
import type { PlacementBox } from "./autofillPlacement";
import { suggestEntries, forgetEntry } from "./formMemory";
import { fillLogin, fillValue, onFieldFocused, onFieldLeft } from "./formsBridge";
import { isOverlayShown } from "./overlay";
import { findLoginsForOrigin, isSameLoginSite, markLoginUsed } from "./passwords";
import type { PasswordVault } from "./passwords";
import { changeVault, openVault } from "./passwordVault";
import { getShownTabIdsInWindow, getTabContents, getTabViews } from "./tabViews";
import { getActiveSpace } from "./tree";

/** Most saved logins listed. Our choice: more than a few accounts on one site is rare, and the list must stay short. */
const MAX_LOGIN_SUGGESTIONS = 8;

/**
 * How long after the field lost the focus the list stays. Our choice: a mouse press on the list takes the page's focus
 * first, and the pick must still land; a new report or a pick cancels the wait.
 */
const FIELD_LEFT_GRACE_MS = 150;

/** What a login without a username is called in the list. */
const NO_USERNAME_TITLE = "No username";

/** The footer under a list of logins. */
const MANAGE_PASSWORDS_TITLE = "Manage passwords…";

/** A row of the list: what main knows about it (a login's id, never its password) and what the page draws. */
interface ListRow {
  entry: { kind: "login"; loginId: string } | { kind: "value"; fieldKind: FormFieldKind; value: string } | { kind: "manage" };
  item: AutofillItem;
}

/** The list on screen. */
interface ShownList {
  tabId: ItemId;
  profileId: ProfileId;
  origin: string;
  window: BrowserWindow;
  fieldRect: FieldRect;
  rows: ListRow[];
  highlightedIndex: number;
  /** The tab view's bounds when the list was placed; a change (layout, resize) closes the list. */
  tabViewBounds: PlacementBox;
  stopListening: () => void;
}

let popupView: WebContentsView | null = null;
let popupReady: Promise<void> = Promise.resolve();
let shownList: ShownList | null = null;

/** Opens Library › Passwords for a profile (given at startup; the list does not know the Library). */
let openPasswordsFor: (profileId: ProfileId) => void = () => undefined;

/** Counts field reports and closings, so an answer from the vault that arrives late can tell it is out of date. */
let requestCounter = 0;
let fieldLeftTimer: NodeJS.Timeout | null = null;

/**
 * Connects the list to the forms bridge, to its page and to layout changes. Runs once at startup.
 */
export function initializeAutofill(openPasswords: (profileId: ProfileId) => void): void {
  openPasswordsFor = openPasswords;
  onFieldFocused((report) => {
    showForField(report).catch((error) => {
      console.error("Could not show the autofill list:", error instanceof Error ? error.name : "");
    });
  });
  onFieldLeft(handleFieldLeft);
  ipcMain.handle(AUTOFILL_CHANNELS.choose, handleChoose);
  ipcMain.handle(AUTOFILL_CHANNELS.manage, handleManage);
  addAfterSyncHook(closeWhenTabMoved);
}

/** The list's view, made the first time a list is needed. Its page loads once and is reused. */
function ensurePopupView(): WebContentsView {
  if (popupView !== null) {
    return popupView;
  }
  const preloadPath = path.join(__dirname, "..", "preload", "autofillPopupPreload.js");
  const view = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: preloadPath },
  });
  view.setBackgroundColor("#00000000");
  view.webContents.on("will-navigate", (event) => event.preventDefault());
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  popupReady = new Promise((resolve) => view.webContents.once("did-finish-load", () => resolve()));
  view.webContents.loadFile(path.join(__dirname, "..", "..", "web", "autofill", "popup.html"));
  popupView = view;
  return view;
}

/** True when the active Space draws dark (its own setting, or the system's for "automatic"), as the overlay does. */
function isActiveSpaceDark(): boolean {
  const appearance = getActiveSpace(getState()).theme.appearance;
  if (appearance === "auto") {
    return nativeTheme.shouldUseDarkColors;
  }
  return appearance === "dark";
}

function makeLoginRow(loginId: string, username: string): ListRow {
  const title = username === "" ? NO_USERNAME_TITLE : username;
  return { entry: { kind: "login", loginId: loginId }, item: { kind: "login", title: title } };
}

function makeValueRows(vault: PasswordVault, fieldKind: FormFieldKind, typed: string): ListRow[] {
  const values = suggestEntries(vault, fieldKind, typed);
  return values.map((value) => ({
    entry: { kind: "value", fieldKind: fieldKind, value: value },
    item: { kind: "value", title: value },
  }));
}

function makeManageRow(): ListRow {
  return { entry: { kind: "manage" }, item: { kind: "manage", title: MANAGE_PASSWORDS_TITLE } };
}

/** Saved logins of the site; for the username field only those that start with what was typed. */
function makeLoginRows(vault: PasswordVault, report: FieldReport): ListRow[] {
  const { role, typed } = report.message;
  const typedStart = typed.trim().toLowerCase();
  const logins = findLoginsForOrigin(vault, report.origin);
  const matching = role === "username" ? logins.filter((login) => login.username.toLowerCase().startsWith(typedStart)) : logins;
  return matching.slice(0, MAX_LOGIN_SUGGESTIONS).map((login) => makeLoginRow(login.id, login.username));
}

/** What the list holds for this field; nothing for a field Bow has nothing for. */
function makeRows(vault: PasswordVault, report: FieldReport, remembersFormEntries: boolean): ListRow[] {
  const { role, typed } = report.message;
  if (role === "newPassword") {
    // No password generator yet: a new-password field gets no list.
    return [];
  }
  if (role === "username" || role === "password") {
    const loginRows = makeLoginRows(vault, report);
    const showsEmailsInstead = loginRows.length === 0 && role === "username" && remembersFormEntries;
    if (showsEmailsInstead) {
      return makeValueRows(vault, "email", typed);
    }
    // The footer only follows logins: a list of nothing else has no reason to open the Library.
    return loginRows.length === 0 ? [] : [...loginRows, makeManageRow()];
  }
  return remembersFormEntries ? makeValueRows(vault, role, typed) : [];
}

/**
 * A field was clicked, tabbed into or typed in: shows its list, or closes the one on screen when there is nothing
 * to list. Answers that come back after a newer report or a closing are dropped.
 */
async function showForField(report: FieldReport): Promise<void> {
  cancelFieldLeft();
  requestCounter = requestCounter + 1;
  const requestNumber = requestCounter;
  const window = getWindow();
  const isInFocusedWindow = getShownTabIdsInWindow(getState().focusedWindowId).includes(report.tabId);
  if (window === null || !isInFocusedWindow || isOverlayShown()) {
    closeAutofillPopup();
    return;
  }
  const access = await openVault(report.profileId);
  if (requestNumber !== requestCounter) {
    return;
  }
  const remembersFormEntries = getState().settings.remembersFormEntries !== false;
  const rows = access.status === "ready" ? makeRows(access.vault, report, remembersFormEntries) : [];
  const view = getTabViews().get(report.tabId);
  const contents = getTabContents(report.tabId);
  if (rows.length === 0 || view === undefined || contents === null) {
    closeAutofillPopup();
    return;
  }
  ensurePopupView();
  await popupReady;
  if (requestNumber !== requestCounter) {
    return;
  }
  if (shownList !== null) {
    shownList.stopListening();
  }
  shownList = {
    tabId: report.tabId,
    profileId: report.profileId,
    origin: report.origin,
    window: window,
    fieldRect: report.message.rect,
    rows: rows,
    highlightedIndex: -1,
    tabViewBounds: view.getBounds(),
    stopListening: listenToTab(contents),
  };
  drawList(shownList);
}

/**
 * Puts the list where its field is and tells the page what to draw. Closes the list when it has no safe place.
 */
function drawList(list: ShownList): void {
  const view = popupView;
  const contents = getTabContents(list.tabId);
  if (view === null || contents === null || list.window.isDestroyed()) {
    closeAutofillPopup();
    return;
  }
  const items = list.rows.map((row) => row.item);
  const placement = computePopupPlacement(list.fieldRect, contents.getZoomFactor(), list.tabViewBounds, items);
  if (placement === null) {
    closeAutofillPopup();
    return;
  }
  const message: AutofillShowMessage = {
    items: items,
    highlightedIndex: list.highlightedIndex,
    isDark: isActiveSpaceDark(),
    isAbove: placement.isAbove,
  };
  view.setBounds(placement.bounds);
  view.webContents.send(AUTOFILL_CHANNELS.show, message);
  // Adding a view again moves it to the top of the window (and to this window when it was in another).
  list.window.contentView.addChildView(view);
}

/**
 * Takes the list away and drops every answer still on its way.
 */
export function closeAutofillPopup(): void {
  requestCounter = requestCounter + 1;
  cancelFieldLeft();
  const list = shownList;
  if (list === null) {
    return;
  }
  shownList = null;
  list.stopListening();
  if (popupView !== null && !list.window.isDestroyed()) {
    list.window.contentView.removeChildView(popupView);
  }
}

/**
 * A main window is closing or lost the focus: its list goes (a list lives in one window at a time).
 */
export function leaveWindow(window: BrowserWindow): void {
  if (shownList !== null && shownList.window === window) {
    closeAutofillPopup();
  }
}

/**
 * Puts the list back on top of its window after new page views were added there (they land above it).
 */
export function raiseAutofillPopupIfShown(window: BrowserWindow): void {
  if (shownList === null || popupView === null || shownList.window !== window) {
    return;
  }
  window.contentView.addChildView(popupView);
}

function cancelFieldLeft(): void {
  if (fieldLeftTimer !== null) {
    clearTimeout(fieldLeftTimer);
    fieldLeftTimer = null;
  }
}

/**
 * The field lost the focus. The list waits a moment before it goes: pressing the mouse on the list takes the page's
 * focus first, and the pick must still land.
 */
function handleFieldLeft(tabId: ItemId): void {
  if (shownList === null) {
    // A list still being prepared for this field is out of date now.
    requestCounter = requestCounter + 1;
    return;
  }
  if (shownList.tabId !== tabId || fieldLeftTimer !== null) {
    return;
  }
  fieldLeftTimer = setTimeout(() => {
    fieldLeftTimer = null;
    if (shownList !== null && shownList.tabId === tabId) {
      closeAutofillPopup();
    }
  }, FIELD_LEFT_GRACE_MS);
}

/**
 * Closes the list when its tab is no longer shown in the focused window or its view moved or changed size.
 */
function closeWhenTabMoved(): void {
  const list = shownList;
  if (list === null) {
    return;
  }
  const isStillShown = getShownTabIdsInWindow(getState().focusedWindowId).includes(list.tabId);
  const currentBounds = getTabViews().get(list.tabId)?.getBounds();
  const before = list.tabViewBounds;
  const isSameBounds =
    currentBounds !== undefined &&
    currentBounds.x === before.x &&
    currentBounds.y === before.y &&
    currentBounds.width === before.width &&
    currentBounds.height === before.height;
  if (!isStillShown || !isSameBounds || getWindow() !== list.window) {
    closeAutofillPopup();
  }
}

/**
 * Watches the tab while its list is shown: the keys that drive the list, a navigation and the page going away.
 * Returns the function that stops watching.
 */
function listenToTab(contents: WebContents): () => void {
  const handleInput = (event: Electron.Event, input: Electron.Input): void => handleKey(event, input);
  const handleNavigation = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
    if (details.isMainFrame && !details.isSameDocument) {
      closeAutofillPopup();
    }
  };
  const handleDestroyed = (): void => closeAutofillPopup();
  contents.on("before-input-event", handleInput);
  contents.on("did-start-navigation", handleNavigation);
  contents.once("destroyed", handleDestroyed);
  return () => {
    contents.removeListener("before-input-event", handleInput);
    contents.removeListener("did-start-navigation", handleNavigation);
    contents.removeListener("destroyed", handleDestroyed);
  };
}

function moveHighlight(list: ShownList, step: number): void {
  const lastIndex = list.rows.length - 1;
  // Up from the first row leaves the list without a highlight (-1), so Return still sends the form.
  list.highlightedIndex = Math.min(Math.max(list.highlightedIndex + step, -1), lastIndex);
  drawList(list);
}

/**
 * Forgets the highlighted remembered value (Shift+Delete, as in Chrome). Logins are removed in the Library only.
 */
function forgetHighlightedValue(list: ShownList): boolean {
  const row = list.rows[list.highlightedIndex];
  if (row === undefined || row.entry.kind !== "value") {
    return false;
  }
  const { fieldKind, value } = row.entry;
  changeVault(list.profileId, (vault) => forgetEntry(vault, fieldKind, value)).catch(() => undefined);
  list.rows.splice(list.highlightedIndex, 1);
  if (list.rows.length === 0) {
    closeAutofillPopup();
    return true;
  }
  list.highlightedIndex = Math.min(list.highlightedIndex, list.rows.length - 1);
  drawList(list);
  return true;
}

/**
 * The keys of the list, heard on the tab's page while the list is shown. Return with nothing highlighted is not
 * taken: the form must still be sent.
 */
function handleKey(event: Electron.Event, input: Electron.Input): void {
  const list = shownList;
  if (list === null || input.type !== "keyDown") {
    return;
  }
  const hasCommandModifier = input.control || input.alt || input.meta;
  if (hasCommandModifier) {
    return;
  }
  if (input.shift && (input.key === "Delete" || input.key === "Backspace")) {
    if (forgetHighlightedValue(list)) {
      event.preventDefault();
    }
    return;
  }
  if (input.shift) {
    return;
  }
  if (input.key === "ArrowDown" || input.key === "ArrowUp") {
    event.preventDefault();
    moveHighlight(list, input.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (input.key === "Escape") {
    event.preventDefault();
    closeAutofillPopup();
    return;
  }
  if (input.key === "Enter" && list.highlightedIndex >= 0) {
    event.preventDefault();
    pickRow(list.highlightedIndex);
    return;
  }
  if (input.key === "Enter" || input.key === "Tab") {
    closeAutofillPopup();
  }
}

/** The page's pointer press on a row. Only our own list page may ask, with a row that exists. */
function handleChoose(event: IpcMainInvokeEvent, index: unknown): void {
  const isFromPopup = popupView !== null && event.sender === popupView.webContents;
  const list = shownList;
  if (!isFromPopup || list === null || typeof index !== "number" || !Number.isInteger(index)) {
    return;
  }
  if (index < 0 || index >= list.rows.length) {
    return;
  }
  pickRow(index);
}

/** The page's pointer press on the "Manage passwords…" footer. Only our own list page may ask, while a list is shown. */
function handleManage(event: IpcMainInvokeEvent): void {
  const isFromPopup = popupView !== null && event.sender === popupView.webContents;
  const list = shownList;
  if (!isFromPopup || list === null) {
    return;
  }
  const hasManageRow = list.rows.some((row) => row.entry.kind === "manage");
  if (hasManageRow) {
    openManagePasswords(list);
  }
}

function openManagePasswords(list: ShownList): void {
  closeAutofillPopup();
  openPasswordsFor(list.profileId);
}

/**
 * Fills the picked row and closes the list. The list goes first: filling gives the keyboard back to the page.
 */
function pickRow(index: number): void {
  const list = shownList;
  const row = list?.rows[index];
  if (list === null || row === undefined) {
    return;
  }
  if (row.entry.kind === "manage") {
    openManagePasswords(list);
    return;
  }
  closeAutofillPopup();
  fillRow(list, row).catch((error) => {
    console.error("Could not fill the picked entry:", error instanceof Error ? error.name : "");
  });
}

async function fillRow(list: ShownList, row: ListRow): Promise<void> {
  if (row.entry.kind === "manage") {
    return;
  }
  if (row.entry.kind === "value") {
    fillValue(list.tabId, list.origin, { value: row.entry.value });
    return;
  }
  const loginId = row.entry.loginId;
  // Read again now: the password was never kept while the list was open.
  const access = await openVault(list.profileId);
  if (access.status !== "ready") {
    return;
  }
  const login = access.vault.logins.find((candidate) => candidate.id === loginId);
  if (login === undefined || !isSameLoginSite(login.origin, list.origin)) {
    return;
  }
  const wasFilled = fillLogin(list.tabId, list.origin, { username: login.username, password: login.password });
  if (wasFilled) {
    await changeVault(list.profileId, (vault) => markLoginUsed(vault, loginId, Date.now()));
  }
}
