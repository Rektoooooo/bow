/**
 * WHY this file exists:
 *   Arc's Split View shows two to four tabs side by side (or stacked) in one card, and the sidebar shows them as
 *   one row. Here a split view is an item whose children are tabs; this file creates, grows, shrinks and undoes them.
 *
 * Data source:
 *   The BrowserState passed in. No Electron, no clock.
 *
 * Data flow:
 *   context menu / shortcut → main.ts applyChange() → one function here → changed copy of the state
 *   tabViews.ts reads the split to lay out its panes.
 *
 * Rules: never change the state that was passed in; return a changed copy, or the same object when nothing changed.
 */
import { SPLIT_PANES_LIMIT } from "../shared/settings";
import type { BrowserState, ItemId, SplitItem, SplitOrientation } from "../shared/types";
import { applyHomeUrlRule, dissolveSmallSplits, replaceSplitWithChildren, selectTab } from "./state";
import { createId, findLocation, findSplitOfTab, findTab, getIdsAt, insertIntoLocation, removeFromLocation, setIdsAt } from "./tree";

/**
 * True when a tab may join a split view: it must exist and must not be a Favorite (Favorites are tiles).
 */
export function canJoinSplit(state: BrowserState, tabId: ItemId): boolean {
  const location = findLocation(state, tabId);
  return findTab(state, tabId) !== undefined && location !== null && location.kind !== "favorites";
}

/**
 * True when a tab sits directly in a live folder, whose source decides what it holds (liveFolders.ts).
 */
function isInLiveFolder(state: BrowserState, tabId: ItemId): boolean {
  const location = findLocation(state, tabId);
  if (location === null || location.kind !== "folder") {
    return false;
  }
  const folder = state.items[location.folderId];
  return folder !== undefined && folder.kind === "folder" && folder.live !== undefined;
}

/**
 * Shows a second tab next to the first. If the first tab is already in a split view, the second joins that split.
 * Otherwise a new split view takes the first tab's place in the sidebar. The first tab is selected.
 * A split never goes into a live folder: when the first tab sits in one, the split takes the second tab's place
 * instead (and two tabs of live folders do not split).
 * Example: Today [A, B, C], splitTabs(A, C) → Today [split(A, C), B]
 */
export function splitTabs(state: BrowserState, firstTabId: ItemId, secondTabId: ItemId, now: number): BrowserState {
  if (firstTabId === secondTabId || !canJoinSplit(state, firstTabId) || !canJoinSplit(state, secondTabId)) {
    return state;
  }
  const isFirstInLiveFolder = isInLiveFolder(state, firstTabId);
  if (isFirstInLiveFolder && isInLiveFolder(state, secondTabId)) {
    return state;
  }
  // The anchor keeps its place and the split takes it; the joining tab leaves its own place.
  const anchorTabId = isFirstInLiveFolder ? secondTabId : firstTabId;
  const joiningTabId = isFirstInLiveFolder ? firstTabId : secondTabId;

  const existingSplitId = findSplitOfTab(state, anchorTabId);
  if (existingSplitId !== null) {
    const grownState = addTabToSplit(state, existingSplitId, joiningTabId, now);
    return selectTab(grownState, firstTabId, now);
  }

  const anchorLocation = findLocation(state, anchorTabId);
  if (anchorLocation === null) {
    return state;
  }
  const split: SplitItem = { kind: "split", id: createId("split", now), childIds: [firstTabId, secondTabId], orientation: "horizontal" };

  // Take the joining tab out first, then swap the anchor's id for the split's id in its list.
  const stateWithoutJoining = dissolveSmallSplits(removeFromLocation(state, joiningTabId));
  const currentAnchorLocation = findLocation(stateWithoutJoining, anchorTabId) ?? anchorLocation;
  const siblingIds = getIdsAt(stateWithoutJoining, currentAnchorLocation);
  const swappedIds = siblingIds.map((id) => (id === anchorTabId ? split.id : id));
  const stateWithSplitItem: BrowserState = { ...stateWithoutJoining, items: { ...stateWithoutJoining.items, [split.id]: split } };
  const stateWithSplit = setIdsAt(stateWithSplitItem, currentAnchorLocation, swappedIds);
  // The joining tab may come from another section (Today into a Pinned split): give it that section's home-URL rule.
  const stateWithHomeUrls = applyHomeUrlRule(stateWithSplit, joiningTabId, now);
  return selectTab(stateWithHomeUrls, firstTabId, now);
}

/**
 * Adds a tab as the last pane of a split view. Returns the same state when the split has SPLIT_PANES_LIMIT panes.
 */
export function addTabToSplit(state: BrowserState, splitId: ItemId, tabId: ItemId, now: number): BrowserState {
  const split = state.items[splitId];
  if (split === undefined || split.kind !== "split" || split.childIds.includes(tabId)) {
    return state;
  }
  if (split.childIds.length >= SPLIT_PANES_LIMIT || !canJoinSplit(state, tabId)) {
    return state;
  }
  const stateWithoutTab = removeFromLocation(state, tabId);
  const stateWithTab = insertIntoLocation(stateWithoutTab, { kind: "split", splitId: splitId }, tabId, split.childIds.length);
  const stateWithHomeUrl = applyHomeUrlRule(stateWithTab, tabId, now);
  return dissolveSmallSplits(stateWithHomeUrl);
}

/**
 * Takes one tab out of its split view and puts it right after the split. A split left with one tab dissolves.
 */
export function separateTabFromSplit(state: BrowserState, tabId: ItemId): BrowserState {
  const splitId = findSplitOfTab(state, tabId);
  if (splitId === null) {
    return state;
  }
  const splitLocation = findLocation(state, splitId);
  if (splitLocation === null) {
    return state;
  }

  const stateWithoutTab = removeFromLocation(state, tabId);
  const splitIndex = getIdsAt(stateWithoutTab, splitLocation).indexOf(splitId);
  const stateWithTab = insertIntoLocation(stateWithoutTab, splitLocation, tabId, splitIndex + 1);
  return dissolveSmallSplits(stateWithTab);
}

/**
 * Turns a split view back into separate tabs ("Separate All Tabs").
 */
export function unsplit(state: BrowserState, splitId: ItemId): BrowserState {
  return replaceSplitWithChildren(state, splitId);
}

/**
 * Sets a split view's orientation: "horizontal" puts panes side by side, "vertical" stacks them.
 */
export function setSplitOrientation(state: BrowserState, splitId: ItemId, orientation: SplitOrientation): BrowserState {
  const split = state.items[splitId];
  if (split === undefined || split.kind !== "split" || split.orientation === orientation) {
    return state;
  }
  const updatedSplit: SplitItem = { ...split, orientation: orientation };
  return { ...state, items: { ...state.items, [splitId]: updatedSplit } };
}
