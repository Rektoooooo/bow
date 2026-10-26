/**
 * WHY this file exists:
 *   Each tab's web page is an Electron WebContentsView laid over the window, right of the sidebar.
 *   BrowserState says which tabs exist and which one is selected; this file makes the views match it.
 *
 * Data source:
 *   BrowserState (from main.ts) and Electron's BrowserWindow / WebContentsView APIs.
 *
 * Data flow:
 *   main.ts applyChange() → syncTabViews() → destroy views of removed tabs → show the selected tab
 *   → layoutTabView() places it as an inset card with rounded corners
 *
 * Pattern: "reconcile". We never add or remove views by hand from a click handler.
 * We change the state, then one function compares state with the views and fixes the difference.
 *
 * Views are created lazily: a tab gets a web view the first time it is shown. Tabs restored from disk
 * stay unloaded until you click them, which keeps memory low when you have many tabs.
 */
import { WebContentsView } from "electron";
import type { BrowserWindow } from "electron";
import { CARD_INSET_PX, CARD_RADIUS_PX, SIDEBAR_WIDTH_PX } from "../shared/settings";
import type { BrowserState, Tab, TabId } from "../shared/types";
import { findTab, getSelectedTabId } from "./state";

/** Called when a page's URL or title changes, so main.ts can store it in the state. */
export type PageChangedListener = (tabId: TabId, url: string, title: string) => void;

/** One web view per loaded tab, keyed by tab id. Lives only in memory. */
const tabViews = new Map<TabId, WebContentsView>();

/** The tab whose view is in the window right now, or null when the card is empty. */
let shownTabId: TabId | null = null;

/**
 * Gives other modules (activity.ts) read access to the views.
 */
export function getTabViews(): Map<TabId, WebContentsView> {
  return tabViews;
}

/**
 * Creates a web view for one tab, loads its URL and listens for navigation and title changes.
 * Links that try to open a new window load in the same tab for now; a "new tab from link" feature comes later.
 */
export function createTabView(tab: Tab, onPageChanged: PageChangedListener): WebContentsView {
  // Default web preferences: sandboxed, context-isolated, no Node.js. Web pages get no preload script.
  const view = new WebContentsView();
  const contents = view.webContents;

  contents.on("page-title-updated", (_event, title) => {
    onPageChanged(tab.id, contents.getURL(), title);
  });
  contents.on("did-navigate", (_event, url) => {
    onPageChanged(tab.id, url, contents.getTitle());
  });
  contents.on("did-navigate-in-page", (_event, url) => {
    onPageChanged(tab.id, url, contents.getTitle());
  });
  contents.setWindowOpenHandler((details) => {
    contents.loadURL(details.url).catch(ignoreLoadFailure);
    return { action: "deny" };
  });

  view.setBorderRadius(CARD_RADIUS_PX);
  contents.loadURL(tab.url).catch(ignoreLoadFailure);
  tabViews.set(tab.id, view);
  return view;
}

/**
 * loadURL rejects when a page fails to load (no network, unknown host, or the user navigated away first).
 * The failure is already visible in the tab, so there is nothing more to do here.
 */
function ignoreLoadFailure(): void {
  // Intentionally empty.
}

/**
 * Removes a tab's web view from the window and closes its page to free memory.
 */
export function destroyTabView(window: BrowserWindow, tabId: TabId): void {
  const view = tabViews.get(tabId);
  if (view === undefined) {
    return;
  }

  window.contentView.removeChildView(view);
  view.webContents.close();
  tabViews.delete(tabId);
  if (shownTabId === tabId) {
    shownTabId = null;
  }
}

/**
 * Places a view as the inset card: right of the sidebar, CARD_INSET_PX from every edge.
 * Example: window content 1200×800 → bounds { x: 248, y: 8, width: 944, height: 784 }
 */
export function layoutTabView(window: BrowserWindow, view: WebContentsView): void {
  const contentSize = window.getContentSize();
  const contentWidth = contentSize[0];
  const contentHeight = contentSize[1];

  const left = SIDEBAR_WIDTH_PX + CARD_INSET_PX;
  const top = CARD_INSET_PX;
  const width = contentWidth - left - CARD_INSET_PX;
  const height = contentHeight - top - CARD_INSET_PX;

  // A very small window would give negative sizes, which Electron rejects.
  view.setBounds({ x: left, y: top, width: Math.max(width, 0), height: Math.max(height, 0) });
}

/**
 * Re-lays out the view on screen. main.ts calls this when the window is resized.
 */
export function layoutShownTabView(window: BrowserWindow): void {
  if (shownTabId === null) {
    return;
  }
  const view = tabViews.get(shownTabId);
  if (view !== undefined) {
    layoutTabView(window, view);
  }
}

/**
 * Takes the currently shown view out of the window. The page keeps running, so audio keeps playing.
 */
function hideShownTab(window: BrowserWindow): void {
  if (shownTabId === null) {
    return;
  }
  const view = tabViews.get(shownTabId);
  if (view !== undefined) {
    window.contentView.removeChildView(view);
  }
  shownTabId = null;
}

/**
 * Puts a tab's view in the window as the card, creating and loading it first if needed.
 */
function showTab(window: BrowserWindow, tab: Tab, onPageChanged: PageChangedListener): void {
  let view = tabViews.get(tab.id);
  if (view === undefined) {
    view = createTabView(tab, onPageChanged);
  }

  window.contentView.addChildView(view);
  layoutTabView(window, view);
  shownTabId = tab.id;
}

/**
 * Makes the views match the state: destroys views for tabs that left the sidebar,
 * and shows only the selected tab of the active Space.
 */
export function syncTabViews(window: BrowserWindow, state: BrowserState, onPageChanged: PageChangedListener): void {
  // Copy the keys first, because destroyTabView deletes from the map we are looping over.
  const loadedTabIds = Array.from(tabViews.keys());
  for (const tabId of loadedTabIds) {
    const tabStillOpen = findTab(state, tabId) !== undefined;
    if (!tabStillOpen) {
      destroyTabView(window, tabId);
    }
  }

  const selectedTabId = getSelectedTabId(state);
  if (selectedTabId === shownTabId) {
    return;
  }

  hideShownTab(window);
  if (selectedTabId === null) {
    return;
  }
  const selectedTab = findTab(state, selectedTabId);
  if (selectedTab !== undefined) {
    showTab(window, selectedTab, onPageChanged);
  }
}
