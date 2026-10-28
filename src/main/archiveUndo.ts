/**
 * WHY this file exists:
 *   The sweep and Clear take many Today tabs at once, and finding them one by one in the Archive is a chore. Just
 *   before they go, this notes where each sat; Undo puts them all back there, in order, and selects again what was
 *   selected. Archive entries do not keep places, so the note lives in memory while Undo is offered.
 *
 * Data source:
 *   The state before the tabs leave (their Space and place in Today, each Space's selection), and the archive after.
 *
 * Data flow:
 *   sweep / Clear → captureArchiveBatch(state, tabIds) → moveTabsToArchive → archiveUndoController offers Undo
 *   Undo → undoArchiveBatch(state, batch, now) → tabs back in Today where they were
 *
 * Rules: pure. A Today split view the tabs were in is not rebuilt (moving to the Archive dissolved it); its tabs come
 * back as plain rows where the split view was.
 */
import type { BrowserState, ItemId, SpaceId, TabItem } from "../shared/types";
import { findRootLocation, getIdsAt, insertIntoLocation } from "./tree";

/** Where a Today tab sat: its Space and the index of its row (or its split view's row) in Today. */
export interface ArchivePlace {
  tabId: ItemId;
  spaceId: SpaceId;
  index: number;
}

/** What Undo needs: the places, and each Space's selected tab before the tabs left. */
export interface ArchiveBatch {
  places: ArchivePlace[];
  selectedTabIdBySpace: Record<SpaceId, ItemId | null>;
}

/**
 * Notes where each tab sits in Today, before it leaves. Tabs outside Today are left out.
 */
export function captureArchiveBatch(state: BrowserState, tabIds: ItemId[]): ArchiveBatch {
  const places: ArchivePlace[] = [];
  for (const tabId of tabIds) {
    const rootLocation = findRootLocation(state, tabId);
    if (rootLocation === null || rootLocation.kind !== "today") {
      continue;
    }
    const todayIds = getIdsAt(state, rootLocation);
    const rowIndex = todayIds.findIndex((rowId) => rowId === tabId || containsTab(state, rowId, tabId));
    places.push({ tabId: tabId, spaceId: rootLocation.spaceId, index: rowIndex });
  }
  return { places: places, selectedTabIdBySpace: { ...state.selectedTabIdBySpace } };
}

/**
 * Whether a Today row (a split view) holds the tab.
 */
function containsTab(state: BrowserState, rowId: ItemId, tabId: ItemId): boolean {
  const row = state.items[rowId];
  return row !== undefined && row.kind === "split" && row.childIds.includes(tabId);
}

/**
 * Puts the batch's tabs back where they were, Space by Space, the lowest places first so the others' places stay
 * right. Tabs of one split view share its place: they return side by side in their order, and the rows after them
 * move down by the extra rows. Tabs no longer in the Archive (restored from the Library meanwhile) are skipped; a tab
 * whose Space is gone returns to the active Space. Each comes back as just used, so the sweep does not take it again
 * at once. Same state when nothing could come back.
 */
export function undoArchiveBatch(state: BrowserState, batch: ArchiveBatch, now: number): BrowserState {
  const archivedTabIds = new Set(state.archive.map((entry) => entry.tab.id));
  const restorable = batch.places.filter((place) => archivedTabIds.has(place.tabId) && state.items[place.tabId] === undefined);
  if (restorable.length === 0) {
    return state;
  }
  const restoredTabIds = new Set(restorable.map((place) => place.tabId));
  let changed: BrowserState = { ...state, archive: state.archive.filter((entry) => !restoredTabIds.has(entry.tab.id)) };
  const spaceIds = new Set(changed.spaces.map((space) => space.id));
  const placesBySpace = new Map<SpaceId, ArchivePlace[]>();
  for (const place of restorable) {
    const spaceId = spaceIds.has(place.spaceId) ? place.spaceId : changed.activeSpaceId;
    placesBySpace.set(spaceId, [...(placesBySpace.get(spaceId) ?? []), place]);
  }
  for (const [spaceId, places] of placesBySpace) {
    changed = restoreIntoSpace(changed, state, spaceId, places, now);
  }
  return restoreSelections(changed, batch, restoredTabIds);
}

/**
 * Puts one Space's tabs back into its Today list (see undoArchiveBatch). `before` holds their archive entries.
 */
function restoreIntoSpace(state: BrowserState, before: BrowserState, spaceId: SpaceId, places: ArchivePlace[], now: number): BrowserState {
  // A stable sort keeps a split view's tabs in their order.
  const inPlaceOrder = [...places].sort((first, second) => first.index - second.index);
  let changed = state;
  let extraRowsBefore = 0;
  let previousIndex: number | null = null;
  let tabsAtThisIndex = 0;
  for (const place of inPlaceOrder) {
    if (place.index !== previousIndex) {
      extraRowsBefore += Math.max(tabsAtThisIndex - 1, 0);
      tabsAtThisIndex = 0;
      previousIndex = place.index;
    }
    const entry = before.archive.find((candidate) => candidate.tab.id === place.tabId);
    if (entry === undefined) {
      continue;
    }
    const tab: TabItem = { ...entry.tab, lastActiveAt: now };
    changed = { ...changed, items: { ...changed.items, [tab.id]: tab } };
    changed = insertIntoLocation(changed, { kind: "today", spaceId: spaceId }, tab.id, place.index + extraRowsBefore + tabsAtThisIndex);
    tabsAtThisIndex += 1;
  }
  return changed;
}

/**
 * Selects again, in each Space, the tab that was selected before the batch left, when it came back.
 */
function restoreSelections(state: BrowserState, batch: ArchiveBatch, restoredTabIds: Set<ItemId>): BrowserState {
  const selections = { ...state.selectedTabIdBySpace };
  for (const [spaceId, selectedTabId] of Object.entries(batch.selectedTabIdBySpace)) {
    if (selectedTabId !== null && restoredTabIds.has(selectedTabId)) {
      selections[spaceId] = selectedTabId;
    }
  }
  return { ...state, selectedTabIdBySpace: selections };
}
