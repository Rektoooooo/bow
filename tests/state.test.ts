/**
 * WHY this file exists:
 *   Every sidebar action goes through state.ts, so these tests guard the rules the user sees.
 */
import { describe, expect, it } from "vitest";
import {
  closeTab,
  createInitialState,
  findTab,
  getSelectedTabId,
  moveTabsToArchive,
  openTab,
  pinTab,
  restoreArchivedTab,
  selectTab,
  unpinTab,
} from "../src/main/state";
import { normalizeTypedInput } from "../src/main/urls";
import { HOUR_MS } from "../src/shared/settings";
import type { BrowserState, Tab } from "../src/shared/types";

const ONE_PM = Date.UTC(2026, 9, 26, 13, 0, 0);
const TWO_PM = ONE_PM + 1 * HOUR_MS;
const THREE_PM = ONE_PM + 2 * HOUR_MS;
const FOUR_PM = ONE_PM + 3 * HOUR_MS;

/** Returns the tab with this id, failing the test if it is missing, so the checks below can read its fields. */
function getTab(state: BrowserState, tabId: string): Tab {
  const tab = findTab(state, tabId);
  if (tab === undefined) {
    throw new Error(`Test setup problem: tab ${tabId} is missing`);
  }
  return tab;
}

/** Returns the id of the tab at the top of the list. New and restored tabs always go there. */
function getTopTabId(state: BrowserState): string {
  const topTab = state.tabs[0];
  if (topTab === undefined) {
    throw new Error("Test setup problem: no tabs");
  }
  return topTab.id;
}

describe("openTab", () => {
  it("adds an unpinned tab at the top of the active Space and selects it", () => {
    const state = openTab(createInitialState(), "https://example.com", ONE_PM);

    const newTab = getTab(state, getTopTabId(state));
    expect(newTab.url).toBe("https://example.com");
    expect(newTab.isPinned).toBe(false);
    expect(newTab.spaceId).toBe(state.activeSpaceId);
    expect(getSelectedTabId(state)).toBe(newTab.id);
  });
});

describe("selectTab", () => {
  it("sets lastActiveAt on both the tab you leave and the tab you open", () => {
    const withFirstTab = openTab(createInitialState(), "https://a.example", ONE_PM);
    const firstTabId = getTopTabId(withFirstTab);
    const withSecondTab = openTab(withFirstTab, "https://b.example", TWO_PM);
    const secondTabId = getTopTabId(withSecondTab);

    const state = selectTab(withSecondTab, firstTabId, THREE_PM);

    expect(getTab(state, firstTabId).lastActiveAt).toBe(THREE_PM);
    expect(getTab(state, secondTabId).lastActiveAt).toBe(THREE_PM);
    expect(getSelectedTabId(state)).toBe(firstTabId);
  });
});

describe("pinTab / unpinTab", () => {
  it("pinning stores the current URL as the home URL", () => {
    const withTab = openTab(createInitialState(), "https://mail.example.com/inbox", ONE_PM);
    const tabId = getTopTabId(withTab);

    const state = pinTab(withTab, tabId);

    expect(getTab(state, tabId).isPinned).toBe(true);
    expect(getTab(state, tabId).homeUrl).toBe("https://mail.example.com/inbox");
  });

  it("unpinning moves the tab to the top of today's tabs with a fresh lastActiveAt", () => {
    const withFirstTab = openTab(createInitialState(), "https://a.example", ONE_PM);
    const firstTabId = getTopTabId(withFirstTab);
    const pinned = pinTab(withFirstTab, firstTabId);
    const withSecondTab = openTab(pinned, "https://b.example", TWO_PM);

    const state = unpinTab(withSecondTab, firstTabId, THREE_PM);

    const unpinnedTab = getTab(state, firstTabId);
    expect(getTopTabId(state)).toBe(firstTabId);
    expect(unpinnedTab.isPinned).toBe(false);
    expect(unpinnedTab.homeUrl).toBeNull();
    expect(unpinnedTab.lastActiveAt).toBe(THREE_PM);
  });
});

describe("moveTabsToArchive", () => {
  it("removes the tabs from the sidebar and adds archive entries with the given reason", () => {
    const withFirstTab = openTab(createInitialState(), "https://a.example", ONE_PM);
    const firstTabId = getTopTabId(withFirstTab);
    const withSecondTab = openTab(withFirstTab, "https://b.example", TWO_PM);

    const state = moveTabsToArchive(withSecondTab, [firstTabId], THREE_PM, "auto");

    expect(findTab(state, firstTabId)).toBeUndefined();
    expect(state.tabs).toHaveLength(1);
    expect(state.archive[0]?.tab.id).toBe(firstTabId);
    expect(state.archive[0]?.reason).toBe("auto");
    expect(state.archive[0]?.archivedAt).toBe(THREE_PM);
  });

  it("selects the most recently used tab in the Space when the selected tab is archived", () => {
    // Opening a tab marks the one you leave as used at that moment:
    // A is left at 2 PM, B is left at 3 PM, C is selected.
    const withA = openTab(createInitialState(), "https://a.example", ONE_PM);
    const withB = openTab(withA, "https://b.example", TWO_PM);
    const tabBId = getTopTabId(withB);
    const withC = openTab(withB, "https://c.example", THREE_PM);
    const tabCId = getTopTabId(withC);

    const state = closeTab(withC, tabCId, FOUR_PM);

    expect(getSelectedTabId(state)).toBe(tabBId);
  });
});

describe("restoreArchivedTab", () => {
  it("puts the tab back at the top of its Space and selects it", () => {
    const withTab = openTab(createInitialState(), "https://a.example", ONE_PM);
    const tabId = getTopTabId(withTab);
    const archived = closeTab(withTab, tabId, TWO_PM);

    const state = restoreArchivedTab(archived, tabId, THREE_PM);

    expect(getTopTabId(state)).toBe(tabId);
    expect(getSelectedTabId(state)).toBe(tabId);
    expect(getTab(state, tabId).lastActiveAt).toBe(THREE_PM);
    expect(state.archive).toHaveLength(0);
  });

  it("falls back to the active Space when the tab's Space was deleted", () => {
    const orphanTab: Tab = {
      id: "tab-orphan",
      spaceId: "space-deleted",
      url: "https://a.example",
      title: "A",
      isPinned: false,
      homeUrl: null,
      lastActiveAt: ONE_PM,
    };
    const initialState = createInitialState();
    const archived: BrowserState = {
      ...initialState,
      archive: [{ tab: orphanTab, archivedAt: TWO_PM, reason: "manual" }],
    };

    const state = restoreArchivedTab(archived, "tab-orphan", THREE_PM);

    expect(getTab(state, "tab-orphan").spaceId).toBe(initialState.activeSpaceId);
  });
});

describe("normalizeTypedInput", () => {
  it("adds https:// to a bare address", () => {
    expect(normalizeTypedInput("example.com")).toBe("https://example.com");
  });

  it("turns plain words into a search URL", () => {
    expect(normalizeTypedInput("best pizza")).toBe("https://duckduckgo.com/?q=best%20pizza");
  });
});
