/**
 * WHY this file exists:
 *   Library › Passwords needs main-process glue between the overlay page and the vault: what to list (never a
 *   password), which profile is shown, and the few calls that do touch a secret (show, copy, edit). Those calls ask
 *   passwordAuth.ts first, so a password only leaves the vault after the user proved it is them, and a copied password
 *   never travels to the overlay page at all: main writes the clipboard and clears it again later.
 *
 * Data source:
 *   The profile's vault (passwordVault.ts; rules in passwords.ts and formMemory.ts), the saved state (profiles,
 *   Spaces, the two settings) and the system clipboard.
 *
 * Data flow:
 *   overlayController.ts buildLibraryData → buildPasswordsData() → LibraryData.passwords (titles only)
 *   overlay "reveal / copy / edit" invoke → readLoginAfterAuth() → ensureUserPresent() → vault → answer or clipboard
 *   actionRunner.ts (remove, forget, retry) → the functions below → changeVault() → onVaultChanged → the Library redraws
 */
import { app, clipboard } from "electron";
import type { BrowserState, ProfileId } from "../shared/types";
import type { PasswordsData } from "../shared/overlay";
import { CLIPBOARD_CLEAR_MS } from "../shared/settings";
import { forgetAllEntries } from "./formMemory";
import { ensureUserPresent } from "./passwordAuth";
import { editLogin, removeLogin, removeNeverSave, siteKeyFor } from "./passwords";
import type { SavedLogin } from "./passwords";
import { changeVault, openVault, peekVault, retryVault } from "./passwordVault";
import { showToast } from "./statusBubble";
import { getActiveSpace } from "./tree";

/** The profile the user picked in the section, or null: then the focused window's active Space decides. Not saved. */
let chosenProfileId: ProfileId | null = null;

let copiedPasswordTimer: NodeJS.Timeout | null = null;
let copiedPassword: string | null = null;
let isWatchingQuit = false;

function isKnownProfile(state: BrowserState, profileId: ProfileId): boolean {
  return state.profiles.some((profile) => profile.id === profileId);
}

/** The profile the section shows: the picked one, else the profile of the focused window's active Space. */
export function resolvePasswordsProfileId(state: BrowserState): ProfileId {
  if (chosenProfileId !== null && isKnownProfile(state, chosenProfileId)) {
    return chosenProfileId;
  }
  return getActiveSpace(state).profileId;
}

/** Shows this profile's passwords (null: back to the active Space's profile, as when the section is opened fresh). */
export function choosePasswordsProfile(state: BrowserState, profileId: ProfileId | null): void {
  chosenProfileId = profileId !== null && isKnownProfile(state, profileId) ? profileId : null;
}

/** "https://www.example.com:8080" → "example.com:8080". Text that is no address is shown as it is. */
function describeSite(origin: string): string {
  const siteKey = siteKeyFor(origin);
  try {
    return new URL(siteKey).host;
  } catch {
    return siteKey;
  }
}

function sortLoginsForList(first: { site: string; username: string }, second: { site: string; username: string }): number {
  const bySite = first.site.localeCompare(second.site);
  return bySite !== 0 ? bySite : first.username.localeCompare(second.username);
}

/**
 * What the section draws. Only when `isShown` it reads the vault: reading can make macOS ask for the Keychain, which
 * must not happen just because the Library is open on another section. A vault not read yet is loaded in the
 * background and `onVaultLoaded` runs when it is there. Never contains a password.
 */
export function buildPasswordsData(state: BrowserState, isShown: boolean, onVaultLoaded: () => void): PasswordsData {
  const profileId = resolvePasswordsProfileId(state);
  const emptyData: PasswordsData = {
    profiles: state.profiles.map((profile) => ({ id: profile.id, name: profile.name })),
    profileId: profileId,
    status: "loading",
    logins: [],
    neverSaveSites: [],
    formEntryCount: 0,
    offersToSavePasswords: state.settings.offersToSavePasswords !== false,
    remembersFormEntries: state.settings.remembersFormEntries !== false,
  };
  if (!isShown) {
    return emptyData;
  }
  const access = peekVault(profileId);
  if (access === null) {
    openVault(profileId).then(onVaultLoaded).catch(() => undefined);
    return emptyData;
  }
  if (access.status !== "ready") {
    return { ...emptyData, status: access.status };
  }
  const logins = access.vault.logins.map((login) => ({ id: login.id, site: describeSite(login.origin), username: login.username }));
  const neverSaveSites = access.vault.neverSaveOrigins.map((origin) => ({ origin: origin, site: describeSite(origin) }));
  logins.sort(sortLoginsForList);
  neverSaveSites.sort((first, second) => first.site.localeCompare(second.site));
  return { ...emptyData, status: "ready", logins: logins, neverSaveSites: neverSaveSites, formEntryCount: access.vault.formEntries.length };
}

/** The saved login, or null when the profile or the login is unknown or the vault is not open. */
async function findSavedLogin(state: BrowserState, profileId: ProfileId, loginId: string): Promise<SavedLogin | null> {
  if (!isKnownProfile(state, profileId)) {
    return null;
  }
  const access = await openVault(profileId);
  if (access.status !== "ready") {
    return null;
  }
  return access.vault.logins.find((login) => login.id === loginId) ?? null;
}

/** Like findSavedLogin, but only after the user proved it is them. Nothing is read without that. */
async function findSavedLoginAfterAuth(state: BrowserState, profileId: ProfileId, loginId: string): Promise<SavedLogin | null> {
  if (!isKnownProfile(state, profileId)) {
    return null;
  }
  const isUserPresent = await ensureUserPresent();
  if (!isUserPresent) {
    return null;
  }
  return findSavedLogin(state, profileId, loginId);
}

/** The password for the Show button; null without Touch ID. The page keeps it only while it is shown. */
export async function revealPassword(state: BrowserState, profileId: ProfileId, loginId: string): Promise<string | null> {
  const login = await findSavedLoginAfterAuth(state, profileId, loginId);
  return login === null ? null : login.password;
}

async function clearCopiedPassword(): Promise<void> {
  if (copiedPasswordTimer !== null) {
    clearTimeout(copiedPasswordTimer);
    copiedPasswordTimer = null;
  }
  const password = copiedPassword;
  copiedPassword = null;
  if (password === null) {
    return;
  }
  // Only when the clipboard still holds it: something the user copied since stays.
  const clipboardText = await clipboard.readText();
  if (clipboardText === password) {
    clipboard.clear();
  }
}

/** Copies the password for the user; the page only hears whether it worked. */
export async function copyPassword(state: BrowserState, profileId: ProfileId, loginId: string): Promise<boolean> {
  const login = await findSavedLoginAfterAuth(state, profileId, loginId);
  if (login === null) {
    return false;
  }
  // A password copied before is overwritten by this one, so its timer has nothing left to clear.
  if (copiedPasswordTimer !== null) {
    clearTimeout(copiedPasswordTimer);
  }
  await clipboard.writeText(login.password);
  copiedPassword = login.password;
  copiedPasswordTimer = setTimeout(() => void clearCopiedPassword(), CLIPBOARD_CLEAR_MS);
  if (!isWatchingQuit) {
    isWatchingQuit = true;
    // A password should not outlive Bow on the clipboard. Reading the clipboard is asynchronous, so this is best effort:
    // before-quit comes first, and closing the windows afterwards gives the read time to finish.
    app.on("before-quit", () => void clearCopiedPassword());
  }
  showToast("Password copied").catch(() => undefined);
  return true;
}

/** The username is not a secret (the list shows it), so copying it needs no Touch ID. */
export async function copyUsername(state: BrowserState, profileId: ProfileId, loginId: string): Promise<boolean> {
  const login = await findSavedLogin(state, profileId, loginId);
  if (login === null) {
    return false;
  }
  await clipboard.writeText(login.username);
  showToast("Username copied").catch(() => undefined);
  return true;
}

/** Saves the edit form. True when the new values are in the vault (also when they are the ones it already had). */
export async function saveEditedLogin(state: BrowserState, profileId: ProfileId, loginId: string, username: string, password: string): Promise<boolean> {
  const login = await findSavedLoginAfterAuth(state, profileId, loginId);
  if (login === null) {
    return false;
  }
  const isChanged = await changeVault(profileId, (vault) => editLogin(vault, loginId, { username: username, password: password }, Date.now()));
  const isAlreadyThere = login.username === username.trim() && login.password === password;
  return isChanged || isAlreadyThere;
}

/** The trash button. No Touch ID: deleting reveals nothing. */
export function deleteSavedLogin(state: BrowserState, profileId: ProfileId, loginId: string): void {
  if (!isKnownProfile(state, profileId)) {
    return;
  }
  changeVault(profileId, (vault) => removeLogin(vault, loginId)).catch(() => undefined);
}

export function allowSavingOnSite(state: BrowserState, profileId: ProfileId, origin: string): void {
  if (!isKnownProfile(state, profileId)) {
    return;
  }
  changeVault(profileId, (vault) => removeNeverSave(vault, origin)).catch(() => undefined);
}

export function forgetAllFormEntries(state: BrowserState, profileId: ProfileId): void {
  if (!isKnownProfile(state, profileId)) {
    return;
  }
  changeVault(profileId, (vault) => forgetAllEntries(vault)).catch(() => undefined);
}

/** "Try again" after the Keychain was refused; the Library redraws when the load is over. */
export function retryPasswordVault(state: BrowserState, profileId: ProfileId, onVaultLoaded: () => void): void {
  if (!isKnownProfile(state, profileId)) {
    return;
  }
  retryVault(profileId).then(onVaultLoaded).catch(() => undefined);
}
