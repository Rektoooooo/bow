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

/**
 * Second-level labels that are really part of a country's suffix ("co.uk", "com.au"), so the site is one label longer.
 * A short list, not the full public-suffix list: good enough to tell "mail.google.com" and "accounts.google.com"
 * apart from "news.bbc.co.uk".
 */
const SHARED_SECOND_LEVEL_LABELS = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

/** A country code top-level domain has two letters. */
const COUNTRY_CODE_LENGTH = 2;

/**
 * Returns the "site" of an address: its registrable domain, or null when it has none (about:, file:, an IP address…).
 * Example: "https://mail.google.com/x" → "google.com"; "https://news.bbc.co.uk" → "bbc.co.uk"
 */
export function getSiteKey(url: string): string | null {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const labels = hostname.split(".").filter((label) => label !== "");
  const isIpAddress = /^[\d.]+$/.test(hostname) || hostname.includes(":");
  if (labels.length < 2 || isIpAddress) {
    return hostname === "" ? null : hostname;
  }
  const topLevel = labels[labels.length - 1] as string;
  const secondLevel = labels[labels.length - 2] as string;
  const hasSharedSuffix = topLevel.length === COUNTRY_CODE_LENGTH && SHARED_SECOND_LEVEL_LABELS.has(secondLevel);
  const siteLabelCount = hasSharedSuffix && labels.length >= 3 ? 3 : 2;
  return labels.slice(-siteLabelCount).join(".");
}

/**
 * True when two addresses belong to the same site. Peek uses it: links to another site open in a Peek.
 */
export function isSameSite(firstUrl: string, secondUrl: string): boolean {
  const firstSite = getSiteKey(firstUrl);
  return firstSite !== null && firstSite === getSiteKey(secondUrl);
}
