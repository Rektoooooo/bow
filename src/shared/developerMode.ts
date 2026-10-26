/**
 * WHY this file exists:
 *   Arc's Developer Mode is a per-site switch (the Control Center's "Developer Mode" setting). A site in Developer
 *   Mode gets a striped toolbar with the full address and developer buttons, and its tabs a dashed yellow outline.
 *   Local development hosts (localhost and friends) are in Developer Mode unless the user turned it off. These pure
 *   functions read and change that switch; main and the sidebar page both use them.
 *
 * Data source:
 *   BrowserState.developerModeSites (the user's own choices, by site) and the page address.
 *
 * Data flow:
 *   Control Center › Developer Mode → action setDeveloperMode → setDeveloperMode() → state
 *   → sidebar rows and toolbar (isDeveloperModeOn) and main's layout (the taller toolbar)
 */
import type { BrowserState } from "./types";
import { getSiteKey } from "./siteKey.js";

/** Hosts that are someone's own development server: Developer Mode is on for them unless turned off. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

/** A host ending like this is a local development name too ("app.localhost", "shop.test"). */
const LOCAL_HOST_SUFFIXES = [".localhost", ".test"];

/**
 * True for addresses of a local development server.
 * Example: "http://localhost:3000/" → true; "https://example.com/" → false
 */
export function isLocalDevelopmentUrl(url: string): boolean {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (LOCAL_HOSTS.has(hostname)) {
    return true;
  }
  return LOCAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

/**
 * True when the page's site is in Developer Mode: the user's choice for the site, or on for local servers.
 */
export function isDeveloperModeOn(state: BrowserState, url: string): boolean {
  const site = getSiteKey(url);
  if (site === null) {
    return false;
  }
  const choice = state.developerModeSites?.[site];
  if (typeof choice === "boolean") {
    return choice;
  }
  return isLocalDevelopmentUrl(url);
}

/**
 * Turns Developer Mode on or off for a site. Returns the same state when that was already the choice.
 */
export function setDeveloperMode(state: BrowserState, site: string, isOn: boolean): BrowserState {
  if (state.developerModeSites?.[site] === isOn) {
    return state;
  }
  return { ...state, developerModeSites: { ...state.developerModeSites, [site]: isOn } };
}
