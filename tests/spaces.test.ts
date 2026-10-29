/**
 * WHY this file exists:
 *   Spaces hold the user's work; deleting or moving between them must never lose a tab silently.
 */
import { describe, expect, it } from "vitest";
import {
  createProfile,
  createSpace,
  deleteSpace,
  moveItemToSpace,
  moveSpace,
  removeEmptySpaces,
  renameSpace,
  setSpaceProfile,
  SPACES_LIMIT,
  switchSpaceByNumber,
  switchSpaceByOffset,
} from "../src/main/spaces";
import { addToFavorites, createInitialState, getSelectedTabId, setSpaceNewTabUrl, setSpaceSearchEngine } from "../src/main/state";
import { rankCommandBarResults } from "../src/main/commandBar";
import { findSpaceSearchEngine } from "../src/shared/searchEngines";
import { FAVORITES_LIMIT, HOUR_MS } from "../src/shared/settings";
import type { BrowserState, ItemId, SpaceTheme } from "../src/shared/types";
import { getPinnedIds, getTodayIds, ONE_PM, openPinnedTabs, openTabs, PERSONAL_SPACE_ID, WORK_SPACE_ID } from "./builders";

const TWO_PM = ONE_PM + 1 * HOUR_MS;
const THEME: SpaceTheme = { colors: ["#c8e6c9"], appearance: "auto", grain: 0.2 };

describe("switching Spaces", () => {
  it("moves by offset and stops at the ends", () => {
    const state = createInitialState();

    const next = switchSpaceByOffset(state, 1, ONE_PM);
    const pastTheEnd = switchSpaceByOffset(next, 1, TWO_PM);

    expect(next.activeSpaceId).toBe(WORK_SPACE_ID);
    expect(pastTheEnd).toBe(next);
  });

  it("jumps by number (⌃1 … ⌃9) and ignores numbers without a Space", () => {
    const state = createInitialState();

    expect(switchSpaceByNumber(state, 2, ONE_PM).activeSpaceId).toBe(WORK_SPACE_ID);
    expect(switchSpaceByNumber(state, 7, ONE_PM)).toBe(state);
  });
});

describe("createSpace / renameSpace / moveSpace", () => {
  it("adds a Space at the end with the active Space's profile and switches to it", () => {
    const state = createSpace(createInitialState(), { name: " Side project ", icon: "🚀", theme: THEME }, ONE_PM);

    const newSpace = state.spaces[2];
    expect(newSpace?.name).toBe("Side project");
    expect(newSpace?.profileId).toBe(state.spaces[0]?.profileId);
    expect(state.activeSpaceId).toBe(newSpace?.id);
    expect(state.selectedTabIdBySpace[newSpace?.id as string]).toBeNull();
  });

  it(`refuses more than ${SPACES_LIMIT} Spaces`, () => {
    let state = createInitialState();
    for (let count = 0; count < SPACES_LIMIT + 2; count++) {
      state = createSpace(state, { name: `Space ${count}`, icon: "", theme: THEME }, ONE_PM + count);
    }

    expect(state.spaces).toHaveLength(SPACES_LIMIT);
  });

  it("ignores an empty name and reorders Spaces", () => {
    const state = createInitialState();

    expect(renameSpace(state, PERSONAL_SPACE_ID, "   ")).toBe(state);
    expect(moveSpace(state, WORK_SPACE_ID, 0).spaces.map((space) => space.id)).toEqual([WORK_SPACE_ID, PERSONAL_SPACE_ID]);
  });
});

describe("deleteSpace", () => {
  it("archives the Space's tabs, removes it and activates its neighbour", () => {
    const { state: withPinned } = openPinnedTabs(["https://a.example"]);
    const { state: withToday } = openTabs(["https://b.example"], withPinned);

    const state = deleteSpace(withToday, PERSONAL_SPACE_ID, TWO_PM);

    expect(state.spaces.map((space) => space.id)).toEqual([WORK_SPACE_ID]);
    expect(state.activeSpaceId).toBe(WORK_SPACE_ID);
    expect(state.archive).toHaveLength(2);
    expect(Object.keys(state.items)).toEqual([]);
    expect(state.selectedTabIdBySpace[PERSONAL_SPACE_ID]).toBeUndefined();
  });

  it("archives the Space's Favorites with its other tabs and leaves another Space's row alone", () => {
    const { state: withTabs, tabIds } = openTabs(["https://a.example", "https://b.example"]);
    const favoriteState = addToFavorites(addToFavorites(withTabs, tabIds[0] as ItemId), tabIds[1] as ItemId);
    const workTab = openTabs(["https://c.example"], { ...favoriteState, activeSpaceId: WORK_SPACE_ID });
    const withWorkFavorite = addToFavorites(workTab.state, workTab.tabIds[0] as ItemId);

    const state = deleteSpace(withWorkFavorite, PERSONAL_SPACE_ID, TWO_PM);

    expect(state.archive.map((entry) => entry.tab.id).sort()).toEqual([...tabIds].sort());
    expect(state.archive.every((entry) => entry.fromSpaceId === PERSONAL_SPACE_ID)).toBe(true);
    expect(state.spaces[0]?.favoriteIds).toEqual(workTab.tabIds);
  });

  it("never deletes the last Space", () => {
    const onlyOne = deleteSpace(createInitialState(), WORK_SPACE_ID, ONE_PM);

    expect(deleteSpace(onlyOne, PERSONAL_SPACE_ID, TWO_PM)).toBe(onlyOne);
  });
});

describe("moveItemToSpace", () => {
  it("keeps the section: a Pinned tab stays Pinned and a Today tab stays Today", () => {
    const { state: withPinned, tabIds: pinnedIds } = openPinnedTabs(["https://a.example"]);
    const { state: withToday, tabIds: todayIds } = openTabs(["https://b.example"], withPinned);

    const movedPinned = moveItemToSpace(withToday, pinnedIds[0] as ItemId, WORK_SPACE_ID);
    const state = moveItemToSpace(movedPinned, todayIds[0] as ItemId, WORK_SPACE_ID);

    expect(getPinnedIds(state, WORK_SPACE_ID)).toEqual(pinnedIds);
    expect(getTodayIds(state, WORK_SPACE_ID)).toEqual(todayIds);
    expect(getPinnedIds(state, PERSONAL_SPACE_ID)).toEqual([]);
  });

  it("makes a Favorite a Favorite of the target Space, or Pinned there when that row is full", () => {
    const { state: withTab, tabIds } = openTabs(["https://a.example"]);
    const favoriteState = addToFavorites(withTab, tabIds[0] as ItemId);

    const moved = moveItemToSpace(favoriteState, tabIds[0] as ItemId, WORK_SPACE_ID);
    const fullWorkRow = Array.from({ length: FAVORITES_LIMIT }, (_unused, index) => `full-${index}`);
    const fullState: BrowserState = { ...favoriteState, spaces: favoriteState.spaces.map((space) => (space.id === WORK_SPACE_ID ? { ...space, favoriteIds: fullWorkRow } : space)) };
    const movedToFullRow = moveItemToSpace(fullState, tabIds[0] as ItemId, WORK_SPACE_ID);

    expect(moved.spaces[0]?.favoriteIds).toEqual([]);
    expect(moved.spaces[1]?.favoriteIds).toEqual([tabIds[0]]);
    expect(moveItemToSpace(moved, tabIds[0] as ItemId, WORK_SPACE_ID)).toBe(moved);
    expect(getPinnedIds(movedToFullRow, WORK_SPACE_ID)).toEqual([tabIds[0]]);
    expect(movedToFullRow.spaces[1]?.favoriteIds).toEqual(fullWorkRow);
  });

  it("moves the selection when the selected tab leaves the Space", () => {
    const { state: withTabs, tabIds } = openTabs(["https://a.example", "https://b.example"]);
    const selectedBefore: BrowserState = withTabs;

    const state = moveItemToSpace(selectedBefore, tabIds[1] as ItemId, WORK_SPACE_ID);

    expect(getSelectedTabId(state)).toBe(tabIds[0]);
  });
});

describe("removeEmptySpaces", () => {
  it("removes only the listed Spaces that are empty, and never the last one", () => {
    const { state: withTab } = openTabs(["https://a.example"]);

    const state = removeEmptySpaces(withTab, [PERSONAL_SPACE_ID, WORK_SPACE_ID]);
    const onlyOneLeft = removeEmptySpaces(createInitialState(), [PERSONAL_SPACE_ID, WORK_SPACE_ID]);

    expect(state.spaces.map((space) => space.id)).toEqual([PERSONAL_SPACE_ID]);
    expect(onlyOneLeft.spaces).toHaveLength(1);
  });

  it("keeps a Space that holds only Favorites", () => {
    const { state: withTab, tabIds } = openTabs(["https://a.example"]);
    const withWorkFavorite: BrowserState = { ...withTab, spaces: withTab.spaces.map((space) => (space.id === WORK_SPACE_ID ? { ...space, favoriteIds: [tabIds[0] as ItemId] } : space)) };

    const state = removeEmptySpaces(withWorkFavorite, [WORK_SPACE_ID]);

    expect(state).toBe(withWorkFavorite);
  });
});

describe("profiles", () => {
  it("creates a profile and moves a Space to it; its Favorites stay with the Space", () => {
    const { state: withTab, tabIds } = openTabs(["https://mail.example"]);
    const withFavorite = addToFavorites(withTab, tabIds[0] as ItemId);
    const created = createProfile(withFavorite, "  ", ONE_PM);

    const state = setSpaceProfile(created.state, PERSONAL_SPACE_ID, created.profileId);

    expect(created.state.profiles.map((profile) => profile.name)).toEqual(["Default", "Profile 2"]);
    expect(state.spaces[0]?.profileId).toBe(created.profileId);
    expect(state.spaces[0]?.favoriteIds).toEqual([tabIds[0]]);
    expect(getSelectedTabId(state)).toBe(getSelectedTabId(withFavorite));
  });
});

describe("per-Space defaults", () => {
  it("a Space searches with its own engine, others with the one in Settings", () => {
    const state = setSpaceSearchEngine(createInitialState(ONE_PM), WORK_SPACE_ID, "google");
    expect(findSpaceSearchEngine(state, WORK_SPACE_ID).id).toBe("google");
    expect(findSpaceSearchEngine(state, PERSONAL_SPACE_ID).id).toBe("duckduckgo");
    expect(setSpaceSearchEngine(state, WORK_SPACE_ID, "google")).toBe(state);
    expect(setSpaceSearchEngine(state, WORK_SPACE_ID, "default").spaces.find((space) => space.id === WORK_SPACE_ID)?.searchEngine).toBeUndefined();
  });

  it("the Command Bar searches with the active Space's engine", () => {
    const state = setSpaceSearchEngine(createInitialState(ONE_PM), WORK_SPACE_ID, "google");
    const inWork = { ...state, activeSpaceId: WORK_SPACE_ID };
    const input = { query: "pizza", state: inWork, history: [], suggestions: [], actions: [], currentUrl: null, recentTabIds: [] };
    const searchLine = rankCommandBarResults(input, ONE_PM).find((result) => result.kind === "search");
    expect(searchLine?.subtitle).toBe("Search Google");
    expect(searchLine?.url?.startsWith("https://www.google.com/")).toBe(true);
  });

  it("a Space's new-tab page is a web page, or the Command Bar again", () => {
    const state = createInitialState(ONE_PM);
    const withPage = setSpaceNewTabUrl(state, WORK_SPACE_ID, "https://github.com/notifications");
    expect(withPage.spaces.find((space) => space.id === WORK_SPACE_ID)?.newTabUrl).toBe("https://github.com/notifications");
    expect(setSpaceNewTabUrl(state, WORK_SPACE_ID, "javascript:alert(1)")).toBe(state);
    expect(setSpaceNewTabUrl(withPage, WORK_SPACE_ID, null).spaces.find((space) => space.id === WORK_SPACE_ID)?.newTabUrl).toBeUndefined();
    expect(setSpaceNewTabUrl(state, WORK_SPACE_ID, null)).toBe(state);
  });
});

