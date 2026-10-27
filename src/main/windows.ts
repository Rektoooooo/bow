/**
 * WHY this file exists:
 *   Several main windows show the same sidebar (Spaces, Favorites, Pinned, Today), but each has its own active Space
 *   and its own selected tab per Space, like Arc's windows. The focused window's choices stay where every other pure
 *   function reads them (BrowserState.activeSpaceId and selectedTabIdBySpace), so state.ts and spaces.ts always act
 *   on "the focused window". The other windows' choices are parked in BrowserState.otherWindows and swapped in when
 *   their window gets the focus.
 *
 * Data source:
 *   The BrowserState. Window ids come from the caller (mainWindows.ts makes them).
 *
 * Data flow:
 *   a main window gets the focus → focusWindow() → applyChange → each window's sidebar gets projectStateForWindow()
 *   every change → applyChange runs repairOtherWindows(), so parked choices never point at a gone tab or Space
 *
 * Same rules as state.ts: never change the state passed in, return the same object when nothing changes.
 */
import type { BrowserState, ItemId, SpaceId, WindowId, WindowSelection } from "../shared/types";
import { repairSelections } from "./state";

/**
 * The focused window's choices, as the record they become when another window takes the focus.
 */
function readFocusedSelection(state: BrowserState): WindowSelection {
  return { id: state.focusedWindowId, activeSpaceId: state.activeSpaceId, selectedTabIdBySpace: state.selectedTabIdBySpace };
}

/**
 * Every open main window's id, the focused one first, then the others from the most recently focused.
 */
export function listWindowIds(state: BrowserState): WindowId[] {
  const otherIds = state.otherWindows.map((selection) => selection.id);
  return [state.focusedWindowId, ...otherIds];
}

/**
 * The state as one window shows it: that window's Space and selection in the usual fields. Only for drawing a
 * window's sidebar and placing its pages; changes always go to the real state. The focused window (or an unknown
 * id) gets the state itself.
 * Example: focused A on "Work", parked B on "Personal" → projectStateForWindow(state, "B").activeSpaceId → "Personal"
 */
export function projectStateForWindow(state: BrowserState, windowId: WindowId): BrowserState {
  const parked = state.otherWindows.find((selection) => selection.id === windowId);
  if (parked === undefined) {
    return state;
  }
  return { ...state, activeSpaceId: parked.activeSpaceId, selectedTabIdBySpace: parked.selectedTabIdBySpace };
}

/**
 * Gives a window the focus: its parked choices move into the usual fields and the previously focused window's choices
 * are parked, at the front of the list. Nothing else changes (no lastActiveAt: looking at another window is not using
 * a tab). Same state when the window is already focused or not open.
 */
export function focusWindow(state: BrowserState, windowId: WindowId): BrowserState {
  const parked = state.otherWindows.find((selection) => selection.id === windowId);
  if (parked === undefined) {
    return state;
  }
  const stillParked = state.otherWindows.filter((selection) => selection.id !== windowId);
  return {
    ...state,
    activeSpaceId: parked.activeSpaceId,
    selectedTabIdBySpace: parked.selectedTabIdBySpace,
    focusedWindowId: windowId,
    otherWindows: [readFocusedSelection(state), ...stillParked],
  };
}

/**
 * Opens a new main window and gives it the focus. It starts in the Space the focused window shows, with nothing
 * selected (our choice: a fresh window is for something new, and a tab another window shows could only be a
 * placeholder there). Same state when the id is already open.
 */
export function openWindow(state: BrowserState, windowId: WindowId): BrowserState {
  if (listWindowIds(state).includes(windowId)) {
    return state;
  }
  const nothingSelected: Record<SpaceId, ItemId | null> = {};
  for (const space of state.spaces) {
    nothingSelected[space.id] = null;
  }
  return {
    ...state,
    selectedTabIdBySpace: nothingSelected,
    focusedWindowId: windowId,
    otherWindows: [readFocusedSelection(state), ...state.otherWindows],
  };
}

/**
 * Forgets a closed window. When the focused one closes, the most recently focused other window takes its place. The
 * last window is kept: the app quits with it, and the next start opens it again.
 */
export function closeWindow(state: BrowserState, windowId: WindowId): BrowserState {
  const isParked = state.otherWindows.some((selection) => selection.id === windowId);
  if (isParked) {
    const remaining = state.otherWindows.filter((selection) => selection.id !== windowId);
    return { ...state, otherWindows: remaining };
  }
  const nextWindow = state.otherWindows[0];
  if (windowId !== state.focusedWindowId || nextWindow === undefined) {
    return state;
  }
  return {
    ...state,
    activeSpaceId: nextWindow.activeSpaceId,
    selectedTabIdBySpace: nextWindow.selectedTabIdBySpace,
    focusedWindowId: nextWindow.id,
    otherWindows: state.otherWindows.slice(1),
  };
}

/**
 * Fixes one parked window after a change made in the focused window: a deleted active Space becomes the first
 * Space, selections of deleted Spaces go, and a selected tab that is gone or moved to another Space is replaced the
 * way state.ts replaces the focused window's (repairSelections). The same record when nothing needed fixing.
 */
function repairWindowSelection(state: BrowserState, selection: WindowSelection): WindowSelection {
  const spaceIds = new Set(state.spaces.map((space) => space.id));
  const hasActiveSpace = spaceIds.has(selection.activeSpaceId);
  const hasGoneSpaces = Object.keys(selection.selectedTabIdBySpace).some((spaceId) => !spaceIds.has(spaceId));
  const asFocused = { ...state, selectedTabIdBySpace: selection.selectedTabIdBySpace };
  const repaired = repairSelections(asFocused);
  if (hasActiveSpace && !hasGoneSpaces && repaired === asFocused) {
    return selection;
  }

  const selectedTabIdBySpace: Record<SpaceId, ItemId | null> = {};
  for (const space of state.spaces) {
    selectedTabIdBySpace[space.id] = repaired.selectedTabIdBySpace[space.id] ?? null;
  }
  const firstSpaceId = state.spaces[0]?.id ?? state.activeSpaceId;
  const activeSpaceId = hasActiveSpace ? selection.activeSpaceId : firstSpaceId;
  return { id: selection.id, activeSpaceId: activeSpaceId, selectedTabIdBySpace: selectedTabIdBySpace };
}

/**
 * Keeps every parked window's choices valid after a change (applyChange runs this after each one). Same state when
 * nothing needed fixing.
 */
export function repairOtherWindows(state: BrowserState): BrowserState {
  let anyRepaired = false;
  const repairedWindows: WindowSelection[] = [];
  for (const selection of state.otherWindows) {
    const repaired = repairWindowSelection(state, selection);
    repairedWindows.push(repaired);
    if (repaired !== selection) {
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
  const selections = [readFocusedSelection(state), ...state.otherWindows];
  for (const selection of selections) {
    const tabIds = Object.values(selection.selectedTabIdBySpace).filter((tabId): tabId is ItemId => tabId !== null);
    for (const tabId of tabIds) {
      selectedTabIds.add(tabId);
    }
  }
  return selectedTabIds;
}
