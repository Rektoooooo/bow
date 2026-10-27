/**
 * WHY this file exists:
 *   Every page that has been on screen keeps its own renderer process (about 80 MB each, measured 2026-10-27) until
 *   its tab closes, so a long session fills the Mac's memory with pages nobody looks at. Pages left alone for a while
 *   go to sleep: tabViews.ts closes the page but keeps its back/forward list with Chromium's page state (scroll
 *   position, form values) and restores it when the tab is shown again. This decides which pages may sleep.
 *
 * Data source:
 *   The state (each tab's lastActiveAt, which auto-archive refreshes every minute while a tab is in use; the
 *   Favorites; the "Sleep unused tabs after" setting), the tabs that have a page now, and the ones in use (on
 *   screen, playing sound or in picture-in-picture, activity.ts).
 *
 * Data flow:
 *   main.ts every minute → findTabsToSleep(state, awakeTabIds, inUseTabIds, now) → tabViews.sleepTabView(tabId)
 *
 * Rules: pure; Favorites never sleep (they are usually apps such as mail and chat, whose unread counts should keep
 * coming, our choice).
 */
import { DEFAULT_TAB_SLEEP_AFTER_MS } from "../shared/settings";
import type { BrowserSettings, BrowserState, ItemId } from "../shared/types";

/**
 * How long a page may go unused before it sleeps, or null when pages never sleep.
 */
export function readTabSleepAfter(settings: BrowserSettings): number | null {
  if (settings.tabSleepAfterMs === undefined) {
    return DEFAULT_TAB_SLEEP_AFTER_MS;
  }
  return settings.tabSleepAfterMs;
}

/**
 * The awake pages that may sleep now: not in use, not a Favorite, and unused for longer than the setting allows.
 */
export function findTabsToSleep(state: BrowserState, awakeTabIds: ItemId[], inUseTabIds: ItemId[], now: number): ItemId[] {
  const sleepAfterMs = readTabSleepAfter(state.settings);
  if (sleepAfterMs === null) {
    return [];
  }
  const inUse = new Set(inUseTabIds);
  const favoriteIds = new Set(state.profiles.flatMap((profile) => profile.favoriteIds));
  return awakeTabIds.filter((tabId) => {
    const item = state.items[tabId];
    if (item === undefined || item.kind !== "tab" || inUse.has(tabId) || favoriteIds.has(tabId)) {
      return false;
    }
    return now - item.lastActiveAt >= sleepAfterMs;
  });
}

/**
 * Changes the "Sleep unused tabs after" setting. Null keeps every page awake.
 */
export function setTabSleepAfter(state: BrowserState, tabSleepAfterMs: number | null): BrowserState {
  if (readTabSleepAfter(state.settings) === tabSleepAfterMs) {
    return state;
  }
  return { ...state, settings: { ...state.settings, tabSleepAfterMs: tabSleepAfterMs } };
}
