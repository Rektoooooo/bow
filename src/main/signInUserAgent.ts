/**
 * WHY this file exists:
 *   Google refused to sign anyone in to Bow 0.1.1 ("Couldn't sign you in. This browser or app may not be secure",
 *   rrk=46). Bow presents itself as desktop Chrome (profiles.ts useChromeUserAgent), so Google runs desktop Chrome's
 *   sign-in (flow "GlifWebSignIn") with checks that a browser built on Electron fails. With Electron's own user agent
 *   Google serves its lighter sign-in ("WebLiteSignIn"), which Electron passes. Measured 2026-10-29 on
 *   accounts.google.com: the Chrome user agent gets GlifWebSignIn, Electron's user agent in the request header gets
 *   WebLiteSignIn. Another Electron browser (Mise, pull request 19, 2026-10-12) found the same and fixed it the same
 *   way. This pure rule says which requests carry Electron's user agent: Google's sign-in pages and everything they
 *   load. Every other site keeps the Chrome user agent.
 *
 * Data source:
 *   A request's address, whether it is a page's own navigation, and the address of the page it belongs to.
 *
 * Data flow:
 *   googleSignIn.ts onBeforeSendHeaders → usesElectronUserAgent() → the User-Agent header for that request
 */

/** Google's sign-in host. Other Google sites (Gmail, YouTube) keep the Chrome user agent. */
export const GOOGLE_SIGN_IN_HOST = "accounts.google.com";

/**
 * True for an https address on Google's sign-in host (exactly that host, so "accounts.google.com.example" is not).
 */
export function isGoogleSignInAddress(address: string): boolean {
  let parsedAddress: URL;
  try {
    parsedAddress = new URL(address);
  } catch {
    return false;
  }
  return parsedAddress.protocol === "https:" && parsedAddress.hostname === GOOGLE_SIGN_IN_HOST;
}

/**
 * True when a request carries Electron's own user agent: a request to Google's sign-in host, or anything a page on
 * that host loads. A page leaving the sign-in host (its next navigation goes elsewhere) is Chrome again, even though
 * the tab still shows the sign-in page while that navigation starts.
 * Examples: ("https://accounts.google.com/v3/signin", true, "https://mail.google.com/") → true;
 * ("https://ssl.gstatic.com/a.js", false, "https://accounts.google.com/v3/signin") → true;
 * ("https://mail.google.com/", true, "https://accounts.google.com/v3/signin") → false
 */
export function usesElectronUserAgent(requestAddress: string, isPageNavigation: boolean, pageAddress: string): boolean {
  if (isGoogleSignInAddress(requestAddress)) {
    return true;
  }
  if (isPageNavigation) {
    return false;
  }
  return isGoogleSignInAddress(pageAddress);
}
