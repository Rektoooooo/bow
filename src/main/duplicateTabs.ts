/**
 * WHY this file exists:
 *   The same page open twice is clutter, and it happens without noticing: typing an address you already have, or a
 *   link from another app. Opening an address the user asks for switches to the tab that already shows it (the
 *   sidebar offers "Open Another"), and Close Duplicate Tabs tidies up what piled up. Within one profile only: the
 *   same address in another profile is a different sign-in.
 *
 * Data source:
 *   The state's tabs (Favorites, Pinned and Today, with their addresses and home addresses) and an address.
 *
 * Data flow:
 *   typed / Command Bar / routed link → tabActions.openOrSwitchToTab → findOpenTabForUrl → select it or open a tab
 *   Close Duplicate Tabs → findDuplicateTodayTabs → archiveUndoController (archived, with Undo)
 *
 * Rules: pure. Two addresses match when they differ only in http/https, "www." and a trailing slash
 * (commandBar.ts toDedupeKey, the Command Bar's rule).
 */
import type { BrowserState, ItemId, Space, SpaceId, TabItem } from "../shared/types";
import { toDedupeKey } from "./commandBar";
import { collectTabIdsInList, findTab } from "./tree";

/** A tab and whether it is a Today tab (the only ones Close Duplicate Tabs may take). */
interface PlacedTab {
  tab: TabItem;
  isToday: boolean;
}

/**
 * The tabs of a profile, in the order a match is preferred: the given Space's Pinned and Today tabs, the profile's
 * Favorites, then its other Spaces.
 */
function listProfileTabs(state: BrowserState, profileId: string, preferredSpaceId: SpaceId | null): PlacedTab[] {
  const placed: PlacedTab[] = [];
  const addList = (itemIds: ItemId[], isToday: boolean): void => {
    for (const tabId of collectTabIdsInList(state, itemIds)) {
      const tab = findTab(state, tabId);
      if (tab !== undefined) {
        placed.push({ tab: tab, isToday: isToday });
      }
    }
  };
  const spaces = state.spaces.filter((space) => space.profileId === profileId);
  const preferred = spaces.filter((space) => space.id === preferredSpaceId);
  const others = spaces.filter((space) => space.id !== preferredSpaceId);
  const addSpace = (space: Space): void => {
    addList(space.pinnedIds, false);
    addList(space.todayIds, true);
  };
  preferred.forEach(addSpace);
  const profile = state.profiles.find((candidate) => candidate.id === profileId);
  addList(profile?.favoriteIds ?? [], false);
  others.forEach(addSpace);
  return placed;
}

/**
 * Whether a tab shows an address: where it is now, or (a pinned tab or Favorite) its home address.
 */
function showsAddress(tab: TabItem, addressKey: string): boolean {
  const isHome = tab.homeUrl !== null && toDedupeKey(tab.homeUrl) === addressKey;
  return toDedupeKey(tab.url) === addressKey || isHome;
}

/**
 * The tab already showing an address, among the tabs of the Space's profile (that Space's first). Null when none.
 * Example: Today has https://mail.example/ and the user types "mail.example" → that tab's id
 */
export function findOpenTabForUrl(state: BrowserState, url: string, spaceId: SpaceId): ItemId | null {
  const space = state.spaces.find((candidate) => candidate.id === spaceId);
  if (space === undefined) {
    return null;
  }
  const addressKey = toDedupeKey(url);
  const match = listProfileTabs(state, space.profileId, spaceId).find((placed) => showsAddress(placed.tab, addressKey));
  return match === undefined ? null : match.tab.id;
}

/**
 * Close Duplicate Tabs: the Today tabs that show an address another tab of the same profile also shows. A pinned
 * tab or Favorite always stays (it is the copy kept); among Today copies alone, the most recently used one stays.
 */
export function findDuplicateTodayTabs(state: BrowserState): ItemId[] {
  const duplicates: ItemId[] = [];
  for (const profile of state.profiles) {
    const byAddress = new Map<string, PlacedTab[]>();
    for (const placed of listProfileTabs(state, profile.id, null)) {
      const addressKey = toDedupeKey(placed.tab.url);
      byAddress.set(addressKey, [...(byAddress.get(addressKey) ?? []), placed]);
    }
    for (const copies of byAddress.values()) {
      duplicates.push(...chooseCopiesToClose(copies));
    }
  }
  return duplicates;
}

/**
 * The copies of one address to close: every Today copy when a pinned tab or Favorite has it, else all Today copies
 * but the most recently used.
 */
function chooseCopiesToClose(copies: PlacedTab[]): ItemId[] {
  const todayCopies = copies.filter((placed) => placed.isToday);
  const hasKeptCopy = todayCopies.length < copies.length;
  if (hasKeptCopy) {
    return todayCopies.map((placed) => placed.tab.id);
  }
  const newestFirst = [...todayCopies].sort((first, second) => second.tab.lastActiveAt - first.tab.lastActiveAt);
  return newestFirst.slice(1).map((placed) => placed.tab.id);
}
