/**
 * WHY this file exists:
 *   Live folders change the sidebar on their own every few minutes, so their rules must hold exactly: what a refresh
 *   adds, keeps, removes and never brings back, and that the user's own tabs are never touched.
 */
import { describe, expect, it } from "vitest";
import { createFolder, createInitialState, deleteItem, moveItem, selectTab } from "../src/main/state";
import { applyLiveFolderEntries, listLiveFolders, showHiddenLiveFolderItems } from "../src/main/liveFolders";
import type { LiveFolderEntry } from "../src/main/liveFolders";
import { LIVE_FOLDER_ITEM_LIMIT } from "../src/shared/settings";
import type { BrowserState, FolderItem, ItemId, TabItem } from "../src/shared/types";
import { getPinnedIds, getTab, getTodayIds, ONE_PM, openTabs } from "./builders";

const FEED_SOURCE = { kind: "feed", url: "https://blog.example/feed.xml" } as const;

/** Made-up posts. */
const POST_A: LiveFolderEntry = { url: "https://blog.example/posts/a", title: "Post A" };
const POST_B: LiveFolderEntry = { url: "https://blog.example/posts/b", title: "Post B" };
const POST_C: LiveFolderEntry = { url: "https://blog.example/posts/c", title: "Post C" };
const POST_D: LiveFolderEntry = { url: "https://blog.example/posts/d", title: "Post D" };

const LATER = ONE_PM + 10 * 60 * 1000;

/** A state with one live folder (the last item of Pinned) and its id. */
function withLiveFolder(startState: BrowserState = createInitialState()): { state: BrowserState; folderId: ItemId } {
  const state = createFolder(startState, "Blog", ONE_PM, { source: FEED_SOURCE, hiddenUrls: [] });
  const folderId = getPinnedIds(state).at(-1) as ItemId;
  return { state: state, folderId: folderId };
}

function getFolder(state: BrowserState, folderId: ItemId): FolderItem {
  const folder = state.items[folderId];
  if (folder === undefined || folder.kind !== "folder") {
    throw new Error(`Test setup problem: folder ${folderId} is missing`);
  }
  return folder;
}

function getChildTabs(state: BrowserState, folderId: ItemId): TabItem[] {
  return getFolder(state, folderId).childIds.map((childId) => getTab(state, childId));
}

describe("live folders", () => {
  it("are folders with a source and nothing hidden yet", () => {
    const { state, folderId } = withLiveFolder();
    const folder = getFolder(state, folderId);
    expect(folder.live).toEqual({ source: FEED_SOURCE, hiddenUrls: [] });
    expect(folder.isOpen).toBe(true);
    expect(listLiveFolders(state)).toEqual([{ folderId: folderId, source: FEED_SOURCE, profileId: "profile-default" }]);
  });

  it("fill with one tab per entry, in the source's order, homed at the entry and without dots the first time", () => {
    const { state, folderId } = withLiveFolder();
    const filled = applyLiveFolderEntries(state, folderId, [POST_A, POST_B], ONE_PM, false);
    const tabs = getChildTabs(filled, folderId);
    expect(tabs.map((tab) => tab.title)).toEqual(["Post A", "Post B"]);
    expect(tabs.map((tab) => tab.homeUrl)).toEqual([POST_A.url, POST_B.url]);
    expect(tabs.every((tab) => tab.isUnread === undefined)).toBe(true);
  });

  it("add new entries with the unread dot, keep listed tabs and drop the ones that left the list", () => {
    const { state, folderId } = withLiveFolder();
    const filled = applyLiveFolderEntries(state, folderId, [POST_A, POST_B, POST_C], ONE_PM, false);
    const [tabA, tabB] = getFolder(filled, folderId).childIds;
    const refreshed = applyLiveFolderEntries(filled, folderId, [POST_D, POST_B, POST_A], LATER, true);
    const tabs = getChildTabs(refreshed, folderId);
    expect(tabs.map((tab) => tab.title)).toEqual(["Post D", "Post B", "Post A"]);
    expect(tabs[0]?.isUnread).toBe(true);
    expect(tabs[1]?.id).toBe(tabB);
    expect(tabs[2]?.id).toBe(tabA);
    const leftoverTitles = Object.values(refreshed.items).filter((item) => item.kind === "tab" && item.title === "Post C");
    expect(leftoverTitles).toEqual([]);
    expect(refreshed.archive).toEqual(state.archive);
  });

  it("return the same state when the folder already shows the entries, or is gone", () => {
    const { state, folderId } = withLiveFolder();
    const filled = applyLiveFolderEntries(state, folderId, [POST_A, POST_B], ONE_PM, false);
    expect(applyLiveFolderEntries(filled, folderId, [POST_A, POST_B], LATER, true)).toBe(filled);
    expect(applyLiveFolderEntries(filled, "folder-missing", [POST_C], LATER, true)).toBe(filled);
  });

  it("never touch a plain folder", () => {
    const state = createFolder(createInitialState(), "Plain", ONE_PM);
    const folderId = getPinnedIds(state).at(-1) as ItemId;
    expect(applyLiveFolderEntries(state, folderId, [POST_A], ONE_PM, false)).toBe(state);
  });

  it("keep a removed tab hidden, and show it again on request", () => {
    const { state, folderId } = withLiveFolder();
    const filled = applyLiveFolderEntries(state, folderId, [POST_A, POST_B], ONE_PM, false);
    const tabA = getFolder(filled, folderId).childIds[0] as ItemId;
    const afterDelete = deleteItem(filled, tabA, LATER);
    expect(getFolder(afterDelete, folderId).live?.hiddenUrls).toEqual([POST_A.url]);
    expect(afterDelete.archive[0]?.tab.url).toBe(POST_A.url);

    const refreshed = applyLiveFolderEntries(afterDelete, folderId, [POST_A, POST_B], LATER, true);
    expect(getChildTabs(refreshed, folderId).map((tab) => tab.title)).toEqual(["Post B"]);

    const unhidden = showHiddenLiveFolderItems(refreshed, folderId);
    expect(getFolder(unhidden, folderId).live?.hiddenUrls).toEqual([]);
    const refreshedAgain = applyLiveFolderEntries(unhidden, folderId, [POST_A, POST_B], LATER, true);
    expect(getChildTabs(refreshedAgain, folderId).map((tab) => tab.title)).toEqual(["Post A", "Post B"]);
  });

  it("skip addresses that are already open in another tab", () => {
    const built = openTabs([POST_A.url]);
    const { state, folderId } = withLiveFolder(built.state);
    const filled = applyLiveFolderEntries(state, folderId, [POST_A, POST_B], ONE_PM, false);
    expect(getChildTabs(filled, folderId).map((tab) => tab.title)).toEqual(["Post B"]);
  });

  it("keep the selected tab while it is on screen, even when its entry left the list", () => {
    const { state, folderId } = withLiveFolder();
    const filled = applyLiveFolderEntries(state, folderId, [POST_A, POST_B], ONE_PM, false);
    const tabA = getFolder(filled, folderId).childIds[0] as ItemId;
    const reading = selectTab(filled, tabA, ONE_PM);
    const refreshed = applyLiveFolderEntries(reading, folderId, [POST_B], LATER, true);
    expect(getFolder(refreshed, folderId).childIds).toContain(tabA);
    expect(refreshed.selectedTabIdBySpace[refreshed.activeSpaceId]).toBe(tabA);
  });

  it(`hold at most ${LIVE_FOLDER_ITEM_LIMIT} entries`, () => {
    const { state, folderId } = withLiveFolder();
    const manyEntries = Array.from({ length: LIVE_FOLDER_ITEM_LIMIT + 5 }, (_unused, index) => ({ url: `https://blog.example/posts/${index}`, title: `Post ${index}` }));
    const filled = applyLiveFolderEntries(state, folderId, manyEntries, ONE_PM, false);
    expect(getFolder(filled, folderId).childIds.length).toBe(LIVE_FOLDER_ITEM_LIMIT);
  });

  it("refuse tabs dragged into them", () => {
    const built = openTabs(["https://other.example/"]);
    const { state, folderId } = withLiveFolder(built.state);
    const todayTabId = getTodayIds(state)[0] as ItemId;
    expect(moveItem(state, todayTabId, { kind: "folder", folderId: folderId }, 0, LATER)).toBe(state);
  });

  it("leave without filling the Archive when deleted", () => {
    const { state, folderId } = withLiveFolder();
    const filled = applyLiveFolderEntries(state, folderId, [POST_A, POST_B], ONE_PM, false);
    const childIds = getFolder(filled, folderId).childIds;
    const deleted = deleteItem(filled, folderId, LATER);
    expect(deleted.items[folderId]).toBeUndefined();
    expect(childIds.every((childId) => deleted.items[childId] === undefined)).toBe(true);
    expect(getPinnedIds(deleted)).not.toContain(folderId);
    expect(deleted.archive).toEqual(filled.archive);
  });
});
