/**
 * WHY this file exists:
 *   When the sweep or Clear archives Today tabs, the sidebar offers Undo for a few seconds, so a Clear pressed by
 *   mistake or a sweep you did not expect costs one click. archiveUndo.ts notes the tabs' places and puts them back;
 *   this file runs the archiving, keeps the note while Undo is offered, and takes the offer away after
 *   ARCHIVE_UNDO_SHOWN_MS.
 *
 * Data source:
 *   The state (browserCore.ts) and the tabs to archive (main.ts sweep, Clear from the menu, the sidebar or the
 *   Command Bar).
 *
 * Data flow:
 *   archiveWithUndo(tabIds, reason) → captureArchiveBatch → applyChange(moveTabsToArchive) → setArchiveUndo(offer)
 *   → the sidebar shows "Cleared 4 tabs · Undo" → undoLastArchive() → applyChange(undoArchiveBatch)
 */
import { applyChange, getState, setArchiveUndo } from "./browserCore";
import { captureArchiveBatch, undoArchiveBatch } from "./archiveUndo";
import type { ArchiveBatch } from "./archiveUndo";
import { listClearableTodayTabIds, moveTabsToArchive } from "./state";
import { ARCHIVE_UNDO_SHOWN_MS } from "../shared/settings";
import type { ArchiveReason, ItemId } from "../shared/types";

/** The tabs the last sweep or Clear archived, while Undo is offered. */
let pendingBatch: ArchiveBatch | null = null;
let offerTimer: NodeJS.Timeout | null = null;

/**
 * Archives tabs and offers Undo with a message about how many left ("Cleared 4 tabs").
 */
function archiveWithUndo(tabIds: ItemId[], reason: ArchiveReason, describe: (count: number) => string): void {
  const batch = captureArchiveBatch(getState(), tabIds);
  const now = Date.now();
  applyChange((state) => moveTabsToArchive(state, tabIds, now, reason));
  if (batch.places.length === 0) {
    return;
  }
  pendingBatch = batch;
  setArchiveUndo({ message: describe(batch.places.length) });
  if (offerTimer !== null) {
    clearTimeout(offerTimer);
  }
  offerTimer = setTimeout(() => dismissArchiveUndo(), ARCHIVE_UNDO_SHOWN_MS);
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
 * Undo: puts the tabs back where they were.
 */
export function undoLastArchive(): void {
  const batch = pendingBatch;
  dismissArchiveUndo();
  if (batch === null) {
    return;
  }
  applyChange((state) => undoArchiveBatch(state, batch, Date.now()));
}

/**
 * Takes the Undo offer away (its time is up, or the user closed it).
 */
export function dismissArchiveUndo(): void {
  pendingBatch = null;
  if (offerTimer !== null) {
    clearTimeout(offerTimer);
    offerTimer = null;
  }
  setArchiveUndo(null);
}
