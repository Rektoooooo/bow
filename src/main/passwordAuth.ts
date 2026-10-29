/**
 * WHY this file exists:
 *   Library › Passwords must not show, copy or change a saved password just because someone sat down at an unlocked
 *   Mac or a page found a way to talk to the Library. Before any of those the user proves it is them with Touch ID
 *   (macOS falls back to the Mac's password). After a success the passwords stay available for a few minutes so
 *   looking up several does not ask each time; locking the screen or sleeping ends that at once. It fails closed: any
 *   doubt (the prompt was cancelled, failed or threw) means no.
 *
 * Data source:
 *   Electron's systemPreferences.promptTouchID and powerMonitor; passwordVault.ts says whether the test keychain is used.
 *
 * Data flow:
 *   passwordsLibrary.ts (reveal / copy / edit) → ensureUserPresent() → true: go on, false: nothing happens
 *   powerMonitor "lock-screen" / "suspend" → the unlock ends
 */
import { powerMonitor, systemPreferences } from "electron";
import { PASSWORD_UNLOCK_MS } from "../shared/settings";
import { isKeychainMocked } from "./passwordVault";

/** The reason macOS shows in the Touch ID sheet. */
const TOUCH_ID_REASON = "show your saved passwords";

/** When the passwords were unlocked, or null while locked. */
let unlockedAt: number | null = null;
let isWatchingPower = false;

function lockAgain(): void {
  unlockedAt = null;
}

/** Locks on the screen locking or the Mac sleeping. Registered with the first unlock, so a quiet app costs nothing. */
function watchPowerEvents(): void {
  if (isWatchingPower) {
    return;
  }
  isWatchingPower = true;
  powerMonitor.on("lock-screen", lockAgain);
  powerMonitor.on("suspend", lockAgain);
}

function isStillUnlocked(): boolean {
  return unlockedAt !== null && Date.now() - unlockedAt < PASSWORD_UNLOCK_MS;
}

/**
 * True when the user has just proved it is them, or did so within PASSWORD_UNLOCK_MS. Asks through macOS otherwise.
 */
export async function ensureUserPresent(): Promise<boolean> {
  // Test runs only: a real vault cannot be opened with the test key, so there is nothing to protect and no person to
  // touch a sensor. The mock is on only when BOW_E2E_MOCK_KEYCHAIN is set by an e2e check.
  if (isKeychainMocked()) {
    return true;
  }
  if (isStillUnlocked()) {
    return true;
  }
  try {
    await systemPreferences.promptTouchID(TOUCH_ID_REASON);
  } catch {
    // Cancelled, failed, or this Mac cannot ask: the passwords stay locked.
    lockAgain();
    return false;
  }
  unlockedAt = Date.now();
  watchPowerEvents();
  return true;
}
