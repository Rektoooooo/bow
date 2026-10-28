/**
 * WHY this file exists:
 *   Split views rearrange the sidebar; these tests make sure no tab is lost or duplicated while splitting and unsplitting.
 */
import { describe, expect, it } from "vitest";
import { addTabToSplit, equalizeSplit, findAdjacentPaneTabId, separateTabFromSplit, setSplitOrientation, setSplitSizes, splitTabs, swapSplitPanes, unsplit } from "../src/main/split";
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

describe("split view layouts", () => {
  /** A split view of the given tabs (in pane order) and its id. */
  function buildSplit(urls: string[]) {
    const { state: built, tabIds } = openTabs(urls);
    let state = splitTabs(built, tabIds[0] as ItemId, tabIds[1] as ItemId, ONE_PM);
    const splitId = findSplitOfTab(state, tabIds[0] as ItemId) as ItemId;
    for (const tabId of tabIds.slice(2)) {
      state = addTabToSplit(state, splitId, tabId, ONE_PM);
    }
    return { state, splitId, tabIds };
  }
  const splitOf = (state: ReturnType<typeof buildSplit>["state"], splitId: ItemId) => {
    const item = state.items[splitId];
    if (item === undefined || item.kind !== "split") {
      throw new Error("Test setup problem: no split view");
    }
    return item;
  };

  it("keeps dragged sizes that fit, and refuses ones that do not", () => {
    const { state, splitId } = buildSplit(["https://a.example/", "https://b.example/"]);
    const sized = setSplitSizes(state, splitId, [0.3, 0.7]);
    expect(splitOf(sized, splitId).sizes).toEqual([0.3, 0.7]);
    expect(setSplitSizes(state, splitId, [0.3, 0.3, 0.4])).toBe(state);
    expect(setSplitSizes(state, splitId, [0.5, 0.9])).toBe(state);
    expect(splitOf(equalizeSplit(sized, splitId), splitId).sizes).toBeUndefined();
  });

  it("a grid needs three panes, and a new layout starts with equal panes", () => {
    const two = buildSplit(["https://a.example/", "https://b.example/"]);
    expect(setSplitOrientation(two.state, two.splitId, "grid")).toBe(two.state);
    const three = buildSplit(["https://a.example/", "https://b.example/", "https://c.example/"]);
    const sized = setSplitSizes(three.state, three.splitId, [0.2, 0.3, 0.5]);
    const grid = setSplitOrientation(sized, three.splitId, "grid");
    expect(splitOf(grid, three.splitId).orientation).toBe("grid");
    expect(splitOf(grid, three.splitId).sizes).toBeUndefined();
  });

  it("Swap Panes trades the focused pane with the next, its size with it", () => {
    const { state, splitId } = buildSplit(["https://a.example/", "https://b.example/", "https://c.example/"]);
    const before = splitOf(state, splitId).childIds;
    const sized = setSplitSizes(state, splitId, [0.2, 0.3, 0.5]);
    const swapped = swapSplitPanes(sized, splitId, before[1] as ItemId);
    expect(splitOf(swapped, splitId).childIds).toEqual([before[0], before[2], before[1]]);
    expect(splitOf(swapped, splitId).sizes).toEqual([0.2, 0.5, 0.3]);
    const lastSwapped = swapSplitPanes(state, splitId, before[2] as ItemId);
    expect(splitOf(lastSwapped, splitId).childIds).toEqual([before[0], before[2], before[1]]);
  });

  it("Next Pane and Previous Pane go round the split view's panes", () => {
    const { state, splitId } = buildSplit(["https://a.example/", "https://b.example/", "https://c.example/"]);
    const panes = splitOf(state, splitId).childIds;
    const selected = getSelectedTabId(state) as ItemId;
    const index = panes.indexOf(selected);
    expect(findAdjacentPaneTabId(state, 1)).toBe(panes[(index + 1) % panes.length]);
    expect(findAdjacentPaneTabId(state, -1)).toBe(panes[(index - 1 + panes.length) % panes.length]);
  });
});
