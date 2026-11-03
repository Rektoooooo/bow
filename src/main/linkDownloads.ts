/**
 * WHY this file exists:
 *   A link to a file (a PDF, a zip) opens a new tab, a Peek or a Little Window, the page turns out to be a download,
 *   and an empty view would stay behind. Chrome closes such a view; so do we. Only a view Bow opened *for that link*
 *   goes away, and only when its first load became the download. A tab from ⌘T or a typed address stays.
 *
 * Data source:
 *   downloads.ts (which page started each download), and the views registered by whoever opened them for a link.
 *
 * Data flow:
 *   openLinkInNewTab() → markLinkTab(tabId, sourceTabId)       Peek / Little Window / popup → markLinkView(contents, close)
 *   a download starts → closeViewOfDownload(contents) → the view never showed a page? → it goes, without an Archive entry
 */
import type { WebContents } from "electron";
import type { ItemId } from "../shared/types";
import { applyChange } from "./browserCore";
import { onDownloadStarted } from "./downloads";
import { discardTab } from "./state";
import { findTabIdOfContents } from "./tabViews";

/** Where a link tab came from: the tab whose page held the link, or null (a link from another app, a Little Window). */
export interface LinkOrigin {
  sourceTabId: ItemId | null;
}

/** Tabs opened for a link and not yet seen to show a page, with the tab each came from. Not saved. */
const linkTabSources = new Map<ItemId, ItemId | null>();

/** How to close a view opened for a link (a Peek, a Little Window, a popup). Keyed by its page; not saved. */
const linkViewClosers = new WeakMap<WebContents, () => void>();

/**
 * Notes that a tab was opened for a link, so a download in place of its page removes it again.
 */
export function markLinkTab(tabId: ItemId, origin: LinkOrigin): void {
  linkTabSources.set(tabId, origin.sourceTabId);
}

/**
 * A link tab showed a page: it is an ordinary tab from now on, and the note about it goes (or every link tab of a long
 * session would stay listed).
 */
export function forgetLinkTab(tabId: ItemId): void {
  linkTabSources.delete(tabId);
}

/**
 * Notes that a Peek, Little Window or popup was opened for a link; `closeView` takes it away.
 */
export function markLinkView(contents: WebContents, closeView: () => void): void {
  linkViewClosers.set(contents, closeView);
}

/**
 * True while a page has not committed anything: Chromium reports "" for a first load that became a download, and
 * "about:blank" for the empty page a popup starts with.
 */
function hasNeverShownPage(contents: WebContents): boolean {
  const url = contents.getURL();
  return url === "" || url === "about:blank";
}

/**
 * A download started in these contents: close the view when it was opened for a link and shows nothing.
 */
function closeViewOfDownload(contents: WebContents): void {
  if (contents.isDestroyed()) {
    return;
  }
  const closeView = linkViewClosers.get(contents);
  if (closeView !== undefined && hasNeverShownPage(contents)) {
    linkViewClosers.delete(contents);
    closeView();
    return;
  }
  const tabId = findTabIdOfContents(contents);
  if (tabId === null || !linkTabSources.has(tabId)) {
    return;
  }
  const sourceTabId = linkTabSources.get(tabId) ?? null;
  // A page that showed something is an ordinary tab from now on; one that showed nothing goes.
  linkTabSources.delete(tabId);
  if (hasNeverShownPage(contents)) {
    applyChange((state) => discardTab(state, tabId, sourceTabId, Date.now()));
  }
}

/**
 * Starts closing the empty views that downloads leave behind. Called once at startup.
 */
export function startClosingEmptyLinkViews(): void {
  onDownloadStarted((contents) => closeViewOfDownload(contents));
}
