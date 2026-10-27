/**
 * WHY this file exists:
 *   The list a closed folder shows on hover must hold every tab inside it, newest first, and say how long ago each was
 *   used in Arc's words.
 */
import { describe, expect, it } from "vitest";
import { buildFolderList } from "../src/main/folderList";
import { createInitialState } from "../src/main/state";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "../src/shared/settings";
import { describeTimeAgo } from "../src/shared/timeAgo";
import type { BrowserState, FolderItem, TabItem } from "../src/shared/types";
import { ONE_PM, PERSONAL_SPACE_ID } from "./builders";

function makeTab(id: string, title: string, lastActiveAt: number): TabItem {
  return { kind: "tab", id: id, url: `https://${id}.example`, title: title, customTitle: null, faviconUrl: null, homeUrl: null, lastActiveAt: lastActiveAt, isMuted: false };
}

/** A Pinned folder holding a tab, an inner folder with one more tab, and a third tab. */
function buildStateWithFolder(): BrowserState {
  const start = createInitialState();
  const inner: FolderItem = { kind: "folder", id: "inner", title: "Inner", childIds: ["tab-b"], isOpen: false };
  const outer: FolderItem = { kind: "folder", id: "outer", title: "Reading", childIds: ["tab-a", "inner", "tab-c"], isOpen: false };
  const items = {
    ...start.items,
    "tab-a": makeTab("tab-a", "Oldest", ONE_PM - 2 * DAY_MS),
    "tab-b": makeTab("tab-b", "Newest", ONE_PM - MINUTE_MS),
    "tab-c": { ...makeTab("tab-c", "Page title", ONE_PM - HOUR_MS), customTitle: "My name" },
    inner: inner,
    outer: outer,
  };
  const spaces = start.spaces.map((space) => (space.id === PERSONAL_SPACE_ID ? { ...space, pinnedIds: ["outer"] } : space));
  return { ...start, items: items, spaces: spaces };
}

describe("a closed folder's list", () => {
  it("holds every tab inside, inner folders too, the most recently used first, by the names the sidebar shows", () => {
    const entries = buildFolderList(buildStateWithFolder(), "outer");

    expect(entries.map((entry) => entry.title)).toEqual(["Newest", "My name", "Oldest"]);
  });

  it("is empty for anything that is not a folder", () => {
    expect(buildFolderList(buildStateWithFolder(), "tab-a")).toEqual([]);
    expect(buildFolderList(buildStateWithFolder(), "missing")).toEqual([]);
  });
});

describe("time ago, in Arc's words", () => {
  it.each([
    [30 * 1000, "Just now"],
    [61 * 1000, "1 minute ago"],
    [18 * HOUR_MS, "18 hours ago"],
    [DAY_MS, "1 day ago"],
    [8 * DAY_MS, "1 week ago"],
    [15 * DAY_MS, "2 weeks ago"],
    [45 * DAY_MS, "1 month ago"],
    [400 * DAY_MS, "1 year ago"],
  ])("%i ms → %s", (elapsedMs, expected) => {
    expect(describeTimeAgo(ONE_PM - elapsedMs, ONE_PM)).toBe(expected);
  });

  it("says Just now for a time in the future (a clock that moved back)", () => {
    expect(describeTimeAgo(ONE_PM + MINUTE_MS, ONE_PM)).toBe("Just now");
  });
});
