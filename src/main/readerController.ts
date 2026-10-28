/**
 * WHY this file exists:
 *   Reader view's main side: which pages look like articles (the toolbar shows its Reader button there), which tabs
 *   show Reader view now, and the article each one shows. The page stays loaded but hidden underneath, so leaving
 *   Reader view finds it where it was. Navigating away leaves Reader view.
 *
 * Data source:
 *   The tab's page (readerView.ts scripts, in an isolated world) and the state's selected tab.
 *
 * Data flow:
 *   page loaded → probeReaderPage() → availableTabIds → runtime → toolbar button
 *   View › Reader View / the button → toggleReaderView() → extract → checkReaderArticle() → articles + hidden view →
 *   runtime readerTabIds → sidebar page asks readReaderArticle(tabId) and draws it
 */
import type { WebContents } from "electron";
import type { ItemId, ReaderArticle } from "../shared/types";
import { getMainWindow, getState, scheduleRuntimePush } from "./browserCore";
import { checkReaderArticle, READER_EXTRACT_SCRIPT, READER_PROBE_SCRIPT } from "./readerView";
import { getSelectedTabId } from "./state";
import { showToast } from "./statusBubble";
import { findWindowShowingTab, getTabContents, setTabViewHidden } from "./tabViews";
import { findSplitOfTab } from "./tree";

/** The isolated world Reader view's scripts run in (renderedLinks.ts uses 1034, Feed from This Page 1035). */
const READER_WORLD_ID = 1036;

/** The tabs in Reader view, with the article each shows. */
const articles = new Map<ItemId, ReaderArticle>();

/** Tabs whose page looks like an article, with that page's address (without its #part). */
const availableUrlByTab = new Map<ItemId, string>();

/**
 * An address without its #part: moving within the page keeps Reader view.
 */
function withoutHash(url: string): string {
  const hashIndex = url.indexOf("#");
  return hashIndex === -1 ? url : url.slice(0, hashIndex);
}

/** The tabs in Reader view now. */
export function listReaderTabIds(): ItemId[] {
  return Array.from(articles.keys());
}

/** The tabs whose page looks like an article. */
export function listReaderAvailableTabIds(): ItemId[] {
  return Array.from(availableUrlByTab.keys());
}

/** The article a tab shows in Reader view, or null. */
export function getReaderArticle(tabId: ItemId): ReaderArticle | null {
  return articles.get(tabId) ?? null;
}

/**
 * Gives the keyboard to the sidebar page while it shows the article (Escape, scrolling keys), or back to the page.
 */
function moveKeyboard(tabId: ItemId, isReaderShown: boolean): void {
  const windowId = findWindowShowingTab(tabId);
  const window = windowId === null ? null : getMainWindow(windowId);
  if (isReaderShown) {
    window?.webContents.focus();
    return;
  }
  getTabContents(tabId)?.focus();
}

/**
 * Leaves Reader view in a tab: the page shows again.
 */
function leaveReaderView(tabId: ItemId): void {
  if (!articles.delete(tabId)) {
    return;
  }
  setTabViewHidden(tabId, false);
  moveKeyboard(tabId, false);
  scheduleRuntimePush();
}

/**
 * Reader View on or off for the selected tab. A page in a split view, or one with no article, stays as it is (the
 * latter says so).
 */
export async function toggleReaderView(): Promise<void> {
  const state = getState();
  const tabId = getSelectedTabId(state);
  if (tabId === null) {
    return;
  }
  if (articles.has(tabId)) {
    leaveReaderView(tabId);
    return;
  }
  const contents = getTabContents(tabId);
  if (contents === null || findSplitOfTab(state, tabId) !== null) {
    return;
  }
  const extracted: unknown = await contents.executeJavaScriptInIsolatedWorld(READER_WORLD_ID, [{ code: READER_EXTRACT_SCRIPT }]).catch(() => null);
  const article = checkReaderArticle(extracted, contents.getURL(), contents.getTitle());
  if (article === null) {
    showToast("This page has no article to read").catch(() => undefined);
    return;
  }
  articles.set(tabId, article);
  setTabViewHidden(tabId, true);
  moveKeyboard(tabId, true);
  scheduleRuntimePush();
}

/**
 * A page loaded: whether it looks like an article decides the toolbar's Reader button.
 */
export function probeReaderPage(tabId: ItemId, contents: WebContents): void {
  contents
    .executeJavaScriptInIsolatedWorld(READER_WORLD_ID, [{ code: READER_PROBE_SCRIPT }])
    .then((result: unknown) => {
      const isArticle = result === true;
      if (isArticle === availableUrlByTab.has(tabId)) {
        return;
      }
      if (isArticle) {
        availableUrlByTab.set(tabId, withoutHash(contents.getURL()));
      } else {
        availableUrlByTab.delete(tabId);
      }
      scheduleRuntimePush();
    })
    .catch(() => undefined);
}

/**
 * A tab's page changed (its address, or only its title): another page leaves Reader view, and is probed again once
 * it loads.
 */
export function noticeReaderPageChanged(tabId: ItemId, url: string): void {
  const page = withoutHash(url);
  const article = articles.get(tabId);
  if (article !== undefined && withoutHash(article.url) !== page) {
    leaveReaderView(tabId);
  }
  const availableUrl = availableUrlByTab.get(tabId);
  if (availableUrl !== undefined && availableUrl !== page) {
    availableUrlByTab.delete(tabId);
    scheduleRuntimePush();
  }
}
