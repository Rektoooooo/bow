/**
 * WHY this file exists:
 *   Fills in the "This connection isn't private" page: which site, and why its certificate was refused, in words
 *   (Chromium's errors are codes). Only a web address is used for the site name, so a crafted query string cannot
 *   put anything else on the page; everything is set as text.
 *
 * Data source:
 *   The page's query string: ?url=…&code=…
 *
 * Data flow:
 *   certificateErrors.ts loadFile(certificate.html, { query }) → here → the host and the reason lines
 */
// A module, so its names stay its own (the crashed-tab page's script has the same ones).
export {};

/** Chromium's certificate errors (net_error_list.h) in words. Others read as REASON_FALLBACK. */
const REASON_TEXTS: Record<string, string> = {
  "-200": "The certificate is for another site.",
  "-201": "The certificate has expired, or is not valid yet.",
  "-202": "The certificate is not from an issuer Bow trusts (for example, it is self-signed).",
};
const REASON_FALLBACK = "The certificate is not valid.";

const parameters = new URLSearchParams(window.location.search);
const siteUrl = parameters.get("url") ?? "";
const errorCode = parameters.get("code") ?? "";
const isWebAddress = siteUrl.startsWith("https://") || siteUrl.startsWith("http://");

const hostLine = document.getElementById("certificate-host");
if (hostLine !== null && isWebAddress) {
  hostLine.textContent = new URL(siteUrl).host;
}
// Only a web address goes into the link, so a crafted query string cannot point it anywhere else.
const retryLink = document.getElementById("certificate-retry");
if (retryLink instanceof HTMLAnchorElement && isWebAddress) {
  retryLink.href = siteUrl;
}
const reasonLine = document.getElementById("certificate-reason");
if (reasonLine !== null) {
  reasonLine.textContent = REASON_TEXTS[errorCode] ?? REASON_FALLBACK;
}
