/**
 * WHY this file exists:
 *   Sidebar items live in ordered lists: a Space's Favorites, a Space's Pinned and Today lists, and the child
 *   lists of folders and split views. Moving, closing and archiving all come down to "find the list that holds
 *   this id, take it out, put it somewhere else". Those few steps live here once, so every action uses the same rules.
 *
 * Data source:
 *   The BrowserState passed in. No Electron, no clock.
 *
 * Data flow:
 *   state.ts / spaces.ts actions → findLocation() / removeFromLocation() / insertIntoLocation() → changed copy of the state
 *
 * Rules: never change the state that was passed in; return a changed copy, or the same object when nothing changed.
 */
import type { BrowserState, ItemId, ItemLocation, ProfileId, SidebarItem, Space, SpaceId, TabItem } from "../shared/types";

/** Counts ids created during this run, so two items created in the same millisecond still get different ids. */
let idCounter = 0;

/**
 * Makes a new unique id from a prefix, the current time and a counter.
 * Example: createId("tab", 1793020000000) → "tab-1793020000000-1"
 */
export function createId(prefix: string, now: number): string {
  idCounter = idCounter + 1;
  return `${prefix}-${now}-${idCounter}`;
}

/**
 * Returns the tab with this id, or undefined when the id is missing or belongs to a folder or split view.
 */
export function findTab(state: BrowserState, itemId: ItemId): TabItem | undefined {
  const item = state.items[itemId];
  if (item === undefined || item.kind !== "tab") {
    return undefined;
  }
  return item;
}

/**
 * Returns the Space with this id, or undefined.
 */
export function findSpace(state: BrowserState, spaceId: SpaceId): Space | undefined {
  return state.spaces.find((space) => space.id === spaceId);
}

/**
 * Returns the active Space. Every state has at least one Space, and activeSpaceId always points at one.
 */
export function getActiveSpace(state: BrowserState): Space {
  const activeSpace = findSpace(state, state.activeSpaceId);
  if (activeSpace === undefined) {
    throw new Error(`Active Space ${state.activeSpaceId} is missing`);
  }
  return activeSpace;
}

/**
 * Returns the ordered id list at a location.
 * Example: getIdsAt(state, { kind: "today", spaceId: "space-work" }) → that Space's todayIds
 */
export function getIdsAt(state: BrowserState, location: ItemLocation): ItemId[] {
  if (location.kind === "favorites") {
    const space = findSpace(state, location.spaceId);
    return space === undefined ? [] : space.favoriteIds;
  }
  if (location.kind === "pinned" || location.kind === "today") {
    const space = findSpace(state, location.spaceId);
    if (space === undefined) {
      return [];
    }
    return location.kind === "pinned" ? space.pinnedIds : space.todayIds;
  }

  const parentId = location.kind === "folder" ? location.folderId : location.splitId;
  const parent = state.items[parentId];
  if (parent === undefined || parent.kind === "tab") {
    return [];
  }
  return parent.childIds;
}

/**
 * Returns a copy of the state with the id list at a location replaced.
 */
export function setIdsAt(state: BrowserState, location: ItemLocation, ids: ItemId[]): BrowserState {
  if (location.kind === "favorites") {
    const spaces = state.spaces.map((space) => (space.id === location.spaceId ? { ...space, favoriteIds: ids } : space));
    return { ...state, spaces: spaces };
  }
  if (location.kind === "pinned") {
    const spaces = state.spaces.map((space) => (space.id === location.spaceId ? { ...space, pinnedIds: ids } : space));
    return { ...state, spaces: spaces };
  }
  if (location.kind === "today") {
    const spaces = state.spaces.map((space) => (space.id === location.spaceId ? { ...space, todayIds: ids } : space));
    return { ...state, spaces: spaces };
  }

  const parentId = location.kind === "folder" ? location.folderId : location.splitId;
  const parent = state.items[parentId];
  if (parent === undefined || parent.kind === "tab") {
    return state;
  }
  const updatedParent: SidebarItem = { ...parent, childIds: ids };
  return { ...state, items: { ...state.items, [parentId]: updatedParent } };
}

/**
 * Finds the list that holds an item. Returns null when no list holds it (a missing or orphaned id).
 * The sidebar has at most a few hundred items, so a scan is fast enough and keeps one source of truth.
 */
export function findLocation(state: BrowserState, itemId: ItemId): ItemLocation | null {
  for (const space of state.spaces) {
    if (space.favoriteIds.includes(itemId)) {
      return { kind: "favorites", spaceId: space.id };
    }
  }
  for (const space of state.spaces) {
    if (space.pinnedIds.includes(itemId)) {
      return { kind: "pinned", spaceId: space.id };
    }
    if (space.todayIds.includes(itemId)) {
      return { kind: "today", spaceId: space.id };
    }
  }
  for (const item of Object.values(state.items)) {
    if (item.kind === "tab" || !item.childIds.includes(itemId)) {
      continue;
    }
    if (item.kind === "folder") {
      return { kind: "folder", folderId: item.id };
    }
    return { kind: "split", splitId: item.id };
  }
  return null;
}

/**
 * Walks up from an item to the Pinned or Today list (or Favorites) at the top of its branch.
 * Example: a tab inside a folder inside Pinned → { kind: "pinned", spaceId }
 */
export function findRootLocation(state: BrowserState, itemId: ItemId): ItemLocation | null {
  let location = findLocation(state, itemId);
  // A folder can sit in a folder; the depth is small, but stop after a generous limit in case of a broken file.
  const maximumDepth = 64;
  for (let depth = 0; depth < maximumDepth; depth++) {
    if (location === null) {
      return null;
    }
    if (location.kind === "folder") {
      location = findLocation(state, location.folderId);
      continue;
    }
    if (location.kind === "split") {
      location = findLocation(state, location.splitId);
      continue;
    }
    return location;
  }
  return null;
}

/**
 * Returns the Space an item belongs to (Favorites included), or null for orphans.
 */
export function findSpaceIdOfItem(state: BrowserState, itemId: ItemId): SpaceId | null {
  const rootLocation = findRootLocation(state, itemId);
  if (rootLocation === null) {
    return null;
  }
  if (rootLocation.kind === "favorites" || rootLocation.kind === "pinned" || rootLocation.kind === "today") {
    return rootLocation.spaceId;
  }
  return null;
}

/**
 * Returns the profile whose cookies an item's page uses: the profile of the Space that holds it.
 */
export function findProfileIdOfItem(state: BrowserState, itemId: ItemId): ProfileId | null {
  const rootLocation = findRootLocation(state, itemId);
  if (rootLocation === null) {
    return null;
  }
  if (rootLocation.kind === "favorites" || rootLocation.kind === "pinned" || rootLocation.kind === "today") {
    const space = findSpace(state, rootLocation.spaceId);
    return space === undefined ? null : space.profileId;
  }
  return null;
}

/**
 * True when the item is a Today tab, or a tab inside a Today split view. Only those auto-archive.
 */
export function isInToday(state: BrowserState, itemId: ItemId): boolean {
  const rootLocation = findRootLocation(state, itemId);
  return rootLocation !== null && rootLocation.kind === "today";
}

/**
 * Takes an id out of whatever list holds it. Returns the same state when no list holds it.
 */
export function removeFromLocation(state: BrowserState, itemId: ItemId): BrowserState {
  const location = findLocation(state, itemId);
  if (location === null) {
    return state;
  }
  const remainingIds = getIdsAt(state, location).filter((id) => id !== itemId);
  return setIdsAt(state, location, remainingIds);
}

/**
 * Puts an id into a list at a position (0 = top). An index past the end appends.
 */
export function insertIntoLocation(state: BrowserState, location: ItemLocation, itemId: ItemId, index: number): BrowserState {
  const currentIds = getIdsAt(state, location);
  const clampedIndex = Math.max(0, Math.min(index, currentIds.length));
  const newIds = [...currentIds.slice(0, clampedIndex), itemId, ...currentIds.slice(clampedIndex)];
  return setIdsAt(state, location, newIds);
}

/**
 * Returns the ids of every tab under an item, the item itself included when it is a tab, in sidebar order.
 * Example: a folder holding a tab and a split of two tabs → three tab ids
 */
export function collectTabIds(state: BrowserState, itemId: ItemId): ItemId[] {
  const item = state.items[itemId];
  if (item === undefined) {
    return [];
  }
  if (item.kind === "tab") {
    return [item.id];
  }

  const tabIds: ItemId[] = [];
  for (const childId of item.childIds) {
    const childTabIds = collectTabIds(state, childId);
    tabIds.push(...childTabIds);
  }
  return tabIds;
}

/**
 * Returns the ids of every tab in a list of items (for example a Space's whole Today list).
 */
export function collectTabIdsInList(state: BrowserState, itemIds: ItemId[]): ItemId[] {
  const tabIds: ItemId[] = [];
  for (const itemId of itemIds) {
    tabIds.push(...collectTabIds(state, itemId));
  }
  return tabIds;
}

/**
 * True when `possibleAncestorId` is the item itself or contains it somewhere below.
 * Used to refuse moving a folder into itself.
 */
export function isSameOrDescendant(state: BrowserState, possibleAncestorId: ItemId, itemId: ItemId): boolean {
  if (possibleAncestorId === itemId) {
    return true;
  }
  const ancestor = state.items[possibleAncestorId];
  if (ancestor === undefined || ancestor.kind === "tab") {
    return false;
  }
  for (const childId of ancestor.childIds) {
    if (isSameOrDescendant(state, childId, itemId)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the split view that holds a tab, or null when the tab is not in one.
 */
export function findSplitOfTab(state: BrowserState, tabId: ItemId): ItemId | null {
  const location = findLocation(state, tabId);
  if (location === null || location.kind !== "split") {
    return null;
  }
  return location.splitId;
}

/**
 * The tabs on screen while a tab is selected: every pane of its split view in pane order, or just the tab.
 * Example: tab-1 in a split with tab-2 → ["tab-1", "tab-2"]; a tab on its own → ["tab-1"]
 */
export function listTabIdsShownWith(state: BrowserState, tabId: ItemId): ItemId[] {
  const splitId = findSplitOfTab(state, tabId);
  const split = splitId === null ? undefined : state.items[splitId];
  return split !== undefined && split.kind === "split" ? split.childIds : [tabId];
}

/**
 * Deletes items from the items map. Ids that are missing are ignored.
 */
export function deleteItems(state: BrowserState, itemIds: ItemId[]): BrowserState {
  if (itemIds.length === 0) {
    return state;
  }
  const items = { ...state.items };
  for (const itemId of itemIds) {
    delete items[itemId];
  }
  return { ...state, items: items };
}
