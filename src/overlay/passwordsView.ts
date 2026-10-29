/**
 * WHY this file exists:
 *   Library › Passwords: the saved logins of one profile (site, username, dots), with Show, Copy and Edit behind Touch ID,
 *   the sites Bow never offers to save on, and the remembered form entries. The page never receives a password until
 *   the user asks for one: the list carries titles only, and Show, Copy and Edit go through main, which asks macOS for
 *   Touch ID first. A shown password lives only in this file's memory, until Hide, a redraw of another section, or
 *   the Library closing.
 *
 * Data source:
 *   LibraryData.passwords (overlayController.ts → passwordsLibrary.ts buildPasswordsData) and the on-demand calls
 *   window.overlayApi.revealPassword / copyPassword / copyUsername / editLogin.
 *
 * Data flow:
 *   Library › Passwords → renderPasswordsSection() → rows; Show → revealPassword → shown in the row
 *   Copy → copyPassword (main writes the clipboard) → toast from main; Edit… → revealPassword → form → editLogin
 *   trash / remove / Forget all / profile chip / Try again → dispatch(action) → main changes the vault → fresh data
 */
import type { LibraryData, PasswordsData, PasswordsLogin } from "../shared/overlay";
import { createElement, createFavicon, createIconButton, createTextButton, dispatch } from "../renderer/dom.js";

/** Shown when Touch ID (or the Mac's password) was not given, or the answer failed. */
const NOT_CONFIRMED_TEXT = "Bow couldn't confirm it's you. Touch ID or your Mac's password is needed to see saved passwords.";

/** Shown under the lists: where passwords are kept, and what leaves them out. */
const PASSWORDS_NOTE = "Saved passwords stay on this Mac, encrypted with a key in your Keychain. Backups and Sync leave them out.";

/** Dots shown instead of a password. */
const HIDDEN_PASSWORD_DOTS = "••••••••";

/** A login being edited: the form is shown only after the password was revealed (so after Touch ID). */
interface EditingLogin {
  loginId: string;
  username: string;
  password: string;
}

/** What the section remembers while it stays open. Cleared when the Library closes or shows another profile. */
let searchQuery = "";
let shownPasswords = new Map<string, string>();
let editingLogin: EditingLogin | null = null;
let isConfirmingForget = false;
let problemText = "";
let drawnProfileId = "";
let latestBuilders: SectionBuilders | null = null;

/** Parts library.ts builds, because it owns the look of its switch rows and of its empty states. */
export interface SectionBuilders {
  /** Draws the Library's body again with its newest data, keeping the scroll position (library.ts renderBody). */
  redraw: () => void;
  createSwitches: (data: LibraryData) => HTMLElement;
  createEmptyState: () => HTMLElement;
}

/**
 * Forgets everything the section holds, shown passwords included. Runs when the Library opens or closes.
 */
export function resetPasswordsView(): void {
  searchQuery = "";
  shownPasswords = new Map<string, string>();
  editingLogin = null;
  isConfirmingForget = false;
  problemText = "";
  drawnProfileId = "";
}

window.overlayApi.onClosing(resetPasswordsView);

/**
 * Draws the section again after a click changed what this file remembers (a password shown, a form opened).
 */
function redraw(): void {
  latestBuilders?.redraw();
}

/**
 * A call that needed Touch ID failed: say so quietly, once, above the lists.
 */
function showNotConfirmed(): void {
  problemText = NOT_CONFIRMED_TEXT;
  redraw();
}

function toggleShownPassword(profileId: string, login: PasswordsLogin): void {
  if (shownPasswords.has(login.id)) {
    shownPasswords.delete(login.id);
    redraw();
    return;
  }
  window.overlayApi
    .revealPassword(profileId, login.id)
    .then((password) => {
      if (password === null) {
        showNotConfirmed();
        return;
      }
      problemText = "";
      shownPasswords.set(login.id, password);
      redraw();
    })
    .catch(showNotConfirmed);
}

function copyPasswordOf(profileId: string, login: PasswordsLogin): void {
  window.overlayApi
    .copyPassword(profileId, login.id)
    .then((isCopied) => {
      problemText = isCopied ? "" : NOT_CONFIRMED_TEXT;
      redraw();
    })
    .catch(showNotConfirmed);
}

function copyUsernameOf(profileId: string, login: PasswordsLogin): void {
  window.overlayApi.copyUsername(profileId, login.id).catch(() => undefined);
}

/** Edit…: asks for Touch ID by revealing the password, then opens the form with it filled in. */
function startEditing(profileId: string, login: PasswordsLogin): void {
  window.overlayApi
    .revealPassword(profileId, login.id)
    .then((password) => {
      if (password === null) {
        showNotConfirmed();
        return;
      }
      problemText = "";
      editingLogin = { loginId: login.id, username: login.username, password: password };
      redraw();
    })
    .catch(showNotConfirmed);
}

function stopEditing(): void {
  editingLogin = null;
  redraw();
}

/** Save in the edit form. A refused edit (empty password, no Touch ID) keeps the form open with a line about it. */
function saveEditing(profileId: string, username: string, password: string): void {
  const editing = editingLogin;
  if (editing === null) {
    return;
  }
  window.overlayApi
    .editLogin(profileId, editing.loginId, username, password)
    .then((isSaved) => {
      if (!isSaved) {
        // Keep what was typed: the redraw builds the form again.
        editingLogin = { loginId: editing.loginId, username: username, password: password };
        problemText = "Bow couldn't save this. Check that the password isn't empty, and that Touch ID or your Mac's password is confirmed.";
        redraw();
        return;
      }
      problemText = "";
      shownPasswords.delete(editing.loginId);
      editingLogin = null;
      redraw();
    })
    .catch(showNotConfirmed);
}

function createEditForm(profileId: string, editing: EditingLogin): HTMLElement {
  const form = document.createElement("form");
  form.className = "library-line password-edit-form";
  const usernameInput = document.createElement("input");
  usernameInput.className = "library-search";
  usernameInput.placeholder = "Username";
  usernameInput.setAttribute("aria-label", "Username");
  usernameInput.value = editing.username;
  usernameInput.dataset.keep = "password-edit-username";
  const passwordInput = document.createElement("input");
  passwordInput.className = "library-search";
  passwordInput.type = "password";
  passwordInput.placeholder = "Password";
  passwordInput.setAttribute("aria-label", "Password");
  passwordInput.value = editing.password;
  passwordInput.dataset.keep = "password-edit-password";
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "library-chip is-active";
  saveButton.textContent = "Save";
  const cancelButton = createTextButton("Cancel", "library-chip", stopEditing);
  form.append(usernameInput, passwordInput, saveButton, cancelButton);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveEditing(profileId, usernameInput.value, passwordInput.value);
  });
  return form;
}

/** One saved login: its site, its username, dots or the shown password, and the buttons. */
function createLoginRow(profileId: string, login: PasswordsLogin): HTMLElement {
  const row = createElement("div", "library-line password-row");
  row.dataset.loginId = login.id;
  const isShown = shownPasswords.has(login.id);
  const username = login.username === "" ? "No username" : login.username;
  const text = createElement("span", "library-line-text");
  const secretLine = createElement("span", "library-line-meta password-secret", isShown ? (shownPasswords.get(login.id) ?? "") : HIDDEN_PASSWORD_DOTS);
  text.append(createElement("span", "library-line-title", login.site), createElement("span", "library-line-meta password-username", username), secretLine);
  const showLabel = isShown ? "Hide password" : "Show password";
  row.append(
    createFavicon(null, `https://${login.site}/`),
    text,
    createIconButton(isShown ? "eyeSlash" : "eye", showLabel, "library-line-icon-button", () => toggleShownPassword(profileId, login)),
    createIconButton("copy", "Copy password", "library-line-icon-button", () => copyPasswordOf(profileId, login)),
    createIconButton("person", "Copy username", "library-line-icon-button", () => copyUsernameOf(profileId, login)),
    createIconButton("pencil", "Edit…", "library-line-icon-button", () => startEditing(profileId, login)),
    createIconButton("trash", "Delete password", "library-line-icon-button", () => dispatch({ type: "removeSavedLogin", profileId: profileId, loginId: login.id })),
  );
  return row;
}

function matchesSearch(login: PasswordsLogin): boolean {
  const words = searchQuery.toLowerCase().split(/\s+/).filter((word) => word !== "");
  const searchable = `${login.site} ${login.username}`.toLowerCase();
  return words.every((word) => searchable.includes(word));
}

/** The login rows (the one being edited shows its form), for the search text. */
function drawLoginRows(list: HTMLElement, passwords: PasswordsData): void {
  const rows = passwords.logins.filter(matchesSearch).map((login) => {
    const isEditing = editingLogin !== null && editingLogin.loginId === login.id;
    return isEditing ? createEditForm(passwords.profileId, editingLogin as EditingLogin) : createLoginRow(passwords.profileId, login);
  });
  list.replaceChildren(...rows);
}

function createToolbar(passwords: PasswordsData, list: HTMLElement): HTMLElement {
  const toolbar = createElement("div", "library-controls");
  const search = document.createElement("input");
  search.className = "library-search";
  search.type = "search";
  search.placeholder = "Search passwords";
  search.value = searchQuery;
  search.setAttribute("aria-label", "Search passwords");
  search.dataset.keep = "passwords-search";
  search.addEventListener("input", () => {
    searchQuery = search.value;
    drawLoginRows(list, passwords);
  });
  toolbar.append(search);
  if (passwords.profiles.length < 2) {
    return toolbar;
  }
  for (const profile of passwords.profiles) {
    const isCurrent = profile.id === passwords.profileId;
    toolbar.append(createTextButton(profile.name, isCurrent ? "library-chip is-active" : "library-chip", () => dispatch({ type: "choosePasswordsProfile", profileId: profile.id })));
  }
  return toolbar;
}

function createNeverSavedGroup(passwords: PasswordsData): HTMLElement | null {
  if (passwords.neverSaveSites.length === 0) {
    return null;
  }
  const group = createElement("section", "password-group password-never-saved");
  group.append(createElement("h2", "library-setting-heading", "Never saved for"));
  for (const site of passwords.neverSaveSites) {
    const row = createElement("div", "library-line password-never-row");
    row.dataset.origin = site.origin;
    const text = createElement("span", "library-line-text");
    text.append(createElement("span", "library-line-title", site.site));
    row.append(text, createIconButton("close", "Offer to save passwords here again", "library-line-icon-button", () => dispatch({ type: "removeNeverSave", profileId: passwords.profileId, origin: site.origin })));
    group.append(row);
  }
  return group;
}

function createFormMemoryGroup(passwords: PasswordsData): HTMLElement {
  const group = createElement("section", "password-group password-form-memory");
  group.append(createElement("h2", "library-setting-heading", "Remembered form entries"));
  const count = passwords.formEntryCount;
  const row = createElement("div", "library-line password-form-memory-row");
  const summary = count === 0 ? "Nothing remembered" : `${count} remembered ${count === 1 ? "entry" : "entries"}`;
  const text = createElement("span", "library-line-text");
  text.append(createElement("span", "library-line-title password-form-memory-count", summary));
  row.append(text);
  if (count > 0) {
    const label = isConfirmingForget ? "Click again to forget all" : "Forget all";
    const className = isConfirmingForget ? "library-chip danger is-confirming password-forget-all" : "library-chip danger password-forget-all";
    row.append(
      createTextButton(label, className, () => {
        if (!isConfirmingForget) {
          isConfirmingForget = true;
          redraw();
          return;
        }
        isConfirmingForget = false;
        dispatch({ type: "forgetFormEntries", profileId: passwords.profileId });
      }),
    );
  }
  group.append(row);
  return group;
}

/** The section when the vault could not be read: what happened, and Try again when that can help. */
function createUnreadableNote(passwords: PasswordsData): HTMLElement {
  const note = createElement("div", "library-empty-state password-unreadable");
  const isLocked = passwords.status === "locked";
  const message = isLocked ? "Bow couldn't open your saved passwords. macOS may not have allowed access to the Keychain." : "Saved passwords need the Mac's Keychain, which isn't available.";
  note.append(createElement("h3", "library-empty-title", isLocked ? "Passwords are locked" : "Passwords aren't available"), createElement("p", "library-empty-text", message));
  if (isLocked) {
    note.append(createTextButton("Try again", "library-chip is-active password-try-again", () => dispatch({ type: "retryPasswordVault", profileId: passwords.profileId })));
  }
  return note;
}

function drawSection(body: HTMLElement, data: LibraryData, builders: SectionBuilders): void {
  const passwords = data.passwords;
  // Another profile starts clean: nothing shown, nothing half-edited, no old search.
  if (drawnProfileId !== passwords.profileId) {
    resetPasswordsView();
    drawnProfileId = passwords.profileId;
  }
  latestBuilders = builders;
  const section = createElement("div", "library-passwords");
  const list = createElement("div", "password-list");
  const toolbar = createToolbar(passwords, list);
  const scrolling = createElement("div", "library-settings password-scroll");
  if (problemText !== "") {
    scrolling.append(createElement("p", "library-setting-note password-problem", problemText));
  }
  if (passwords.status === "loading") {
    scrolling.append(createElement("p", "library-setting-note password-loading", "Opening your saved passwords…"));
  }
  if (passwords.status === "locked" || passwords.status === "unavailable") {
    scrolling.append(createUnreadableNote(passwords));
  }
  if (passwords.status === "ready") {
    scrolling.append(builders.createSwitches(data));
    drawLoginRows(list, passwords);
    scrolling.append(list);
    if (passwords.logins.length === 0) {
      scrolling.append(builders.createEmptyState());
    }
    const neverSaved = createNeverSavedGroup(passwords);
    if (neverSaved !== null) {
      scrolling.append(neverSaved);
    }
    scrolling.append(createFormMemoryGroup(passwords));
  }
  scrolling.append(createElement("p", "library-setting-note password-note", PASSWORDS_NOTE));
  section.append(toolbar, scrolling);
  body.replaceChildren(section);
}

/**
 * Draws Library › Passwords into the body.
 */
export function renderPasswordsSection(body: HTMLElement, data: LibraryData, builders: SectionBuilders): void {
  drawSection(body, data, builders);
}
