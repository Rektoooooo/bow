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
import { GRID_MIN_PANES, readPaneSizes } from "../shared/splitLayout";
import type { BrowserState, ItemId, SplitItem, SplitOrientation } from "../shared/types";
import { applyHomeUrlRule, dissolveSmallSplits, getSelectedTabId, replaceSplitWithChildren, selectTab } from "./state";
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
 * Finds a split view by id, or undefined.
 */
function findSplit(state: BrowserState, splitId: ItemId): SplitItem | undefined {
  const item = state.items[splitId];
  return item !== undefined && item.kind === "split" ? item : undefined;
}

/**
 * Puts a changed split view in the state.
 */
function replaceSplit(state: BrowserState, split: SplitItem): BrowserState {
  return { ...state, items: { ...state.items, [split.id]: split } };
}

/**
 * Sets a split view's layout: "horizontal" puts panes side by side, "vertical" stacks them, "grid" makes a 2×2 grid
 * (3 or 4 panes only). The dragged sizes start over: each layout means something else by them.
 */
export function setSplitOrientation(state: BrowserState, splitId: ItemId, orientation: SplitOrientation): BrowserState {
  const split = findSplit(state, splitId);
  const isGridTooSmall = orientation === "grid" && split !== undefined && split.childIds.length < GRID_MIN_PANES;
  if (split === undefined || split.orientation === orientation || isGridTooSmall) {
    return state;
  }
  const updatedSplit: SplitItem = { ...split, orientation: orientation };
  delete updatedSplit.sizes;
  return replaceSplit(state, updatedSplit);
}

/**
 * Keeps the sizes a divider was dragged to. Sizes that do not fit the split view (shared/splitLayout.ts
 * readPaneSizes would not use them) change nothing.
 */
export function setSplitSizes(state: BrowserState, splitId: ItemId, sizes: number[]): BrowserState {
  const split = findSplit(state, splitId);
  if (split === undefined) {
    return state;
  }
  const usable = readPaneSizes(split.orientation, sizes, split.childIds.length);
  const fits = usable.length === sizes.length && usable.every((size, index) => size === sizes[index]);
  if (!fits) {
    return state;
  }
  return replaceSplit(state, { ...split, sizes: sizes });
}

/**
 * Equal panes again (double-click a divider, "Equal Pane Sizes").
 */
export function equalizeSplit(state: BrowserState, splitId: ItemId): BrowserState {
  const split = findSplit(state, splitId);
  if (split === undefined || split.sizes === undefined) {
    return state;
  }
  const updatedSplit: SplitItem = { ...split };
  delete updatedSplit.sizes;
  return replaceSplit(state, updatedSplit);
}

/**
 * Swap Panes: the focused pane trades places with the next one (the last with the one before), its size with it.
 * With two panes that is a plain swap.
 */
export function swapSplitPanes(state: BrowserState, splitId: ItemId, focusedTabId: ItemId | null): BrowserState {
  const split = findSplit(state, splitId);
  if (split === undefined || split.childIds.length < 2) {
    return state;
  }
  const foundIndex = focusedTabId === null ? -1 : split.childIds.indexOf(focusedTabId);
  const focusedIndex = Math.max(foundIndex, 0);
  const isLast = focusedIndex === split.childIds.length - 1;
  const otherIndex = isLast ? focusedIndex - 1 : focusedIndex + 1;
  const childIds = [...split.childIds];
  childIds[focusedIndex] = split.childIds[otherIndex] as ItemId;
  childIds[otherIndex] = split.childIds[focusedIndex] as ItemId;
  const updatedSplit: SplitItem = { ...split, childIds: childIds };
  // Side by side or stacked, each pane keeps its size; a grid's lines stay where they are.
  const hasPaneSizes = split.sizes !== undefined && split.orientation !== "grid" && split.sizes.length === split.childIds.length;
  if (hasPaneSizes) {
    const sizes = [...(split.sizes as number[])];
    sizes[focusedIndex] = split.sizes?.[otherIndex] as number;
    sizes[otherIndex] = split.sizes?.[focusedIndex] as number;
    updatedSplit.sizes = sizes;
  }
  return replaceSplit(state, updatedSplit);
}

/**
 * The pane beside the selected one in its split view (Next Pane / Previous Pane), wrapping around; null outside a
 * split view.
 */
export function findAdjacentPaneTabId(state: BrowserState, offset: number): ItemId | null {
  const selectedTabId = getSelectedTabId(state);
  const splitId = selectedTabId === null ? null : findSplitOfTab(state, selectedTabId);
  const split = splitId === null ? undefined : findSplit(state, splitId);
  if (split === undefined || selectedTabId === null) {
    return null;
  }
  const count = split.childIds.length;
  const index = split.childIds.indexOf(selectedTabId);
  return split.childIds[(index + offset + count) % count] ?? null;
}
