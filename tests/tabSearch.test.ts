// Tab search (⇧⌘A): every tab in every Space, with where it lives.
import { describe, expect, it } from "vitest";
import { rankTabSearchResults } from "../src/main/commandBar";
import { switchSpaceByOffset } from "../src/main/spaces";
import { addToFavorites, selectTab } from "../src/main/state";
import type { ItemId } from "../src/shared/types";
import { ONE_PM, openTabs } from "./builders";

describe("rankTabSearchResults", () => {
  const personal = openTabs(["https://mail.example/", "https://news.example/"]);
  const inWork = switchSpaceByOffset(personal.state, 1, ONE_PM + 1000);
  const both = openTabs(["https://docs.example/"], inWork);
  const [mailTab, newsTab] = personal.tabIds as [ItemId, ItemId];
  const docsTab = both.tabIds[0] as ItemId;
  // The docs tab was used last.
  const state = selectTab(addToFavorites(both.state, newsTab), docsTab, ONE_PM + 3 * 60 * 60 * 1000);

  it("lists every tab of every Space when nothing is typed, most recently used first", () => {
    const results = rankTabSearchResults({ query: "", state: state, tabIdsInOtherWindows: [] });
    expect(results.map((result) => result.tabId).sort()).toEqual([mailTab, newsTab, docsTab].sort());
    expect(results[0]?.tabId).toBe(docsTab);
  });

  it("says where each tab lives: its Space, or Favorites, and another window showing it", () => {
    const results = rankTabSearchResults({ query: "", state: state, tabIdsInOtherWindows: [mailTab] });
    const subtitleOf = (tabId: ItemId) => results.find((result) => result.tabId === tabId)?.subtitle;
    expect(subtitleOf(docsTab)).toContain("Work");
    expect(subtitleOf(newsTab)).toMatch(/Personal · Favorites$/);
    expect(subtitleOf(mailTab)).toMatch(/Personal · open in another window$/);
  });

  it("keeps only tabs matching what is typed", () => {
    const results = rankTabSearchResults({ query: "docs", state: state, tabIdsInOtherWindows: [] });
    expect(results.map((result) => result.tabId)).toEqual([docsTab]);
  });
});
