/**
 * WHY this file exists:
 *   Fills in the crashed-tab page: why it crashed, in words (Electron's reasons are codes such as "oom"), which
 *   address it was, and points "Reload" at that address. Only web addresses are used for the link, so a crafted query
 *   string cannot turn it into something else.
 *
 * Data source:
 *   The page's query string: ?url=…&reason=…
 *
 * Data flow:
 *   tabViews.ts loadFile(crash.html, { query }) → here → the Reload link
 */
/** Electron's reasons a page's process ended (render-process-gone), in words. Others read as REASON_FALLBACK. */
const REASON_TEXTS: Record<string, string> = {
  killed: "The system stopped it.",
  oom: "It ran out of memory.",
  "memory-eviction": "It ran out of memory.",
  "launch-failed": "It could not start.",
  "integrity-failure": "Its code did not pass a safety check.",
};
const REASON_FALLBACK = "Something in the page went wrong.";

const parameters = new URLSearchParams(window.location.search);
const crashedUrl = parameters.get("url") ?? "";
const reason = parameters.get("reason") ?? "crashed";
const isWebAddress = crashedUrl.startsWith("https://") || crashedUrl.startsWith("http://");

const reasonLine = document.getElementById("crash-reason");
if (reasonLine !== null) {
  reasonLine.textContent = `${REASON_TEXTS[reason] ?? REASON_FALLBACK} Reload to try again.`;
}
const addressLine = document.getElementById("crash-address");
if (addressLine !== null && isWebAddress) {
  addressLine.textContent = crashedUrl;
  addressLine.title = crashedUrl;
}
const reloadLink = document.getElementById("crash-reload");
if (reloadLink instanceof HTMLAnchorElement && isWebAddress) {
  reloadLink.href = crashedUrl;
}
