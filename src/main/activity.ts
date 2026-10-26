/**
 * WHY this file exists:
 *   Auto-archive must leave alone any tab you are actually using. We decided "in use" means:
 *   the tab is visible, OR it is playing sound, OR it is in picture-in-picture.
 *   This file asks Electron about each tab and refreshes lastActiveAt for the ones in use.
 *
 * Data source:
 *   Electron's WebContentsView for each tab:
 *     - visible: the selected tab of the active Space (split view comes later)
 *     - audible: webContents.isCurrentlyAudible()
 *     - picture-in-picture: asks the page whether document.pictureInPictureElement is set
 *
 * Data flow:
 *   main.ts refresh timer → findTabsInUse() → markTabsActive() → new BrowserState with fresh lastActiveAt
 */
import type { WebContentsView } from "electron";
import type { BrowserState, Tab, TabId } from "../shared/types";
import { getSelectedTabId } from "./state";

/** JavaScript run inside a tab's page. It evaluates to true while a video on the page is in picture-in-picture. */
const PICTURE_IN_PICTURE_CHECK = "document.pictureInPictureElement !== null";

/**
 * Asks a tab's page whether it is showing a video in picture-in-picture.
 * Returns false when the page cannot answer (still loading, closed, crashed),
 * because "not sure" must not keep a tab from archiving forever.
 */
export async function isInPictureInPicture(view: WebContentsView): Promise<boolean> {
  const contents = view.webContents;
  if (contents.isDestroyed() || contents.isLoading()) {
    return false;
  }

  try {
    const answer = await contents.executeJavaScript(PICTURE_IN_PICTURE_CHECK);
    return answer === true;
  } catch {
    return false;
  }
}

/**
 * Returns the ids of every tab that is visible, audible or in picture-in-picture right now.
 * Tabs without a web view (never loaded in this run) are skipped: they cannot be playing anything.
 * Example: selected tab "tab-1" plus "tab-7" playing music → ["tab-1", "tab-7"]
 */
export async function findTabsInUse(state: BrowserState, tabViews: Map<TabId, WebContentsView>): Promise<TabId[]> {
  const visibleTabId = getSelectedTabId(state);
  const inUseTabIds: TabId[] = [];

  for (const tab of state.tabs) {
    const view = tabViews.get(tab.id);
    if (view === undefined || view.webContents.isDestroyed()) {
      continue;
    }

    const isVisible = tab.id === visibleTabId;
    const isAudible = view.webContents.isCurrentlyAudible();
    if (isVisible || isAudible) {
      inUseTabIds.push(tab.id);
      continue;
    }

    // Only ask the page when the cheaper checks said no.
    const isPictureInPicture = await isInPictureInPicture(view);
    if (isPictureInPicture) {
      inUseTabIds.push(tab.id);
    }
  }
  return inUseTabIds;
}

/**
 * Sets lastActiveAt = now on the given tabs. Returns the same state when the list is empty.
 */
export function markTabsActive(state: BrowserState, tabIds: TabId[], now: number): BrowserState {
  if (tabIds.length === 0) {
    return state;
  }

  const activeTabIds = new Set(tabIds);
  const tabs: Tab[] = [];
  for (const tab of state.tabs) {
    if (activeTabIds.has(tab.id)) {
      tabs.push({ ...tab, lastActiveAt: now });
    } else {
      tabs.push(tab);
    }
  }
  return { ...state, tabs: tabs };
}
