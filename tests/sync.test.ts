/**
 * WHY this file exists:
 *   Folder sync merges two Macs' setups unit by unit. These tests play two made-up Macs, A and B, trading their files:
 *   edits to different things both survive, deletions beat older edits, nothing ping-pongs, and a crafted file can't
 *   bring anything harmful in.
 */
import { describe, expect, it } from "vitest";
import { buildSyncPayload, CLOCK_SKEW_GUARD_MS, collectUnits, createSyncMeta, mergePeer, parseSyncPayload, stampLocalChanges, TOMBSTONE_LIFETIME_MS } from "../src/main/sync";
import type { SyncMeta, SyncPayload } from "../src/main/sync";
import { createSpace, renameSpace } from "../src/main/spaces";
import { createFolder, createNote, renameItem } from "../src/main/state";
import { createNoteUrl } from "../src/shared/notes";
import type { BrowserState, FolderItem, ItemId, TabItem } from "../src/shared/types";
import { getPinnedIds, ONE_PM, openPinnedTabs, PERSONAL_SPACE_ID, WORK_SPACE_ID } from "./builders";

const MINUTE_MS = 60 * 1000;

/** One made-up Mac: its state, its sync meta, its Notes. */
interface Mac {
  name: string;
  state: BrowserState;
  meta: SyncMeta;
  notes: Record<string, string>;
}

function createMac(name: string, deviceId: string, state: BrowserState, now: number, changedAt: number = now): Mac {
  const meta = stampLocalChanges(createSyncMeta(deviceId), collectUnits(state, {}, {}), now, changedAt);
  return { name: name, state: state, meta: meta, notes: {} };
}

/** A Mac records its own changes (as the controller does after every change). */
function stamp(mac: Mac, now: number): Mac {
  return { ...mac, meta: stampLocalChanges(mac.meta, collectUnits(mac.state, mac.notes, {}), now) };
}

/** A Mac's file, written and read back the way another Mac reads it. */
function fileOf(mac: Mac, now: number): SyncPayload {
  const payload = buildSyncPayload(mac.state, mac.meta, mac.notes, {}, mac.name, now);
  const parsed = parseSyncPayload(JSON.stringify(payload));
  if (parsed === null) {
    throw new Error("A Mac's own file must read back");
  }
  return parsed;
}

/** One Mac reads another's file. */
function receive(mac: Mac, payload: SyncPayload, now: number): Mac & { conflicts: string[] } {
  const result = mergePeer(mac.state, mac.meta, payload, mac.notes, now);
  return { ...mac, state: result.state, meta: result.meta, notes: { ...mac.notes, ...result.notes }, conflicts: result.conflicts };
}

/** Two Macs that already share a setup (B joined A's folder). */
function sharedMacs(): { macA: Mac; macB: Mac; tabIds: ItemId[] } {
  const built = openPinnedTabs(["https://docs.example/", "https://mail.example/"]);
  const macA = createMac("Mac A", "mac-a-0000001", built.state, ONE_PM);
  const joining = createMac("Mac B", "mac-b-0000001", built.state, ONE_PM, 0);
  const macB = receive(joining, fileOf(macA, ONE_PM), ONE_PM);
  return { macA: macA, macB: macB, tabIds: built.tabIds };
}

function tabTitle(mac: Mac, tabId: ItemId): string {
  const tab = mac.state.items[tabId] as TabItem;
  return tab.customTitle ?? tab.title;
}

describe("folder sync", () => {
  it("a Mac joining takes the folder's setup where they differ, and keeps the Spaces only it has", () => {
    const built = openPinnedTabs(["https://docs.example/"]);
    const macA = createMac("Mac A", "mac-a-0000001", renameSpace(built.state, PERSONAL_SPACE_ID, "Life"), ONE_PM);
    const renamedShared = renameSpace(built.state, WORK_SPACE_ID, "Job");
    const ownSetup = createSpace(renamedShared, { name: "Hobby", icon: "🎸", theme: { colors: ["#000000"], appearance: "auto", grain: 0 } }, ONE_PM);
    const macB = receive(createMac("Mac B", "mac-b-0000001", ownSetup, ONE_PM, 0), fileOf(macA, ONE_PM), ONE_PM + MINUTE_MS);
    const names = macB.state.spaces.map((space) => space.name);
    expect(names).toContain("Life");
    expect(names).toContain("Work");
    expect(names).not.toContain("Job");
    expect(names).toContain("Hobby");
  });

  it("a rename on one Mac and a new pin on the other both survive", () => {
    const { macA, macB, tabIds } = sharedMacs();
    const renamedOnA = stamp({ ...macA, state: renameItem(macA.state, tabIds[0] as ItemId, "Team docs") }, ONE_PM + MINUTE_MS);
    const extraPin = openPinnedTabs(["https://news.example/"], macB.state);
    const pinnedOnB = stamp({ ...macB, state: extraPin.state }, ONE_PM + 2 * MINUTE_MS);

    const bAfter = receive(pinnedOnB, fileOf(renamedOnA, ONE_PM + 3 * MINUTE_MS), ONE_PM + 3 * MINUTE_MS);
    const aAfter = receive(renamedOnA, fileOf(stamp(bAfter, ONE_PM + 3 * MINUTE_MS), ONE_PM + 4 * MINUTE_MS), ONE_PM + 4 * MINUTE_MS);

    for (const mac of [aAfter, bAfter]) {
      expect(tabTitle(mac, tabIds[0] as ItemId)).toBe("Team docs");
      expect(getPinnedIds(mac.state)).toContain(extraPin.tabIds[0]);
    }
  });

  it("nothing ping-pongs: a merge is not a change here, and the same file twice changes nothing", () => {
    const { macA, macB, tabIds } = sharedMacs();
    const renamedOnA = stamp({ ...macA, state: renameItem(macA.state, tabIds[1] as ItemId, "Inbox") }, ONE_PM + MINUTE_MS);
    const fileA = fileOf(renamedOnA, ONE_PM + MINUTE_MS);
    const bAfter = receive(macB, fileA, ONE_PM + 2 * MINUTE_MS);
    expect(stamp(bAfter, ONE_PM + 3 * MINUTE_MS).meta).toBe(bAfter.meta);
    const again = mergePeer(bAfter.state, bAfter.meta, fileA, bAfter.notes, ONE_PM + 4 * MINUTE_MS);
    expect(again.state).toBe(bAfter.state);
    // A reading B's file back (B only adopted A's change) changes nothing on A either.
    const aBack = mergePeer(renamedOnA.state, renamedOnA.meta, fileOf(stamp(bAfter, ONE_PM + 5 * MINUTE_MS), ONE_PM + 5 * MINUTE_MS), {}, ONE_PM + 5 * MINUTE_MS);
    expect(aBack.state).toBe(renamedOnA.state);
    // So A's file has nothing new to say back to B.
    expect(aBack.meta.stamps).toBe(renamedOnA.meta.stamps);
    expect(aBack.meta.tombstones).toBe(renamedOnA.meta.tombstones);
  });

  it("a deletion wins over an older edit", () => {
    const { macA, macB, tabIds } = sharedMacs();
    const editedOnB = stamp({ ...macB, state: renameItem(macB.state, tabIds[0] as ItemId, "Old edit") }, ONE_PM + MINUTE_MS);
    const withoutTab = { ...macA.state, spaces: macA.state.spaces.map((space) => ({ ...space, pinnedIds: space.pinnedIds.filter((itemId) => itemId !== tabIds[0]) })) };
    const deletedOnA = stamp({ ...macA, state: withoutTab }, ONE_PM + 2 * MINUTE_MS);
    const bAfter = receive(editedOnB, fileOf(deletedOnA, ONE_PM + 2 * MINUTE_MS), ONE_PM + 3 * MINUTE_MS);
    expect(bAfter.state.items[tabIds[0] as ItemId]).toBeUndefined();
    expect(getPinnedIds(bAfter.state)).not.toContain(tabIds[0]);
  });

  it("changes too close in time to order are counted, and both Macs end with the same one", () => {
    const { macA, macB, tabIds } = sharedMacs();
    const tabKey = `item:${tabIds[0]}`;
    const renamedOnA = stamp({ ...macA, state: renameItem(macA.state, tabIds[0] as ItemId, "From A") }, ONE_PM + MINUTE_MS);
    const renamedOnB = stamp({ ...macB, state: renameItem(macB.state, tabIds[0] as ItemId, "From B") }, ONE_PM + MINUTE_MS + CLOCK_SKEW_GUARD_MS - 1000);
    const bAfter = receive(renamedOnB, fileOf(renamedOnA, ONE_PM + 2 * MINUTE_MS), ONE_PM + 2 * MINUTE_MS);
    const aAfter = receive(renamedOnA, fileOf(renamedOnB, ONE_PM + 2 * MINUTE_MS), ONE_PM + 2 * MINUTE_MS);
    expect(tabTitle(bAfter, tabIds[0] as ItemId)).toBe("From B");
    expect(tabTitle(aAfter, tabIds[0] as ItemId)).toBe("From B");
    expect(bAfter.conflicts).toEqual([tabKey]);
    expect(aAfter.conflicts).toEqual([tabKey]);
    // Once alike, reading each other's files again finds nothing to merge and no conflict.
    const aAgain = receive(aAfter, fileOf(stamp(bAfter, ONE_PM + 3 * MINUTE_MS), ONE_PM + 3 * MINUTE_MS), ONE_PM + 3 * MINUTE_MS);
    expect(aAgain.state).toBe(aAfter.state);
    expect(aAgain.conflicts).toEqual([]);
  });

  it("changes at the very same moment are decided alike on both Macs", () => {
    const { macA, macB, tabIds } = sharedMacs();
    const renamedOnA = stamp({ ...macA, state: renameItem(macA.state, tabIds[0] as ItemId, "From A") }, ONE_PM + MINUTE_MS);
    const renamedOnB = stamp({ ...macB, state: renameItem(macB.state, tabIds[0] as ItemId, "From B") }, ONE_PM + MINUTE_MS);
    const bAfter = receive(renamedOnB, fileOf(renamedOnA, ONE_PM + 2 * MINUTE_MS), ONE_PM + 2 * MINUTE_MS);
    const aAfter = receive(renamedOnA, fileOf(renamedOnB, ONE_PM + 2 * MINUTE_MS), ONE_PM + 2 * MINUTE_MS);
    expect(tabTitle(aAfter, tabIds[0] as ItemId)).toBe(tabTitle(bAfter, tabIds[0] as ItemId));
  });

  it("a deletion and an edit at the same moment end deleted on both Macs", () => {
    const { macA, macB, tabIds } = sharedMacs();
    const editedOnB = stamp({ ...macB, state: renameItem(macB.state, tabIds[0] as ItemId, "Same moment") }, ONE_PM + MINUTE_MS);
    const withoutTab = { ...macA.state, spaces: macA.state.spaces.map((space) => ({ ...space, pinnedIds: space.pinnedIds.filter((itemId) => itemId !== tabIds[0]) })) };
    const deletedOnA = stamp({ ...macA, state: withoutTab }, ONE_PM + MINUTE_MS);
    const bAfter = receive(editedOnB, fileOf(deletedOnA, ONE_PM + 2 * MINUTE_MS), ONE_PM + 2 * MINUTE_MS);
    const aAfter = receive(deletedOnA, fileOf(editedOnB, ONE_PM + 2 * MINUTE_MS), ONE_PM + 2 * MINUTE_MS);
    expect(bAfter.state.items[tabIds[0] as ItemId]).toBeUndefined();
    expect(getPinnedIds(aAfter.state)).not.toContain(tabIds[0]);
  });

  it("a live folder syncs its source, and each Mac keeps the items it filled", () => {
    const { macA, macB } = sharedMacs();
    const withLive = createFolder(macA.state, "Pull Requests", ONE_PM, { source: { kind: "github", list: "pullRequests" }, hiddenUrls: [] });
    const folderId = getPinnedIds(withLive).at(-1) as ItemId;
    const filled = openPinnedTabs(["https://github.com/octo/app/pull/1"], withLive);
    const filledFolder = filled.state.items[folderId] as FolderItem;
    const stateA: BrowserState = {
      ...filled.state,
      items: { ...filled.state.items, [folderId]: { ...filledFolder, childIds: [filled.tabIds[0] as ItemId] } },
      spaces: filled.state.spaces.map((space) => ({ ...space, pinnedIds: space.pinnedIds.filter((itemId) => itemId !== filled.tabIds[0]) })),
    };
    const macAWithLive = stamp({ ...macA, state: stateA }, ONE_PM + MINUTE_MS);
    const bAfter = receive(macB, fileOf(macAWithLive, ONE_PM + MINUTE_MS), ONE_PM + 2 * MINUTE_MS);
    const folderOnB = bAfter.state.items[folderId] as FolderItem;
    expect(folderOnB.live?.source).toEqual({ kind: "github", list: "pullRequests" });
    expect(folderOnB.childIds).toEqual([]);
  });

  it("deletions are forgotten after a while", () => {
    const { macA, tabIds } = sharedMacs();
    const withoutTab = { ...macA.state, spaces: macA.state.spaces.map((space) => ({ ...space, pinnedIds: space.pinnedIds.filter((itemId) => itemId !== tabIds[0]) })) };
    const deleted = stamp({ ...macA, state: withoutTab }, ONE_PM + MINUTE_MS);
    expect(deleted.meta.tombstones[`item:${tabIds[0]}`]).toBe(ONE_PM + MINUTE_MS);
    const muchLater = stamp(deleted, ONE_PM + MINUTE_MS + TOMBSTONE_LIFETIME_MS + 1);
    expect(muchLater.meta.tombstones[`item:${tabIds[0]}`]).toBeUndefined();
  });

  it("a note changed on both Macs keeps this Mac's text as a copy next to it", () => {
    const shared = openPinnedTabs([]);
    const withNote = createNote(shared.state, "note-1", ONE_PM);
    const noteTabId = Object.values(withNote.items).find((item) => item.kind === "tab" && item.url === createNoteUrl("note-1"))?.id as ItemId;
    // Pin the note so it syncs.
    const pinnedNote: BrowserState = { ...withNote, spaces: withNote.spaces.map((space) => ({ ...space, todayIds: space.todayIds.filter((itemId) => itemId !== noteTabId), pinnedIds: space.id === withNote.activeSpaceId ? [noteTabId] : space.pinnedIds })) };
    let macA: Mac = { ...createMac("Mac A", "mac-a-0000001", pinnedNote, ONE_PM), notes: { "note-1": "<p>shared</p>" } };
    macA = stamp(macA, ONE_PM);
    let macB = receive(createMac("Mac B", "mac-b-0000001", pinnedNote, ONE_PM, 0), fileOf(macA, ONE_PM), ONE_PM);
    macB = stamp({ ...macB, notes: { "note-1": "<p>shared</p>" } }, ONE_PM);

    macA = stamp({ ...macA, notes: { "note-1": "<p>A's words</p>" } }, ONE_PM + 2 * MINUTE_MS);
    macB = stamp({ ...macB, notes: { "note-1": "<p>B's words</p>" } }, ONE_PM + MINUTE_MS);
    const bAfter = receive(macB, fileOf(macA, ONE_PM + 3 * MINUTE_MS), ONE_PM + 3 * MINUTE_MS);
    expect(bAfter.notes["note-1"]).toBe("<p>A's words</p>");
    const copyText = Object.entries(bAfter.notes).find(([noteId]) => noteId !== "note-1")?.[1];
    expect(copyText).toBe("<p>B's words</p>");
    const copyTab = Object.values(bAfter.state.items).find((item): item is TabItem => item.kind === "tab" && (item.customTitle ?? "").includes("before Mac A's change"));
    expect(copyTab).toBeDefined();
  });

  it("a crafted file brings nothing harmful in", () => {
    const { macA, macB, tabIds } = sharedMacs();
    const payload = buildSyncPayload(macA.state, macA.meta, {}, {}, "Mac A", ONE_PM + MINUTE_MS);
    const crafted = JSON.parse(JSON.stringify(payload));
    crafted.state.items[tabIds[0] as ItemId].url = "javascript:alert(1)";
    crafted.state.items[tabIds[0] as ItemId].homeUrl = "javascript:alert(1)";
    crafted.stamps[`item:${tabIds[0]}`].updatedAt = ONE_PM + 10 * MINUTE_MS;
    const parsed = parseSyncPayload(JSON.stringify(crafted));
    expect(parsed).not.toBeNull();
    const bAfter = receive(macB, parsed as SyncPayload, ONE_PM + 11 * MINUTE_MS);
    const anyScript = Object.values(bAfter.state.items).some((item) => item.kind === "tab" && item.url.startsWith("javascript:"));
    expect(anyScript).toBe(false);
    expect(parseSyncPayload(JSON.stringify({ ...payload, deviceId: "../../etc" }))).toBeNull();
    expect(parseSyncPayload(JSON.stringify({ ...payload, formatVersion: 99 }))).toBeNull();
  });
});
