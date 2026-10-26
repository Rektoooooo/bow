/**
 * WHY this file exists:
 *   Resting the pointer on a tab in the sidebar shows a preview card of its page next to the sidebar, like Arc's tab
 *   previews; moving away hides it. This file only watches the pointer: the main process decides whether there is a
 *   picture to show and places the card.
 *
 * Data source:
 *   Pointer events on the sidebar's tab rows (data-row="tab", data-item-id).
 *
 * Data flow:
 *   pointer rests on a row for HOVER_DELAY_MS → action showTabPreview(tabId, row box) → overlayController.ts
 *   pointer leaves the row, presses, or a drag starts → action hideTabPreview
 */
import { dispatch } from "./dom.js";

/** How long the pointer must rest on a tab before its preview shows. Our choice: deliberate, not on every pass. */
const HOVER_DELAY_MS = 600;

let hoverTimer: number | null = null;
/** The tab whose preview is waiting to show (moving between parts of the same row must not restart the wait). */
let pendingTabId: string | null = null;
let shownTabId: string | null = null;

/**
 * Cancels a pending preview and hides one that is showing.
 */
function hidePreview(): void {
  if (hoverTimer !== null) {
    window.clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  pendingTabId = null;
  if (shownTabId !== null) {
    shownTabId = null;
    dispatch({ type: "hideTabPreview" });
  }
}

/**
 * Starts the wait for a row's preview; the selected tab needs none (its page is on screen).
 */
function schedulePreview(row: HTMLElement): void {
  const tabId = row.dataset.itemId;
  if (tabId === undefined || tabId === shownTabId || tabId === pendingTabId) {
    return;
  }
  hidePreview();
  if (row.classList.contains("is-selected")) {
    return;
  }
  pendingTabId = tabId;
  hoverTimer = window.setTimeout(() => {
    hoverTimer = null;
    pendingTabId = null;
    const box = row.getBoundingClientRect();
    shownTabId = tabId;
    dispatch({ type: "showTabPreview", tabId: tabId, anchor: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } });
  }, HOVER_DELAY_MS);
}

/**
 * Watches the pointer over the sidebar's tab rows.
 */
export function installTabPreviewHover(root: HTMLElement): void {
  root.addEventListener("pointerover", (event) => {
    const row = (event.target as Element | null)?.closest<HTMLElement>('[data-row="tab"]') ?? null;
    if (row === null) {
      hidePreview();
      return;
    }
    schedulePreview(row);
  });
  root.addEventListener("pointerleave", hidePreview);
  root.addEventListener("pointerdown", hidePreview);
  root.addEventListener("dragstart", hidePreview);
}
