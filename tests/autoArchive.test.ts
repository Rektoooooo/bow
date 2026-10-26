/**
 * WHY this file exists:
 *   Auto-archive removes things from the user's sidebar, so its rules need proof.
 *   Each test below is one rule from autoArchive.ts.
 */
import { describe, expect, it } from "vitest";
import { findTabsToArchive, getInactiveDurationMs, pruneArchive } from "../src/main/autoArchive";
import { addToFavorites, createInitialState, pinTab } from "../src/main/state";
import { splitTabs } from "../src/main/split";
import { ARCHIVE_RETENTION_MS, DAY_MS, HOUR_MS } from "../src/shared/settings";
import type { ArchivedTab, BrowserState, ItemId, TabItem } from "../src/shared/types";

const NINE_AM = Date.UTC(2026, 9, 26, 9, 0, 0);
const TEN_AM = NINE_AM + 1 * HOUR_MS;
const ELEVEN_AM = NINE_AM + 2 * HOUR_MS;
const TWELVE_HOURS_MS = 12 * HOUR_MS;

/** A launch time long before every test's events, for tests that are not about launch. */
const LAUNCHED_LONG_AGO = NINE_AM - 30 * DAY_MS;

/** Builds a Today tab last used at the given time. Each test changes only what it is about. */
function makeTab(lastActiveAt: number, changes: Partial<TabItem> = {}): TabItem {
  const baseTab: TabItem = {
    kind: "tab",
    id: "tab-1",
    url: "https://example.com",
    title: "Example",
    customTitle: null,
    faviconUrl: null,
    homeUrl: null,
    lastActiveAt: lastActiveAt,
    isMuted: false,
  };
  return { ...baseTab, ...changes };
}

/** Builds a state whose Personal Today list holds exactly these tabs, with a 12-hour threshold unless the test picks another. */
function makeStateWithTabs(tabs: TabItem[], archiveAfterMs: number | null = TWELVE_HOURS_MS): BrowserState {
  const initialState = createInitialState();
  const items: BrowserState["items"] = {};
  for (const tab of tabs) {
    items[tab.id] = tab;
  }
  const todayIds: ItemId[] = tabs.map((tab) => tab.id);
  const spaces = initialState.spaces.map((space, index) => (index === 0 ? { ...space, todayIds: todayIds } : space));
  return { ...initialState, items: items, spaces: spaces, settings: { ...initialState.settings, archiveAfterMs: archiveAfterMs } };
}

describe("getInactiveDurationMs", () => {
  it("counts from lastActiveAt when the tab was used after launch", () => {
    const tab = makeTab(TEN_AM);

    const inactiveDurationMs = getInactiveDurationMs(tab, ELEVEN_AM, NINE_AM);

    expect(inactiveDurationMs).toBe(1 * HOUR_MS);
  });

  it("counts from launch time when the tab was last used before launch", () => {
    const tab = makeTab(NINE_AM);

    const inactiveDurationMs = getInactiveDurationMs(tab, ELEVEN_AM, TEN_AM);

    expect(inactiveDurationMs).toBe(1 * HOUR_MS);
  });
});

describe("findTabsToArchive", () => {
  it("archives an unpinned tab unused for longer than the threshold", () => {
    const state = makeStateWithTabs([makeTab(NINE_AM)]);
    const now = NINE_AM + 13 * HOUR_MS;

    const tabIds = findTabsToArchive(state, now, LAUNCHED_LONG_AGO, []);

    expect(tabIds).toEqual(["tab-1"]);
  });

  it("keeps an unpinned tab unused for less than the threshold", () => {
    const state = makeStateWithTabs([makeTab(NINE_AM)]);
    const now = NINE_AM + 11 * HOUR_MS;

    const tabIds = findTabsToArchive(state, now, LAUNCHED_LONG_AGO, []);

    expect(tabIds).toEqual([]);
  });

  it("never archives a Pinned tab or a Favorite, however old", () => {
    const oldTab = makeTab(NINE_AM - 20 * DAY_MS);
    const otherOldTab = makeTab(NINE_AM - 20 * DAY_MS, { id: "tab-2" });
    const withTabs = makeStateWithTabs([oldTab, otherOldTab]);
    const state = addToFavorites(pinTab(withTabs, "tab-1"), "tab-2");

    const tabIds = findTabsToArchive(state, NINE_AM, LAUNCHED_LONG_AGO, []);

    expect(tabIds).toEqual([]);
  });

  it("archives the old tabs inside a Today split view", () => {
    const oldTab = makeTab(NINE_AM - 2 * DAY_MS);
    const otherOldTab = makeTab(NINE_AM - 2 * DAY_MS, { id: "tab-2" });
    const state = splitTabs(makeStateWithTabs([oldTab, otherOldTab]), "tab-1", "tab-2", NINE_AM - 2 * DAY_MS);

    const tabIds = findTabsToArchive(state, NINE_AM, LAUNCHED_LONG_AGO, []);

    expect(tabIds.sort()).toEqual(["tab-1", "tab-2"]);
  });

  it("never archives a tab that is in use right now", () => {
    const state = makeStateWithTabs([makeTab(NINE_AM)]);
    const now = NINE_AM + 13 * HOUR_MS;

    const tabIds = findTabsToArchive(state, now, LAUNCHED_LONG_AGO, ["tab-1"]);

    expect(tabIds).toEqual([]);
  });

  it("archives nothing when the setting is Never", () => {
    const state = makeStateWithTabs([makeTab(NINE_AM - 20 * DAY_MS)], null);

    const tabIds = findTabsToArchive(state, NINE_AM, LAUNCHED_LONG_AGO, []);

    expect(tabIds).toEqual([]);
  });

  it("does not archive everything right after launch when the Mac was off for a week", () => {
    const tabFromLastWeek = makeTab(NINE_AM - 7 * DAY_MS);
    const state = makeStateWithTabs([tabFromLastWeek]);
    const launchedAt = NINE_AM;
    const oneHourAfterLaunch = NINE_AM + 1 * HOUR_MS;

    const tabIds = findTabsToArchive(state, oneHourAfterLaunch, launchedAt, []);

    expect(tabIds).toEqual([]);
  });
});

describe("pruneArchive", () => {
  /** Builds an archive entry archived at the given time. */
  function makeArchiveEntry(id: string, archivedAt: number): ArchivedTab {
    return { tab: makeTab(archivedAt, { id: id }), fromSpaceId: null, archivedAt: archivedAt, reason: "auto" };
  }

  it("removes archive entries older than the retention period", () => {
    const now = NINE_AM;
    const oldEntry = makeArchiveEntry("tab-old", now - ARCHIVE_RETENTION_MS - DAY_MS);
    const recentEntry = makeArchiveEntry("tab-recent", now - DAY_MS);
    const state: BrowserState = { ...createInitialState(), archive: [recentEntry, oldEntry] };

    const prunedState = pruneArchive(state, now);

    expect(prunedState.archive).toEqual([recentEntry]);
  });

  it("keeps archive entries inside the retention period and returns the same state", () => {
    const now = NINE_AM;
    const recentEntry = makeArchiveEntry("tab-recent", now - DAY_MS);
    const state: BrowserState = { ...createInitialState(), archive: [recentEntry] };

    const prunedState = pruneArchive(state, now);

    expect(prunedState).toBe(state);
  });
});
