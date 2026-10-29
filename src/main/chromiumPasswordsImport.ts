/**
 * WHY this file exists:
 *   Importing from Arc or another Chromium browser brings its saved passwords too, like Arc's own importer: macOS asks
 *   the user once to let Bow read that browser's key, then the logins are decrypted and merged into the vaults of the
 *   Bow profiles they belong to. Every importer (the onboarding, File › Import, Arc, Dia's spaces) uses the one helper
 *   here, so they ask once and behave the same.
 *
 * Data source:
 *   The browser's Keychain item ("<Name> Safe Storage", read with /usr/bin/security; macOS shows its own dialog),
 *   chromiumPasswords.ts (the logins of each profile folder) and the vaults (passwordVault.ts).
 *
 * Data flow:
 *   importer → importChromiumPasswords(targets, keychainService, now) → open each vault → readChromiumKeychainSecret()
 *   → deriveChromiumKey() → per target: readChromiumLogins() → changeVault(mergeImportedLogins + addNeverSave)
 *   → counts (never a login, a name or a password)
 *
 * Rules: the secret and the passwords live in this module's memory only for the import; nothing is logged or sent to a
 * page. Passwords are never overwritten (mergeImportedLogins).
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { ProfileId } from "../shared/types";
import { deriveChromiumKey } from "./chromiumPasswordCrypto";
import { readChromiumLogins } from "./chromiumPasswords";
import type { ChromiumLoginsRead } from "./chromiumPasswords";
import { mergeImportedLogins } from "./passwordCsv";
import { addNeverSave } from "./passwords";
import { changeVault, isKeychainMocked, openVault } from "./passwordVault";

const execFileAsync = promisify(execFile);

/** macOS's tool for the Keychain. */
const SECURITY_COMMAND = "/usr/bin/security";

/**
 * `security` waits while macOS shows its dialog, and the person types their Mac password there: a generous wait. Our
 * choice.
 */
const KEYCHAIN_PROMPT_TIMEOUT_MS = 120_000;

/** `security find-generic-password` exits with this code when the item does not exist (errSecItemNotFound, 44). */
const SECURITY_EXIT_ITEM_NOT_FOUND = 44;

/**
 * e2e runs only: the secret a test gives instead of the real Keychain's. "deny" stands for the user refusing. See
 * readChromiumKeychainSecret.
 */
const TEST_SECRET_VARIABLE = "BOW_E2E_IMPORT_KEYCHAIN_SECRET";
const TEST_SECRET_DENY = "deny";

/** What asking for a browser's key gave. */
export type KeychainSecretResult = { kind: "secret"; secret: string } | { kind: "missing" } | { kind: "denied" };

/** A profile folder to read and the Bow profile whose vault takes its logins. */
export interface PasswordImportTarget {
  profileFolder: string;
  bowProfileId: ProfileId;
}

/** How an import of a browser's passwords went. Counts only. */
export type ChromiumPasswordsOutcome =
  | { kind: "imported"; addedCount: number; alreadySavedCount: number; keptDifferentCount: number }
  | { kind: "denied" }
  | { kind: "missing" }
  | { kind: "vaultUnavailable" };

/**
 * The secret of a browser's "<Name> Safe Storage" Keychain item. macOS shows its dialog asking to allow Bow; refusing,
 * cancelling or a timeout is "denied", no such item (the browser never saved a password) is "missing".
 */
export async function readChromiumKeychainSecret(service: string): Promise<KeychainSecretResult> {
  // Safe: isKeychainMocked() is true only in e2e runs, which also use Chromium's mock keychain, so no real vault can
  // be opened and no test ever reaches the real Keychain or a real browser's secret.
  if (isKeychainMocked()) {
    const testSecret = process.env[TEST_SECRET_VARIABLE] ?? "";
    if (testSecret === TEST_SECRET_DENY) {
      return { kind: "denied" };
    }
    return testSecret === "" ? { kind: "missing" } : { kind: "secret", secret: testSecret };
  }
  try {
    const answer = await execFileAsync(SECURITY_COMMAND, ["find-generic-password", "-w", "-s", service], {
      timeout: KEYCHAIN_PROMPT_TIMEOUT_MS,
    });
    const secret = answer.stdout.trim();
    return secret === "" ? { kind: "missing" } : { kind: "secret", secret: secret };
  } catch (error) {
    const exitCode = (error as { code?: unknown }).code;
    return exitCode === SECURITY_EXIT_ITEM_NOT_FOUND ? { kind: "missing" } : { kind: "denied" };
  }
}

/** The profiles whose vault is open and ready; the others are skipped. */
async function findReadyTargets(targets: PasswordImportTarget[]): Promise<PasswordImportTarget[]> {
  const readyTargets: PasswordImportTarget[] = [];
  for (const target of targets) {
    const access = await openVault(target.bowProfileId);
    if (access.status === "ready") {
      readyTargets.push(target);
    }
  }
  return readyTargets;
}

/**
 * Adds one profile's logins and never-save sites to its Bow profile's vault, and adds the counts to `totals`.
 */
async function mergeIntoVault(
  bowProfileId: ProfileId,
  read: ChromiumLoginsRead,
  totals: { addedCount: number; alreadySavedCount: number; keptDifferentCount: number },
  now: number,
): Promise<void> {
  await changeVault(bowProfileId, (vault) => {
    const merged = mergeImportedLogins(vault, read.logins, randomUUID, now);
    totals.addedCount += merged.addedCount;
    totals.alreadySavedCount += merged.alreadySavedCount;
    totals.keptDifferentCount += merged.keptDifferentCount;
    let changedVault = merged.vault;
    for (const origin of read.neverSaveOrigins) {
      changedVault = addNeverSave(changedVault, origin);
    }
    return changedVault;
  });
}

/**
 * Brings the saved passwords of some profile folders of one browser into the vaults of their Bow profiles, asking
 * macOS for the browser's key once. A login Bow already has is never changed. A profile whose vault cannot be opened
 * is skipped (and when none can, nothing is asked).
 */
export async function importChromiumPasswords(targets: PasswordImportTarget[], keychainService: string, now: number): Promise<ChromiumPasswordsOutcome> {
  const totals = { addedCount: 0, alreadySavedCount: 0, keptDifferentCount: 0 };
  if (targets.length === 0) {
    return { kind: "imported", ...totals };
  }
  const readyTargets = await findReadyTargets(targets);
  if (readyTargets.length === 0) {
    return { kind: "vaultUnavailable" };
  }
  const secretResult = await readChromiumKeychainSecret(keychainService);
  if (secretResult.kind !== "secret") {
    return { kind: secretResult.kind };
  }
  const key = deriveChromiumKey(secretResult.secret);
  for (const target of readyTargets) {
    const read = await readChromiumLogins(target.profileFolder, key);
    await mergeIntoVault(target.bowProfileId, read, totals, now);
  }
  return { kind: "imported", ...totals };
}
