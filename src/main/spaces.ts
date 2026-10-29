/**
 * WHY this file exists:
 *   Spaces are Arc's workspaces: each has a name, an emoji, a theme, a profile and its own Pinned and Today tabs.
 *   Switching, creating, editing, reordering and deleting them, and moving items between them, live here.
 *
 * Data source:
 *   The BrowserState passed in. No Electron, no clock.
 *
 * Data flow:
 *   ipc.ts / menu.ts → main.ts applyChange() → one function here → changed copy of the state
 *
 * Rules: never change the state that was passed in; return a changed copy, or the same object when nothing changed.
 */
import type { BrowserState, ItemId, ItemLocation, Space, SpaceId, SpaceTheme } from "../shared/types";
import { getSelectedTabId, moveTabsToArchive, repairSelections, updateTab } from "./state";
import { collectTabIdsInList, createId, findRootLocation, findSpace, getActiveSpace, getIdsAt, insertIntoLocation, removeFromLocation } from "./tree";

/** The most Spaces we allow. Arc does not document one; nine matches ⌃1–⌃9. */
export const SPACES_LIMIT = 9;

/** The two Spaces a fresh install starts with (state.ts); an import replaces them while they are still empty. */
export const STARTER_SPACE_IDS = ["space-personal", "space-work"];

/** Emoji used when a new Space gets no icon. */
export const DEFAULT_SPACE_ICON = "✦";

/**
 * Returns a copy of the Space list with one Space changed.
 */
function updateSpace(state: BrowserState, spaceId: SpaceId, changes: Partial<Space>): BrowserState {
  const spaces = state.spaces.map((space) => (space.id === spaceId ? { ...space, ...changes } : space));
  return { ...state, spaces: spaces };
}

/**
 * Switches to another Space. The tab you leave and the tab that becomes visible both get lastActiveAt = now.
 */
export function switchSpace(state: BrowserState, spaceId: SpaceId, now: number): BrowserState {
  const targetSpace = findSpace(state, spaceId);
  if (targetSpace === undefined || spaceId === state.activeSpaceId) {
    return state;
  }

  let changedState = state;
  const leavingTabId = getSelectedTabId(state);
  if (leavingTabId !== null) {
    changedState = updateTab(changedState, leavingTabId, { lastActiveAt: now });
  }
  const arrivingTabId = state.selectedTabIdBySpace[spaceId] ?? null;
  if (arrivingTabId !== null) {
    changedState = updateTab(changedState, arrivingTabId, { lastActiveAt: now });
  }
  return { ...changedState, activeSpaceId: spaceId };
}

/**
 * Switches to the Space `offset` places away in switcher order (+1 next, -1 previous). Stops at the ends, like Arc.
 * Example: Spaces [A, B, C], active B, offset +1 → C; active C, offset +1 → stays C
 */
export function switchSpaceByOffset(state: BrowserState, offset: number, now: number): BrowserState {
  const activeIndex = state.spaces.findIndex((space) => space.id === state.activeSpaceId);
  const targetIndex = activeIndex + offset;
  const targetSpace = state.spaces[targetIndex];
  if (targetSpace === undefined) {
    return state;
  }
  return switchSpace(state, targetSpace.id, now);
}

/**
 * Switches to the Space at a 1-based position (⌃1 … ⌃9). Returns the same state when there is no such Space.
 */
export function switchSpaceByNumber(state: BrowserState, spaceNumber: number, now: number): BrowserState {
  const targetSpace = state.spaces[spaceNumber - 1];
  if (targetSpace === undefined) {
    return state;
  }
  return switchSpace(state, targetSpace.id, now);
}

/** What a new Space starts with. */
export interface NewSpaceDetails {
  name: string;
  icon: string;
  theme: SpaceTheme;
}

/**
 * Adds a Space after the last one, using the active Space's profile, and switches to it.
 * Returns the same state when SPACES_LIMIT is reached.
 */
export function createSpace(state: BrowserState, details: NewSpaceDetails, now: number): BrowserState {
  if (state.spaces.length >= SPACES_LIMIT) {
    return state;
  }
  const activeSpace = getActiveSpace(state);
  const trimmedName = details.name.trim();
  const newSpace: Space = {
    id: createId("space", now),
    name: trimmedName === "" ? "New Space" : trimmedName,
    icon: details.icon.trim() === "" ? DEFAULT_SPACE_ICON : details.icon.trim(),
    theme: details.theme,
    profileId: activeSpace.profileId,
    pinnedIds: [],
    todayIds: [],
    isPinnedOpen: true,
  };

  const stateWithSpace: BrowserState = {
    ...state,
    spaces: [...state.spaces, newSpace],
    selectedTabIdBySpace: { ...state.selectedTabIdBySpace, [newSpace.id]: null },
  };
  return switchSpace(stateWithSpace, newSpace.id, now);
}

/**
 * Renames a Space. An empty name is ignored.
 */
export function renameSpace(state: BrowserState, spaceId: SpaceId, newName: string): BrowserState {
  const space = findSpace(state, spaceId);
  const trimmedName = newName.trim();
  if (space === undefined || trimmedName === "" || space.name === trimmedName) {
    return state;
  }
  return updateSpace(state, spaceId, { name: trimmedName });
}

/**
 * Changes a Space's emoji. An empty icon is ignored.
 */
export function setSpaceIcon(state: BrowserState, spaceId: SpaceId, newIcon: string): BrowserState {
  const space = findSpace(state, spaceId);
  const trimmedIcon = newIcon.trim();
  if (space === undefined || trimmedIcon === "" || space.icon === trimmedIcon) {
    return state;
  }
  return updateSpace(state, spaceId, { icon: trimmedIcon });
}

/**
 * Changes a Space's theme.
 */
export function setSpaceTheme(state: BrowserState, spaceId: SpaceId, theme: SpaceTheme): BrowserState {
  const space = findSpace(state, spaceId);
  if (space === undefined) {
    return state;
  }
  return updateSpace(state, spaceId, { theme: theme });
}

/**
 * Deletes a Space. Its tabs go to the archive ("manual"), its folders and split views are removed, and the
 * neighbouring Space becomes active. The last Space cannot be deleted.
 */
export function deleteSpace(state: BrowserState, spaceId: SpaceId, now: number): BrowserState {
  const space = findSpace(state, spaceId);
  if (space === undefined || state.spaces.length <= 1) {
    return state;
  }

  const allItemIds = [...space.pinnedIds, ...space.todayIds];
  const tabIds = collectTabIdsInList(state, allItemIds);
  const archivedState = moveTabsToArchive(state, tabIds, now, "manual");

  const spaceIndex = state.spaces.findIndex((candidate) => candidate.id === spaceId);
  const remainingSpaces = archivedState.spaces.filter((candidate) => candidate.id !== spaceId);
  const neighbourSpace = remainingSpaces[Math.min(spaceIndex, remainingSpaces.length - 1)] as Space;
  const selectedTabIdBySpace = { ...archivedState.selectedTabIdBySpace };
  delete selectedTabIdBySpace[spaceId];

  // Folders and split views left in the deleted Space are only reachable through it, so drop them too.
  const leftoverSpace = findSpace(archivedState, spaceId) as Space;
  const items = { ...archivedState.items };
  for (const leftoverId of [...leftoverSpace.pinnedIds, ...leftoverSpace.todayIds]) {
    deleteSubtree(items, leftoverId);
  }

  const activeSpaceId = state.activeSpaceId === spaceId ? neighbourSpace.id : state.activeSpaceId;
  return { ...archivedState, items: items, spaces: remainingSpaces, selectedTabIdBySpace: selectedTabIdBySpace, activeSpaceId: activeSpaceId };
}

/**
 * Removes an item and everything under it from an items map that the caller already copied.
 */
function deleteSubtree(items: BrowserState["items"], itemId: ItemId): void {
  const item = items[itemId];
  if (item === undefined) {
    return;
  }
  delete items[itemId];
  if (item.kind === "tab") {
    return;
  }
  for (const childId of item.childIds) {
    deleteSubtree(items, childId);
  }
}

/**
 * Adds a profile (its own cookies, logins and Favorites) and returns the new state and the profile's id.
 * The name is trimmed; an empty name becomes "Profile N".
 */
export function createProfile(state: BrowserState, name: string, now: number): { state: BrowserState; profileId: string } {
  const profileId = createId("profile", now);
  const trimmedName = name.trim();
  const profileName = trimmedName === "" ? `Profile ${state.profiles.length + 1}` : trimmedName;
  const profiles = [...state.profiles, { id: profileId, name: profileName, favoriteIds: [] }];
  return { state: { ...state, profiles: profiles }, profileId: profileId };
}

/**
 * Makes a Space use another profile. Its tabs then load with that profile's cookies, and it shows that profile's
 * Favorites. Returns the same state for an unknown profile or Space.
 */
export function setSpaceProfile(state: BrowserState, spaceId: SpaceId, profileId: string): BrowserState {
  const space = findSpace(state, spaceId);
  const profileExists = state.profiles.some((profile) => profile.id === profileId);
  if (space === undefined || !profileExists || space.profileId === profileId) {
    return state;
  }
  const changedState = updateSpace(state, spaceId, { profileId: profileId });
  // The selected tab may have been a Favorite of the old profile.
  return repairSelections(changedState);
}

/**
 * Moves a Space to a new position in the switcher (0 = first).
 */
export function moveSpace(state: BrowserState, spaceId: SpaceId, newIndex: number): BrowserState {
  const space = findSpace(state, spaceId);
  const currentIndex = state.spaces.findIndex((candidate) => candidate.id === spaceId);
  const clampedIndex = Math.max(0, Math.min(newIndex, state.spaces.length - 1));
  if (space === undefined || currentIndex === clampedIndex) {
    return state;
  }
  const otherSpaces = state.spaces.filter((candidate) => candidate.id !== spaceId);
  const spaces = [...otherSpaces.slice(0, clampedIndex), space, ...otherSpaces.slice(clampedIndex)];
  return { ...state, spaces: spaces };
}

/**
 * Moves a top-level Pinned or Today item to another Space ("Move to Space"). It keeps its section: Pinned stays
 * Pinned (at the bottom), Today goes to the top of Today. Favorites and items inside folders move into the
 * target's Today or Pinned list matching their root.
 */
export function moveItemToSpace(state: BrowserState, itemId: ItemId, targetSpaceId: SpaceId): BrowserState {
  const targetSpace = findSpace(state, targetSpaceId);
  const rootLocation = findRootLocation(state, itemId);
  if (targetSpace === undefined || rootLocation === null) {
    return state;
  }
  const isAlreadyThere = (rootLocation.kind === "pinned" || rootLocation.kind === "today") && rootLocation.spaceId === targetSpaceId;
  if (isAlreadyThere) {
    return state;
  }

  const item = state.items[itemId];
  const goesToPinned = rootLocation.kind !== "today" || item?.kind === "folder";
  const targetLocation: ItemLocation = goesToPinned ? { kind: "pinned", spaceId: targetSpaceId } : { kind: "today", spaceId: targetSpaceId };
  const stateWithoutItem = removeFromLocation(state, itemId);
  const insertIndex = goesToPinned ? getIdsAt(stateWithoutItem, targetLocation).length : 0;
  const movedState = insertIntoLocation(stateWithoutItem, targetLocation, itemId, insertIndex);
  return repairSelections(movedState);
}

/**
 * Removes the listed Spaces when they hold nothing at all, keeping at least one Space. Used after an import, so the
 * two empty starter Spaces of a fresh install do not sit next to the user's imported ones.
 */
export function removeEmptySpaces(state: BrowserState, spaceIds: SpaceId[]): BrowserState {
  let changedState = state;
  for (const spaceId of spaceIds) {
    const space = findSpace(changedState, spaceId);
    const isEmpty = space !== undefined && space.pinnedIds.length === 0 && space.todayIds.length === 0;
    if (!isEmpty || changedState.spaces.length <= 1) {
      continue;
    }
    const remainingSpaces = changedState.spaces.filter((candidate) => candidate.id !== spaceId);
    const selectedTabIdBySpace = { ...changedState.selectedTabIdBySpace };
    delete selectedTabIdBySpace[spaceId];
    const firstSpace = remainingSpaces[0] as Space;
    const activeSpaceId = changedState.activeSpaceId === spaceId ? firstSpace.id : changedState.activeSpaceId;
    changedState = { ...changedState, spaces: remainingSpaces, selectedTabIdBySpace: selectedTabIdBySpace, activeSpaceId: activeSpaceId };
  }
  return changedState;
}
