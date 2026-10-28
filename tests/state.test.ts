/**
 * WHY this file exists:
 *   Every sidebar action goes through state.ts, so these tests guard the rules the user sees.
 */
import { describe, expect, it } from "vitest";
import {
  addPageToArchive,
  addToFavorites,
  clearTodayTabs,
  closeTab,
  createFolder,
  createInitialState,
  deleteItem,
  duplicateTab,
  findNeighbourTabId,
  findTabIdByNumber,
  getSelectedTabId,
  listVisibleTabIds,
  moveItem,
  moveTabsToArchive,
  openTab,
  pinTab,
  renameItem,
  resetPinnedTab,
  resetPinnedTabs,
  restoreArchivedTab,
  restoreLastArchivedTab,
  selectTab,
  setSidebarWidth,
  toggleFolder,
  unpinTab,
  updateTabPage,
  setAdBlock,
  setSearchEngine,
  setAdBlockForSite,
  setAppIcon,
} from "../src/main/state";
import { findLocation, findTab } from "../src/main/tree";
import { getSiteKey, isSameSite, normalizeTypedInput } from "../src/main/urls";
import { findSearchEngine } from "../src/shared/searchEngines";
import { DEFAULT_PROFILE_ID, FAVORITES_LIMIT, HOUR_MS, SIDEBAR_MAX_WIDTH_PX, SIDEBAR_MIN_WIDTH_PX } from "../src/shared/settings";
import type { BrowserState, ItemId, TabItem } from "../src/shared/types";
import { getPinnedIds, getTab, getTodayIds, ONE_PM, openPinnedTabs, openTabs, PERSONAL_SPACE_ID, WORK_SPACE_ID } from "./builders";

const TWO_PM = ONE_PM + 1 * HOUR_MS;
const THREE_PM = ONE_PM + 2 * HOUR_MS;
const FOUR_PM = ONE_PM + 3 * HOUR_MS;
const FIVE_PM = ONE_PM + 4 * HOUR_MS;

/** Returns the newest folder's id in the active Space's Pinned list. */
function getLastPinnedId(state: BrowserState): ItemId {
  const pinnedIds = getPinnedIds(state, state.activeSpaceId);
  return pinnedIds[pinnedIds.length - 1] as ItemId;
}

describe("openTab", () => {
  it("adds a tab at the top of the active Space's Today list and selects it", () => {
    const { state, tabIds } = openTabs(["https://a.example", "https://b.example"]);

    expect(getTodayIds(state)).toEqual([tabIds[1], tabIds[0]]);
    expect(getSelectedTabId(state)).toBe(tabIds[1]);
    expect(getTab(state, tabIds[0] as ItemId).homeUrl).toBeNull();
  });

  it("can open a tab in the background without taking the selection", () => {
    const { state: withTab, tabIds } = openTabs(["https://a.example"]);

    const state = openTab(withTab, "https://b.example", TWO_PM, { select: false });

    expect(getTodayIds(state)).toHaveLength(2);
    expect(getSelectedTabId(state)).toBe(tabIds[0]);
  });
});

describe("selectTab", () => {
  it("sets lastActiveAt on both the tab you leave and the tab you open", () => {
    const { state: withTabs, tabIds } = openTabs(["https://a.example", "https://b.example"]);

    const state = selectTab(withTabs, tabIds[0] as ItemId, THREE_PM);

    expect(getTab(state, tabIds[0] as ItemId).lastActiveAt).toBe(THREE_PM);
    expect(getTab(state, tabIds[1] as ItemId).lastActiveAt).toBe(THREE_PM);
    expect(getSelectedTabId(state)).toBe(tabIds[0]);
  });

  it("switches to the tab's Space when it lives in another Space", () => {
    const { state: withTab, tabIds } = openTabs(["https://a.example"]);
    const inWork: BrowserState = { ...withTab, activeSpaceId: WORK_SPACE_ID };

    const state = selectTab(inWork, tabIds[0] as ItemId, TWO_PM);

    expect(state.activeSpaceId).toBe(PERSONAL_SPACE_ID);
  });

  it("shows a Favorite in the active Space, because Favorites belong to the profile", () => {
    const { state: withTab, tabIds } = openTabs(["https://mail.example"]);
    const favoriteState = addToFavorites(withTab, tabIds[0] as ItemId);
    const inWork: BrowserState = { ...favoriteState, activeSpaceId: WORK_SPACE_ID };

    const state = selectTab(inWork, tabIds[0] as ItemId, TWO_PM);

    expect(state.activeSpaceId).toBe(WORK_SPACE_ID);
    expect(state.selectedTabIdBySpace[WORK_SPACE_ID]).toBe(tabIds[0]);
  });
});

describe("updateTabPage", () => {
  it("falls back to the URL when the page has no title, and returns the same state when nothing changed", () => {
    const { state: withTab, tabIds } = openTabs(["https://a.example"]);
    const tabId = tabIds[0] as ItemId;

    const state = updateTabPage(withTab, tabId, "https://a.example/page", "  ");

    expect(getTab(state, tabId).title).toBe("https://a.example/page");
    expect(updateTabPage(state, tabId, "https://a.example/page", "")).toBe(state);
  });
});

describe("pinTab / unpinTab", () => {
  it("pinning moves the tab to the bottom of Pinned and stores its URL as the home URL", () => {
    const { state: withTabs, tabIds } = openTabs(["https://mail.example.com/inbox", "https://b.example"]);
    const pinnedFirst = pinTab(withTabs, tabIds[1] as ItemId);

    const state = pinTab(pinnedFirst, tabIds[0] as ItemId);

    expect(getPinnedIds(state)).toEqual([tabIds[1], tabIds[0]]);
    expect(getTodayIds(state)).toEqual([]);
    expect(getTab(state, tabIds[0] as ItemId).homeUrl).toBe("https://mail.example.com/inbox");
  });

  it("unpinning moves the tab to the top of Today with a fresh lastActiveAt and no home URL", () => {
    const { state: withPinned, tabIds } = openPinnedTabs(["https://a.example"]);
    const { state: withBoth } = openTabs(["https://b.example"], withPinned);

    const state = unpinTab(withBoth, tabIds[0] as ItemId, FIVE_PM);

    const unpinnedTab = getTab(state, tabIds[0] as ItemId);
    expect(getTodayIds(state)[0]).toBe(tabIds[0]);
    expect(unpinnedTab.homeUrl).toBeNull();
    expect(unpinnedTab.lastActiveAt).toBe(FIVE_PM);
  });
});

describe("addToFavorites", () => {
  it("moves the tab into its profile's Favorites with a home URL", () => {
    const { state: withTab, tabIds } = openTabs(["https://music.example"]);

    const state = addToFavorites(withTab, tabIds[0] as ItemId);

    expect(state.profiles[0]?.favoriteIds).toEqual([tabIds[0]]);
    expect(getTodayIds(state)).toEqual([]);
    expect(getTab(state, tabIds[0] as ItemId).homeUrl).toBe("https://music.example");
  });

  it(`refuses a ${FAVORITES_LIMIT + 1}th Favorite, like Arc`, () => {
    const urls = Array.from({ length: FAVORITES_LIMIT + 1 }, (_value, index) => `https://site${index}.example`);
    const { state: withTabs, tabIds } = openTabs(urls);
    let state = withTabs;
    for (const tabId of tabIds) {
      state = addToFavorites(state, tabId);
    }

    expect(state.profiles[0]?.favoriteIds).toHaveLength(FAVORITES_LIMIT);
    expect(findLocation(state, tabIds[FAVORITES_LIMIT] as ItemId)?.kind).toBe("today");
  });
});

describe("folders and moveItem", () => {
  it("creates an open folder at the bottom of Pinned and renames it", () => {
    const created = createFolder(createInitialState(), "Reading", ONE_PM);
    const folderId = getLastPinnedId(created);

    const state = renameItem(created, folderId, "  Articles ");

    const folder = state.items[folderId];
    expect(folder?.kind === "folder" && folder.title).toBe("Articles");
    expect(folder?.kind === "folder" && folder.isOpen).toBe(true);
  });

  it("moving a Today tab into a folder gives it a home URL; moving it back to Today removes it", () => {
    const { state: withTab, tabIds } = openTabs(["https://docs.example"]);
    const withFolder = createFolder(withTab, "Work", TWO_PM);
    const folderId = getLastPinnedId(withFolder);
    const tabId = tabIds[0] as ItemId;

    const inFolder = moveItem(withFolder, tabId, { kind: "folder", folderId: folderId }, 0, THREE_PM);
    const backInToday = moveItem(inFolder, tabId, { kind: "today", spaceId: PERSONAL_SPACE_ID }, 0, FOUR_PM);

    expect(getTab(inFolder, tabId).homeUrl).toBe("https://docs.example");
    expect(getTab(backInToday, tabId).homeUrl).toBeNull();
    expect(getTab(backInToday, tabId).lastActiveAt).toBe(FOUR_PM);
  });

  it("refuses to put a folder inside itself or into Today", () => {
    const outerState = createFolder(createInitialState(), "Outer", ONE_PM);
    const outerId = getLastPinnedId(outerState);
    const bothState = createFolder(outerState, "Inner", TWO_PM);
    const innerId = getLastPinnedId(bothState);
    const nested = moveItem(bothState, innerId, { kind: "folder", folderId: outerId }, 0, THREE_PM);

    expect(moveItem(nested, outerId, { kind: "folder", folderId: innerId }, 0, FOUR_PM)).toBe(nested);
    expect(moveItem(nested, outerId, { kind: "today", spaceId: PERSONAL_SPACE_ID }, 0, FOUR_PM)).toBe(nested);
  });

  it("listVisibleTabIds skips tabs inside closed folders", () => {
    const { state: withTabs, tabIds } = openPinnedTabs(["https://a.example", "https://b.example"]);
    const withFolder = createFolder(withTabs, "Folder", THREE_PM);
    const folderId = getLastPinnedId(withFolder);
    const filled = moveItem(withFolder, tabIds[1] as ItemId, { kind: "folder", folderId: folderId }, 0, FOUR_PM);

    const closed = toggleFolder(filled, folderId);

    expect(listVisibleTabIds(filled)).toEqual([tabIds[0], tabIds[1]]);
    expect(listVisibleTabIds(closed)).toEqual([tabIds[0]]);
  });
});

describe("moveTabsToArchive / closeTab", () => {
  it("removes the tabs and adds archive entries with the reason and the Space they left", () => {
    const { state: withTabs, tabIds } = openTabs(["https://a.example", "https://b.example"]);

    const state = moveTabsToArchive(withTabs, [tabIds[0] as ItemId], THREE_PM, "auto");

    expect(findTab(state, tabIds[0] as ItemId)).toBeUndefined();
    expect(state.archive[0]?.tab.id).toBe(tabIds[0]);
    expect(state.archive[0]?.reason).toBe("auto");
    expect(state.archive[0]?.fromSpaceId).toBe(PERSONAL_SPACE_ID);
    expect(state.archive[0]?.archivedAt).toBe(THREE_PM);
  });

  it("selects the most recently used tab in the Space when the selected tab is closed", () => {
    // Opening a tab marks the one you leave as used at that moment: A is left at 2 PM, B at 3 PM, C is selected.
    const { state: withTabs, tabIds } = openTabs(["https://a.example", "https://b.example", "https://c.example"]);

    const state = closeTab(withTabs, tabIds[2] as ItemId, FOUR_PM);

    expect(getSelectedTabId(state)).toBe(tabIds[1]);
  });

  it("resetPinnedTab keeps the tab, sends it home and moves the selection away", () => {
    const { state: withPinned, tabIds } = openPinnedTabs(["https://mail.example/inbox"]);
    const pinnedTabId = tabIds[0] as ItemId;
    const navigated = updateTabPage(withPinned, pinnedTabId, "https://mail.example/message/42", "Message");
    const { state: withToday, tabIds: todayIds } = openTabs(["https://news.example"], navigated);
    const selectedPinned = selectTab(withToday, pinnedTabId, FOUR_PM);

    const state = resetPinnedTab(selectedPinned, pinnedTabId);

    expect(getTab(state, pinnedTabId).url).toBe("https://mail.example/inbox");
    expect(getPinnedIds(state)).toEqual([pinnedTabId]);
    expect(getSelectedTabId(state)).toBe(todayIds[0]);
  });

  it("resetPinnedTabs sends a pinned split's tabs home and moves the selection off both", () => {
    const { state: withPinned, tabIds } = openPinnedTabs(["https://mail.example/inbox", "https://calendar.example/week"]);
    const mailTabId = tabIds[0] as ItemId;
    const calendarTabId = tabIds[1] as ItemId;
    const navigated = updateTabPage(withPinned, mailTabId, "https://mail.example/message/42", "Message");
    const { state: withToday, tabIds: todayIds } = openTabs(["https://news.example"], navigated);
    // The calendar was used last, so a one-by-one reset of the mail tab would select it.
    const usedBoth = selectTab(selectTab(withToday, mailTabId, THREE_PM), calendarTabId, FOUR_PM);
    const selectedMail = selectTab(usedBoth, mailTabId, FOUR_PM + 1);

    const state = resetPinnedTabs(selectedMail, [mailTabId, calendarTabId]);

    expect(getTab(state, mailTabId).url).toBe("https://mail.example/inbox");
    expect(getTab(state, calendarTabId).url).toBe("https://calendar.example/week");
    expect(getSelectedTabId(state)).toBe(todayIds[0]);
    expect(resetPinnedTabs(state, [mailTabId, calendarTabId])).toBe(state);
  });

  it("deleting a folder archives every tab inside it", () => {
    const { state: withTabs, tabIds } = openPinnedTabs(["https://a.example", "https://b.example"]);
    const withFolder = createFolder(withTabs, "Folder", THREE_PM);
    const folderId = getLastPinnedId(withFolder);
    let filled = withFolder;
    for (const tabId of tabIds) {
      filled = moveItem(filled, tabId, { kind: "folder", folderId: folderId }, 0, FOUR_PM);
    }

    const state = deleteItem(filled, folderId, FIVE_PM);

    expect(state.items[folderId]).toBeUndefined();
    expect(getPinnedIds(state)).toEqual([]);
    expect(state.archive.map((entry) => entry.tab.id).sort()).toEqual([...tabIds].sort());
  });

  it("Clear archives the active Space's Today tabs and keeps Pinned ones", () => {
    const { state: withPinned } = openPinnedTabs(["https://pinned.example"]);
    const { state: withToday } = openTabs(["https://a.example", "https://b.example"], withPinned);

    const state = clearTodayTabs(withToday, FIVE_PM);

    expect(getTodayIds(state)).toEqual([]);
    expect(getPinnedIds(state)).toHaveLength(1);
    expect(state.archive.every((entry) => entry.reason === "clear-button")).toBe(true);
  });
});

describe("restoreArchivedTab", () => {
  it("puts the tab back at the top of the Space it left and selects it", () => {
    const { state: withTab, tabIds } = openTabs(["https://a.example"]);
    const tabId = tabIds[0] as ItemId;
    const archived = closeTab(withTab, tabId, TWO_PM);
    const inWork: BrowserState = { ...archived, activeSpaceId: WORK_SPACE_ID };

    const state = restoreArchivedTab(inWork, tabId, THREE_PM);

    expect(getTodayIds(state, PERSONAL_SPACE_ID)[0]).toBe(tabId);
    expect(state.activeSpaceId).toBe(PERSONAL_SPACE_ID);
    expect(getTab(state, tabId).lastActiveAt).toBe(THREE_PM);
    expect(state.archive).toHaveLength(0);
  });

  it("falls back to the active Space when the tab's Space was deleted", () => {
    const orphanTab: TabItem = {
      kind: "tab",
      id: "tab-orphan",
      url: "https://a.example",
      title: "A",
      customTitle: null,
      faviconUrl: null,
      homeUrl: null,
      lastActiveAt: ONE_PM,
      isMuted: false,
    };
    const initialState = createInitialState();
    const archived: BrowserState = {
      ...initialState,
      archive: [{ tab: orphanTab, fromSpaceId: "space-deleted", archivedAt: TWO_PM, reason: "manual" }],
    };

    const state = restoreArchivedTab(archived, "tab-orphan", THREE_PM);

    expect(getTodayIds(state, initialState.activeSpaceId)).toEqual(["tab-orphan"]);
  });

  it("restoreLastArchivedTab brings back the newest entry (⇧⌘T)", () => {
    const { state: withTabs, tabIds } = openTabs(["https://a.example", "https://b.example"]);
    const closedFirst = closeTab(withTabs, tabIds[0] as ItemId, THREE_PM);
    const closedBoth = closeTab(closedFirst, tabIds[1] as ItemId, FOUR_PM);

    const state = restoreLastArchivedTab(closedBoth, FIVE_PM);

    expect(getTodayIds(state)).toEqual([tabIds[1]]);
  });
});

describe("duplicateTab", () => {
  it("puts a copy right below a Today tab and selects it", () => {
    const { state: withTabs, tabIds } = openTabs(["https://a.example", "https://b.example"]);

    const state = duplicateTab(withTabs, tabIds[1] as ItemId, THREE_PM);

    const todayIds = getTodayIds(state);
    expect(todayIds).toHaveLength(3);
    expect(todayIds[0]).toBe(tabIds[1]);
    expect(getTab(state, todayIds[1] as ItemId).url).toBe("https://b.example");
    expect(getSelectedTabId(state)).toBe(todayIds[1]);
  });
});

describe("createInitialState", () => {
  it("starts with one profile shared by both Spaces", () => {
    const state = createInitialState();

    expect(state.profiles.map((profile) => profile.id)).toEqual([DEFAULT_PROFILE_ID]);
    expect(state.spaces.every((space) => space.profileId === DEFAULT_PROFILE_ID)).toBe(true);
  });
});

describe("normalizeTypedInput", () => {
  it("adds https:// to a bare address", () => {
    expect(normalizeTypedInput("example.com", findSearchEngine(undefined))).toBe("https://example.com");
  });

  it("turns plain words into a search URL of the chosen engine (DuckDuckGo until one is chosen)", () => {
    expect(normalizeTypedInput("best pizza", findSearchEngine(undefined))).toBe("https://duckduckgo.com/?q=best%20pizza");
    expect(normalizeTypedInput("best pizza", findSearchEngine("google"))).toBe("https://www.google.com/search?q=best%20pizza");
  });
});

describe("search engine setting", () => {
  it("is DuckDuckGo until another engine is chosen, and leaves the state alone when nothing changes", () => {
    const state = createInitialState();
    const withGoogle = setSearchEngine(state, "google");

    expect(findSearchEngine(state.settings.searchEngine).id).toBe("duckduckgo");
    expect(withGoogle.settings.searchEngine).toBe("google");
    expect(setSearchEngine(state, "duckduckgo")).toBe(state);
    expect(setSearchEngine(withGoogle, "google")).toBe(withGoogle);
  });

  it("falls back to the default for an engine this version does not know", () => {
    expect(findSearchEngine("altavista").id).toBe("duckduckgo");
  });
});

describe("moveItem within one list", () => {
  it("uses positions as seen before the move, so dropping below the next row moves down by one", () => {
    // Today shows [C, B, A].
    const { state: withTabs, tabIds } = openTabs(["https://a.example", "https://b.example", "https://c.example"]);
    const today = { kind: "today" as const, spaceId: PERSONAL_SPACE_ID };

    const movedDown = moveItem(withTabs, tabIds[2] as ItemId, today, 2, FIVE_PM);
    const toTheEnd = moveItem(withTabs, tabIds[2] as ItemId, today, -1, FIVE_PM);

    expect(getTodayIds(movedDown)).toEqual([tabIds[1], tabIds[2], tabIds[0]]);
    expect(getTodayIds(toTheEnd)).toEqual([tabIds[1], tabIds[0], tabIds[2]]);
    expect(moveItem(withTabs, tabIds[2] as ItemId, today, 1, FIVE_PM)).toBe(withTabs);
  });
});

describe("tab shortcuts", () => {
  it("cycles through visible tabs with wrap-around, and ⌘9 means the last tab", () => {
    // Today shows [C, B, A] with C selected.
    const { state, tabIds } = openTabs(["https://a.example", "https://b.example", "https://c.example"]);

    expect(findNeighbourTabId(state, 1)).toBe(tabIds[1]);
    expect(findNeighbourTabId(state, -1)).toBe(tabIds[0]);
    expect(findTabIdByNumber(state, 1)).toBe(tabIds[2]);
    expect(findTabIdByNumber(state, 9)).toBe(tabIds[0]);
    expect(findTabIdByNumber(state, 5)).toBeNull();
  });
});

describe("addPageToArchive", () => {
  it("archives a web page from outside the sidebar and ignores other pages", () => {
    const state = addPageToArchive(createInitialState(), { url: "https://news.example/", title: "News", faviconUrl: null }, ONE_PM, "auto");

    expect(state.archive[0]).toMatchObject({ fromSpaceId: null, reason: "auto", archivedAt: ONE_PM });
    expect(state.archive[0]?.tab.title).toBe("News");
    expect(addPageToArchive(state, { url: "about:blank", title: "", faviconUrl: null }, ONE_PM, "manual")).toBe(state);
  });
});

describe("sites (for Peek)", () => {
  it("treats subdomains of one registrable domain as the same site", () => {
    expect(getSiteKey("https://mail.google.com/mail")).toBe("google.com");
    expect(getSiteKey("https://news.bbc.co.uk/x")).toBe("bbc.co.uk");
    expect(getSiteKey("about:blank")).toBeNull();
    expect(isSameSite("https://mail.google.com/", "https://accounts.google.com/login")).toBe(true);
    expect(isSameSite("https://github.com/", "https://gist.github.com/")).toBe(true);
    expect(isSameSite("https://github.com/", "https://example.com/")).toBe(false);
  });
});

describe("unread dot (Arc's isUnread)", () => {
  it("marks a pinned tab whose title changes off screen, and clears it when the tab is opened", () => {
    const { state: withPinned, tabIds } = openPinnedTabs(["https://mail.example/inbox"]);
    const { state: withToday } = openTabs(["https://news.example"], withPinned);
    const pinnedTabId = tabIds[0] as ItemId;

    const unread = updateTabPage(withToday, pinnedTabId, "https://mail.example/inbox", "Inbox (3)", false);
    const read = selectTab(unread, pinnedTabId, FIVE_PM);

    expect(getTab(unread, pinnedTabId).isUnread).toBe(true);
    expect(getTab(read, pinnedTabId).isUnread).toBe(false);
  });

  it("does not mark Today tabs or tabs on screen", () => {
    const { state, tabIds } = openTabs(["https://news.example"]);

    const offScreenToday = updateTabPage(state, tabIds[0] as ItemId, "https://news.example", "News (2)", false);

    expect(getTab(offScreenToday, tabIds[0] as ItemId).isUnread).toBeFalsy();
  });
});

describe("setSidebarWidth", () => {
  it("keeps the width inside its limits", () => {
    expect(setSidebarWidth(createInitialState(), 50).settings.sidebarWidth).toBe(SIDEBAR_MIN_WIDTH_PX);
    expect(setSidebarWidth(createInitialState(), 900).settings.sidebarWidth).toBe(SIDEBAR_MAX_WIDTH_PX);
    expect(setSidebarWidth(createInitialState(), 300.4).settings.sidebarWidth).toBe(300);
  });
});

describe("ad blocking and app icon settings", () => {
  it("ad blocking is off until turned on, and can be turned off per site and back", () => {
    const on = setAdBlock(createInitialState(), true);
    const offForSite = setAdBlockForSite(on, "example.com", false);

    expect(createInitialState().settings.isAdBlockOn ?? false).toBe(false);
    expect(on.settings.isAdBlockOn).toBe(true);
    expect(offForSite.adBlockOffSites).toEqual(["example.com"]);
    expect(setAdBlockForSite(offForSite, "example.com", false)).toBe(offForSite);
    expect(setAdBlockForSite(offForSite, "example.com", true).adBlockOffSites).toEqual([]);
  });

  it("remembers the chosen app icon, Glass by default", () => {
    const state = createInitialState();

    expect(setAppIcon(state, "glass")).toBe(state);
    expect(setAppIcon(state, "pixel").settings.appIcon).toBe("pixel");
  });
});
