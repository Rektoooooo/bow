/**
 * WHY this file exists:
 *   Some tab actions need both the state and the live page: closing a pinned tab also closes its page, Reset Tab
 *   navigates the page if it is loaded, mute applies to the page, back/forward act on it. They live here so the
 *   action runner, the menus and the Command Bar all use the same versions.
 *
 * Data source:
 *   browserCore.ts (state, applyChange) and tabViews.ts (the pages).
 *
 * Data flow:
 *   action runner / menu / Command Bar → one function here → applyChange() and/or a WebContents call
 */
import type { WebContents } from "electron";
import type { NavigationCommand } from "../shared/actions";
import type { ItemId } from "../shared/types";
import { applyChange, getState, scheduleRuntimePush } from "./browserCore";
import { closeTab, deleteItem, getSelectedTabId, openTab, selectTab, setTabMuted, updateTab } from "./state";
import type { OpenTabOptions } from "./state";
import { destroyTabView, getFocusedContents, getTabContents } from "./tabViews";
import type { OpenDisposition } from "./tabViews";
import { findTab, isInToday } from "./tree";
import { resetPinnedTabInEveryWindow, resetPinnedTabsInEveryWindow } from "./windows";

/**
 * Opens a link in a new Today tab. Background links (⌘-click) do not take the selection.
 */
export function openLinkInNewTab(url: string, disposition: OpenDisposition): void {
  const options: OpenTabOptions = { select: disposition === "foreground" };
  applyChange((state) => openTab(state, url, Date.now(), options));
}

/**
 * ⌘W and the close button. A Today tab goes to the archive. A Pinned tab or Favorite keeps its place: its page is
 * put away and it goes back to its home URL, like Arc. A pane of a pinned split puts only its own page away, and the
 * selection leaves the whole split (see resetPinnedTab).
 */
export function closeTabByUser(tabId: ItemId): void {
  if (isInToday(getState(), tabId)) {
    applyChange((state) => closeTab(state, tabId, Date.now()));
    return;
  }
  // The page may be on screen in another window (this one showed "Open in another window"); it goes there too, and
  // every window that selected it moves on, so the page does not load again there.
  destroyTabView(tabId);
  applyChange((state) => resetPinnedTabInEveryWindow(state, tabId));
  // The page is gone even when the state did not change, so the sidebar must hear about it.
  scheduleRuntimePush();
}

/**
 * The × on a split view's row. In Today the split view closes with its tabs (they go to the Archive), like a Today
 * tab's ×; a pinned split view keeps its place and puts its pages away, like a pinned tab's.
 */
export function closeSplitByUser(splitId: ItemId): void {
  const state = getState();
  const split = state.items[splitId];
  if (split === undefined || split.kind !== "split") {
    return;
  }
  if (isInToday(state, splitId)) {
    applyChange((current) => deleteItem(current, splitId, Date.now()));
    return;
  }
  // The pages may be on screen in another window too; they go there as well, and every window moves on from them.
  for (const tabId of split.childIds) {
    destroyTabView(tabId);
  }
  applyChange((current) => resetPinnedTabsInEveryWindow(current, split.childIds));
  // The pages are gone even when the state did not change, so the sidebar must hear about it.
  scheduleRuntimePush();
}

/**
 * Closes the selected tab (⌘W).
 */
export function closeSelectedTab(): void {
  const selectedTabId = getSelectedTabId(getState());
  if (selectedTabId !== null) {
    closeTabByUser(selectedTabId);
  }
}

/**
 * Sends a Pinned tab or Favorite back to its home URL ("Reset Tab"). A loaded page navigates; an unloaded tab
 * just remembers the URL for when it loads.
 */
export function resetTabToHome(tabId: ItemId): void {
  const tab = findTab(getState(), tabId);
  if (tab === undefined || tab.homeUrl === null) {
    return;
  }
  loadUrlInTab(tabId, tab.homeUrl);
}

/**
 * Loads an address in an existing tab: the page navigates if it is loaded, otherwise the tab remembers the address.
 */
export function loadUrlInTab(tabId: ItemId, url: string): void {
  const contents = getTabContents(tabId);
  if (contents === null) {
    applyChange((state) => updateTab(state, tabId, { url: url }));
    return;
  }
  contents.loadURL(url).catch(() => undefined);
}

/**
 * Mutes or unmutes a tab: saved in the state and applied to the page if it is loaded.
 */
export function setMuted(tabId: ItemId, isMuted: boolean): void {
  applyChange((state) => setTabMuted(state, tabId, isMuted));
  const contents = getTabContents(tabId);
  if (contents !== null) {
    contents.setAudioMuted(isMuted);
  }
}

/**
 * Back, forward, reload and stop for the page that has focus.
 */
export function navigateFocusedPage(command: NavigationCommand): void {
  const contents = getFocusedContents();
  if (contents === null) {
    return;
  }
  navigatePage(contents, command);
}

/**
 * Back, forward, reload and stop for one page (a tab's, or the Peek's from the menu).
 */
export function navigatePage(contents: WebContents, command: NavigationCommand): void {
  if (command === "back" && contents.navigationHistory.canGoBack()) {
    contents.navigationHistory.goBack();
  }
  if (command === "forward" && contents.navigationHistory.canGoForward()) {
    contents.navigationHistory.goForward();
  }
  if (command === "reload") {
    contents.reload();
  }
  if (command === "stop") {
    contents.stop();
  }
  if (command === "hardReload") {
    contents.reloadIgnoringCache();
  }
  if (command === "emptyCacheAndReload") {
    // Like Chrome's "Empty Cache and Hard Reload": the profile's whole HTTP cache goes, then the page reloads.
    contents.session
      .clearCache()
      .then(() => contents.reloadIgnoringCache())
      .catch((error) => console.error("Emptying the cache failed:", error));
  }
}

/**
 * Selects a tab when there is one. Used by commands that pick a tab by position.
 */
export function selectTabIfAny(tabId: ItemId | null): void {
  if (tabId !== null) {
    applyChange((state) => selectTab(state, tabId, Date.now()));
  }
}
