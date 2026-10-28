// Which pages may sleep: unused for longer than the setting, not in use, not a Favorite (unless allowed), not a site
// kept awake; and the settings themselves.
import { describe, expect, it } from "vitest";
import { DEFAULT_TAB_SLEEP_AFTER_MS, MINUTE_MS } from "../src/shared/settings";
import type { BrowserState, ItemId } from "../src/shared/types";
import { findTabsAllowedToSleep, findTabsToSleep, isKeptAwake, readTabSleepAfter, setFavoritesKeptAwake, setSiteKeptAwake, setTabSleepAfter } from "../src/main/tabSleep";
import { ONE_PM, openTabs } from "./builders";

/** Sets one tab's lastActiveAt, as auto-archive's minute refresh would have left it. */
function lastUsedAt(state: BrowserState, tabId: ItemId, time: number): BrowserState {
  const tab = state.items[tabId];
  if (tab === undefined || tab.kind !== "tab") {
    throw new Error(`Test setup problem: tab ${tabId} is missing`);
  }
  return { ...state, items: { ...state.items, [tabId]: { ...tab, lastActiveAt: time } } };
}

/** Makes a tab a Favorite of the default profile. */
function makeFavorite(state: BrowserState, tabId: ItemId): BrowserState {
  const profiles = state.profiles.map((profile, index) => (index === 0 ? { ...profile, favoriteIds: [...profile.favoriteIds, tabId] } : profile));
  return { ...state, profiles: profiles };
}

describe("findTabsToSleep", () => {
  const { state: builtState, tabIds } = openTabs(["https://a.example/", "https://b.example/", "https://c.example/", "https://d.example/"]);
  const [idleTab, recentTab, inUseTab, favoriteTab] = tabIds as [ItemId, ItemId, ItemId, ItemId];
  const now = ONE_PM + 10 * 60 * MINUTE_MS;
  let state = lastUsedAt(builtState, idleTab, now - DEFAULT_TAB_SLEEP_AFTER_MS - MINUTE_MS);
  state = lastUsedAt(state, recentTab, now - DEFAULT_TAB_SLEEP_AFTER_MS + MINUTE_MS);
  state = lastUsedAt(state, inUseTab, now - 5 * DEFAULT_TAB_SLEEP_AFTER_MS);
  state = makeFavorite(lastUsedAt(state, favoriteTab, now - 5 * DEFAULT_TAB_SLEEP_AFTER_MS), favoriteTab);
  const awakeTabIds = [idleTab, recentTab, inUseTab, favoriteTab];

  it("puts to sleep only the awake page unused for longer than the default 30 minutes", () => {
    expect(findTabsToSleep(state, awakeTabIds, [inUseTab], now)).toEqual([idleTab]);
  });

  it("never puts a page in use (on screen, playing sound, in picture-in-picture) or a Favorite to sleep", () => {
    const result = findTabsToSleep(state, awakeTabIds, [inUseTab], now);
    expect(result).not.toContain(inUseTab);
    expect(result).not.toContain(favoriteTab);
  });

  it("only looks at pages that are awake", () => {
    expect(findTabsToSleep(state, [recentTab, inUseTab], [inUseTab], now)).toEqual([]);
  });

  it("follows the setting, and Never keeps every page awake", () => {
    const sooner = setTabSleepAfter(state, 15 * MINUTE_MS);
    expect(findTabsToSleep(sooner, awakeTabIds, [inUseTab], now)).toEqual([idleTab, recentTab]);
    const never = setTabSleepAfter(state, null);
    expect(findTabsToSleep(never, awakeTabIds, [], now)).toEqual([]);
  });

  it("skips ids that are not tabs", () => {
    expect(findTabsToSleep(state, ["no-such-tab"], [], now)).toEqual([]);
  });
});

describe("the Sleep unused tabs after setting", () => {
  const { state } = openTabs(["https://a.example/"]);

  it("is 30 minutes when it was never set", () => {
    expect(readTabSleepAfter(state.settings)).toBe(DEFAULT_TAB_SLEEP_AFTER_MS);
  });

  it("returns the same state when the value does not change", () => {
    expect(setTabSleepAfter(state, DEFAULT_TAB_SLEEP_AFTER_MS)).toBe(state);
    const never = setTabSleepAfter(state, null);
    expect(readTabSleepAfter(never.settings)).toBeNull();
    expect(setTabSleepAfter(never, null)).toBe(never);
  });
});

describe("keeping pages awake", () => {
  const { state: builtState, tabIds } = openTabs(["https://mail.example.com/inbox", "https://news.example.org/", "https://docs.example.net/"]);
  const [mailTab, newsTab, favoriteTab] = tabIds as [ItemId, ItemId, ItemId];
  const now = ONE_PM + 10 * 60 * MINUTE_MS;
  const longAgo = now - 5 * DEFAULT_TAB_SLEEP_AFTER_MS;
  let state = lastUsedAt(lastUsedAt(builtState, mailTab, longAgo), newsTab, longAgo);
  state = makeFavorite(lastUsedAt(state, favoriteTab, longAgo), favoriteTab);
  const awakeTabIds = [mailTab, newsTab, favoriteTab];

  it("a site on the Keep Awake list never sleeps by itself, on any of its addresses", () => {
    const kept = setSiteKeptAwake(state, "example.com", true);
    expect(isKeptAwake(kept, "https://mail.example.com/other")).toBe(true);
    expect(findTabsToSleep(kept, awakeTabIds, [], now)).toEqual([newsTab]);
  });

  it("taking a site off the list lets it sleep again, and repeating a change changes nothing", () => {
    const kept = setSiteKeptAwake(state, "example.com", true);
    expect(setSiteKeptAwake(kept, "example.com", true)).toBe(kept);
    const released = setSiteKeptAwake(kept, "example.com", false);
    expect(findTabsToSleep(released, awakeTabIds, [], now)).toEqual([mailTab, newsTab]);
  });

  it("Favorites stay awake unless that is turned off", () => {
    expect(findTabsToSleep(state, awakeTabIds, [], now)).not.toContain(favoriteTab);
    const favoritesMaySleep = setFavoritesKeptAwake(state, false);
    expect(findTabsToSleep(favoritesMaySleep, awakeTabIds, [], now)).toContain(favoriteTab);
    expect(setFavoritesKeptAwake(state, true)).toBe(state);
  });

  it("Sleep Other Tabs may put recently used pages to sleep, but not pages in use or kept awake", () => {
    const recent = lastUsedAt(setSiteKeptAwake(state, "example.net", true), newsTab, now);
    expect(findTabsAllowedToSleep(recent, awakeTabIds, [mailTab])).toEqual([newsTab]);
  });
});
