/**
 * WHY this file exists:
 *   Hovering a closed folder in Arc's sidebar shows the folder's tabs in a list beside it, the most recently used
 *   first ("1 minute ago", "18 hours ago"), so a tab can be found without opening the folder (the user's recording).
 *   This builds that list from the state.
 *
 * Data source:
 *   The BrowserState and the folder's id. Pure: no Electron, no clock.
 *
 * Data flow:
 *   sidebar hover → action showFolderList → overlayController.ts → buildFolderList() → the "folderList" panel
 */
import type { FolderListEntry } from "../shared/overlay";
import type { BrowserState, ItemId } from "../shared/types";
import { collectTabIds, findTab } from "./tree";

/**
 * Every tab in a folder (in its splits and inner folders too), the most recently used first. Empty for anything that
 * is not a folder.
 * Example: a folder with tabs used at 9:00 and 11:00 → [the 11:00 tab, the 9:00 tab]
 */
export function buildFolderList(state: BrowserState, folderId: ItemId): FolderListEntry[] {
  const folder = state.items[folderId];
  if (folder === undefined || folder.kind !== "folder") {
    return [];
  }
  const entries: FolderListEntry[] = [];
  for (const tabId of collectTabIds(state, folderId)) {
    const tab = findTab(state, tabId);
    if (tab === undefined) {
      continue;
    }
    entries.push({ tabId: tab.id, title: tab.customTitle ?? tab.title, url: tab.url, faviconUrl: tab.faviconUrl, lastActiveAt: tab.lastActiveAt });
  }
  // A copy is sorted; sort keeps tabs used at the same moment in sidebar order.
  return [...entries].sort((first, second) => second.lastActiveAt - first.lastActiveAt);
}
