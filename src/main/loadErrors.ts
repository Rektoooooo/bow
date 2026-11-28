/**
 * WHY this file exists:
 *   Electron has no error pages: when a tab's page cannot be loaded (a development server that is not running, a
 *   device macOS keeps Bow away from), Chromium leaves an empty document and the tab was just white, with no reason
 *   and no way to tell it from a page that is still blank (2026-11-28, a LAN dev server). These are the rules for the
 *   page Bow writes into that empty document instead: which failures get it, the reason in words, a tip for local
 *   addresses, and the page itself.
 *
 * Data source:
 *   A failed main-frame load: Chromium's error code and name (net_error_list.h) and the address it was for.
 *
 * Data flow:
 *   tab load fails (tabViews.ts → main.ts onLoadFailed, after HTTPS-Only Mode and the certificate warning had their
 *   say) → describeLoadError() → renderLoadErrorHtml() → loadErrorPage.ts writes it into Chromium's error document
 *
 * Rules: pure. Every text that comes from the address or Chromium goes into the page escaped.
 */
import { isLocalHost } from "../shared/localNames";

/** ERR_ABORTED: the load was stopped or replaced (the user, a download, a new address). Not a failure to show. */
const ABORTED_ERROR_CODE = -3;
/** ERR_CONNECTION_REFUSED: nothing listens there, the usual state of a development server that is not running. */
const CONNECTION_REFUSED_ERROR_CODE = -102;
/**
 * ERR_ADDRESS_UNREACHABLE: what macOS's Local Network privacy (macOS 15 and later) gives an app it keeps off the
 * local network (measured 2026-11-28: Bow got it for a LAN device that Terminal reached; Apple's TN3179).
 */
const ADDRESS_UNREACHABLE_ERROR_CODE = -109;

/** The reason in words per Chromium error code (the site is on the line above). Our wording, after Chrome's pages. */
const REASON_TEXTS: Record<number, string> = {
  [-7]: "The site took too long to respond.", // TIMED_OUT
  [-21]: "The network changed while the page was loading.", // NETWORK_CHANGED
  [-100]: "The site closed the connection.", // CONNECTION_CLOSED
  [-101]: "The connection was reset.", // CONNECTION_RESET
  [CONNECTION_REFUSED_ERROR_CODE]: "The site refused to connect.",
  [-105]: "The site's address couldn't be found.", // NAME_NOT_RESOLVED
  [-106]: "This Mac isn't connected to the internet.", // INTERNET_DISCONNECTED
  [ADDRESS_UNREACHABLE_ERROR_CODE]: "This Mac can't reach the site.",
  [-118]: "The site took too long to respond.", // CONNECTION_TIMED_OUT
  [-324]: "The site sent no data.", // EMPTY_RESPONSE
};
const REASON_FALLBACK = "The page couldn't be loaded.";

const LOCAL_NETWORK_TIP =
  "macOS may be keeping Bow off your local network. In System Settings › Privacy & Security › Local Network, turn on Bow.";
const DEVELOPMENT_SERVER_TIP = "If this is a development server, check that it is running.";

/** What the page shows for one failed load. */
export interface LoadErrorPage {
  /** The site as host and port ("192.168.0.7:3000"); the address itself when it has none. */
  host: string;
  /** The address, for Try Again; null when it is not a web address (then there is no Try Again link). */
  retryUrl: string | null;
  reason: string;
  /** Chromium's name for the error ("ERR_CONNECTION_REFUSED"), as Chrome shows it. */
  errorName: string;
  tip: string | null;
}

/**
 * The page for a failed load, or null when the failure is not one to show: a frame inside the page (the page itself is
 * still there) or a load that was only stopped.
 * Example: (-102, "ERR_CONNECTION_REFUSED", "http://localhost:3000/", true) → host "localhost:3000", the
 * "refused to connect" reason and the development-server tip.
 */
export function describeLoadError(errorCode: number, errorName: string, url: string, isMainFrame: boolean): LoadErrorPage | null {
  if (!isMainFrame || errorCode === ABORTED_ERROR_CODE) {
    return null;
  }
  const address = readWebAddress(url);
  const host = address === null ? url : address.host;
  const isLocal = address !== null && isLocalHost(address.hostname);
  let tip: string | null = null;
  // Every unreachable address gets the Local Network tip, not only local-looking names: "nas.lan" or a name that
  // points to 192.168.x.x is just as local, and a site on the internet is rarely unreachable this way.
  if (errorCode === ADDRESS_UNREACHABLE_ERROR_CODE) {
    tip = LOCAL_NETWORK_TIP;
  }
  if (isLocal && errorCode === CONNECTION_REFUSED_ERROR_CODE) {
    tip = DEVELOPMENT_SERVER_TIP;
  }
  return {
    host: host,
    retryUrl: address === null ? null : url,
    reason: REASON_TEXTS[errorCode] ?? REASON_FALLBACK,
    errorName: errorName,
    tip: tip,
  };
}

/** The address when it is a web page (http or https), else null: only those get a Try Again link. */
function readWebAddress(url: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const isWebPage = parsed.protocol === "http:" || parsed.protocol === "https:";
  return isWebPage ? parsed : null;
}

/** The look: the same family as the certificate warning and the crashed-tab page (certificate.css). */
const PAGE_STYLE = `
:root { color-scheme: light dark; }
html, body { height: 100%; margin: 0; }
body {
  display: grid;
  place-items: center;
  background: light-dark(#f5f4f7, #1f1f22);
  color: light-dark(#1d1d1f, #f2f2f4);
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
}
.load-error { max-width: min(560px, calc(100vw - 48px)); text-align: center; }
.load-error h1 { margin: 0 0 6px; font-size: 20px; }
.load-error-host { margin: 0 0 12px; overflow: hidden; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
.load-error-reason { margin: 0 0 8px; color: light-dark(rgba(0, 0, 0, 0.7), rgba(255, 255, 255, 0.7)); }
.load-error-tip { margin: 0 0 8px; color: light-dark(rgba(0, 0, 0, 0.7), rgba(255, 255, 255, 0.7)); }
.load-error-name { margin: 0; color: light-dark(rgba(0, 0, 0, 0.45), rgba(255, 255, 255, 0.45)); font-size: 12px; }
.load-error-retry {
  display: inline-block;
  margin-top: 18px;
  padding: 6px 16px;
  border-radius: 9px;
  box-shadow: inset 0 0 0 1px light-dark(rgba(0, 0, 0, 0.18), rgba(255, 255, 255, 0.22));
  color: inherit;
  font-weight: 600;
  text-decoration: none;
}
`;

/**
 * The whole document's inner HTML (head and body) for the page. Try Again is a plain link to the address, so it loads
 * the real page again in the same history entry, like Chrome's.
 */
export function renderLoadErrorHtml(page: LoadErrorPage): string {
  const tipLine = page.tip === null ? "" : `<p class="load-error-tip">${escapeHtml(page.tip)}</p>`;
  const retryLink = page.retryUrl === null ? "" : `<a class="load-error-retry" href="${escapeHtml(page.retryUrl)}">Try Again</a>`;
  return [
    `<head><meta charset="utf-8"><style>${PAGE_STYLE}</style></head>`,
    `<body><main class="load-error">`,
    `<h1>Bow can't open this page</h1>`,
    `<p class="load-error-host">${escapeHtml(page.host)}</p>`,
    `<p class="load-error-reason">${escapeHtml(page.reason)}</p>`,
    tipLine,
    `<p class="load-error-name">${escapeHtml(page.errorName)}</p>`,
    retryLink,
    `</main></body>`,
  ].join("");
}

/** The characters that mean something in HTML, and how each is written as text. */
const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Text for HTML, inside elements and quoted attributes. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}
