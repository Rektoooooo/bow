/**
 * WHY this file exists:
 *   Every tab action in the sidebar (open, select, pin, add to Favorites, rename, close, archive, restore) changes
 *   the browser's data. These functions make those changes without touching Electron, so they are easy to test.
 *
 * Data source:
 *   The BrowserState passed in. Nothing is read from disk or the screen here.
 *
 * Data flow:
 *   ipc.ts receives a click → main.ts calls one function here → gets a new BrowserState back → saves and redraws
 *
 * Rules for every function in this file:
 *   - Never change the state that was passed in. Build and return a changed copy.
 *   - When nothing changes, return the same state object, so main.ts can skip saving.
 *   - `now` is always a parameter; nothing here reads the clock.
 */
import { ARCHIVE_LIMIT, DEFAULT_ARCHIVE_AFTER_MS, DEFAULT_PROFILE_ID, FAVORITES_LIMIT, FIRST_WINDOW_ID, LIVE_FOLDER_HIDDEN_LIMIT, SIDEBAR_MAX_WIDTH_PX, SIDEBAR_MIN_WIDTH_PX } from "../shared/settings";
import type { ArchiveReason, ArchivedTab, BrowserState, FolderItem, ItemId, ItemLocation, LiveFolderData, Space, SpaceId, TabItem } from "../shared/types";
import { createNoteUrl, NEW_NOTE_TITLE } from "../shared/notes";
import { createEaselUrl, NEW_EASEL_TITLE } from "../shared/easels";
import {
  collectTabIds,
  collectTabIdsInList,
  createId,
  deleteItems,
  findLocation,
  findProfileIdOfItem,
  findRootLocation,
  findSpace,
  findSpaceIdOfItem,
  findTab,
  getActiveSpace,
  getIdsAt,
  insertIntoLocation,
  isSameOrDescendant,
  removeFromLocation,
  setIdsAt,
} from "./tree";

/**
 * Builds the state for a first launch: one profile, two Spaces ("Personal" and "Work"), no tabs, default settings.
 * Example: createInitialState().spaces.length → 2
 */
export function createInitialState(): BrowserState {
  const personalSpace: Space = {
    id: "space-personal",
    name: "Personal",
    icon: "🏠",
    theme: { colors: ["#e9d8d4"], appearance: "auto", grain: 0 },
    profileId: DEFAULT_PROFILE_ID,
    pinnedIds: [],
    todayIds: [],
    isPinnedOpen: true,
  };
  const workSpace: Space = {
    id: "space-work",
    name: "Work",
    icon: "💼",
    theme: { colors: ["#d4dfe9"], appearance: "auto", grain: 0 },
    profileId: DEFAULT_PROFILE_ID,
    pinnedIds: [],
    todayIds: [],
    isPinnedOpen: true,
  };

  return {
    version: 4,
    items: {},
    profiles: [{ id: DEFAULT_PROFILE_ID, name: "Default", favoriteIds: [] }],
    spaces: [personalSpace, workSpace],
    activeSpaceId: personalSpace.id,
    selectedTabIdBySpace: {
      [personalSpace.id]: null,
      [workSpace.id]: null,
    },
    focusedWindowId: FIRST_WINDOW_ID,
    otherWindows: [],
    archive: [],
    settings: { archiveAfterMs: DEFAULT_ARCHIVE_AFTER_MS, isSidebarVisible: true },
  };
}

/**
 * Returns the id of the selected tab in the active Space, or null when nothing is selected.
 */
export function getSelectedTabId(state: BrowserState): ItemId | null {
  // "?? null" turns a missing entry (undefined) into null, so both mean "nothing selected".
  return state.selectedTabIdBySpace[state.activeSpaceId] ?? null;
}

/**
 * Returns a copy of the state where one tab has some fields changed. Returns the same state when the id is not a tab.
 * Example: updateTab(state, "tab-1", { title: "Inbox" }) → tab-1 now titled "Inbox"
 */
export function updateTab(state: BrowserState, tabId: ItemId, changes: Partial<TabItem>): BrowserState {
  const tab = findTab(state, tabId);
  if (tab === undefined) {
    return state;
  }
  const updatedTab: TabItem = { ...tab, ...changes };
  return { ...state, items: { ...state.items, [tabId]: updatedTab } };
}

/**
 * Builds a new tab object. It is not in any list yet.
 */
function createTab(url: string, now: number): TabItem {
  return {
    kind: "tab",
    id: createId("tab", now),
    url: url,
    title: url,
    customTitle: null,
    faviconUrl: null,
    homeUrl: null,
    lastActiveAt: now,
    isMuted: false,
  };
}

/** Options for openTab. */
export interface OpenTabOptions {
  /** False opens the tab in the background (⌘-click on a link). Default true. */
  select?: boolean;
  /** Use this id instead of a new one: a Peek that becomes a tab hands over its page under an id made in advance. */
  id?: ItemId;
}

/**
 * Adds a new tab at the top of the active Space's Today list, like Arc, and selects it unless told not to.
 * Example: openTab(state, "https://example.com", now) → state with that tab first in Today and selected
 */
export function openTab(state: BrowserState, url: string, now: number, options: OpenTabOptions = {}): BrowserState {
  const freshTab = createTab(url, now);
  const newTab: TabItem = options.id === undefined ? freshTab : { ...freshTab, id: options.id };
  const stateWithItem: BrowserState = { ...state, items: { ...state.items, [newTab.id]: newTab } };
  const todayLocation: ItemLocation = { kind: "today", spaceId: state.activeSpaceId };
  const stateWithTab = insertIntoLocation(stateWithItem, todayLocation, newTab.id, 0);

  if (options.select === false) {
    return stateWithTab;
  }
  return selectTab(stateWithTab, newTab.id, now);
}

/**
 * Opens a new, empty note at the top of Today and selects it (shared/notes.ts: a note is a tab with a note address).
 */
export function createNote(state: BrowserState, noteId: string, now: number): BrowserState {
  const tabId = createId("tab", now);
  const withTab = openTab(state, createNoteUrl(noteId), now, { id: tabId });
  return updateTab(withTab, tabId, { title: NEW_NOTE_TITLE });
}

/**
 * Opens a new, empty easel at the top of Today and selects it (shared/easels.ts: an easel is a tab with an easel
 * address).
 */
export function createEasel(state: BrowserState, easelId: string, now: number): BrowserState {
  const tabId = createId("tab", now);
  const withTab = openTab(state, createEaselUrl(easelId), now, { id: tabId });
  return updateTab(withTab, tabId, { title: NEW_EASEL_TITLE });
}

/**
 * Names every tab of a note after its first line (a note can be open once; this also covers a restored copy).
 */
export function setNoteTitle(state: BrowserState, noteUrl: string, title: string): BrowserState {
  const shownTitle = title.trim() === "" ? NEW_NOTE_TITLE : title.trim();
  let changedState = state;
  for (const item of Object.values(state.items)) {
    if (item.kind === "tab" && item.url === noteUrl && item.title !== shownTitle) {
      changedState = updateTab(changedState, item.id, { title: shownTitle });
    }
  }
  return changedState;
}

/**
 * Finds which Space should show a tab. A tab in a Space's lists belongs to that Space. A Favorite belongs to a
 * profile, so it shows in the active Space when that Space uses the same profile, otherwise in the first Space that does.
 */
function findSpaceToShowTab(state: BrowserState, tabId: ItemId): SpaceId | null {
  const ownSpaceId = findSpaceIdOfItem(state, tabId);
  if (ownSpaceId !== null) {
    return ownSpaceId;
  }

  const profileId = findProfileIdOfItem(state, tabId);
  if (profileId === null) {
    return null;
  }
  const activeSpace = getActiveSpace(state);
  if (activeSpace.profileId === profileId) {
    return activeSpace.id;
  }
  const spaceWithProfile = state.spaces.find((space) => space.profileId === profileId);
  return spaceWithProfile === undefined ? null : spaceWithProfile.id;
}

/**
 * Selects a tab and makes its Space active. Both the tab you leave and the tab you open get lastActiveAt = now,
 * because leaving a tab is the last moment it was in use.
 */
export function selectTab(state: BrowserState, tabId: ItemId, now: number): BrowserState {
  const tab = findTab(state, tabId);
  if (tab === undefined) {
    return state;
  }
  const spaceId = findSpaceToShowTab(state, tabId);
  if (spaceId === null) {
    return state;
  }

  let changedState = state;
  const previousTabId = getSelectedTabId(state);
  if (previousTabId !== null) {
    changedState = updateTab(changedState, previousTabId, { lastActiveAt: now });
  }
  // Opening a tab reads its news.
  changedState = updateTab(changedState, tabId, { lastActiveAt: now, isUnread: false });

  return {
    ...changedState,
    activeSpaceId: spaceId,
    selectedTabIdBySpace: { ...changedState.selectedTabIdBySpace, [spaceId]: tabId },
  };
}

/**
 * Records a tab's new URL and title after the page navigates. An empty title falls back to the URL.
 */
export function updateTabPage(state: BrowserState, tabId: ItemId, url: string, title: string, isOnScreen: boolean = true): BrowserState {
  const tab = findTab(state, tabId);
  if (tab === undefined) {
    return state;
  }

  let displayTitle = title;
  if (displayTitle.trim() === "") {
    displayTitle = url;
  }
  if (tab.url === url && tab.title === displayTitle) {
    return state;
  }
  // A Pinned tab or Favorite whose title changes off screen, on the same page, has news (Arc's unread dot).
  const root = findRootLocation(state, tabId);
  const isPinnedOrFavorite = root !== null && root.kind !== "today";
  const becameUnread = !isOnScreen && isPinnedOrFavorite && tab.url === url;
  return updateTab(state, tabId, { url: url, title: displayTitle, isUnread: becameUnread || tab.isUnread === true });
}

/**
 * Records the icon a page reported. Returns the same state when nothing changed.
 */
export function updateTabFavicon(state: BrowserState, tabId: ItemId, faviconUrl: string): BrowserState {
  const tab = findTab(state, tabId);
  if (tab === undefined || tab.faviconUrl === faviconUrl) {
    return state;
  }
  return updateTab(state, tabId, { faviconUrl: faviconUrl });
}

/**
 * Pins a tab: it moves to the bottom of its Space's Pinned list and remembers its current URL as its home.
 * A Favorite goes to the active Space's Pinned list. A pinned tab is left alone.
 * Example: pin a tab on "https://mail.example.com/inbox" → homeUrl is "https://mail.example.com/inbox"
 */
export function pinTab(state: BrowserState, tabId: ItemId): BrowserState {
  const tab = findTab(state, tabId);
  const rootLocation = findRootLocation(state, tabId);
  if (tab === undefined || rootLocation === null || rootLocation.kind === "pinned") {
    return state;
  }

  const spaceId = rootLocation.kind === "today" ? rootLocation.spaceId : state.activeSpaceId;
  const space = findSpace(state, spaceId);
  if (space === undefined) {
    return state;
  }

  const stateWithoutTab = removeFromLocation(state, tabId);
  const pinnedLocation: ItemLocation = { kind: "pinned", spaceId: spaceId };
  const pinnedIds = getIdsAt(stateWithoutTab, pinnedLocation);
  const stateWithTab = insertIntoLocation(stateWithoutTab, pinnedLocation, tabId, pinnedIds.length);
  const homeUrl = tab.homeUrl ?? tab.url;
  return updateTab(stateWithTab, tabId, { homeUrl: homeUrl });
}

/**
 * Unpins a tab (from Pinned, a folder or Favorites): it moves to the top of Today and forgets its home URL.
 * Its lastActiveAt is set to now, so it does not archive the moment it is unpinned.
 */
export function unpinTab(state: BrowserState, tabId: ItemId, now: number): BrowserState {
  const tab = findTab(state, tabId);
  const rootLocation = findRootLocation(state, tabId);
  if (tab === undefined || rootLocation === null || rootLocation.kind === "today") {
    return state;
  }

  const spaceId = rootLocation.kind === "pinned" ? rootLocation.spaceId : state.activeSpaceId;
  const stateWithoutTab = removeFromLocation(state, tabId);
  const todayLocation: ItemLocation = { kind: "today", spaceId: spaceId };
  const stateWithTab = insertIntoLocation(stateWithoutTab, todayLocation, tabId, 0);
  return updateTab(stateWithTab, tabId, { homeUrl: null, lastActiveAt: now });
}

/**
 * Makes a tab a Favorite of its profile (the tiles at the top). Returns the same state when that profile already
 * has FAVORITES_LIMIT Favorites, or the tab is one already.
 */
export function addToFavorites(state: BrowserState, tabId: ItemId): BrowserState {
  const tab = findTab(state, tabId);
  const location = findLocation(state, tabId);
  const profileId = findProfileIdOfItem(state, tabId);
  if (tab === undefined || location === null || location.kind === "favorites" || profileId === null) {
    return state;
  }

  const favoritesLocation: ItemLocation = { kind: "favorites", profileId: profileId };
  const favoriteIds = getIdsAt(state, favoritesLocation);
  if (favoriteIds.length >= FAVORITES_LIMIT) {
    return state;
  }

  const stateWithoutTab = removeFromLocation(state, tabId);
  const stateWithTab = insertIntoLocation(stateWithoutTab, favoritesLocation, tabId, favoriteIds.length);
  const homeUrl = tab.homeUrl ?? tab.url;
  return updateTab(stateWithTab, tabId, { homeUrl: homeUrl });
}

/**
 * True when an item may be placed at a location. The rules:
 *   - Favorites and split views hold only tabs.
 *   - Today holds tabs and split views (folders live in Pinned).
 *   - A folder cannot go inside itself.
 *   - Nothing goes into a live folder: its source decides what it holds, and in which order.
 */
function canPlace(state: BrowserState, itemId: ItemId, target: ItemLocation): boolean {
  const item = state.items[itemId];
  if (item === undefined) {
    return false;
  }
  if (target.kind === "favorites" || target.kind === "split") {
    return item.kind === "tab";
  }
  if (target.kind === "today") {
    return item.kind !== "folder";
  }
  if (target.kind === "folder") {
    const targetFolder = state.items[target.folderId];
    const isLiveFolder = targetFolder !== undefined && targetFolder.kind === "folder" && targetFolder.live !== undefined;
    return !isLiveFolder && !isSameOrDescendant(state, itemId, target.folderId);
  }
  return true;
}

/**
 * True when two locations name the same list.
 */
function isSameLocation(first: ItemLocation, second: ItemLocation): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

/**
 * Moves an item to a position in another (or the same) list: the drag-and-drop action.
 * `index` counts positions in the target list as it is now, before the item leaves its old place
 * (what the user sees while dragging). A negative index means "at the end".
 * Tabs that enter Pinned or Favorites get a home URL; tabs that enter Today lose it and count as used now.
 * Returns the same state when the move breaks a rule (see canPlace) or the target is full.
 */
export function moveItem(state: BrowserState, itemId: ItemId, target: ItemLocation, index: number, now: number): BrowserState {
  if (!canPlace(state, itemId, target)) {
    return state;
  }
  const currentLocation = findLocation(state, itemId);
  const isAlreadyFavorite = currentLocation !== null && currentLocation.kind === "favorites";
  const favoritesAreFull = target.kind === "favorites" && getIdsAt(state, target).length >= FAVORITES_LIMIT;
  if (favoritesAreFull && !isAlreadyFavorite) {
    return state;
  }

  const targetLength = getIdsAt(state, target).length;
  let insertIndex = index < 0 ? targetLength : index;
  if (currentLocation !== null && isSameLocation(currentLocation, target)) {
    const currentIndex = getIdsAt(state, currentLocation).indexOf(itemId);
    // Taking the item out first shifts every later position up by one.
    if (currentIndex < insertIndex) {
      insertIndex = insertIndex - 1;
    }
    if (currentIndex === insertIndex) {
      return state;
    }
  }

  const stateWithoutItem = removeFromLocation(state, itemId);
  let changedState = insertIntoLocation(stateWithoutItem, target, itemId, insertIndex);

  const targetRoot = target.kind === "folder" || target.kind === "split" ? findRootLocation(changedState, itemId) : target;
  const tabIds = collectTabIds(changedState, itemId);
  for (const tabId of tabIds) {
    changedState = updateHomeUrlForRoot(changedState, tabId, targetRoot, now);
  }
  // Dragging a tab out of a split view can leave it with one pane.
  changedState = dissolveSmallSplits(changedState);
  return repairSelections(changedState);
}

/**
 * Gives a tab the home-URL rule of the list its branch sits in: Pinned and Favorites remember a home, Today does not.
 */
export function applyHomeUrlRule(state: BrowserState, tabId: ItemId, now: number): BrowserState {
  const root = findRootLocation(state, tabId);
  return updateHomeUrlForRoot(state, tabId, root, now);
}

/**
 * Gives a tab the home-URL rule of a given root list. Today tabs also count as used now, since they just arrived.
 */
function updateHomeUrlForRoot(state: BrowserState, tabId: ItemId, root: ItemLocation | null, now: number): BrowserState {
  const tab = findTab(state, tabId);
  if (tab === undefined || root === null) {
    return state;
  }
  if (root.kind === "today") {
    return updateTab(state, tabId, { homeUrl: null, lastActiveAt: now });
  }
  if (tab.homeUrl === null) {
    return updateTab(state, tabId, { homeUrl: tab.url });
  }
  return state;
}

/**
 * Adds an empty, open folder at the bottom of the active Space's Pinned list. With `live`, it is a live folder that
 * liveFolders.ts fills from its source.
 */
export function createFolder(state: BrowserState, title: string, now: number, live?: LiveFolderData): BrowserState {
  const folder: FolderItem = { kind: "folder", id: createId("folder", now), title: title, childIds: [], isOpen: true };
  if (live !== undefined) {
    folder.live = live;
  }
  const stateWithItem: BrowserState = { ...state, items: { ...state.items, [folder.id]: folder } };
  const pinnedLocation: ItemLocation = { kind: "pinned", spaceId: state.activeSpaceId };
  const pinnedIds = getIdsAt(stateWithItem, pinnedLocation);
  const stateWithFolder = insertIntoLocation(stateWithItem, pinnedLocation, folder.id, pinnedIds.length);
  const space = getActiveSpace(stateWithFolder);
  if (space.isPinnedOpen) {
    return stateWithFolder;
  }
  return setPinnedSectionOpen(stateWithFolder, space.id, true);
}

/**
 * Renames a tab or folder. An empty name on a tab removes the rename, so the page title shows again.
 */
export function renameItem(state: BrowserState, itemId: ItemId, newName: string): BrowserState {
  const item = state.items[itemId];
  if (item === undefined || item.kind === "split") {
    return state;
  }
  const trimmedName = newName.trim();

  if (item.kind === "tab") {
    const customTitle = trimmedName === "" ? null : trimmedName;
    if (item.customTitle === customTitle) {
      return state;
    }
    return updateTab(state, itemId, { customTitle: customTitle });
  }

  if (trimmedName === "" || item.title === trimmedName) {
    return state;
  }
  const renamedFolder: FolderItem = { ...item, title: trimmedName };
  return { ...state, items: { ...state.items, [itemId]: renamedFolder } };
}

/**
 * Opens a closed folder or closes an open one.
 */
export function toggleFolder(state: BrowserState, folderId: ItemId): BrowserState {
  const folder = state.items[folderId];
  if (folder === undefined || folder.kind !== "folder") {
    return state;
  }
  const toggledFolder: FolderItem = { ...folder, isOpen: !folder.isOpen };
  return { ...state, items: { ...state.items, [folderId]: toggledFolder } };
}

/**
 * Expands or collapses a Space's Pinned section.
 */
export function setPinnedSectionOpen(state: BrowserState, spaceId: SpaceId, isOpen: boolean): BrowserState {
  const space = findSpace(state, spaceId);
  if (space === undefined || space.isPinnedOpen === isOpen) {
    return state;
  }
  const spaces = state.spaces.map((candidate) => (candidate.id === spaceId ? { ...candidate, isPinnedOpen: isOpen } : candidate));
  return { ...state, spaces: spaces };
}

/**
 * Mutes or unmutes a tab.
 */
export function setTabMuted(state: BrowserState, tabId: ItemId, isMuted: boolean): BrowserState {
  const tab = findTab(state, tabId);
  if (tab === undefined || tab.isMuted === isMuted) {
    return state;
  }
  return updateTab(state, tabId, { isMuted: isMuted });
}

/**
 * Returns every tab id a Space can show: its Pinned and Today tabs plus its profile's Favorites.
 */
function collectSpaceTabIds(state: BrowserState, space: Space): ItemId[] {
  const profile = state.profiles.find((candidate) => candidate.id === space.profileId);
  const favoriteIds = profile === undefined ? [] : profile.favoriteIds;
  const pinnedTabIds = collectTabIdsInList(state, space.pinnedIds);
  const todayTabIds = collectTabIdsInList(state, space.todayIds);
  return [...favoriteIds, ...pinnedTabIds, ...todayTabIds];
}

/**
 * Returns the id of the most recently used tab a Space can show, or null when it has none.
 * Used to pick a new selection after the selected tab leaves.
 */
function findMostRecentlyUsedTabId(state: BrowserState, space: Space, excludedTabIds: Set<ItemId>): ItemId | null {
  let mostRecentTab: TabItem | null = null;
  for (const tabId of collectSpaceTabIds(state, space)) {
    const tab = findTab(state, tabId);
    if (tab === undefined || excludedTabIds.has(tabId)) {
      continue;
    }
    if (mostRecentTab === null || tab.lastActiveAt > mostRecentTab.lastActiveAt) {
      mostRecentTab = tab;
    }
  }
  return mostRecentTab === null ? null : mostRecentTab.id;
}

/**
 * For every Space whose selected tab is gone, moved to another Space, or in the excluded set, selects the Space's
 * most recently used remaining tab. A Space with nothing selected stays that way.
 */
export function repairSelections(state: BrowserState, excludedTabIds: Set<ItemId> = new Set()): BrowserState {
  let selectionChanged = false;
  const selectedTabIdBySpace: Record<SpaceId, ItemId | null> = {};
  for (const space of state.spaces) {
    const selectedTabId = state.selectedTabIdBySpace[space.id] ?? null;
    const spaceTabIds = new Set(collectSpaceTabIds(state, space));
    const isStillShown = selectedTabId !== null && spaceTabIds.has(selectedTabId) && !excludedTabIds.has(selectedTabId);
    if (selectedTabId === null || isStillShown) {
      selectedTabIdBySpace[space.id] = selectedTabId;
      continue;
    }
    selectedTabIdBySpace[space.id] = findMostRecentlyUsedTabId(state, space, excludedTabIds);
    selectionChanged = true;
  }
  if (!selectionChanged) {
    return state;
  }
  return { ...state, selectedTabIdBySpace: selectedTabIdBySpace };
}

/**
 * Replaces split views that have fewer than two tabs left: one tab takes the split's place, an empty split is removed.
 * Archiving a tab out of a split calls this, so a split never shows a single pane.
 */
export function dissolveSmallSplits(state: BrowserState): BrowserState {
  let changedState = state;
  for (const item of Object.values(state.items)) {
    if (item.kind !== "split" || item.childIds.length >= 2) {
      continue;
    }
    changedState = replaceSplitWithChildren(changedState, item.id);
  }
  return changedState;
}

/**
 * Puts a split view's tabs where the split was, in pane order, and deletes the split.
 */
export function replaceSplitWithChildren(state: BrowserState, splitId: ItemId): BrowserState {
  const split = state.items[splitId];
  const location = findLocation(state, splitId);
  if (split === undefined || split.kind !== "split") {
    return state;
  }
  if (location === null) {
    return deleteItems(state, [splitId]);
  }

  const siblingIds = getIdsAt(state, location);
  const splitIndex = siblingIds.indexOf(splitId);
  const newSiblingIds = [...siblingIds.slice(0, splitIndex), ...split.childIds, ...siblingIds.slice(splitIndex + 1)];
  const stateWithoutSplit = deleteItems(state, [splitId]);
  return setIdsAt(stateWithoutSplit, location, newSiblingIds);
}

/**
 * Removes tabs from the sidebar and adds them to the top of the archive with a reason.
 * Split views left with one tab dissolve, and every Space whose selected tab left selects its most recently used tab.
 * Used by closing, clearing, deleting and the auto-archive sweeper, so the rules live in one place.
 */
export function moveTabsToArchive(state: BrowserState, tabIds: ItemId[], now: number, reason: ArchiveReason): BrowserState {
  const existingTabIds = tabIds.filter((tabId) => findTab(state, tabId) !== undefined);
  if (existingTabIds.length === 0) {
    return state;
  }

  const newArchiveEntries: ArchivedTab[] = [];
  for (const tabId of existingTabIds) {
    const tab = findTab(state, tabId) as TabItem;
    const fromSpaceId = findSpaceIdOfItem(state, tabId);
    newArchiveEntries.push({ tab: tab, fromSpaceId: fromSpaceId, archivedAt: now, reason: reason });
  }

  let changedState = state;
  for (const tabId of existingTabIds) {
    changedState = removeFromLocation(changedState, tabId);
  }
  changedState = deleteItems(changedState, existingTabIds);
  changedState = dissolveSmallSplits(changedState);
  // Newest first, and only the newest ARCHIVE_LIMIT are kept, like Arc.
  const archive = [...newArchiveEntries, ...changedState.archive].slice(0, ARCHIVE_LIMIT);
  changedState = { ...changedState, archive: archive };
  return repairSelections(changedState);
}

/**
 * Closing a Today tab archives it with reason "manual", so it can be found again like in Arc.
 * Pinned tabs and Favorites are not removed by closing; see resetPinnedTab.
 */
export function closeTab(state: BrowserState, tabId: ItemId, now: number): BrowserState {
  return moveTabsToArchive(state, [tabId], now, "manual");
}

/**
 * What ⌘W does to a Pinned tab or Favorite in Arc: the page is put away and the tab goes back to its home URL,
 * but it keeps its place. The selection moves to the most recently used other tab.
 * main.ts also destroys the tab's web view.
 */
export function resetPinnedTab(state: BrowserState, tabId: ItemId): BrowserState {
  const tab = findTab(state, tabId);
  if (tab === undefined || tab.homeUrl === null) {
    return state;
  }
  const resetState = updateTab(state, tabId, { url: tab.homeUrl });
  return repairSelections(resetState, new Set([tabId]));
}

/**
 * A tab removed from a live folder stays removed: its address joins the folder's hidden list, so the next refresh
 * does not bring it back. Tabs anywhere else are left alone.
 */
function hideFromLiveFolder(state: BrowserState, tab: TabItem): BrowserState {
  const location = findLocation(state, tab.id);
  if (location === null || location.kind !== "folder") {
    return state;
  }
  const folder = state.items[location.folderId];
  if (folder === undefined || folder.kind !== "folder" || folder.live === undefined) {
    return state;
  }
  const address = tab.homeUrl ?? tab.url;
  const otherHiddenUrls = folder.live.hiddenUrls.filter((hiddenUrl) => hiddenUrl !== address);
  const hiddenUrls = [address, ...otherHiddenUrls].slice(0, LIVE_FOLDER_HIDDEN_LIMIT);
  const changedFolder: FolderItem = { ...folder, live: { ...folder.live, hiddenUrls: hiddenUrls } };
  return { ...state, items: { ...state.items, [folder.id]: changedFolder } };
}

/**
 * Removes an item for good: its tabs go to the archive ("manual") and any folders or split views inside are deleted.
 * A live folder's tabs are deleted without archiving; a tab removed from a live folder is hidden from its source.
 */
export function deleteItem(state: BrowserState, itemId: ItemId, now: number): BrowserState {
  const item = state.items[itemId];
  if (item === undefined) {
    return state;
  }
  if (item.kind === "tab") {
    const stateWithHiddenUrl = hideFromLiveFolder(state, item);
    return moveTabsToArchive(stateWithHiddenUrl, [itemId], now, "manual");
  }

  const tabIds = collectTabIds(state, itemId);
  const containerIds = collectContainerIds(state, itemId);
  if (item.kind === "folder" && item.live !== undefined) {
    // A live folder's tabs came from its source, not from the user: they leave without filling the Archive.
    const stateWithoutFolder = deleteItems(removeFromLocation(state, itemId), [...containerIds, ...tabIds]);
    return repairSelections(stateWithoutFolder);
  }
  const archivedState = moveTabsToArchive(state, tabIds, now, "manual");
  const stateWithoutItem = removeFromLocation(archivedState, itemId);
  return deleteItems(stateWithoutItem, containerIds);
}

/**
 * Returns the ids of the folders and split views at or below an item.
 */
function collectContainerIds(state: BrowserState, itemId: ItemId): ItemId[] {
  const item = state.items[itemId];
  if (item === undefined || item.kind === "tab") {
    return [];
  }
  const containerIds: ItemId[] = [itemId];
  for (const childId of item.childIds) {
    containerIds.push(...collectContainerIds(state, childId));
  }
  return containerIds;
}

/**
 * Archives every Today tab in the active Space with reason "clear-button" (Arc's "Clear", ⇧⌘K).
 */
export function clearTodayTabs(state: BrowserState, now: number): BrowserState {
  const activeSpace = getActiveSpace(state);
  const todayTabIds = collectTabIdsInList(state, activeSpace.todayIds);
  return moveTabsToArchive(state, todayTabIds, now, "clear-button");
}

/**
 * Takes a tab out of the archive and puts it back at the top of Today in the Space it left, then selects it.
 * It comes back as a Today tab (no home URL) with lastActiveAt = now. If its Space is gone, it goes to the active Space.
 */
export function restoreArchivedTab(state: BrowserState, tabId: ItemId, now: number): BrowserState {
  const archivedEntry = state.archive.find((entry) => entry.tab.id === tabId);
  if (archivedEntry === undefined) {
    return state;
  }

  let spaceId = state.activeSpaceId;
  if (archivedEntry.fromSpaceId !== null && findSpace(state, archivedEntry.fromSpaceId) !== undefined) {
    spaceId = archivedEntry.fromSpaceId;
  }

  // A tab with the same id may exist if it was restored before and archived again; give it a fresh id then.
  const restoredId = state.items[tabId] === undefined ? tabId : createId("tab", now);
  const restoredTab: TabItem = { ...archivedEntry.tab, id: restoredId, homeUrl: null, lastActiveAt: now };
  const remainingArchive = state.archive.filter((entry) => entry !== archivedEntry);
  const stateWithItem: BrowserState = { ...state, items: { ...state.items, [restoredId]: restoredTab }, archive: remainingArchive };
  const stateWithTab = insertIntoLocation(stateWithItem, { kind: "today", spaceId: spaceId }, restoredId, 0);
  return selectTab(stateWithTab, restoredId, now);
}

/**
 * Restores the most recently archived tab (⇧⌘T, "Restore Last Closed Tab"). Returns the same state when the archive is empty.
 */
export function restoreLastArchivedTab(state: BrowserState, now: number): BrowserState {
  const newestEntry = state.archive[0];
  if (newestEntry === undefined) {
    return state;
  }
  return restoreArchivedTab(state, newestEntry.tab.id, now);
}

/**
 * Opens a copy of a tab right below it (Pinned and Favorites copies go to the top of Today) and selects it.
 */
export function duplicateTab(state: BrowserState, tabId: ItemId, now: number): BrowserState {
  const tab = findTab(state, tabId);
  if (tab === undefined) {
    return state;
  }

  const copy: TabItem = { ...createTab(tab.url, now), title: tab.title, faviconUrl: tab.faviconUrl };
  const stateWithItem: BrowserState = { ...state, items: { ...state.items, [copy.id]: copy } };
  const location = findLocation(state, tabId);
  let stateWithCopy: BrowserState;
  if (location !== null && location.kind === "today") {
    const index = getIdsAt(state, location).indexOf(tabId) + 1;
    stateWithCopy = insertIntoLocation(stateWithItem, location, copy.id, index);
  } else {
    stateWithCopy = insertIntoLocation(stateWithItem, { kind: "today", spaceId: state.activeSpaceId }, copy.id, 0);
  }
  return selectTab(stateWithCopy, copy.id, now);
}

/**
 * Changes the "Archive tabs after" setting. Null turns auto-archive off.
 */
export function setArchiveAfter(state: BrowserState, archiveAfterMs: number | null): BrowserState {
  if (state.settings.archiveAfterMs === archiveAfterMs) {
    return state;
  }
  return { ...state, settings: { ...state.settings, archiveAfterMs: archiveAfterMs } };
}

/**
 * Turns the sound effects on or off.
 */
export function setSoundEffects(state: BrowserState, isOn: boolean): BrowserState {
  if ((state.settings.areSoundEffectsOn ?? true) === isOn) {
    return state;
  }
  return { ...state, settings: { ...state.settings, areSoundEffectsOn: isOn } };
}

/**
 * Remembers that the first-start tour was finished or skipped.
 */
export function finishWelcome(state: BrowserState): BrowserState {
  if (state.settings.hasSeenWelcome === true) {
    return state;
  }
  return { ...state, settings: { ...state.settings, hasSeenWelcome: true } };
}

/**
 * Shows the whole address in the toolbar, or host and path (Arc's default).
 */
export function setShowFullUrls(state: BrowserState, isOn: boolean): BrowserState {
  if ((state.settings.showsFullUrls ?? false) === isOn) {
    return state;
  }
  return { ...state, settings: { ...state.settings, showsFullUrls: isOn } };
}

/**
 * Turns tidy titles for pinned tabs on or off.
 */
export function setTidyTitles(state: BrowserState, isOn: boolean): BrowserState {
  if ((state.settings.areTitlesTidy ?? true) === isOn) {
    return state;
  }
  return { ...state, settings: { ...state.settings, areTitlesTidy: isOn } };
}

/**
 * Picks the app icon variant shown in the Dock.
 */
export function setAppIcon(state: BrowserState, variantId: string): BrowserState {
  if ((state.settings.appIcon ?? "classic") === variantId) {
    return state;
  }
  return { ...state, settings: { ...state.settings, appIcon: variantId } };
}

/**
 * Turns ad and tracker blocking on or off.
 */
export function setAdBlock(state: BrowserState, isOn: boolean): BrowserState {
  if ((state.settings.isAdBlockOn ?? false) === isOn) {
    return state;
  }
  return { ...state, settings: { ...state.settings, isAdBlockOn: isOn } };
}

/**
 * Turns ad blocking off (or back on) for one site.
 */
export function setAdBlockForSite(state: BrowserState, site: string, isOn: boolean): BrowserState {
  const offSites = state.adBlockOffSites ?? [];
  const isOffNow = offSites.includes(site);
  if (isOffNow !== isOn) {
    return state;
  }
  const changedOffSites = isOn ? offSites.filter((offSite) => offSite !== site) : [...offSites, site];
  return { ...state, adBlockOffSites: changedOffSites };
}

/**
 * Sets the sidebar's width, kept between SIDEBAR_MIN_WIDTH_PX and SIDEBAR_MAX_WIDTH_PX.
 */
export function setSidebarWidth(state: BrowserState, width: number): BrowserState {
  const clampedWidth = Math.round(Math.max(SIDEBAR_MIN_WIDTH_PX, Math.min(width, SIDEBAR_MAX_WIDTH_PX)));
  if (state.settings.sidebarWidth === clampedWidth) {
    return state;
  }
  return { ...state, settings: { ...state.settings, sidebarWidth: clampedWidth } };
}

/**
 * Shows or hides the sidebar (⌘S).
 */
export function setSidebarVisible(state: BrowserState, isVisible: boolean): BrowserState {
  if (state.settings.isSidebarVisible === isVisible) {
    return state;
  }
  return { ...state, settings: { ...state.settings, isSidebarVisible: isVisible } };
}

/**
 * Returns the tabs in the order the sidebar shows them for the active Space: Favorites, then Pinned (open folders
 * only), then Today. ⌘1–9 and ⌥⌘↑/↓ walk this list.
 */
export function listVisibleTabIds(state: BrowserState): ItemId[] {
  const space = getActiveSpace(state);
  const profile = state.profiles.find((candidate) => candidate.id === space.profileId);
  const favoriteIds = profile === undefined ? [] : profile.favoriteIds;
  const pinnedTabIds = space.isPinnedOpen ? collectOpenTabIds(state, space.pinnedIds) : [];
  const todayTabIds = collectTabIdsInList(state, space.todayIds);
  return [...favoriteIds, ...pinnedTabIds, ...todayTabIds];
}

/**
 * Like collectTabIdsInList, but skips the inside of closed folders, because those tabs are hidden.
 */
function collectOpenTabIds(state: BrowserState, itemIds: ItemId[]): ItemId[] {
  const tabIds: ItemId[] = [];
  for (const itemId of itemIds) {
    const item = state.items[itemId];
    if (item === undefined) {
      continue;
    }
    if (item.kind === "folder" && !item.isOpen) {
      continue;
    }
    const childTabIds = item.kind === "folder" ? collectOpenTabIds(state, item.childIds) : collectTabIds(state, itemId);
    tabIds.push(...childTabIds);
  }
  return tabIds;
}

/**
 * Returns the tab `offset` places away from the selected one in sidebar order (⌥⌘↓ is +1, ⌥⌘↑ is -1), wrapping
 * around at the ends. Returns null when the Space shows no tabs.
 */
export function findNeighbourTabId(state: BrowserState, offset: number): ItemId | null {
  const visibleTabIds = listVisibleTabIds(state);
  if (visibleTabIds.length === 0) {
    return null;
  }
  const selectedTabId = getSelectedTabId(state);
  const currentIndex = selectedTabId === null ? -1 : visibleTabIds.indexOf(selectedTabId);
  const count = visibleTabIds.length;
  // Adding count before the remainder keeps the result positive when moving backwards from the top.
  const targetIndex = (((currentIndex + offset) % count) + count) % count;
  return visibleTabIds[targetIndex] ?? null;
}

/** ⌘9 always means the last tab, as in other browsers. */
const LAST_TAB_NUMBER = 9;

/**
 * Returns the tab at a 1-based position in sidebar order (⌘1 … ⌘8), or the last tab for ⌘9. Null when there is none.
 */
export function findTabIdByNumber(state: BrowserState, tabNumber: number): ItemId | null {
  const visibleTabIds = listVisibleTabIds(state);
  if (tabNumber === LAST_TAB_NUMBER) {
    return visibleTabIds[visibleTabIds.length - 1] ?? null;
  }
  return visibleTabIds[tabNumber - 1] ?? null;
}

/** What addPageToArchive needs to know about a page that never was in the sidebar. */
export interface LoosePage {
  url: string;
  title: string;
  faviconUrl: string | null;
}

/**
 * Puts a page that never lived in the sidebar (a closed Little Window) at the top of the archive, so it can be
 * found and restored like any closed tab. Pages that are not web pages are not kept.
 */
export function addPageToArchive(state: BrowserState, page: LoosePage, now: number, reason: ArchiveReason): BrowserState {
  const isWebPage = page.url.startsWith("https://") || page.url.startsWith("http://");
  if (!isWebPage) {
    return state;
  }
  const tab: TabItem = { ...createTab(page.url, now), title: page.title.trim() === "" ? page.url : page.title, faviconUrl: page.faviconUrl };
  const entry: ArchivedTab = { tab: tab, fromSpaceId: null, archivedAt: now, reason: reason };
  return { ...state, archive: [entry, ...state.archive].slice(0, ARCHIVE_LIMIT) };
}
