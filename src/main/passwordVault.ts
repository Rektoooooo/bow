/**
 * WHY this file exists:
 *   Saved logins must be kept secret on disk and must never be lost. This module is the only place that touches the
 *   vault file: one encrypted file per profile, loaded once, changed through the pure rules in passwords.ts, and
 *   written at most once a second. The whole vault is encrypted, so even the sites and usernames stay hidden.
 *
 * Data source:
 *   <userData>/Passwords/<profileId>.vault, encrypted with Electron's safeStorage (its key lives in the macOS
 *   Keychain, so another program or another Mac cannot read the file).
 *
 * Data flow:
 *   openVault() → read file → safeStorage.decryptStringAsync → parseVault() → vault in memory
 *   changeVault(pure change) → vault in memory → listeners → saveSoon() → encryptString → temporary file → rename
 *   will quit → saveAllVaultsNow()
 *
 * A vault that could not be opened ("locked") is never written: it may be the user's real vault, which a build
 * with another signature (or another Keychain) cannot decrypt, and a write would destroy it.
 */
import { app, safeStorage } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ProfileId } from "../shared/types";
import { createEmptyVault, parseVault } from "./passwords";
import type { PasswordVault } from "./passwords";

export type VaultStatus = "ready" | "locked" | "unavailable";

export interface VaultAccess {
  status: VaultStatus;
  /** An empty vault unless the status is "ready". */
  vault: PasswordVault;
}

const VAULT_FOLDER_NAME = "Passwords";
const VAULT_FILE_EXTENSION = ".vault";
const TEMPORARY_FILE_SUFFIX = ".tmp";

/** Wait this long after a change before writing, so a burst of changes is written once. Our choice. */
export const VAULT_SAVE_DELAY_MS = 1000;

/** Only the owner may read the files (rw-------) and open the folder (rwx------). Our choice. */
const VAULT_FILE_MODE = 0o600;
const VAULT_FOLDER_MODE = 0o700;

/** Every Bow profile id is made of these ("profile-default", "profile-1730000000000-3"); anything else could escape the folder. */
const SAFE_PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Chromium's switch for tests: safeStorage then uses a fixed key and never asks the Keychain. */
const MOCK_KEYCHAIN_SWITCH = "use-mock-keychain";

interface LoadedVault {
  status: VaultStatus;
  vault: PasswordVault;
  isChangedSinceSave: boolean;
}

const loadedVaults = new Map<ProfileId, LoadedVault>();
const loadsInProgress = new Map<ProfileId, Promise<VaultAccess>>();
const saveTimers = new Map<ProfileId, NodeJS.Timeout>();
const changeListeners: Array<(profileId: ProfileId) => void> = [];

/**
 * e2e runs only: they must never show a Keychain dialog or create a Keychain item. A real vault cannot be opened
 * with the test key, so it stays locked and is never overwritten. Must run before the app is ready.
 */
export function useMockKeychainInTests(): void {
  if (process.env.BOW_E2E_MOCK_KEYCHAIN !== "1") {
    return;
  }
  app.commandLine.appendSwitch(MOCK_KEYCHAIN_SWITCH);
}

/** True in e2e runs: the Library may then show a password without Touch ID, as no real vault can be opened. */
export function isKeychainMocked(): boolean {
  return app.commandLine.hasSwitch(MOCK_KEYCHAIN_SWITCH);
}

function vaultFilePath(profileId: ProfileId): string {
  return path.join(app.getPath("userData"), VAULT_FOLDER_NAME, `${profileId}${VAULT_FILE_EXTENSION}`);
}

function toAccess(loadedVault: LoadedVault): VaultAccess {
  return { status: loadedVault.status, vault: loadedVault.vault };
}

function unusableVault(status: VaultStatus): LoadedVault {
  return { status: status, vault: createEmptyVault(), isChangedSinceSave: false };
}

/**
 * Reads and decrypts one profile's file. The asynchronous call keeps Bow responsive while macOS asks about the Keychain.
 */
async function loadVault(profileId: ProfileId): Promise<LoadedVault> {
  if (!SAFE_PROFILE_ID_PATTERN.test(profileId) || !safeStorage.isEncryptionAvailable()) {
    return unusableVault("unavailable");
  }
  const filePath = vaultFilePath(profileId);
  if (!fs.existsSync(filePath)) {
    return { status: "ready", vault: createEmptyVault(), isChangedSinceSave: false };
  }
  try {
    const encryptedBytes = fs.readFileSync(filePath);
    const decrypted = await safeStorage.decryptStringAsync(encryptedBytes);
    const vault = parseVault(JSON.parse(decrypted.result));
    if (vault === null) {
      console.warn(`The password vault of ${profileId} is not in a known format; leaving it untouched.`);
      return unusableVault("locked");
    }
    // The system asked for the vault to be encrypted again with a newer key.
    return { status: "ready", vault: vault, isChangedSinceSave: decrypted.shouldReEncrypt };
  } catch (error) {
    console.warn(`Could not open the password vault of ${profileId}; leaving it untouched.`, error instanceof Error ? error.name : "");
    return unusableVault("locked");
  }
}

/**
 * The vault of a profile, loaded on the first call. Concurrent callers share one load.
 */
export function openVault(profileId: ProfileId): Promise<VaultAccess> {
  const loadedVault = loadedVaults.get(profileId);
  if (loadedVault) {
    return Promise.resolve(toAccess(loadedVault));
  }
  const loadInProgress = loadsInProgress.get(profileId);
  if (loadInProgress) {
    return loadInProgress;
  }
  const newLoad = loadVault(profileId).then((result) => {
    loadedVaults.set(profileId, result);
    loadsInProgress.delete(profileId);
    if (result.isChangedSinceSave) {
      scheduleSave(profileId);
    }
    return toAccess(result);
  });
  loadsInProgress.set(profileId, newLoad);
  return newLoad;
}

/**
 * The vault when it is already loaded, for callers that cannot wait.
 */
export function peekVault(profileId: ProfileId): VaultAccess | null {
  const loadedVault = loadedVaults.get(profileId);
  return loadedVault ? toAccess(loadedVault) : null;
}

/**
 * Applies a pure change. False (and nothing happens) when the vault is not ready or the change changed nothing.
 */
export async function changeVault(profileId: ProfileId, change: (vault: PasswordVault) => PasswordVault): Promise<boolean> {
  const access = await openVault(profileId);
  if (access.status !== "ready") {
    return false;
  }
  const loadedVault = loadedVaults.get(profileId);
  if (!loadedVault) {
    return false;
  }
  const changedVault = change(loadedVault.vault);
  if (changedVault === loadedVault.vault) {
    return false;
  }
  loadedVault.vault = changedVault;
  loadedVault.isChangedSinceSave = true;
  for (const listener of changeListeners) {
    listener(profileId);
  }
  scheduleSave(profileId);
  return true;
}

/**
 * Forgets a locked or unavailable result and loads again (for example after the user allowed the Keychain).
 */
export function retryVault(profileId: ProfileId): Promise<VaultAccess> {
  const loadedVault = loadedVaults.get(profileId);
  if (loadedVault && loadedVault.status === "ready") {
    return Promise.resolve(toAccess(loadedVault));
  }
  loadedVaults.delete(profileId);
  return openVault(profileId);
}

/** Calls the listener after every change to a profile's vault (the Library redraws). */
export function onVaultChanged(listener: (profileId: ProfileId) => void): void {
  changeListeners.push(listener);
}

function scheduleSave(profileId: ProfileId): void {
  if (saveTimers.has(profileId)) {
    return;
  }
  const timer = setTimeout(() => saveVault(profileId), VAULT_SAVE_DELAY_MS);
  saveTimers.set(profileId, timer);
}

/**
 * Writes one ready vault with unsaved changes, through a temporary file so a crash never leaves half a file.
 * The synchronous encryption also works while the app quits.
 */
function saveVault(profileId: ProfileId): void {
  const timer = saveTimers.get(profileId);
  if (timer) {
    clearTimeout(timer);
    saveTimers.delete(profileId);
  }
  const loadedVault = loadedVaults.get(profileId);
  if (!loadedVault || loadedVault.status !== "ready" || !loadedVault.isChangedSinceSave) {
    return;
  }
  const filePath = vaultFilePath(profileId);
  const temporaryPath = filePath + TEMPORARY_FILE_SUFFIX;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: VAULT_FOLDER_MODE });
    const encryptedBytes = safeStorage.encryptString(JSON.stringify(loadedVault.vault));
    fs.writeFileSync(temporaryPath, encryptedBytes, { mode: VAULT_FILE_MODE });
    fs.renameSync(temporaryPath, filePath);
    loadedVault.isChangedSinceSave = false;
  } catch (error) {
    console.warn(`Could not save the password vault of ${profileId}:`, error instanceof Error ? error.name : "");
  }
}

/**
 * Writes every vault with unsaved changes now (the app is quitting).
 */
export function saveAllVaultsNow(): void {
  for (const profileId of loadedVaults.keys()) {
    saveVault(profileId);
  }
}
