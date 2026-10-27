/**
 * WHY this file exists:
 *   Several main windows show the same sidebar (Spaces, Favorites, Pinned, Today), but each has its own choices, like
 *   Arc's windows (StorableWindows.json): its active Space, its selected tab per Space, its sidebar shown or hidden
 *   (⌘S) and its width, and which Pinned sections and folders it shows collapsed or open. The focused window's
 *   choices stay where every other pure function reads them (activeSpaceId, selectedTabIdBySpace,
 *   settings.isSidebarVisible / sidebarWidth, Space.isPinnedOpen, FolderItem.isOpen), so state.ts and spaces.ts
 *   always act on "the focused window". The other windows' choices are parked in BrowserState.otherWindows and swapped
 *   in when their window gets the focus.
 *
 * Data source:
 *   The BrowserState. Window ids come from the caller (mainWindows.ts makes them).
 *
 * Data flow:
 *   a main window gets the focus → focusWindow() → applyChange → each window's sidebar gets projectStateForWindow()
 *   every change → applyChange runs repairOtherWindows(), so parked choices never point at a gone tab, Space or folder
 *
 * Same rules as state.ts: never change the state passed in, return the same object when nothing changes.
 */
import type { BrowserState, ItemId, ParkedWindow, SidebarItem, Space, SpaceId, WindowId, WindowSidebar } from "../shared/types";
import { repairSelections } from "./state";

/**
 * The ids of the folders the focused window shows open.
 */
function listOpenFolderIds(state: BrowserState): ItemId[] {
  const openFolderIds: ItemId[] = [];
  for (const item of Object.values(state.items)) {
    if (item.kind === "folder" && item.isOpen) {
      openFolderIds.push(item.id);
    }
  }
  return openFolderIds;
}

/**
 * The focused window's choices, as the record they become when another window takes the focus.
 */
function readFocusedWindow(state: BrowserState): ParkedWindow {
  const collapsedSpaces = state.spaces.filter((space) => !space.isPinnedOpen);
  return {
    id: state.focusedWindowId,
    activeSpaceId: state.activeSpaceId,
    selectedTabIdBySpace: state.selectedTabIdBySpace,
    isSidebarVisible: state.settings.isSidebarVisible,
    sidebarWidth: state.settings.sidebarWidth,
    collapsedPinnedSpaceIds: collapsedSpaces.map((space) => space.id),
    openFolderIds: listOpenFolderIds(state),
  };
}

/**
 * The Spaces with each Pinned section open or collapsed as a window shows it. Unchanged Spaces stay the same objects.
 */
function applyCollapsedPinnedSections(spaces: Space[], collapsedPinnedSpaceIds: SpaceId[]): Space[] {
  const collapsedIds = new Set(collapsedPinnedSpaceIds);
  const isAlreadyRight = spaces.every((space) => space.isPinnedOpen !== collapsedIds.has(space.id));
  if (isAlreadyRight) {
    return spaces;
  }
  return spaces.map((space) => {
    const isPinnedOpen = !collapsedIds.has(space.id);
    return space.isPinnedOpen === isPinnedOpen ? space : { ...space, isPinnedOpen: isPinnedOpen };
  });
}

/**
 * The items with each folder open or closed as a window shows it. The same map when every folder already matches.
 */
function applyOpenFolders(items: Record<ItemId, SidebarItem>, openFolderIds: ItemId[]): Record<ItemId, SidebarItem> {
  const openIds = new Set(openFolderIds);
  let changedItems: Record<ItemId, SidebarItem> | null = null;
  for (const item of Object.values(items)) {
    if (item.kind !== "folder" || item.isOpen === openIds.has(item.id)) {
      continue;
    }
    changedItems = changedItems ?? { ...items };
    changedItems[item.id] = { ...item, isOpen: openIds.has(item.id) };
  }
  return changedItems ?? items;
}

/**
 * The state with a window's choices in the fields the focused window uses.
 */
function withWindowChoices(state: BrowserState, choices: ParkedWindow): BrowserState {
  return {
    ...state,
    activeSpaceId: choices.activeSpaceId,
    selectedTabIdBySpace: choices.selectedTabIdBySpace,
    settings: { ...state.settings, isSidebarVisible: choices.isSidebarVisible, sidebarWidth: choices.sidebarWidth },
    spaces: applyCollapsedPinnedSections(state.spaces, choices.collapsedPinnedSpaceIds),
    items: applyOpenFolders(state.items, choices.openFolderIds),
  };
}

/**
 * Every open main window's id, the focused one first, then the others from the most recently focused.
 */
export function listWindowIds(state: BrowserState): WindowId[] {
  const otherIds = state.otherWindows.map((parked) => parked.id);
  return [state.focusedWindowId, ...otherIds];
}

/**
 * The state as one window shows it: that window's choices in the usual fields. Only for drawing a window's sidebar
 * and placing its pages; changes always go to the real state. The focused window (or an unknown id) gets the state
 * itself.
 * Example: focused A on "Work", parked B on "Personal" → projectStateForWindow(state, "B").activeSpaceId → "Personal"
 */
export function projectStateForWindow(state: BrowserState, windowId: WindowId): BrowserState {
  const parked = state.otherWindows.find((candidate) => candidate.id === windowId);
  if (parked === undefined) {
    return state;
  }
  return withWindowChoices(state, parked);
}

/**
 * Gives a window the focus: its parked choices move into the usual fields and the previously focused window's choices
 * are parked, at the front of the list. Nothing else changes (no lastActiveAt: looking at another window is not using
 * a tab). Same state when the window is already focused or not open.
 */
export function focusWindow(state: BrowserState, windowId: WindowId): BrowserState {
  const parked = state.otherWindows.find((candidate) => candidate.id === windowId);
  if (parked === undefined) {
    return state;
  }
  const stillParked = state.otherWindows.filter((candidate) => candidate.id !== windowId);
  return {
    ...withWindowChoices(state, parked),
    focusedWindowId: windowId,
    otherWindows: [readFocusedWindow(state), ...stillParked],
  };
}

/**
 * Opens a new main window and gives it the focus. It starts in the Space the focused window shows, with nothing
 * selected (a tab another window shows could only be a placeholder there), with the sidebar of the last window closed
 * (Arc's sidebarViewPreferences) and the same Pinned sections and folders open as the window it came from (our
 * choice). Same state when the id is already open.
 */
export function openWindow(state: BrowserState, windowId: WindowId): BrowserState {
  if (listWindowIds(state).includes(windowId)) {
    return state;
  }
  const nothingSelected: Record<SpaceId, ItemId | null> = {};
  for (const space of state.spaces) {
    nothingSelected[space.id] = null;
  }
  const sidebar: WindowSidebar = state.newWindowSidebar ?? { isSidebarVisible: true };
  const fromWindow = readFocusedWindow(state);
  const newWindow: ParkedWindow = {
    ...fromWindow,
    id: windowId,
    selectedTabIdBySpace: nothingSelected,
    isSidebarVisible: sidebar.isSidebarVisible,
    sidebarWidth: sidebar.sidebarWidth,
  };
  return {
    ...withWindowChoices(state, newWindow),
    focusedWindowId: windowId,
    otherWindows: [fromWindow, ...state.otherWindows],
  };
}

/**
 * Forgets a closed window. When the focused one closes, the most recently focused other window takes its place. The
 * last window is kept: the app quits with it, and the next start opens it again. Either way its sidebar becomes the
 * one new windows start with (Arc's sidebarViewPreferences follow the last window closed).
 */
export function closeWindow(state: BrowserState, windowId: WindowId): BrowserState {
  const parked = state.otherWindows.find((candidate) => candidate.id === windowId);
  if (parked === undefined && windowId !== state.focusedWindowId) {
    return state;
  }
  const closing = parked ?? readFocusedWindow(state);
  const closingSidebar: WindowSidebar = { isSidebarVisible: closing.isSidebarVisible, sidebarWidth: closing.sidebarWidth };
  if (parked !== undefined) {
    const remaining = state.otherWindows.filter((candidate) => candidate.id !== windowId);
    return { ...state, otherWindows: remaining, newWindowSidebar: closingSidebar };
  }
  const nextWindow = state.otherWindows[0];
  if (nextWindow !== undefined) {
    return {
      ...withWindowChoices(state, nextWindow),
      focusedWindowId: nextWindow.id,
      otherWindows: state.otherWindows.slice(1),
      newWindowSidebar: closingSidebar,
    };
  }
  const remembered = state.newWindowSidebar;
  const isSameSidebar = remembered?.isSidebarVisible === closingSidebar.isSidebarVisible && remembered?.sidebarWidth === closingSidebar.sidebarWidth;
  return isSameSidebar ? state : { ...state, newWindowSidebar: closingSidebar };
}

/**
 * Fixes one parked window after a change made in the focused window: a deleted active Space becomes the first
 * Space; selections, collapsed Pinned sections and open folders of deleted Spaces and folders go; a selected tab that
 * is gone or moved to another Space is replaced the way state.ts replaces the focused window's (repairSelections).
 * The same record when nothing needed fixing.
 */
function repairParkedWindow(state: BrowserState, parked: ParkedWindow): ParkedWindow {
  const spaceIds = new Set(state.spaces.map((space) => space.id));
  const hasActiveSpace = spaceIds.has(parked.activeSpaceId);
  const hasGoneSpaces = Object.keys(parked.selectedTabIdBySpace).some((spaceId) => !spaceIds.has(spaceId));
  const keptCollapsedIds = parked.collapsedPinnedSpaceIds.filter((spaceId) => spaceIds.has(spaceId));
  const keptOpenFolderIds = parked.openFolderIds.filter((itemId) => state.items[itemId]?.kind === "folder");
  const hasGoneLists = keptCollapsedIds.length !== parked.collapsedPinnedSpaceIds.length || keptOpenFolderIds.length !== parked.openFolderIds.length;
  const asFocused = { ...state, selectedTabIdBySpace: parked.selectedTabIdBySpace };
  const repaired = repairSelections(asFocused);
  if (hasActiveSpace && !hasGoneSpaces && !hasGoneLists && repaired === asFocused) {
    return parked;
  }

  const selectedTabIdBySpace: Record<SpaceId, ItemId | null> = {};
  for (const space of state.spaces) {
    selectedTabIdBySpace[space.id] = repaired.selectedTabIdBySpace[space.id] ?? null;
  }
  const firstSpaceId = state.spaces[0]?.id ?? state.activeSpaceId;
  return {
    ...parked,
    activeSpaceId: hasActiveSpace ? parked.activeSpaceId : firstSpaceId,
    selectedTabIdBySpace: selectedTabIdBySpace,
    collapsedPinnedSpaceIds: keptCollapsedIds,
    openFolderIds: keptOpenFolderIds,
  };
}

/**
 * Keeps every parked window's choices valid after a change (applyChange runs this after each one). Same state when
 * nothing needed fixing.
 */
export function repairOtherWindows(state: BrowserState): BrowserState {
  let anyRepaired = false;
  const repairedWindows: ParkedWindow[] = [];
  for (const parked of state.otherWindows) {
    const repaired = repairParkedWindow(state, parked);
    repairedWindows.push(repaired);
    if (repaired !== parked) {
      anyRepaired = true;
    }
  }
  if (!anyRepaired) {
    return state;
  }
  return { ...state, otherWindows: repairedWindows };
}

/**
 * The tabs selected in any Space of any open window (a live folder keeps those, so nobody loses the page they look
 * at).
 */
export function collectSelectedTabIdsOfAllWindows(state: BrowserState): Set<ItemId> {
  const selectedTabIds = new Set<ItemId>();
  const selections = [state.selectedTabIdBySpace, ...state.otherWindows.map((parked) => parked.selectedTabIdBySpace)];
  for (const selection of selections) {
    const tabIds = Object.values(selection).filter((tabId): tabId is ItemId => tabId !== null);
    for (const tabId of tabIds) {
      selectedTabIds.add(tabId);
    }
  }
  return selectedTabIds;
}
