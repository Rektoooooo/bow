/**
 * WHY this file exists:
 *   Today tabs that nobody has used for a while should leave the sidebar on their own,
 *   the way Arc's auto-archive works. This file decides WHICH tabs go and cleans up old archive entries.
 *   It never looks at Electron or the clock itself; main.ts passes "now" in, so tests can pick any time.
 *
 * Data source:
 *   BrowserState (tabs, settings, archive), the time the app launched, and the ids of tabs in use right now.
 *
 * Data flow:
 *   main.ts timer fires → findTabsToArchive() → state.moveTabsToArchive(…, "auto")
 *   main.ts prune timer → pruneArchive() → archive without entries older than the retention period
 */
import { ARCHIVE_RETENTION_MS } from "../shared/settings";
import type { BrowserState, Tab, TabId } from "../shared/types";

/**
 * How long a tab has been unused, in milliseconds.
 * Counts from the later of the tab's lastActiveAt and the app launch, so tabs do not all
 * archive the moment you open the app after a week away.
 * Example: lastActiveAt = 9:00, launchedAt = 10:00, now = 11:00 → 1 hour (not 2)
 */
export function getInactiveDurationMs(tab: Tab, now: number, launchedAt: number): number {
  // Time while the app was closed does not count, so start from launch if that is later.
  const countFrom = Math.max(tab.lastActiveAt, launchedAt);
  const inactiveDurationMs = now - countFrom;
  return inactiveDurationMs;
}

/**
 * Returns the ids of tabs that should be auto-archived now.
 * A tab qualifies only when ALL of these are true:
 *   - it is unpinned
 *   - it is not in use right now (inUseTabIds)
 *   - it has been unused for at least settings.archiveAfterMs
 * Returns an empty list when the setting is "Never" (null).
 * Example: threshold 12 h, unpinned tab unused for 13 h, not in use → ["tab-…"]
 */
export function findTabsToArchive(state: BrowserState, now: number, launchedAt: number, inUseTabIds: TabId[]): TabId[] {
  const archiveAfterMs = state.settings.archiveAfterMs;
  if (archiveAfterMs === null) {
    return [];
  }

  const tabsInUse = new Set(inUseTabIds);
  const tabIdsToArchive: TabId[] = [];
  for (const tab of state.tabs) {
    if (tab.isPinned || tabsInUse.has(tab.id)) {
      continue;
    }
    const inactiveDurationMs = getInactiveDurationMs(tab, now, launchedAt);
    if (inactiveDurationMs >= archiveAfterMs) {
      tabIdsToArchive.push(tab.id);
    }
  }
  return tabIdsToArchive;
}

/**
 * Deletes archive entries older than ARCHIVE_RETENTION_MS.
 * Returns the same state object when nothing was old enough, so main.ts can skip saving.
 * Example: retention 30 days, entry archived 31 days ago → removed
 */
export function pruneArchive(state: BrowserState, now: number): BrowserState {
  const oldestAllowedArchivedAt = now - ARCHIVE_RETENTION_MS;
  const keptEntries = state.archive.filter((entry) => entry.archivedAt >= oldestAllowedArchivedAt);

  const nothingRemoved = keptEntries.length === state.archive.length;
  if (nothingRemoved) {
    return state;
  }
  return { ...state, archive: keptEntries };
}
