/**
 * WHY this file exists:
 *   A tab opened for a link that turned into a download must vanish without trace (no Archive entry) and hand the
 *   selection back to the page the link was on. discardTab() in state.ts holds that rule.
 */
import { describe, expect, it } from "vitest";
import { discardTab, getSelectedTabId, openTab, selectTab } from "../src/main/state";
import type { ItemId } from "../src/shared/types";
import { getTodayIds, ONE_PM, openTabs } from "./builders";

const LATER = ONE_PM + 60 * 60 * 1000;

describe("discardTab", () => {
  it("removes the tab without an Archive entry and selects the tab it came from", () => {
    const { state: built, tabIds } = openTabs(["https://a.example/", "https://b.example/", "https://c.example/"]);
    const sourceTabId = tabIds[0] as ItemId;
    const linkTabId = "tab-link";
    const withLinkTab = openTab(built, "https://files.example/report.pdf", LATER, { id: linkTabId });
    expect(getSelectedTabId(withLinkTab)).toBe(linkTabId);

    const discarded = discardTab(withLinkTab, linkTabId, sourceTabId, LATER);

    expect(discarded.items[linkTabId]).toBeUndefined();
    expect(getTodayIds(discarded)).not.toContain(linkTabId);
    expect(discarded.archive).toEqual(built.archive);
    expect(getSelectedTabId(discarded)).toBe(sourceTabId);
  });

  it("leaves the selection alone when the discarded tab was opened in the background", () => {
    const { state: built, tabIds } = openTabs(["https://a.example/", "https://b.example/"]);
    const selectedTabId = getSelectedTabId(built);
    const withLinkTab = openTab(built, "https://files.example/report.pdf", LATER, { id: "tab-link", select: false });

    const discarded = discardTab(withLinkTab, "tab-link", tabIds[0] as ItemId, LATER);

    expect(getSelectedTabId(discarded)).toBe(selectedTabId);
    expect(discarded.items["tab-link"]).toBeUndefined();
  });

  it("falls back to the most recently used tab when the source is gone or unknown", () => {
    const { state: built } = openTabs(["https://a.example/", "https://b.example/"]);
    const selectedBefore = getSelectedTabId(built);
    const withLinkTab = openTab(built, "https://files.example/report.pdf", LATER, { id: "tab-link" });

    const withoutSource = discardTab(withLinkTab, "tab-link", null, LATER);
    const withMissingSource = discardTab(withLinkTab, "tab-link", "tab-missing", LATER);

    expect(getSelectedTabId(withoutSource)).toBe(selectedBefore);
    expect(getSelectedTabId(withMissingSource)).toBe(selectedBefore);
  });

  it("returns the same state for a tab that does not exist", () => {
    const { state } = openTabs(["https://a.example/"]);
    expect(discardTab(state, "tab-missing", null, LATER)).toBe(state);
  });

  it("does not move the selection when another tab is selected", () => {
    const { state: built, tabIds } = openTabs(["https://a.example/", "https://b.example/"]);
    const withLinkTab = openTab(built, "https://files.example/report.pdf", LATER, { id: "tab-link", select: false });
    const reselected = selectTab(withLinkTab, tabIds[1] as ItemId, LATER);

    const discarded = discardTab(reselected, "tab-link", tabIds[0] as ItemId, LATER);

    expect(getSelectedTabId(discarded)).toBe(tabIds[1]);
  });
});
