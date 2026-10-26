/**
 * WHY this file exists:
 *   The toolbar offers "Add Extension" on a Chrome Web Store extension page, and the main process installs that
 *   extension. Both need to read the extension id out of the page's address.
 *
 * Data source:
 *   The Web Store's page addresses: https://chromewebstore.google.com/detail/<name>/<id> (and the older
 *   https://chrome.google.com/webstore/detail/<name>/<id>).
 *
 * Data flow:
 *   toolbar.ts / extensionsController.ts → findWebStoreExtensionId(url) → the 32-letter extension id, or null
 */

/** Web Store page hosts and the path part before the extension's name and id. */
const WEB_STORE_PAGES = [
  { host: "chromewebstore.google.com", pathStart: "/detail/" },
  { host: "chrome.google.com", pathStart: "/webstore/detail/" },
];

/** An extension id: 32 letters a–p. */
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

/**
 * Returns the extension id of a Web Store extension page, or null for any other address.
 * Example: "https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh?hl=en" → "eimadp…"
 */
export function findWebStoreExtensionId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const page = WEB_STORE_PAGES.find((candidate) => candidate.host === parsed.host && parsed.pathname.startsWith(candidate.pathStart));
  if (parsed.protocol !== "https:" || page === undefined) {
    return null;
  }
  const parts = parsed.pathname.slice(page.pathStart.length).split("/").filter((part) => part !== "");
  const extensionId = parts.find((part) => EXTENSION_ID_PATTERN.test(part));
  return extensionId ?? null;
}
