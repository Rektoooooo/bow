/**
 * WHY this file exists:
 *   Some addresses are local: development servers (localhost, *.localhost, *.test), devices on the home network
 *   (*.local) and IP addresses. They rarely have certificates, so HTTPS-Only Mode never upgrades them
 *   (main/httpsOnly.ts) and the guessed site icon keeps their own scheme (faviconColor.ts). One rule for both.
 *
 * Data source:
 *   A host name.
 *
 * Data flow:
 *   main/httpsOnly.ts toHttpsUrl, shared/faviconColor.ts getFaviconAddress → isLocalHost(host)
 *
 * Rules: pure.
 */

/** Name endings that are local or for development. */
const LOCAL_SUFFIXES = [".localhost", ".local", ".test"];

/**
 * Whether a host is local: localhost and the names above, and any IP address.
 * Example: "localhost", "printer.local", "192.168.1.10", "[::1]" → true; "example.com" → false
 */
export function isLocalHost(host: string): boolean {
  const lowerHost = host.toLowerCase();
  if (lowerHost === "localhost" || LOCAL_SUFFIXES.some((suffix) => lowerHost.endsWith(suffix))) {
    return true;
  }
  const isIpv4 = /^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(lowerHost);
  const isIpv6 = lowerHost.startsWith("[") && lowerHost.endsWith("]");
  return isIpv4 || isIpv6;
}
