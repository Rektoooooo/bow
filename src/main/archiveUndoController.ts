/**
 * WHY this file exists:
 *   When the sweep or Clear archives Today tabs, the sidebar offers Undo for a few seconds, so a Clear pressed by
 *   mistake or a sweep you did not expect costs one click. archiveUndo.ts notes the tabs' places and puts them back;
 *   this file runs the archiving and offers Undo in the sidebar's notice (sidebarNotice.ts) for
 *   SIDEBAR_NOTICE_SHOWN_MS, the note kept by the notice's button. Close Duplicate Tabs archives the same way.
 *
 * Data source:
 *   The state (browserCore.ts) and the tabs to archive (main.ts sweep, Clear from the menu, the sidebar or the
 *   Command Bar).
 *
 * Data flow:
 *   archiveWithUndo(tabIds, reason) → captureArchiveBatch → applyChange(moveTabsToArchive) → offerSidebarNotice
 *   → the sidebar shows "Cleared 4 tabs · Undo" → its button → undoArchive(batch) → applyChange(undoArchiveBatch)
 */
import { applyChange, getState } from "./browserCore";
import { offerSidebarNotice } from "./sidebarNotice";
import { captureArchiveBatch, undoArchiveBatch } from "./archiveUndo";
import type { ArchiveBatch } from "./archiveUndo";
import { findDuplicateTodayTabs } from "./duplicateTabs";
import { listClearableTodayTabIds, moveTabsToArchive } from "./state";
import { closeTabByUser } from "./tabActions";
import { findRootLocation } from "./tree";
import { SIDEBAR_NOTICE_SHOWN_MS } from "../shared/settings";
import type { ArchiveReason, ItemId } from "../shared/types";

/**
 * Archives tabs and offers Undo in the sidebar with a message about how many left ("Cleared 4 tabs").
 */
function archiveWithUndo(tabIds: ItemId[], reason: ArchiveReason, describe: (count: number) => string): void {
  const batch = captureArchiveBatch(getState(), tabIds);
  const now = Date.now();
  applyChange((state) => moveTabsToArchive(state, tabIds, now, reason));
  if (batch.places.length === 0) {
    return;
  }
  offerSidebarNotice(describe(batch.places.length), "Undo", () => undoArchive(batch), SIDEBAR_NOTICE_SHOWN_MS);
}

/**
 * Clear (⇧⌘K, the sidebar's Clear, the Command Bar): the active Space's Today tabs, except those marked Never Archive.
 */
export function clearTodayTabsWithUndo(): void {
  const tabIds = listClearableTodayTabIds(getState());
  archiveWithUndo(tabIds, "clear-button", (count) => (count === 1 ? "Cleared 1 tab" : `Cleared ${count} tabs`));
}

/**
 * The sweep (main.ts): Today tabs unused for longer than their Space's timing.
 */
export function archiveUnusedTabsWithUndo(tabIds: ItemId[]): void {
  archiveWithUndo(tabIds, "auto", (count) => (count === 1 ? "Archived 1 unused tab" : `Archived ${count} unused tabs`));
}

/**
 * Close Duplicate Tabs: the Today copies of addresses another tab of the profile shows (duplicateTabs.ts).
 */
export function closeDuplicateTabsWithUndo(): void {
  const tabIds = findDuplicateTodayTabs(getState());
  archiveWithUndo(tabIds, "manual", (count) => (count === 1 ? "Closed 1 duplicate tab" : `Closed ${count} duplicate tabs`));
}

/**
 * Close for several picked tabs: Today tabs go to the Archive together, with Undo; a pinned tab or Favorite puts its
 * page away and keeps its place, as ⌘W does (tabActions.ts).
 */
export function closeTabsWithUndo(tabIds: ItemId[]): void {
  const state = getState();
  const todayTabIds = tabIds.filter((tabId) => findRootLocation(state, tabId)?.kind === "today");
  const otherTabIds = tabIds.filter((tabId) => !todayTabIds.includes(tabId));
  for (const tabId of otherTabIds) {
    closeTabByUser(tabId);
  }
  archiveWithUndo(todayTabIds, "manual", (count) => (count === 1 ? "Closed 1 tab" : `Closed ${count} tabs`));
}

/**
 * Undo: puts the tabs back where they were.
 */
function undoArchive(batch: ArchiveBatch): void {
  applyChange((state) => undoArchiveBatch(state, batch, Date.now()));
}

