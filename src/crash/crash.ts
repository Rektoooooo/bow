/**
 * WHY this file exists:
 *   Fills in the crashed-tab page: which address crashed and why, and points "Reload" at that address. Only web
 *   addresses are used for the link, so a crafted query string cannot turn it into something else.
 *
 * Data source:
 *   The page's query string: ?url=…&reason=…
 *
 * Data flow:
 *   tabViews.ts loadFile(crash.html, { query }) → here → the Reload link
 */
const parameters = new URLSearchParams(window.location.search);
const crashedUrl = parameters.get("url") ?? "";
const reason = parameters.get("reason") ?? "crashed";
const isWebAddress = crashedUrl.startsWith("https://") || crashedUrl.startsWith("http://");

const detail = document.getElementById("crash-detail");
if (detail !== null) {
  detail.textContent = isWebAddress ? `${crashedUrl} (${reason})` : `Reason: ${reason}`;
}
const reloadLink = document.getElementById("crash-reload");
if (reloadLink instanceof HTMLAnchorElement && isWebAddress) {
  reloadLink.href = crashedUrl;
}
