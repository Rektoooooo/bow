/**
 * WHY this file exists:
 *   A site with a certificate Bow cannot trust (self-signed, expired, for another name) used to leave a dead page: no
 *   warning, no way to continue. This shows "This connection isn't private" in the tab, with two choices on an overlay
 *   card: "Back to Safety", or "Visit <site> Anyway", which allows that site with that very certificate until Bow
 *   quits. The allowance is in memory only and is never saved. Only tabs are handled: every other view keeps the
 *   refusal Electron gives by default.
 *
 * Data source:
 *   app "certificate-error" events (the address and the certificate's fingerprint), and failed main-frame loads of
 *   tabs (tabViews.ts → main.ts onLoadFailed, after httpsOnlyController.ts had its say).
 *
 * Data flow:
 *   page load hits a bad certificate → "certificate-error": allowed before? → accept; else refuse and remember what
 *   was refused for that page → the load fails → noticeCertificateFailure() → certificate.html in the tab, plus a
 *   pending card → overlay panel "certificateWarning" (when that tab is on screen) → Back to Safety / Visit Anyway
 *   (action answerCertificateWarning) → answerCertificateWarning() → go back or close the tab / allow and load again.
 */
import * as path from "node:path";
import { app } from "electron";
import type { Certificate, Event, WebContents } from "electron";
import type { ItemId } from "../shared/types";
import { getState } from "./browserCore";
import { isOverlayShown } from "./overlay";
import { closeCertificateWarning, isPanelShown, onPanelEnded, openCertificateWarning } from "./overlayController";
import { closeTabByUser } from "./tabActions";
import { findTabIdOfContents, getShownTabIdsInWindow } from "./tabViews";

/** How often a waiting card checks whether its tab is on screen and the overlay is free (same reason as permissionPrompts.ts). */
const BUSY_RETRY_MS = 1000;

/** Chromium's certificate errors are -200 to -299 (net_error_list.h). */
const CERTIFICATE_ERROR_FIRST = -200;
const CERTIFICATE_ERROR_LAST = -299;

/** The warning page (a local file; tabs never record local file addresses, so it never ends up saved). */
const CERTIFICATE_PAGE_PATH = path.join(__dirname, "..", "..", "web", "certificate", "certificate.html");

/** What a page's load was refused for, until the failed load reports it. */
interface RefusedCertificate {
  url: string;
  host: string;
  fingerprint: string;
}

/** A warning on screen in a tab, with its card waiting to be shown or shown. */
interface PendingWarning {
  id: string;
  contents: WebContents;
  tabId: ItemId;
  refused: RefusedCertificate;
  stopWatchingTab: () => void;
}

/** The last refusal per page (by WebContents id). */
const refusedByContents = new Map<number, RefusedCertificate>();

/** "host|fingerprint" the user chose to visit anyway. Lives until Bow quits; never saved. */
const allowedCertificates = new Set<string>();

const pendingWarnings: PendingWarning[] = [];

let shownWarningId: string | null = null;
let warningCounter = 0;
let retryTimer: NodeJS.Timeout | null = null;

function allowanceKey(host: string, fingerprint: string): string {
  return `${host}|${fingerprint}`;
}

/**
 * Connects the certificate errors to the overlay. Runs once at startup.
 */
export function initializeCertificateErrors(): void {
  app.on("certificate-error", (event, contents, url, _error, certificate, callback, isMainFrame) => {
    try {
      handleCertificateError(event, contents, url, certificate, callback, isMainFrame);
    } catch (error) {
      // An error escaping an Electron event handler pops up a dialog; the default (refuse) stays.
      console.error("Could not handle a certificate error:", error instanceof Error ? error.name : "");
    }
  });
  onPanelEnded((panel, reason) => {
    if (panel.kind === "certificateWarning" && panel.requestId === shownWarningId) {
      shownWarningId = null;
      if (reason === "closed") {
        // Escape or a click outside: the page stays as it is, the card is not shown again.
        dropWarning(panel.requestId);
      }
    }
    showNextWarning();
  });
}

/**
 * A tab's page met a certificate Chromium does not trust: accepted when the user visited this site with this
 * certificate anyway; otherwise left refused (Electron's default), and noted for the failed load that follows.
 */
function handleCertificateError(event: Event, contents: WebContents | null, url: string, certificate: Certificate, callback: (isTrusted: boolean) => void, isMainFrame: boolean): void {
  if (contents === null || findTabIdOfContents(contents) === null) {
    return;
  }
  const host = new URL(url).host;
  if (allowedCertificates.has(allowanceKey(host, certificate.fingerprint))) {
    event.preventDefault();
    callback(true);
    return;
  }
  if (isMainFrame) {
    refusedByContents.set(contents.id, { url: url, host: host, fingerprint: certificate.fingerprint });
  }
}

/**
 * A tab's page failed to load. When the reason was a refused certificate, the tab shows the warning page and the
 * card asks what to do. Anything else is not ours.
 */
export function noticeCertificateFailure(contents: WebContents, errorCode: number, validatedUrl: string, isMainFrame: boolean): void {
  const isCertificateError = errorCode <= CERTIFICATE_ERROR_FIRST && errorCode >= CERTIFICATE_ERROR_LAST;
  const refused = refusedByContents.get(contents.id);
  const tabId = findTabIdOfContents(contents);
  if (!isMainFrame || !isCertificateError || refused === undefined || tabId === null) {
    return;
  }
  refusedByContents.delete(contents.id);
  if (readHost(validatedUrl) !== refused.host) {
    return;
  }
  contents
    .loadFile(CERTIFICATE_PAGE_PATH, { query: { url: refused.url, code: String(errorCode) } })
    .then(() => addWarning(contents, tabId, refused))
    .catch(() => undefined);
}

function readHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Keeps a card for the warning page that is now in the tab. It goes when the tab leaves that page or closes.
 */
function addWarning(contents: WebContents, tabId: ItemId, refused: RefusedCertificate): void {
  if (contents.isDestroyed()) {
    return;
  }
  const olderWarning = pendingWarnings.find((warning) => warning.contents === contents);
  if (olderWarning !== undefined) {
    dropWarning(olderWarning.id);
  }
  warningCounter = warningCounter + 1;
  const id = `certificate-${warningCounter}`;
  const onNavigation = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => {
    if (details.isMainFrame && !details.isSameDocument) {
      dropWarning(id);
    }
  };
  const onDestroyed = (): void => {
    dropWarning(id);
  };
  contents.on("did-start-navigation", onNavigation);
  contents.once("destroyed", onDestroyed);
  const stopWatchingTab = (): void => {
    if (!contents.isDestroyed()) {
      contents.removeListener("did-start-navigation", onNavigation);
      contents.removeListener("destroyed", onDestroyed);
    }
  };
  pendingWarnings.push({ id: id, contents: contents, tabId: tabId, refused: refused, stopWatchingTab: stopWatchingTab });
  showNextWarning();
}

/**
 * Forgets a warning's card and takes it off screen when it is the one shown.
 */
function dropWarning(id: string): PendingWarning | null {
  const index = pendingWarnings.findIndex((warning) => warning.id === id);
  const warning = pendingWarnings[index];
  if (warning === undefined) {
    return null;
  }
  pendingWarnings.splice(index, 1);
  warning.stopWatchingTab();
  if (shownWarningId === id) {
    closeCertificateWarning(id);
  }
  return warning;
}

/**
 * Shows the first warning whose tab is on screen in the focused window, when nothing else is on the overlay.
 * Otherwise checks again in a moment.
 */
function showNextWarning(): void {
  if (shownWarningId !== null || pendingWarnings.length === 0) {
    return;
  }
  const shownTabIds = getShownTabIdsInWindow(getState().focusedWindowId);
  const next = pendingWarnings.find((warning) => shownTabIds.includes(warning.tabId));
  const isOverlayBusy = isPanelShown() || isOverlayShown();
  if (next === undefined || isOverlayBusy) {
    if (retryTimer === null) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        showNextWarning();
      }, BUSY_RETRY_MS);
    }
    return;
  }
  shownWarningId = next.id;
  openCertificateWarning(next.id, next.refused.host);
}

/**
 * Back to Safety goes to the last page of the tab that is not this site, or closes the tab when there is none.
 */
function goBackToSafety(contents: WebContents, tabId: ItemId, refused: RefusedCertificate): void {
  const history = contents.navigationHistory;
  const entries = history.getAllEntries();
  for (let index = history.getActiveIndex() - 1; index >= 0; index = index - 1) {
    const entry = entries[index];
    const isOurPage = entry !== undefined && (entry.url.startsWith("file://") || entry.url.startsWith("chrome-error://"));
    if (entry !== undefined && !isOurPage && readHost(entry.url) !== refused.host) {
      history.goToIndex(index);
      return;
    }
  }
  closeTabByUser(tabId);
}

/**
 * "Back to Safety" or "Visit <site> Anyway" on the shown card. Visiting allows this site with this certificate until
 * Bow quits, then loads the address that was refused.
 */
export function answerCertificateWarning(requestId: string, isVisitAnyway: boolean): void {
  const warning = dropWarning(requestId);
  if (warning === null || warning.contents.isDestroyed()) {
    return;
  }
  if (isVisitAnyway) {
    allowedCertificates.add(allowanceKey(warning.refused.host, warning.refused.fingerprint));
    warning.contents.loadURL(warning.refused.url).catch(() => undefined);
    return;
  }
  goBackToSafety(warning.contents, warning.tabId, warning.refused);
}
