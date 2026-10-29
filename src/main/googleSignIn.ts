/**
 * WHY this file exists:
 *   Google refuses to sign anyone in to a browser that says it is desktop Chrome but fails desktop Chrome's checks,
 *   which every Electron browser does (signInUserAgent.ts has the measurements). Its sign-in pages therefore get
 *   Electron's own user agent: in the request headers (here) and in the page's own scripts (navigator.userAgent,
 *   googleSignInPreload.ts), so both say the same. Every other site keeps the Chrome user agent.
 *
 * Data source:
 *   Every request a web page session sends; Electron's own user agent from profiles.ts.
 *
 * Data flow:
 *   web page session created (profiles, private windows) → installGoogleSignIn()
 *   request → onBeforeSendHeaders → usesElectronUserAgent() → User-Agent header
 *   page on accounts.google.com starts → googleSignInPreload.ts → navigator.userAgent matches the header
 */
import type { Session } from "electron";
import * as path from "node:path";
import { getElectronUserAgent } from "./profiles";
import { usesElectronUserAgent } from "./signInUserAgent";

/** Our page helper's id among a session's preload scripts (check-extensions and check-google-sign-in look for it). */
export const GOOGLE_SIGN_IN_HELPER_ID = "bow-google-sign-in";

/**
 * Gives one web page session the sign-in user agent: Electron's own on Google's sign-in pages, in headers and
 * scripts. Private windows get it too: signing in to Google there is just as common.
 * The ad blocker uses onBeforeRequest; Electron keeps one listener per event, so onBeforeSendHeaders is ours alone.
 */
export function installGoogleSignIn(webSession: Session): void {
  webSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const electronUserAgent = getElectronUserAgent();
    // Service workers and prefetches belong to no page.
    const pageAddress = details.webContents?.getURL() ?? "";
    const isPageNavigation = details.resourceType === "mainFrame";
    const isSignInRequest = usesElectronUserAgent(details.url, isPageNavigation, pageAddress);
    if (isSignInRequest && electronUserAgent !== "") {
      details.requestHeaders["User-Agent"] = electronUserAgent;
    }
    callback({ requestHeaders: details.requestHeaders });
  });
  const isHelperRegistered = webSession.getPreloadScripts().some((script) => script.id === GOOGLE_SIGN_IN_HELPER_ID);
  if (isHelperRegistered) {
    return;
  }
  webSession.registerPreloadScript({
    id: GOOGLE_SIGN_IN_HELPER_ID,
    type: "frame",
    filePath: path.join(__dirname, "..", "preload", "googleSignInPreload.js"),
  });
}
