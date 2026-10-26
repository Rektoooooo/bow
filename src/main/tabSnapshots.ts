/**
 * WHY this file exists:
 *   The recent-tab switcher (⌃Tab) and tab previews show small pictures of pages that are not on screen. A page
 *   that is off screen cannot be captured, so we keep a picture of each page from while it was showing: after it
 *   finishes loading, a moment after it comes on screen, and every few seconds while it stays.
 *
 * Data source:
 *   WebContents.capturePage() of the shown pages (tabViews.ts tells us which).
 *
 * Data flow:
 *   tabViews.ts (page loaded / shown) → captureSnapshotSoon(tabId, contents) → small JPEG data: URL kept by tab id
 *   overlayController.ts (switcher, previews) → getSnapshot(tabId)
 */
import type { WebContents } from "electron";
import type { ItemId } from "../shared/types";

/** Width of a kept picture in pixels; the switcher's cards are about half as wide (sharp on 2× screens). Our choice. */
const SNAPSHOT_WIDTH_PX = 400;

/** JPEG quality of a kept picture (0–100). Our choice: small files, no visible blocks at card size. */
const SNAPSHOT_JPEG_QUALITY = 72;

/** Pictures kept; the least recently taken goes first. Our choice: covers the recent-tabs list several times over. */
const SNAPSHOTS_LIMIT = 60;

/** Wait this long after a page loads or comes on screen, so the picture shows it painted. Our choice. */
const SNAPSHOT_DELAY_MS = 700;

/** While a page stays on screen its picture is refreshed this often (one capture each time). Our choice. */
export const SNAPSHOT_REFRESH_MS = 10000;

/** Picture per tab, oldest first (a Map keeps insertion order). */
const snapshots = new Map<ItemId, string>();

/** Tabs with a capture already waiting, so a burst of events captures once. */
const pendingTabIds = new Set<ItemId>();

/**
 * Captures a page now and keeps a small picture of it. A page that is not on screen gives an empty image: skipped.
 */
async function captureSnapshot(tabId: ItemId, contents: WebContents): Promise<void> {
  if (contents.isDestroyed()) {
    return;
  }
  const image = await contents.capturePage();
  if (image.isEmpty()) {
    return;
  }
  const small = image.resize({ width: SNAPSHOT_WIDTH_PX, quality: "good" });
  const dataUrl = `data:image/jpeg;base64,${small.toJPEG(SNAPSHOT_JPEG_QUALITY).toString("base64")}`;
  snapshots.delete(tabId);
  snapshots.set(tabId, dataUrl);
  while (snapshots.size > SNAPSHOTS_LIMIT) {
    const oldestTabId = snapshots.keys().next().value;
    if (oldestTabId === undefined) {
      break;
    }
    snapshots.delete(oldestTabId);
  }
}

/**
 * Captures a page shortly, once it has painted.
 */
export function captureSnapshotSoon(tabId: ItemId, contents: WebContents): void {
  if (pendingTabIds.has(tabId)) {
    return;
  }
  pendingTabIds.add(tabId);
  setTimeout(() => {
    pendingTabIds.delete(tabId);
    captureSnapshot(tabId, contents).catch(() => undefined);
  }, SNAPSHOT_DELAY_MS);
}

/**
 * The kept picture of a tab's page as a data: URL, or null when there is none yet.
 */
export function getSnapshot(tabId: ItemId): string | null {
  return snapshots.get(tabId) ?? null;
}

/**
 * Forgets a closed tab's picture.
 */
export function forgetSnapshot(tabId: ItemId): void {
  snapshots.delete(tabId);
}
