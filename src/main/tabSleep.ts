/**
 * WHY this file exists:
 *   Every page that has been on screen keeps its own renderer process (about 80 MB each, measured 2026-10-27) until
 *   its tab closes, so a long session fills the Mac's memory with pages nobody looks at. Pages left alone for a while
 *   go to sleep: tabViews.ts closes the page but keeps its back/forward list with Chromium's page state (scroll
 *   position, form values) and restores it when the tab is shown again. This decides which pages may sleep.
 *
 * Data source:
 *   The state (each tab's lastActiveAt, which auto-archive refreshes every minute while a tab is in use; the
 *   Favorites; the sites kept awake; the "Sleep unused tabs after" and "Keep Favorites awake" settings), the tabs
 *   that have a page now, and the ones in use (on screen, playing sound, in picture-in-picture, or using the camera,
 *   microphone or a screen share; activity.ts).
 *
 * Data flow:
 *   main.ts every minute → findTabsToSleep(state, awakeTabIds, inUseTabIds, now) → tabViews.sleepTabView(tabId)
 *   Sleep Other Tabs → findTabsAllowedToSleep(state, awakeTabIds, inUseTabIds) → tabViews.sleepTabView(tabId)
 *
 * Rules: pure. Favorites stay awake unless the user turns that off (they are usually apps such as mail and chat,
 * whose unread counts should keep coming, our choice); pinned tabs sleep like Today tabs (Arc's choice too); a site
 * on the Keep Awake list never sleeps by itself.
 */
import { getSiteKey } from "../shared/siteKey";
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
 * Whether Favorites stay awake ("Keep Favorites awake" in Library › Settings, on unless turned off).
 */
export function areFavoritesKeptAwake(settings: BrowserSettings): boolean {
  return settings.areFavoritesKeptAwake !== false;
}

/**
 * Whether a page's site is on the Keep Awake list (Control Center, a tab's menu, Library › Settings).
 */
export function isKeptAwake(state: BrowserState, url: string): boolean {
  const site = getSiteKey(url);
  return site !== null && (state.keepAwakeSites ?? []).includes(site);
}

/**
 * The awake pages that may sleep at all: not in use, not on the Keep Awake list, and not a Favorite while Favorites
 * stay awake. Sleep Other Tabs puts all of them to sleep; the timer only those unused for long enough.
 */
export function findTabsAllowedToSleep(state: BrowserState, awakeTabIds: ItemId[], inUseTabIds: ItemId[]): ItemId[] {
  const inUse = new Set(inUseTabIds);
  const favoriteIds = areFavoritesKeptAwake(state.settings) ? state.spaces.flatMap((space) => space.favoriteIds) : [];
  const keptFavoriteIds = new Set(favoriteIds);
  return awakeTabIds.filter((tabId) => {
    const item = state.items[tabId];
    if (item === undefined || item.kind !== "tab" || inUse.has(tabId) || keptFavoriteIds.has(tabId)) {
      return false;
    }
    return !isKeptAwake(state, item.url);
  });
}

/**
 * The awake pages that may sleep now: allowed to (findTabsAllowedToSleep) and unused for longer than the setting.
 */
export function findTabsToSleep(state: BrowserState, awakeTabIds: ItemId[], inUseTabIds: ItemId[], now: number): ItemId[] {
  const sleepAfterMs = readTabSleepAfter(state.settings);
  if (sleepAfterMs === null) {
    return [];
  }
  const allowedTabIds = findTabsAllowedToSleep(state, awakeTabIds, inUseTabIds);
  return allowedTabIds.filter((tabId) => {
    const item = state.items[tabId];
    return item !== undefined && item.kind === "tab" && now - item.lastActiveAt >= sleepAfterMs;
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

/**
 * Puts a site on the Keep Awake list, or takes it off.
 */
export function setSiteKeptAwake(state: BrowserState, site: string, isKeptAwake: boolean): BrowserState {
  const keptSites = state.keepAwakeSites ?? [];
  if (keptSites.includes(site) === isKeptAwake) {
    return state;
  }
  const changedSites = isKeptAwake ? [...keptSites, site] : keptSites.filter((keptSite) => keptSite !== site);
  return { ...state, keepAwakeSites: changedSites };
}

/**
 * Changes "Keep Favorites awake".
 */
export function setFavoritesKeptAwake(state: BrowserState, isOn: boolean): BrowserState {
  if (areFavoritesKeptAwake(state.settings) === isOn) {
    return state;
  }
  return { ...state, settings: { ...state.settings, areFavoritesKeptAwake: isOn } };
}
