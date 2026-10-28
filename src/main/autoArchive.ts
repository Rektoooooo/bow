/**
 * WHY this file exists:
 *   Today tabs that nobody has used for a while should leave the sidebar on their own,
 *   the way Arc's auto-archive works. This file decides WHICH tabs go and cleans up old archive entries.
 *   It never looks at Electron or the clock itself; main.ts passes "now" in, so tests can pick any time.
 *
 * Data source:
 *   BrowserState (tabs and their Never Archive mark, each Space's own timing, the setting, the archive), the time the
 *   app launched, and the ids of tabs in use right now.
 *
 * Data flow:
 *   main.ts timer fires → findTabsToArchive() → state.moveTabsToArchive(…, "auto")
 *   main.ts every minute → findTabsArchivingSoon() → RuntimeState.archivingSoon → the rows say "archives in 20 min"
 *   main.ts prune timer → pruneArchive() → archive trimmed to the newest ARCHIVE_LIMIT entries
 */
import { ARCHIVE_LIMIT, ARCHIVE_SOON_MS, ARCHIVE_SOON_SHARE, MINUTE_MS } from "../shared/settings";
import type { BrowserState, ItemId, Space, TabItem } from "../shared/types";
import { collectTabIdsInList, findTab } from "./tree";

/**
 * How long a tab has been unused, in milliseconds.
 * Counts from the later of the tab's lastActiveAt and the app launch, so tabs do not all
 * archive the moment you open the app after a week away.
 * Example: lastActiveAt = 9:00, launchedAt = 10:00, now = 11:00 → 1 hour (not 2)
 */
export function getInactiveDurationMs(tab: TabItem, now: number, launchedAt: number): number {
  // Time while the app was closed does not count, so start from launch if that is later.
  const countFrom = Math.max(tab.lastActiveAt, launchedAt);
  const inactiveDurationMs = now - countFrom;
  return inactiveDurationMs;
}

/**
 * How long a Space's Today tabs may go unused: the Space's own timing, or the setting. Null means never.
 */
export function getSpaceArchiveAfter(state: BrowserState, space: Space): number | null {
  if (space.archiveAfterMs === undefined) {
    return state.settings.archiveAfterMs;
  }
  return space.archiveAfterMs;
}

/**
 * The Today tabs of a Space that may archive at all: not in use and not marked Never Archive.
 */
function listArchivableTabs(state: BrowserState, space: Space, tabsInUse: Set<ItemId>): TabItem[] {
  const tabs: TabItem[] = [];
  for (const tabId of collectTabIdsInList(state, space.todayIds)) {
    const tab = findTab(state, tabId);
    if (tab !== undefined && !tabsInUse.has(tabId) && tab.isNeverArchived !== true) {
      tabs.push(tab);
    }
  }
  return tabs;
}

/**
 * Returns the ids of tabs that should be auto-archived now.
 * A tab qualifies only when ALL of these are true:
 *   - it is a Today tab (directly, or inside a Today split view); Pinned tabs and Favorites never archive
 *   - it is not in use right now (inUseTabIds) and not marked Never Archive
 *   - it has been unused for at least its Space's timing (getSpaceArchiveAfter); "Never" (null) skips the Space
 * Example: threshold 12 h, unpinned tab unused for 13 h, not in use → ["tab-…"]
 */
export function findTabsToArchive(state: BrowserState, now: number, launchedAt: number, inUseTabIds: ItemId[]): ItemId[] {
  const tabsInUse = new Set(inUseTabIds);
  const tabIdsToArchive: ItemId[] = [];
  for (const space of state.spaces) {
    const archiveAfterMs = getSpaceArchiveAfter(state, space);
    if (archiveAfterMs === null) {
      continue;
    }
    for (const tab of listArchivableTabs(state, space, tabsInUse)) {
      if (getInactiveDurationMs(tab, now, launchedAt) >= archiveAfterMs) {
        tabIdsToArchive.push(tab.id);
      }
    }
  }
  return tabIdsToArchive;
}

/**
 * The Today tabs that archive soon, with the whole minutes left (at least 1: a tab past its time waits for the next
 * sweep, at most ARCHIVE_SWEEP_INTERVAL_MS away). "Soon" is the last ARCHIVE_SOON_MS, or the last quarter of a
 * shorter timing, so a 1-hour timing does not mark tabs the moment they open.
 * Example: timing 12 h, tab unused for 11 h 40 min → { "tab-…": 20 }
 */
export function findTabsArchivingSoon(state: BrowserState, now: number, launchedAt: number, inUseTabIds: ItemId[]): Record<ItemId, number> {
  const tabsInUse = new Set(inUseTabIds);
  const minutesLeftByTab: Record<ItemId, number> = {};
  for (const space of state.spaces) {
    const archiveAfterMs = getSpaceArchiveAfter(state, space);
    if (archiveAfterMs === null) {
      continue;
    }
    const soonWindowMs = Math.min(ARCHIVE_SOON_MS, archiveAfterMs / ARCHIVE_SOON_SHARE);
    for (const tab of listArchivableTabs(state, space, tabsInUse)) {
      const remainingMs = archiveAfterMs - getInactiveDurationMs(tab, now, launchedAt);
      if (remainingMs <= soonWindowMs) {
        minutesLeftByTab[tab.id] = Math.max(1, Math.ceil(remainingMs / MINUTE_MS));
      }
    }
  }
  return minutesLeftByTab;
}

/**
 * Keeps the newest ARCHIVE_LIMIT archive entries (the archive is newest first) and deletes the rest, like Arc.
 * Returns the same state object when nothing had to go, so main.ts can skip saving.
 * Example: limit 250, 260 entries → the 10 oldest are removed
 */
export function pruneArchive(state: BrowserState): BrowserState {
  if (state.archive.length <= ARCHIVE_LIMIT) {
    return state;
  }
  return { ...state, archive: state.archive.slice(0, ARCHIVE_LIMIT) };
}
