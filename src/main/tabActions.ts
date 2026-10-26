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
import type { NavigationCommand } from "../shared/actions";
import type { ItemId } from "../shared/types";
import { applyChange, getState, getWindow, scheduleRuntimePush } from "./browserCore";
import { closeTab, getSelectedTabId, openTab, resetPinnedTab, selectTab, setTabMuted, updateTab } from "./state";
import type { OpenTabOptions } from "./state";
import { destroyTabView, getFocusedContents, getTabContents } from "./tabViews";
import type { OpenDisposition } from "./tabViews";
import { findTab, isInToday } from "./tree";

/**
 * Opens a link in a new Today tab. Background links (⌘-click) do not take the selection.
 */
export function openLinkInNewTab(url: string, disposition: OpenDisposition): void {
  const options: OpenTabOptions = { select: disposition === "foreground" };
  applyChange((state) => openTab(state, url, Date.now(), options));
}

/**
 * ⌘W and the close button. A Today tab goes to the archive. A Pinned tab or Favorite keeps its place: its page is
 * put away and it goes back to its home URL, like Arc.
 */
export function closeTabByUser(tabId: ItemId): void {
  if (isInToday(getState(), tabId)) {
    applyChange((state) => closeTab(state, tabId, Date.now()));
    return;
  }
  const window = getWindow();
  if (window !== null) {
    destroyTabView(window, tabId);
  }
  applyChange((state) => resetPinnedTab(state, tabId));
  // The page is gone even when the state did not change, so the sidebar must hear about it.
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
