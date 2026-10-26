/**
 * WHY this file exists:
 *   Auto-archive must leave alone any tab you are actually using. We decided "in use" means:
 *   the tab is visible, OR it is playing sound, OR it is in picture-in-picture.
 *   This file asks Electron about each tab and refreshes lastActiveAt for the ones in use.
 *
 * Data source:
 *   Electron's WebContentsView for each tab:
 *     - visible: the tabs whose pages are on screen right now (the selected tab, or every pane of its split view)
 *     - audible: webContents.isCurrentlyAudible()
 *     - picture-in-picture: asks the page whether document.pictureInPictureElement is set
 *
 * Data flow:
 *   main.ts refresh timer → findTabsInUse() → markTabsActive() → new BrowserState with fresh lastActiveAt
 */
import type { WebContentsView } from "electron";
import type { BrowserState, ItemId } from "../shared/types";
import { updateTab } from "./state";

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
 * Returns the ids of every loaded tab that is visible, audible or in picture-in-picture right now.
 * Only tabs with a web view are checked: a tab that is not loaded cannot be playing anything.
 * Example: selected tab "tab-1" plus "tab-7" playing music → ["tab-1", "tab-7"]
 */
export async function findTabsInUse(tabViews: Map<ItemId, WebContentsView>, visibleTabIds: ItemId[]): Promise<ItemId[]> {
  const visibleTabSet = new Set(visibleTabIds);
  const inUseTabIds: ItemId[] = [];

  for (const [tabId, view] of tabViews) {
    if (view.webContents.isDestroyed()) {
      continue;
    }

    const isVisible = visibleTabSet.has(tabId);
    const isAudible = view.webContents.isCurrentlyAudible();
    if (isVisible || isAudible) {
      inUseTabIds.push(tabId);
      continue;
    }

    // Only ask the page when the cheaper checks said no.
    const isPictureInPicture = await isInPictureInPicture(view);
    if (isPictureInPicture) {
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
