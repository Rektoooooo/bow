/**
 * WHY this file exists:
 *   Many things in Arc belong to a site rather than a page: Boosts, toolbar colors, Developer Mode, Peek's "other
 *   site" rule. This pure function names a page's site. It is shared, so the main process and the sidebar page agree.
 *
 * Data source:
 *   A page address.
 *
 * Data flow:
 *   urls.ts (main, re-exported) / developerMode.ts / the sidebar page → getSiteKey(url) → "example.com"
 */

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
