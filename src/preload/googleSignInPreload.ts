/**
 * WHY this file exists:
 *   Google's sign-in pages get Electron's own user agent in their request headers (main/googleSignIn.ts); without
 *   this, the page's own scripts would still read Bow's Chrome user agent, and Google's sign-in compares what it can
 *   see. On https://accounts.google.com only, this makes navigator.userAgent and navigator.appVersion say the same
 *   as the header, before the page's first script runs. On every other page it does nothing at all, and it never
 *   exposes anything to pages.
 *
 * Data source:
 *   The page's address, Bow's Chrome user agent (navigator.userAgent) and Electron's version.
 *
 * Data flow:
 *   page starts loading → not Google's sign-in page: stop
 *   Google's sign-in page → Electron's user agent → navigator.userAgent / appVersion in the page's own world
 */
import { contextBridge } from "electron";
import type { GOOGLE_SIGN_IN_HOST } from "../main/signInUserAgent";

/** Same host as GOOGLE_SIGN_IN_HOST: sandboxed preloads cannot import our files, so the type check guards it. */
const SIGN_IN_HOST: typeof GOOGLE_SIGN_IN_HOST = "accounts.google.com";

/** Where Electron's own user agent names Electron: just before "Safari/" ("… Chrome/x Electron/y Safari/537.36"). */
const SAFARI_TOKEN = " Safari/";

/**
 * Runs in the page's own world (contextBridge.executeInMainWorld copies it there, so it can use only its argument).
 */
function setPageUserAgent(userAgent: string): void {
  const appVersion = userAgent.replace(/^Mozilla\//, "");
  Object.defineProperty(Navigator.prototype, "userAgent", { get: () => userAgent, configurable: true });
  Object.defineProperty(Navigator.prototype, "appVersion", { get: () => appVersion, configurable: true });
}

/**
 * On Google's sign-in page, gives the page Electron's own user agent, the one its requests carry.
 */
function alignSignInUserAgent(): void {
  if (location.protocol !== "https:" || location.hostname !== SIGN_IN_HOST) {
    return;
  }
  const chromeUserAgent = navigator.userAgent;
  if (chromeUserAgent.includes(" Electron/") || !chromeUserAgent.includes(SAFARI_TOKEN)) {
    return;
  }
  const electronUserAgent = chromeUserAgent.replace(SAFARI_TOKEN, ` Electron/${process.versions.electron}${SAFARI_TOKEN}`);
  contextBridge.executeInMainWorld({ func: setPageUserAgent, args: [electronUserAgent] });
}

alignSignInUserAgent();
