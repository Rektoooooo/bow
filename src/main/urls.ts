/**
 * WHY this file exists:
 *   People type "example.com", "https://example.com" or "best pizza near me" into the same box.
 *   This file turns any of those into a URL a web view can load.
 *
 * Data source:
 *   The text typed into the sidebar's address box.
 *
 * Data flow:
 *   sidebar submit → ipc.ts → normalizeTypedInput() → state.openTab(url)
 */
import { getSiteKey } from "../shared/siteKey";

/** Search page used when the text is not a web address. Our choice; change it to any engine. */
export const SEARCH_URL_PREFIX = "https://duckduckgo.com/?q=";

/**
 * Decides whether the typed text looks like a web address (has a dot and no spaces, or a scheme).
 * Example: "example.com" → true, "best pizza" → false, "https://x.org" → true
 */
export function looksLikeWebAddress(typedText: string): boolean {
  const text = typedText.trim();
  if (text.includes(" ")) {
    return false;
  }

  const hasWebScheme = text.startsWith("http://") || text.startsWith("https://");
  if (hasWebScheme) {
    return true;
  }

  const hasDot = text.includes(".");
  const isLocalhost = text.startsWith("localhost");
  return hasDot || isLocalhost;
}

/**
 * Turns typed text into a URL: adds https:// to bare addresses, or builds a search URL.
 * Only http and https come out of this function, so typed text can never open file: or javascript: URLs.
 * Example: "example.com" → "https://example.com"
 * Example: "best pizza" → "https://duckduckgo.com/?q=best%20pizza"
 */
export function normalizeTypedInput(typedText: string): string {
  const text = typedText.trim();
  if (!looksLikeWebAddress(text)) {
    const searchTerms = encodeURIComponent(text);
    return SEARCH_URL_PREFIX + searchTerms;
  }

  const hasWebScheme = text.startsWith("http://") || text.startsWith("https://");
  if (hasWebScheme) {
    return text;
  }
  return "https://" + text;
}

// getSiteKey lives in shared/siteKey.ts so the sidebar page can use it too (Developer Mode marks rows by site).
export { getSiteKey };

/**
 * True when two addresses belong to the same site. Peek uses it: links to another site open in a Peek.
 */
export function isSameSite(firstUrl: string, secondUrl: string): boolean {
  const firstSite = getSiteKey(firstUrl);
  return firstSite !== null && firstSite === getSiteKey(secondUrl);
}
