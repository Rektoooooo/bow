/**
 * WHY this file exists:
 *   Importing bookmarks must put one closed folder at the end of the chosen Space's Pinned list and leave
 *   everything else alone. These tests pin that down.
 *
 * Data source:
 *   Synthetic bookmark trees written by hand below (example.com, wikipedia.org). No real browser data.
 *
 * Data flow:
 *   tree → addImportedBookmarks() with createInitialState() → checks on the returned state
 */
import { describe, expect, it } from "vitest";
import { addImportedBookmarks, countBookmarks } from "../src/main/bookmarkImport";
import type { ImportedBookmarkNode } from "../src/main/bookmarkImport";
import { createInitialState } from "../src/main/state";
import type { FolderItem, TabItem } from "../src/shared/types";
import { getPinnedIds, ONE_PM, PERSONAL_SPACE_ID, WORK_SPACE_ID } from "./builders";

const SAMPLE_TREE: ImportedBookmarkNode[] = [
  {
    kind: "folder",
    title: "Bookmarks bar",
    children: [
      { kind: "bookmark", title: "Example", url: "https://example.com/" },
      { kind: "folder", title: "Reading", children: [{ kind: "bookmark", title: "", url: "https://en.wikipedia.org/" }] },
      { kind: "folder", title: "Empty", children: [] },
    ],
  },
  { kind: "bookmark", title: "Loose", url: "https://example.org/" },
];

function asFolder(state: ReturnType<typeof createInitialState>, itemId: string): FolderItem {
  const item = state.items[itemId];
  if (item === undefined || item.kind !== "folder") {
    throw new Error(`Test setup problem: ${itemId} is not a folder`);
  }
  return item;
}

describe("addImportedBookmarks", () => {
  it("adds one closed folder at the end of the Space's Pinned list", () => {
    const state = createInitialState();
    const pinnedBefore = getPinnedIds(state);
    const next = addImportedBookmarks(state, PERSONAL_SPACE_ID, "From Chrome", SAMPLE_TREE, ONE_PM);
    const pinnedAfter = getPinnedIds(next);
    expect(pinnedAfter.slice(0, pinnedBefore.length)).toEqual(pinnedBefore);
    expect(pinnedAfter).toHaveLength(pinnedBefore.length + 1);
    const wrapper = asFolder(next, pinnedAfter[pinnedAfter.length - 1] ?? "");
    expect(wrapper.title).toBe("From Chrome");
    expect(wrapper.isOpen).toBe(false);
    expect(wrapper.childIds).toHaveLength(2);
  });

  it("nests folders, makes pinned tabs with home addresses and leaves out empty folders", () => {
    const next = addImportedBookmarks(createInitialState(), PERSONAL_SPACE_ID, "Import", SAMPLE_TREE, ONE_PM);
    const pinnedIds = getPinnedIds(next);
    const wrapper = asFolder(next, pinnedIds[pinnedIds.length - 1] ?? "");
    const barFolder = asFolder(next, wrapper.childIds[0] ?? "");
    expect(barFolder.title).toBe("Bookmarks bar");
    expect(barFolder.isOpen).toBe(false);
    expect(barFolder.childIds).toHaveLength(2);
    const exampleTab = next.items[barFolder.childIds[0] ?? ""] as TabItem;
    expect(exampleTab).toMatchObject({ kind: "tab", url: "https://example.com/", title: "Example", homeUrl: "https://example.com/", lastActiveAt: ONE_PM });
    const readingFolder = asFolder(next, barFolder.childIds[1] ?? "");
    const wikipediaTab = next.items[readingFolder.childIds[0] ?? ""] as TabItem;
    expect(wikipediaTab.title).toBe("https://en.wikipedia.org/");
  });

  it("only touches the chosen Space and does not change the old state", () => {
    const state = createInitialState();
    const before = JSON.stringify(state);
    const next = addImportedBookmarks(state, WORK_SPACE_ID, "Import", SAMPLE_TREE, ONE_PM);
    expect(JSON.stringify(state)).toBe(before);
    expect(getPinnedIds(next, PERSONAL_SPACE_ID)).toEqual(getPinnedIds(state, PERSONAL_SPACE_ID));
    expect(getPinnedIds(next, WORK_SPACE_ID)).toHaveLength(getPinnedIds(state, WORK_SPACE_ID).length + 1);
  });

  it("returns the same object for an empty tree, a tree of empty folders or an unknown Space", () => {
    const state = createInitialState();
    expect(addImportedBookmarks(state, PERSONAL_SPACE_ID, "Import", [], ONE_PM)).toBe(state);
    const onlyEmptyFolder: ImportedBookmarkNode[] = [{ kind: "folder", title: "x", children: [] }];
    expect(addImportedBookmarks(state, PERSONAL_SPACE_ID, "Import", onlyEmptyFolder, ONE_PM)).toBe(state);
    expect(addImportedBookmarks(state, "no-such-space", "Import", SAMPLE_TREE, ONE_PM)).toBe(state);
  });
});

describe("countBookmarks", () => {
  it("counts bookmarks at any depth", () => {
    expect(countBookmarks(SAMPLE_TREE)).toBe(3);
  });
});
