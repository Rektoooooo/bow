/**
 * WHY this file exists:
 *   Split views rearrange the sidebar; these tests make sure no tab is lost or duplicated while splitting and unsplitting.
 */
import { describe, expect, it } from "vitest";
import { addTabToSplit, separateTabFromSplit, splitTabs, unsplit } from "../src/main/split";
import { closeTab, getSelectedTabId } from "../src/main/state";
import { findSplitOfTab } from "../src/main/tree";
import { HOUR_MS, SPLIT_PANES_LIMIT } from "../src/shared/settings";
import type { ItemId } from "../src/shared/types";
import { getPinnedIds, getTab, getTodayIds, ONE_PM, openPinnedTabs, openTabs } from "./builders";

const LATER = ONE_PM + 10 * HOUR_MS;

describe("splitTabs", () => {
  it("replaces the first tab's row with a split holding both tabs, and selects the first", () => {
    // Today shows [C, B, A].
    const { state: withTabs, tabIds } = openTabs(["https://a.example", "https://b.example", "https://c.example"]);
    const tabA = tabIds[0] as ItemId;
    const tabC = tabIds[2] as ItemId;

    const state = splitTabs(withTabs, tabA, tabC, LATER);

    const splitId = findSplitOfTab(state, tabA) as ItemId;
    expect(getTodayIds(state)).toEqual([tabIds[1], splitId]);
    expect(state.items[splitId]?.kind === "split" && state.items[splitId].childIds).toEqual([tabA, tabC]);
    expect(getSelectedTabId(state)).toBe(tabA);
  });

  it("adds to the first tab's split when it already has one, up to the pane limit", () => {
    const urls = Array.from({ length: SPLIT_PANES_LIMIT + 1 }, (_value, index) => `https://pane${index}.example`);
    const { state: withTabs, tabIds } = openTabs(urls);
    const firstTab = tabIds[0] as ItemId;
    let state = withTabs;
    for (const tabId of tabIds.slice(1)) {
      state = splitTabs(state, firstTab, tabId, LATER);
    }

    const splitId = findSplitOfTab(state, firstTab) as ItemId;
    const split = state.items[splitId];
    expect(split?.kind === "split" && split.childIds.length).toBe(SPLIT_PANES_LIMIT);
    expect(getTodayIds(state)).toContain(tabIds[SPLIT_PANES_LIMIT]);
  });

  it("gives a Today tab a home URL when it joins a Pinned split", () => {
    const { state: withPinned, tabIds: pinnedIds } = openPinnedTabs(["https://pinned.example"]);
    const { state: withToday, tabIds: todayIds } = openTabs(["https://today.example"], withPinned);

    const state = splitTabs(withToday, pinnedIds[0] as ItemId, todayIds[0] as ItemId, LATER);

    expect(getTab(state, todayIds[0] as ItemId).homeUrl).toBe("https://today.example");
    expect(getPinnedIds(state)).toHaveLength(1);
    expect(getTodayIds(state)).toEqual([]);
  });
});

describe("leaving a split", () => {
  it("separating a tab puts it right after the split, and a split of one dissolves", () => {
    const { state: withTabs, tabIds } = openTabs(["https://a.example", "https://b.example"]);
    const tabA = tabIds[0] as ItemId;
    const tabB = tabIds[1] as ItemId;
    const split = splitTabs(withTabs, tabB, tabA, LATER);

    const state = separateTabFromSplit(split, tabA);

    expect(getTodayIds(state)).toEqual([tabB, tabA]);
    expect(Object.values(state.items).some((item) => item.kind === "split")).toBe(false);
  });

  it("closing one of two panes leaves the other as a plain tab", () => {
    const { state: withTabs, tabIds } = openTabs(["https://a.example", "https://b.example"]);
    const split = splitTabs(withTabs, tabIds[1] as ItemId, tabIds[0] as ItemId, LATER);

    const state = closeTab(split, tabIds[0] as ItemId, LATER);

    expect(getTodayIds(state)).toEqual([tabIds[1]]);
  });

  it("unsplit puts every pane back in pane order", () => {
    const { state: withTabs, tabIds } = openTabs(["https://a.example", "https://b.example", "https://c.example"]);
    const tabC = tabIds[2] as ItemId;
    const twoPanes = splitTabs(withTabs, tabC, tabIds[0] as ItemId, LATER);
    const threePanes = addTabToSplit(twoPanes, findSplitOfTab(twoPanes, tabC) as ItemId, tabIds[1] as ItemId, LATER);

    const state = unsplit(threePanes, findSplitOfTab(threePanes, tabC) as ItemId);

    expect(getTodayIds(state)).toEqual([tabC, tabIds[0], tabIds[1]]);
  });
});
