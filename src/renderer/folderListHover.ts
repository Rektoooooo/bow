/**
 * WHY this file exists:
 *   Resting the pointer on a closed folder in Arc's sidebar shows the folder's tabs in a list beside it. This file
 *   watches the pointer over closed folder rows and tells main when it leaves the row; the overlay reports the list's
 *   side, and main closes the list once the pointer is away from both for a moment.
 *
 * Data source:
 *   Pointer events on the sidebar's folder rows (data-row="folder", not .is-open).
 *
 * Data flow:
 *   pointer rests on a closed folder for FOLDER_LIST_DELAY_MS → action showFolderList(folderId, row box)
 *   pointer leaves that row → action folderListPointer(false); comes back → showFolderList again
 *   the row is pressed, dragged or scrolled → action hideFolderList
 */
import { FOLDER_LIST_DELAY_MS } from "../shared/settings.js";
import { dispatch } from "./dom.js";

let restTimer: number | null = null;
/** The folder whose list was asked for (null: none), and whether the pointer is on its row right now. */
let shownFolderId: string | null = null;
let isPointerOnShownRow = false;

/**
 * Cancels a list that is waiting to show.
 */
function cancelPendingList(): void {
  if (restTimer !== null) {
    window.clearTimeout(restTimer);
    restTimer = null;
  }
}

/**
 * The pointer left the shown list's folder row: main closes the list unless the pointer reaches the list (or comes
 * back) in a moment.
 */
function reportPointerLeftRow(): void {
  if (shownFolderId !== null && isPointerOnShownRow) {
    isPointerOnShownRow = false;
    dispatch({ type: "folderListPointer", isInside: false });
  }
}

/**
 * Asks main for a folder's list (or, for the one that shows, tells it the pointer is back on the row).
 */
function requestList(row: HTMLElement, folderId: string): void {
  const box = row.getBoundingClientRect();
  shownFolderId = folderId;
  isPointerOnShownRow = true;
  dispatch({ type: "showFolderList", folderId: folderId, anchor: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } });
}

/**
 * The pointer moved over the sidebar: back on the shown list's row, onto another closed folder (wait for it to rest),
 * or elsewhere.
 */
function handlePointerMove(event: PointerEvent): void {
  const row = (event.target as Element | null)?.closest<HTMLElement>('[data-row="folder"]:not(.is-open)') ?? null;
  const folderId = row?.dataset.itemId ?? null;
  if (row !== null && folderId !== null && folderId === shownFolderId) {
    if (!isPointerOnShownRow) {
      requestList(row, folderId);
    }
    return;
  }
  reportPointerLeftRow();
  if (row !== null && folderId !== null && restTimer !== null) {
    return;
  }
  cancelPendingList();
  shownFolderId = null;
  if (row === null || folderId === null || event.buttons !== 0) {
    return;
  }
  restTimer = window.setTimeout(() => {
    restTimer = null;
    if (row.isConnected) {
      requestList(row, folderId);
    }
  }, FOLDER_LIST_DELAY_MS);
}

/**
 * A press, a drag or a scroll ends the list: the folder is being opened or moved.
 */
function endList(): void {
  cancelPendingList();
  if (shownFolderId !== null) {
    shownFolderId = null;
    isPointerOnShownRow = false;
    dispatch({ type: "hideFolderList" });
  }
}

/**
 * Watches the pointer over the sidebar's closed folders.
 */
export function installFolderListHover(root: HTMLElement): void {
  root.addEventListener("pointermove", handlePointerMove);
  // Leaving the sidebar page (to the list, or to the page beside it) leaves the row too.
  root.addEventListener("pointerleave", () => {
    cancelPendingList();
    reportPointerLeftRow();
  });
  root.addEventListener("pointerdown", endList);
  root.addEventListener("dragstart", endList);
  root.addEventListener("wheel", endList, { passive: true });
}
