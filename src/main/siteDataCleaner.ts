/**
 * WHY this file exists:
 *   Forget Site Data on Quit, per profile (Space menu › Profile, Library › Privacy): a profile's cookies, sign-ins and
 *   site storage are cleared every time Bow quits, and again at the next start before any page loads (so a crash or
 *   an update restart, which skip the quit, forget them too). Extensions in the profile keep their own storage.
 *
 * Data source:
 *   The profiles marked forgetsSiteDataOnQuit, their sessions (profiles.ts), and their extensions (kept).
 *
 * Data flow:
 *   start → clearForgettingProfiles() before extensions and windows
 *   quit → before-quit holds the quit → clearForgettingProfiles() (at most CLEAR_TIMEOUT_MS) → quits
 */
import { app } from "electron";
import type { BrowserState, ProfileId } from "../shared/types";
import { getState } from "./browserCore";
import { getProfileSession } from "./profiles";

/** Longest the quit waits for the clearing. Our choice: Bow must never hang on quit. */
const CLEAR_TIMEOUT_MS = 3000;

/** What is cleared: everything a site stores, but not the download list (Bow keeps its own). */
const CLEARED_DATA_TYPES: ("backgroundFetch" | "cache" | "cookies" | "fileSystems" | "indexedDB" | "localStorage" | "serviceWorkers" | "webSQL")[] = [
  "backgroundFetch",
  "cache",
  "cookies",
  "fileSystems",
  "indexedDB",
  "localStorage",
  "serviceWorkers",
  "webSQL",
];

/** True once the quit's clearing is done, so the second quit goes through. */
let hasClearedForQuit = false;

/**
 * The profiles marked to forget their site data.
 */
function listForgettingProfileIds(state: BrowserState): ProfileId[] {
  const profileIds: ProfileId[] = [];
  for (const profile of state.profiles) {
    if (profile.forgetsSiteDataOnQuit === true) {
      profileIds.push(profile.id);
    }
  }
  return profileIds;
}

/**
 * Clears one profile's site data, keeping its extensions' own storage.
 */
async function clearProfile(state: BrowserState, profileId: ProfileId): Promise<void> {
  const extensionOrigins: string[] = [];
  for (const extension of state.extensions ?? []) {
    if (extension.profileId === profileId) {
      extensionOrigins.push(`chrome-extension://${extension.id}`);
    }
  }
  const options = extensionOrigins.length === 0 ? { dataTypes: CLEARED_DATA_TYPES } : { dataTypes: CLEARED_DATA_TYPES, excludeOrigins: extensionOrigins };
  await getProfileSession(profileId).clearData(options);
  await getProfileSession(profileId).clearAuthCache();
}

/**
 * Clears every forgetting profile's site data; resolves after at most CLEAR_TIMEOUT_MS either way.
 */
export function clearForgettingProfiles(): Promise<void> {
  const state = getState();
  const clearing = Promise.all(listForgettingProfileIds(state).map((profileId) => clearProfile(state, profileId)));
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, CLEAR_TIMEOUT_MS));
  return Promise.race([clearing.then(() => undefined), timeout]).catch((error) => console.error("Clearing site data failed:", error));
}

/**
 * Holds the quit while forgetting profiles are cleared, then quits again.
 */
export function clearSiteDataOnQuit(): void {
  app.on("before-quit", (event) => {
    if (hasClearedForQuit || listForgettingProfileIds(getState()).length === 0) {
      return;
    }
    event.preventDefault();
    hasClearedForQuit = true;
    clearForgettingProfiles().finally(() => app.quit());
  });
}
