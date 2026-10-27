/**
 * WHY this file exists:
 *   Auto-archive (and tab sleep) must leave alone any tab you are actually using. We decided "in use" means:
 *   the tab is visible, OR it is playing sound, OR it is in picture-in-picture, OR it uses the camera, the microphone
 *   or a screen share (a muted call is silent).
 *   This file asks Electron about each tab and refreshes lastActiveAt for the ones in use.
 *
 * Data source:
 *   Electron's WebContentsView for each tab:
 *     - visible: the tabs whose pages are on screen right now (the selected tab, or every pane of its split view)
 *     - audible: webContents.isCurrentlyAudible()
 *     - picture-in-picture: the tab whose video is in our floating window (pictureInPicture.ts)
 *     - capturing: a page allowed the camera, microphone or a screen share (mediaCapture.ts)
 *
 * Data flow:
 *   main.ts refresh timer → findTabsInUse() → markTabsActive() → new BrowserState with fresh lastActiveAt
 */
import type { WebContentsView } from "electron";
import type { BrowserState, ItemId } from "../shared/types";
import { isCapturing } from "./mediaCapture";
import { updateTab } from "./state";

/**
 * Returns the ids of every loaded tab that is visible, audible or in picture-in-picture right now.
 * Only tabs with a web view are checked: a tab that is not loaded cannot be playing anything.
 * Example: selected tab "tab-1" plus "tab-7" playing music → ["tab-1", "tab-7"]
 */
export function findTabsInUse(tabViews: Map<ItemId, WebContentsView>, visibleTabIds: ItemId[], pictureInPictureTabId: ItemId | null): ItemId[] {
  const visibleTabSet = new Set(visibleTabIds);
  const inUseTabIds: ItemId[] = [];

  for (const [tabId, view] of tabViews) {
    if (view.webContents.isDestroyed()) {
      continue;
    }

    const isVisible = visibleTabSet.has(tabId);
    const isAudible = view.webContents.isCurrentlyAudible();
    const isPictureInPicture = tabId === pictureInPictureTabId;
    if (isVisible || isAudible || isPictureInPicture || isCapturing(view.webContents)) {
      inUseTabIds.push(tabId);
    }
  }
  return inUseTabIds;
}

/**
 * Sets lastActiveAt = now on the given tabs. Returns the same state when the list is empty.
 */
export function markTabsActive(state: BrowserState, tabIds: ItemId[], now: number): BrowserState {
  let changedState = state;
  for (const tabId of tabIds) {
    changedState = updateTab(changedState, tabId, { lastActiveAt: now });
  }
  return changedState;
}
