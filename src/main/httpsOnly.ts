/**
 * WHY this file exists:
 *   HTTPS-Only Mode (Library › Privacy): a page asked for over plain http is asked for over https instead, so nobody
 *   on the network can read or change it. When a site has no secure version, Bow says so and offers to open it over
 *   http (httpsOnlyController.ts). These are the rules: which addresses are upgraded and how, and which load failures
 *   mean "this site has no https".
 *
 * Data source:
 *   A page request's address; a failed load's Chromium error code (net_error_list.h).
 *
 * Data flow:
 *   adBlock.ts request handler (main frame, setting on) → toHttpsUrl() → redirect
 *   failed load of an upgraded page → isNoHttpsFailure(code) → the "Open with HTTP" offer
 *
 * Rules: pure. Local names and IP addresses are never upgraded (shared/localNames.ts): development servers and devices
 * on the home network rarely have certificates.
 */
import { isLocalHost } from "../shared/localNames";

/** Chromium's errors that mean the secure version is not there (net_error_list.h). Our choice of which count. */
const NO_HTTPS_ERROR_CODES = new Set([
  -7, // TIMED_OUT
  -100, // CONNECTION_CLOSED
  -101, // CONNECTION_RESET
  -102, // CONNECTION_REFUSED
  -107, // SSL_PROTOCOL_ERROR
]);

/** Certificate errors: CERT_COMMON_NAME_INVALID (-200) to the end of Chromium's certificate range (-299). */
const CERTIFICATE_ERROR_FIRST = -200;
const CERTIFICATE_ERROR_LAST = -299;


/**
 * The https address for a plain-http page, or null when it is not one to upgrade (another scheme, or exempt). The
 * port stays when the page names one.
 * Example: "http://example.com/a?b=1" → "https://example.com/a?b=1"
 */
export function toHttpsUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" || isLocalHost(parsed.hostname)) {
    return null;
  }
  parsed.protocol = "https:";
  return parsed.toString();
}

/**
 * Whether a failed load means the site has no secure version (refused, reset, closed, timed out, TLS or certificate
 * errors). A cancelled load (-3) and a name that does not resolve (-105, which fails over http too) do not.
 */
export function isNoHttpsFailure(errorCode: number): boolean {
  const isCertificateError = errorCode <= CERTIFICATE_ERROR_FIRST && errorCode >= CERTIFICATE_ERROR_LAST;
  return NO_HTTPS_ERROR_CODES.has(errorCode) || isCertificateError;
}
