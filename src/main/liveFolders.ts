/**
 * WHY this file exists:
 *   A live folder fills itself, like Arc's Live Folders: your open GitHub pull requests, or the newest posts of a
 *   feed. Each refresh reads a list of addresses from the source; this file turns that list into the folder's tabs.
 *   New addresses become tabs (with the unread dot, like Arc), addresses that left the list leave the folder, and the
 *   rest keep their tab (and its loaded page) in the source's order. Pure, like state.ts: reading the sources lives
 *   in liveFolderRefresher.ts.
 *
 * Data source:
 *   The BrowserState, and the entries a refresh read.
 *
 * Data flow:
 *   liveFolderRefresher.ts reads a source → applyLiveFolderEntries(state, folderId, entries, now, …) → applyChange
 *
 * Same rules as state.ts: never change the state passed in, return the same object when nothing changes, `now` is a
 * parameter.
 */
import { LIVE_FOLDER_ITEM_LIMIT } from "../shared/settings";
import type { BrowserState, FolderItem, ItemId, LiveFolderSource, ProfileId, SidebarItem, TabItem } from "../shared/types";
import { repairSelections } from "./state";
import { collectTabIds, createId, deleteItems, findProfileIdOfItem } from "./tree";

/** One item a source lists: its address and title. */
export interface LiveFolderEntry {
  url: string;
  title: string;
}

/** A live folder, with what a refresh needs to read its source. */
export interface LiveFolderTarget {
  folderId: ItemId;
  source: LiveFolderSource;
  /** The profile of the folder's Space: its cookies are the ones signed in to GitHub. */
  profileId: ProfileId;
}

/**
 * Every live folder in the state.
 */
export function listLiveFolders(state: BrowserState): LiveFolderTarget[] {
  const targets: LiveFolderTarget[] = [];
  for (const item of Object.values(state.items)) {
    if (item.kind !== "folder" || item.live === undefined) {
      continue;
    }
    const profileId = findProfileIdOfItem(state, item.id);
    if (profileId !== null) {
      targets.push({ folderId: item.id, source: item.live.source, profileId: profileId });
    }
  }
  return targets;
}

/**
 * The address a tab stands for: where it was pinned (its home), or where it is.
 */
function getTabAddress(tab: TabItem): string {
  return tab.homeUrl ?? tab.url;
}

/**
 * The addresses of every tab outside a folder (in any Space, Favorites included). A refresh skips them, so a page
 * you already keep somewhere (or dragged out of the folder) does not show up twice.
 */
function collectAddressesOutside(state: BrowserState, folder: FolderItem): Set<string> {
  const childIds = new Set(folder.childIds);
  const addresses = new Set<string>();
  for (const item of Object.values(state.items)) {
    if (item.kind === "tab" && !childIds.has(item.id)) {
      addresses.add(getTabAddress(item));
    }
  }
  return addresses;
}

/**
 * The folder's tabs by address (the first one, when two share an address).
 */
function mapChildTabsByAddress(state: BrowserState, folder: FolderItem): Map<string, TabItem> {
  const tabsByAddress = new Map<string, TabItem>();
  for (const childId of folder.childIds) {
    const child: SidebarItem | undefined = state.items[childId];
    if (child === undefined || child.kind !== "tab") {
      continue;
    }
    const address = getTabAddress(child);
    if (!tabsByAddress.has(address)) {
      tabsByAddress.set(address, child);
    }
  }
  return tabsByAddress;
}

/**
 * True when two id lists hold the same ids in the same order.
 */
function isSameOrder(firstIds: ItemId[], secondIds: ItemId[]): boolean {
  if (firstIds.length !== secondIds.length) {
    return false;
  }
  return firstIds.every((itemId, index) => itemId === secondIds[index]);
}

/**
 * Puts the entries a refresh read into a live folder:
 *   - Hidden addresses (removed by the user), addresses open in another tab and repeats are skipped; at most
 *     LIVE_FOLDER_ITEM_LIMIT entries are kept.
 *   - A tab whose address is still listed stays, in the source's order.
 *   - A new address becomes a tab whose home is that address (like a pinned tab). With `markNewAsUnread` it gets the
 *     unread dot; the first fill of a folder passes false, so a new folder is not all dots.
 *   - A tab whose address left the list is deleted (it was never the user's), unless it is the selected tab of its
 *     Space: the page you are reading never disappears under you. It goes on a later refresh.
 * Returns the same state when the folder is gone, not live, or already shows exactly these entries.
 */
export function applyLiveFolderEntries(state: BrowserState, folderId: ItemId, entries: LiveFolderEntry[], now: number, markNewAsUnread: boolean): BrowserState {
  const folder = state.items[folderId];
  if (folder === undefined || folder.kind !== "folder" || folder.live === undefined) {
    return state;
  }
  const hiddenUrls = new Set(folder.live.hiddenUrls);
  const addressesOutside = collectAddressesOutside(state, folder);
  const childTabsByAddress = mapChildTabsByAddress(state, folder);

  const items = { ...state.items };
  const newChildIds: ItemId[] = [];
  const usedAddresses = new Set<string>();
  for (const entry of entries) {
    const isSkipped = hiddenUrls.has(entry.url) || addressesOutside.has(entry.url) || usedAddresses.has(entry.url);
    if (isSkipped || newChildIds.length >= LIVE_FOLDER_ITEM_LIMIT) {
      continue;
    }
    usedAddresses.add(entry.url);
    const existingTab = childTabsByAddress.get(entry.url);
    if (existingTab !== undefined) {
      newChildIds.push(existingTab.id);
      continue;
    }
    const tab: TabItem = {
      kind: "tab",
      id: createId("tab", now),
      url: entry.url,
      title: entry.title,
      customTitle: null,
      faviconUrl: null,
      homeUrl: entry.url,
      lastActiveAt: now,
      isMuted: false,
    };
    if (markNewAsUnread) {
      tab.isUnread = true;
    }
    items[tab.id] = tab;
    newChildIds.push(tab.id);
  }

  const selectedTabIds = new Set(Object.values(state.selectedTabIdBySpace));
  const removedIds: ItemId[] = [];
  for (const childId of folder.childIds) {
    if (newChildIds.includes(childId)) {
      continue;
    }
    if (selectedTabIds.has(childId)) {
      newChildIds.push(childId);
      continue;
    }
    // Whatever else got in (an import, an older version) leaves whole: a container takes its tabs along.
    removedIds.push(childId, ...collectTabIds(state, childId));
  }
  if (isSameOrder(newChildIds, folder.childIds)) {
    return state;
  }

  const changedFolder: FolderItem = { ...folder, childIds: newChildIds };
  items[folderId] = changedFolder;
  const stateWithoutRemoved = deleteItems({ ...state, items: items }, removedIds);
  return repairSelections(stateWithoutRemoved);
}

/**
 * Forgets the addresses removed from a live folder, so the next refresh shows them again ("Show Removed Items").
 */
export function showHiddenLiveFolderItems(state: BrowserState, folderId: ItemId): BrowserState {
  const folder = state.items[folderId];
  if (folder === undefined || folder.kind !== "folder" || folder.live === undefined || folder.live.hiddenUrls.length === 0) {
    return state;
  }
  const changedFolder: FolderItem = { ...folder, live: { ...folder.live, hiddenUrls: [] } };
  return { ...state, items: { ...state.items, [folderId]: changedFolder } };
}
