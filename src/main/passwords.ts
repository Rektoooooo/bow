/**
 * WHY this file exists:
 *   Bow Passwords keeps the user's saved logins (site, username, password), the sites where Bow must never offer to
 *   save, and the remembered form entries. These pure functions hold every rule: which site a login belongs to,
 *   when to offer saving or updating, and how the vault changes. No Electron and no clock: encryption and files
 *   are another module's job, and `now` and new ids are parameters.
 *
 * Data source:
 *   The decrypted vault (parseVault checks it, because the file may be damaged or from another program), plus
 *   logins reported by pages and edits made in the Library.
 *
 * Data flow:
 *   page submits a login → decideOffer() → prompt → saveLogin() / updateLoginPassword() → vault is encrypted and saved
 *   Library → editLogin() / removeLogin(); autofill → findLoginsForOrigin() → markLoginUsed()
 */
import { isFormFieldKind, type FormFieldKind } from "../shared/passwords";
import { MAX_REMEMBERED_VALUE_LENGTH } from "./formMemory";

export const PASSWORD_VAULT_VERSION = 1;

/** Most saved logins. Our choice: far above what one person has (hundreds); bounds the size of the vault file. */
export const MAX_SAVED_LOGINS = 10_000;

/** Most sites with "never save". Our choice: bounds the vault file; the oldest entries go first. */
export const MAX_NEVER_SAVE_ORIGINS = 1_000;

/** Longest username or password. Our choice: real passwords are far shorter; refuses pasted garbage and huge files. */
export const MAX_LOGIN_FIELD_LENGTH = 1_024;

/** Sites serve the same account on "www.example.com" and "example.com"; Bow treats them as one site. */
const WWW_PREFIX = "www.";

const ALLOWED_LOGIN_PROTOCOLS = ["http:", "https:"];

export interface SavedLogin {
  id: string;
  origin: string;
  username: string;
  password: string;
  createdAt: number;
  changedAt: number;
  lastUsedAt?: number;
  timesUsed?: number;
}

export interface FormEntry {
  kind: FormFieldKind;
  value: string;
  timesUsed: number;
  lastUsedAt: number;
}

export interface PasswordVault {
  version: 1;
  logins: SavedLogin[];
  neverSaveOrigins: string[];
  formEntries: FormEntry[];
}

export type OfferDecision = { kind: "save" } | { kind: "update"; loginId: string } | { kind: "nothing" };

/** A vault with nothing in it: a profile's first one, before anything is saved. */
export function createEmptyVault(): PasswordVault {
  return { version: PASSWORD_VAULT_VERSION, logins: [], neverSaveOrigins: [], formEntries: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseSavedLogin(value: unknown): SavedLogin | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, origin, username, password, createdAt, changedAt, lastUsedAt, timesUsed } = value;
  if (typeof id !== "string" || id === "" || typeof origin !== "string" || origin === "") {
    return null;
  }
  if (typeof username !== "string" || username.length > MAX_LOGIN_FIELD_LENGTH) {
    return null;
  }
  if (typeof password !== "string" || password === "" || password.length > MAX_LOGIN_FIELD_LENGTH) {
    return null;
  }
  if (!isFiniteNumber(createdAt) || !isFiniteNumber(changedAt)) {
    return null;
  }
  const login: SavedLogin = { id, origin, username, password, createdAt, changedAt };
  if (isFiniteNumber(lastUsedAt)) {
    login.lastUsedAt = lastUsedAt;
  }
  if (isFiniteNumber(timesUsed)) {
    login.timesUsed = timesUsed;
  }
  return login;
}

function parseFormEntry(value: unknown): FormEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const { kind, value: text, timesUsed, lastUsedAt } = value;
  if (!isFormFieldKind(kind)) {
    return null;
  }
  if (typeof text !== "string" || text === "" || text.length > MAX_REMEMBERED_VALUE_LENGTH) {
    return null;
  }
  if (!isFiniteNumber(timesUsed) || !isFiniteNumber(lastUsedAt)) {
    return null;
  }
  return { kind, value: text, timesUsed, lastUsedAt };
}

/**
 * Checks data decrypted from disk. Null when it is not a version 1 vault; single damaged entries are dropped and the
 * good ones kept, so one bad entry never locks the user out of the rest. Never throws.
 */
export function parseVault(value: unknown): PasswordVault | null {
  if (!isRecord(value) || value.version !== PASSWORD_VAULT_VERSION) {
    return null;
  }
  const { logins, neverSaveOrigins, formEntries } = value;
  if (!Array.isArray(logins) || !Array.isArray(neverSaveOrigins) || !Array.isArray(formEntries)) {
    return null;
  }
  const vault = createEmptyVault();
  for (const rawLogin of logins) {
    const login = parseSavedLogin(rawLogin);
    if (login) {
      vault.logins.push(login);
    }
  }
  for (const rawOrigin of neverSaveOrigins) {
    if (typeof rawOrigin === "string" && rawOrigin !== "") {
      vault.neverSaveOrigins.push(rawOrigin);
    }
  }
  for (const rawEntry of formEntries) {
    const entry = parseFormEntry(rawEntry);
    if (entry) {
      vault.formEntries.push(entry);
    }
  }
  return vault;
}

/**
 * The origin of an http(s) address, or null for anything else (about:, android://, "null" origins, text that is no URL).
 * Example: "https://Example.com:443/login?x" → "https://example.com"
 */
export function normalizeLoginOrigin(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!ALLOWED_LOGIN_PROTOCOLS.includes(url.protocol)) {
    return null;
  }
  return url.origin;
}

/**
 * The origin with a leading "www." removed from the host (scheme and port stay), so www and non-www are one site.
 * Nothing else is merged: "login.example.com" is a different site from "example.com", because a login for one must
 * not be offered on a page that merely shares a parent domain. Text that is no URL is returned unchanged.
 */
export function siteKeyFor(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return origin;
  }
  const host = url.host.startsWith(WWW_PREFIX) ? url.host.slice(WWW_PREFIX.length) : url.host;
  return `${url.protocol}//${host}`;
}

/** True when two origins are one site for logins (only a leading "www." is ignored). */
export function isSameLoginSite(firstOrigin: string, secondOrigin: string): boolean {
  return siteKeyFor(firstOrigin) === siteKeyFor(secondOrigin);
}

function lastUseOrCreation(login: SavedLogin): number {
  return login.lastUsedAt ?? login.createdAt;
}

/** Logins for the site, the most recently used first (a never-used one counts from when it was saved), then A to Z. */
export function findLoginsForOrigin(vault: PasswordVault, origin: string): SavedLogin[] {
  const matching = vault.logins.filter((login) => isSameLoginSite(login.origin, origin));
  return matching.sort((first, second) => {
    const byRecency = lastUseOrCreation(second) - lastUseOrCreation(first);
    if (byRecency !== 0) {
      return byRecency;
    }
    return first.username.localeCompare(second.username);
  });
}

/** True when the user chose "Never for this site" for this site. */
export function isNeverSave(vault: PasswordVault, origin: string): boolean {
  return vault.neverSaveOrigins.includes(siteKeyFor(origin));
}

/** The login for this site and username. Case-sensitive like most sites, but stray spaces around the name are ignored. */
export function findLoginForSiteAndUsername(
  logins: readonly SavedLogin[],
  origin: string,
  username: string,
): SavedLogin | undefined {
  const trimmedUsername = username.trim();
  return logins.find((login) => isSameLoginSite(login.origin, origin) && login.username.trim() === trimmedUsername);
}

/** What to do after the user signed in on a page: offer to save, offer to update a changed password, or stay quiet. */
export function decideOffer(vault: PasswordVault, origin: string, username: string, password: string): OfferDecision {
  const nothing: OfferDecision = { kind: "nothing" };
  if (password === "" || password.length > MAX_LOGIN_FIELD_LENGTH || username.length > MAX_LOGIN_FIELD_LENGTH) {
    return nothing;
  }
  if (isNeverSave(vault, origin)) {
    return nothing;
  }
  const sameAccount = findLoginForSiteAndUsername(vault.logins, origin, username);
  if (sameAccount) {
    return sameAccount.password === password ? nothing : { kind: "update", loginId: sameAccount.id };
  }
  // Without a username (a password-only form) any saved password for the site that matches is "already saved".
  const isPasswordOnlyForm = username.trim() === "";
  const hasSamePassword = vault.logins.some(
    (login) => isSameLoginSite(login.origin, origin) && login.password === password,
  );
  if (isPasswordOnlyForm && hasSamePassword) {
    return nothing;
  }
  return { kind: "save" };
}

/** Index of the login nobody used for the longest time (a never-used one counts from its last change). */
function indexOfLeastRecentlyUsed(logins: readonly SavedLogin[]): number {
  let leastIndex = 0;
  let leastTime = Number.POSITIVE_INFINITY;
  for (let index = 0; index < logins.length; index++) {
    const login = logins[index];
    const lastTouched = login.lastUsedAt ?? login.changedAt;
    if (lastTouched < leastTime) {
      leastTime = lastTouched;
      leastIndex = index;
    }
  }
  return leastIndex;
}

function replaceLogin(vault: PasswordVault, loginId: string, replacement: SavedLogin): PasswordVault {
  const logins = vault.logins.map((login) => (login.id === loginId ? replacement : login));
  return { ...vault, logins };
}

/** Saves a login. For a site and username that already have one, the password of that login is updated instead. */
export function saveLogin(
  vault: PasswordVault,
  login: { origin: string; username: string; password: string },
  newId: string,
  now: number,
): PasswordVault {
  const existing = findLoginForSiteAndUsername(vault.logins, login.origin, login.username);
  if (existing) {
    return updateLoginPassword(vault, existing.id, login.password, now);
  }
  const newLogin: SavedLogin = {
    id: newId,
    origin: login.origin,
    username: login.username.trim(),
    password: login.password,
    createdAt: now,
    changedAt: now,
  };
  const keptLogins = [...vault.logins];
  if (keptLogins.length >= MAX_SAVED_LOGINS) {
    keptLogins.splice(indexOfLeastRecentlyUsed(keptLogins), 1);
  }
  return { ...vault, logins: [...keptLogins, newLogin] };
}

/** A changed password for a saved login (the user accepted "Update password"). Same vault when nothing changes. */
export function updateLoginPassword(vault: PasswordVault, loginId: string, password: string, now: number): PasswordVault {
  const login = vault.logins.find((candidate) => candidate.id === loginId);
  if (!login || login.password === password) {
    return vault;
  }
  return replaceLogin(vault, loginId, { ...login, password, changedAt: now });
}

/** An edit from the Library. Refuses an empty password and over-long fields. */
export function editLogin(
  vault: PasswordVault,
  loginId: string,
  change: { username: string; password: string },
  now: number,
): PasswordVault {
  const login = vault.logins.find((candidate) => candidate.id === loginId);
  if (!login) {
    return vault;
  }
  const username = change.username.trim();
  const { password } = change;
  if (password === "" || password.length > MAX_LOGIN_FIELD_LENGTH || username.length > MAX_LOGIN_FIELD_LENGTH) {
    return vault;
  }
  const passwordChanged = password !== login.password;
  if (username === login.username && !passwordChanged) {
    return vault;
  }
  const changedAt = passwordChanged ? now : login.changedAt;
  return replaceLogin(vault, loginId, { ...login, username, password, changedAt });
}

/** Deletes a saved login (the Library's delete button). */
export function removeLogin(vault: PasswordVault, loginId: string): PasswordVault {
  const logins = vault.logins.filter((login) => login.id !== loginId);
  return logins.length === vault.logins.length ? vault : { ...vault, logins };
}

/** Notes that a login was filled in, so the most used logins come first. */
export function markLoginUsed(vault: PasswordVault, loginId: string, now: number): PasswordVault {
  const login = vault.logins.find((candidate) => candidate.id === loginId);
  if (!login) {
    return vault;
  }
  const timesUsed = (login.timesUsed ?? 0) + 1;
  return replaceLogin(vault, loginId, { ...login, lastUsedAt: now, timesUsed });
}

/** "Never for this site": Bow stops offering to save there. The oldest entry goes first at the limit. */
export function addNeverSave(vault: PasswordVault, origin: string): PasswordVault {
  const siteKey = siteKeyFor(origin);
  if (vault.neverSaveOrigins.includes(siteKey)) {
    return vault;
  }
  const neverSaveOrigins = [...vault.neverSaveOrigins, siteKey];
  if (neverSaveOrigins.length > MAX_NEVER_SAVE_ORIGINS) {
    neverSaveOrigins.shift();
  }
  return { ...vault, neverSaveOrigins };
}

/** Lets Bow offer to save on a site again (the Library's "Never saved for" list). */
export function removeNeverSave(vault: PasswordVault, origin: string): PasswordVault {
  const siteKey = siteKeyFor(origin);
  const neverSaveOrigins = vault.neverSaveOrigins.filter((entry) => entry !== siteKey);
  return neverSaveOrigins.length === vault.neverSaveOrigins.length ? vault : { ...vault, neverSaveOrigins };
}
