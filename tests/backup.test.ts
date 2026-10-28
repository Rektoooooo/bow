/**
 * WHY this file exists:
 *   A backup must bring a setup back exactly, and a crafted backup must not bring anything harmful in. These tests use
 *   made-up states: a round trip, files that are not backups, and every check on untrusted contents.
 */
import { describe, expect, it } from "vitest";
import { addSpacesFromBackup, BACKUP_FORMAT_VERSION, chooseSnapshotsToDelete, createBackup, isRestorableUrl, parseBackup, replaceFromBackup } from "../src/main/backup";
import type { BowBackup, SnapshotFile } from "../src/main/backup";
import { createFolder, createInitialState, createNote, moveItem, setDownloadFolder } from "../src/main/state";
import { openWindow } from "../src/main/windows";
import { createNoteUrl } from "../src/shared/notes";
import { BEFORE_RESTORE_SNAPSHOTS_KEPT, FAVORITES_LIMIT, SNAPSHOTS_DAILY_KEPT, SNAPSHOTS_HOURLY_KEPT } from "../src/shared/settings";
import type { BrowserState, FolderItem, ItemId, TabItem } from "../src/shared/types";
import { getPinnedIds, getTab, getTodayIds, ONE_PM, openPinnedTabs, openTabs } from "./builders";

const LATER = ONE_PM + 60 * 60 * 1000;
const APP_VERSION = "0.1.0";

/** A made-up setup: two pinned tabs, a folder holding one of them, a note, a Today tab, a JavaScript Boost, a rule. */
function buildSetup(): { state: BrowserState; noteId: string } {
  const pinned = openPinnedTabs(["https://docs.example/", "https://mail.example/"]);
  const withFolder = createFolder(pinned.state, "Reading", ONE_PM);
  const folderId = getPinnedIds(withFolder).at(-1) as ItemId;
  const filed = moveItem(withFolder, pinned.tabIds[0] as ItemId, { kind: "folder", folderId: folderId }, 0, ONE_PM);
  const withToday = openTabs(["https://news.example/"], filed).state;
  const noteId = "note-1";
  const withNote = createNote(withToday, noteId, ONE_PM);
  const state: BrowserState = {
    ...withNote,
    boosts: [{ id: "boost-1", site: "news.example", css: "body { color: red }", zappedSelectors: [], isEnabled: true, javascript: "console.log(1)", isJavaScriptOn: true }],
    routingRules: [{ id: "rule-1", matchType: "contains", value: "mail.example", spaceId: withNote.activeSpaceId }],
    keepAwakeSites: ["mail.example"],
    siteZooms: { "docs.example": 1.25 },
    searchKeywords: [{ keyword: "w", name: "Wiki", url: "https://wiki.example/search?q=%s" }],
    settings: { ...withNote.settings, areFavoritesKeptAwake: false },
  };
  return { state: state, noteId: noteId };
}

/** The backup of a state as text, the way a file holds it. */
function backupText(state: BrowserState, notes: Record<string, string> = {}): string {
  return JSON.stringify(createBackup(state, notes, {}, LATER, APP_VERSION));
}

/** A backup whose state was changed by hand (a crafted file). */
function craftedBackupText(change: (backup: BowBackup) => void): string {
  const backup = createBackup(buildSetup().state, {}, {}, LATER, APP_VERSION);
  change(backup);
  return JSON.stringify(backup);
}

function parseOrFail(text: string) {
  const result = parseBackup(text);
  if (!result.isValid) {
    throw new Error(`Expected a valid backup: ${result.error}`);
  }
  return result.backup;
}

/** Every tab address in a state's Spaces and Favorites, in order. */
function listAddresses(state: BrowserState): string[] {
  const addresses: string[] = [];
  const walk = (itemIds: ItemId[]): void => {
    for (const itemId of itemIds) {
      const item = state.items[itemId];
      if (item?.kind === "tab") {
        addresses.push(item.url);
      } else if (item !== undefined) {
        walk(item.childIds);
      }
    }
  };
  for (const space of state.spaces) {
    walk(space.pinnedIds);
    walk(space.todayIds);
  }
  return addresses;
}

describe("backups", () => {
  it("bring a setup back exactly, with the notes its tabs use", () => {
    const { state, noteId } = buildSetup();
    const restored = parseOrFail(backupText(state, { [noteId]: "<p>Hello</p>", "note-unused": "<p>Old</p>" }));
    expect(restored.state.spaces).toEqual(state.spaces);
    expect(restored.state.items).toEqual(state.items);
    expect(restored.state.profiles).toEqual(state.profiles);
    expect(restored.state.keepAwakeSites).toEqual(["mail.example"]);
    expect(restored.state.siteZooms).toEqual({ "docs.example": 1.25 });
    expect(restored.state.searchKeywords).toEqual([{ keyword: "w", name: "Wiki", url: "https://wiki.example/search?q=%s" }]);
    expect(restored.state.settings.areFavoritesKeptAwake).toBe(false);
    expect(restored.notes).toEqual({ [noteId]: "<p>Hello</p>" });
    expect(restored.report).toMatchObject({ spaces: 2, pinnedTabs: 2, todayTabs: 2, folders: 1, notes: 1, boosts: 1, leftOut: 0, appVersion: APP_VERSION });
  });

  it("leave out what only means something on this Mac", () => {
    const { state } = buildSetup();
    const withWindow = openWindow(state, "window-2");
    const withExtension: BrowserState = { ...withWindow, extensions: [{ id: "abc", profileId: "profile-default", name: "Notes Helper", version: "1.0", path: "/Users/someone/Extensions/abc", isEnabled: true, source: "webstore" }] };
    const backup = createBackup(withExtension, {}, {}, LATER, APP_VERSION);
    expect(backup.state.otherWindows).toEqual([]);
    expect(backup.state.extensions?.[0]?.path).toBe("");
    expect(parseOrFail(JSON.stringify(backup)).report.extensionNames).toEqual(["Notes Helper"]);
  });

  it("never take a download folder from a file, and keep this Mac's on replacing", () => {
    const crafted = craftedBackupText((backup) => {
      backup.state.settings = { ...backup.state.settings, downloadFolder: "/Users/someone/Library/LaunchAgents", asksWhereToSave: true };
    });
    const restored = parseOrFail(crafted).state;
    expect(restored.settings.downloadFolder).toBeUndefined();
    expect(restored.settings.asksWhereToSave).toBe(true);
    const current = setDownloadFolder(createInitialState(), "/Users/someone/Desktop");
    expect(replaceFromBackup(current, restored).settings.downloadFolder).toBe("/Users/someone/Desktop");
  });

  it("refuse files that are not Bow backups, or from a newer Bow", () => {
    expect(parseBackup("not json").isValid).toBe(false);
    expect(parseBackup(JSON.stringify({ hello: 1 })).isValid).toBe(false);
    const newer = craftedBackupText((backup) => {
      backup.formatVersion = BACKUP_FORMAT_VERSION + 1;
    });
    const newerResult = parseBackup(newer);
    expect(newerResult.isValid === false && newerResult.error).toContain("newer Bow");
    const noSpaces = craftedBackupText((backup) => {
      backup.state = { ...backup.state, spaces: [] };
    });
    expect(parseBackup(noSpaces).isValid).toBe(false);
  });

  it("keep only web, note and easel addresses", () => {
    expect(isRestorableUrl("https://a.example/")).toBe(true);
    expect(isRestorableUrl(createNoteUrl("note-2"))).toBe(true);
    expect(isRestorableUrl("about:blank")).toBe(true);
    expect(isRestorableUrl("javascript:alert(1)")).toBe(false);
    expect(isRestorableUrl("file:///etc/passwd")).toBe(false);
    expect(isRestorableUrl("chrome://settings")).toBe(false);

    const text = craftedBackupText((backup) => {
      const todayId = backup.state.spaces[0]?.todayIds[0] as ItemId;
      const tab = backup.state.items[todayId] as TabItem;
      backup.state.items[todayId] = { ...tab, url: "javascript:alert(document.cookie)" };
    });
    const restored = parseOrFail(text);
    expect(listAddresses(restored.state).some((url) => url.startsWith("javascript:"))).toBe(false);
    expect(restored.report.leftOut).toBeGreaterThan(0);
  });

  it("drop missing children, double listings and folders inside themselves", () => {
    const text = craftedBackupText((backup) => {
      const space = backup.state.spaces[0];
      if (space === undefined) {
        throw new Error("setup");
      }
      const folderId = space.pinnedIds.find((itemId) => backup.state.items[itemId]?.kind === "folder") as ItemId;
      const folder = backup.state.items[folderId] as FolderItem;
      // The folder lists itself and a child that does not exist; a Today tab is also listed in Pinned.
      backup.state.items[folderId] = { ...folder, childIds: [...folder.childIds, folderId, "tab-missing"] };
      space.pinnedIds = [...space.pinnedIds, space.todayIds[0] as ItemId];
    });
    const restored = parseOrFail(text);
    const space = restored.state.spaces[0];
    const folder = Object.values(restored.state.items).find((item): item is FolderItem => item.kind === "folder");
    expect(folder?.childIds.includes(folder.id)).toBe(false);
    expect(folder?.childIds.includes("tab-missing")).toBe(false);
    const listedTwice = space?.todayIds.filter((itemId) => space.pinnedIds.includes(itemId)) ?? [];
    expect(listedTwice).toEqual([]);
  });

  it("keep live folders of every kind, and make a damaged one a plain folder", () => {
    const sources = [
      { kind: "github", list: "notifications" },
      { kind: "issues", url: "https://acme.atlassian.example/issues/?filter=1", issueKind: "jira" },
      { kind: "issues", url: "https://linear.example/acme/my-issues", issueKind: "trello" },
      { kind: "issues", url: "javascript:alert(1)", issueKind: "linear" },
    ];
    const text = craftedBackupText((backup) => {
      const space = backup.state.spaces[0];
      if (space === undefined) {
        throw new Error("setup");
      }
      sources.forEach((source, index) => {
        const folderId = `live-${index}`;
        backup.state.items[folderId] = { kind: "folder", id: folderId, title: "Live", childIds: [], isOpen: true, live: { source: source, hiddenUrls: [] } } as FolderItem;
        space.pinnedIds.push(folderId);
      });
    });
    const restored = parseOrFail(text);
    const liveOf = (folderId: string) => (restored.state.items[folderId] as FolderItem | undefined)?.live?.source;
    expect(liveOf("live-0")).toEqual({ kind: "github", list: "notifications" });
    expect(liveOf("live-1")).toEqual({ kind: "issues", url: "https://acme.atlassian.example/issues/?filter=1", issueKind: "jira" });
    expect(liveOf("live-2")).toBeUndefined();
    expect(liveOf("live-3")).toBeUndefined();
    expect(restored.state.items["live-3"]?.kind).toBe("folder");
  });

  it("keep a Space's own search engine and new-tab page, but only a known engine and a web page", () => {
    const text = craftedBackupText((backup) => {
      const [first, second] = backup.state.spaces;
      if (first === undefined || second === undefined) {
        throw new Error("setup");
      }
      backup.state.spaces[0] = { ...first, searchEngine: "google", newTabUrl: "https://github.com/notifications" };
      backup.state.spaces[1] = { ...second, searchEngine: "evil" as "google", newTabUrl: "javascript:alert(1)" };
    });
    const restored = parseOrFail(text);
    expect(restored.state.spaces[0]).toMatchObject({ searchEngine: "google", newTabUrl: "https://github.com/notifications" });
    expect(restored.state.spaces[1]?.searchEngine).toBeUndefined();
    expect(restored.state.spaces[1]?.newTabUrl).toBeUndefined();
  });

  it("keep Space templates through a backup", () => {
    const template = { id: "template-1-1", name: "Client", icon: "💼", theme: { colors: ["#000000"], appearance: "dark" as const, grain: 0 }, pinned: [{ kind: "tab" as const, url: "https://docs.example/", title: "Docs" }], searchEngine: "google" as const };
    const restored = parseOrFail(backupText({ ...buildSetup().state, spaceTemplates: [template] }));
    expect(restored.state.spaceTemplates).toEqual([template]);
  });

  it("keep command chains, and drop a chain with a step that is not a web page or an action", () => {
    const morning = { id: "chain-1-1", name: "Morning", steps: [{ kind: "open", url: "https://news.example/" }, { kind: "action", actionId: "toggle-sidebar" }] };
    const crafted = { id: "chain-1-2", name: "Crafted", steps: [{ kind: "open", url: "javascript:alert(document.cookie)" }] };
    const text = craftedBackupText((backup) => {
      backup.state.commandChains = [morning, crafted] as BrowserState["commandChains"];
    });
    const restored = parseOrFail(text);
    expect(restored.state.commandChains).toEqual([morning]);
    expect(restored.report.leftOut).toBeGreaterThan(0);
  });

  it("switch JavaScript Boosts off, and drop rules for Spaces that are not there", () => {
    const text = craftedBackupText((backup) => {
      backup.state.routingRules = [...(backup.state.routingRules ?? []), { id: "rule-2", matchType: "is", value: "x", spaceId: "space-gone" }];
    });
    const restored = parseOrFail(text);
    expect(restored.state.boosts?.[0]).toMatchObject({ javascript: "console.log(1)", isJavaScriptOn: false });
    expect(restored.report.scriptsTurnedOff).toBe(1);
    expect(restored.state.routingRules?.map((rule) => rule.id)).toEqual(["rule-1"]);
  });

  it("replace the setup but keep this Mac's windows and extensions", () => {
    const { state } = buildSetup();
    const restored = parseOrFail(backupText(state)).state;
    const current: BrowserState = { ...openWindow(createInitialState(), "window-2"), extensions: [{ id: "abc", profileId: "profile-default", name: "Here", version: "1", path: "/here", isEnabled: true, source: "unpacked" }] };
    const replaced = replaceFromBackup(current, restored);
    expect(replaced.spaces).toEqual(restored.spaces);
    expect(replaced.focusedWindowId).toBe(current.focusedWindowId);
    expect(replaced.otherWindows.map((window) => window.id)).toEqual(["window-1"]);
    expect(replaced.spaces.some((space) => space.id === replaced.otherWindows[0]?.activeSpaceId)).toBe(true);
    expect(replaced.extensions).toEqual(current.extensions);
  });

  it("add a backup's Spaces next to the current ones, under new ids", () => {
    const { state, noteId } = buildSetup();
    const restored = parseOrFail(backupText(state, { [noteId]: "<p>Hello</p>" })).state;
    const current = buildSetup().state;
    const added = addSpacesFromBackup(current, restored, LATER);
    expect(added.state.spaces.length).toBe(current.spaces.length + restored.spaces.length);
    const newSpaces = added.state.spaces.slice(current.spaces.length);
    expect(newSpaces.map((space) => space.name)).toEqual(restored.spaces.map((space) => space.name));
    expect(newSpaces.every((space) => !current.spaces.some((existing) => existing.id === space.id))).toBe(true);
    // The note tab points at a new note id, and the controller is told which file to write it under.
    expect(added.noteIds[noteId]).toBeDefined();
    const noteTab = Object.values(added.state.items).find((item) => item.kind === "tab" && item.url === createNoteUrl(added.noteIds[noteId] as string));
    expect(noteTab).toBeDefined();
    // Boosts and rules that are already here are not added again.
    expect(added.state.boosts?.length).toBe(1);
    expect(added.state.routingRules?.length).toBe(1);
  });

  it("add Favorites up to the limit, not the same address twice", () => {
    const urls = Array.from({ length: FAVORITES_LIMIT }, (_unused, index) => `https://site-${index}.example/`);
    const built = openTabs(urls);
    let backupState = built.state;
    const favoriteIds = built.tabIds;
    backupState = { ...backupState, profiles: backupState.profiles.map((profile) => ({ ...profile, favoriteIds: favoriteIds })), spaces: backupState.spaces.map((space) => ({ ...space, todayIds: space.todayIds.filter((itemId) => !favoriteIds.includes(itemId)) })) };
    const restored = parseOrFail(backupText(backupState)).state;
    const currentBuilt = openTabs(["https://site-0.example/"]);
    const current = { ...currentBuilt.state, profiles: currentBuilt.state.profiles.map((profile) => ({ ...profile, favoriteIds: currentBuilt.tabIds })), spaces: currentBuilt.state.spaces.map((space) => ({ ...space, todayIds: [] })) };
    const added = addSpacesFromBackup(current, restored, LATER).state;
    const favorites = added.profiles[0]?.favoriteIds ?? [];
    expect(favorites.length).toBe(FAVORITES_LIMIT);
    const addresses = favorites.map((favoriteId) => getTab(added, favoriteId).url);
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it("keep Today and the archive of the backup when replacing", () => {
    const { state } = buildSetup();
    const restored = parseOrFail(backupText(state)).state;
    const replaced = replaceFromBackup(createInitialState(), restored);
    expect(getTodayIds(replaced, replaced.activeSpaceId)).toEqual(getTodayIds(restored, restored.activeSpaceId));
  });
});

describe("automatic snapshots", () => {
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const snapshot = (index: number, takenAt: number): SnapshotFile => ({ name: `Snapshot ${index}`, kind: "snapshot", takenAt: takenAt });

  it("keep the newest hourly ones, then one a day for a week", () => {
    // 40 snapshots, one every 6 hours: the newest 12 stay, then the newest of each older day up to the daily limit.
    const files = Array.from({ length: 40 }, (_unused, index) => snapshot(index, ONE_PM - index * 6 * HOUR_MS));
    const deleted = new Set(chooseSnapshotsToDelete(files));
    const kept = files.filter((file) => !deleted.has(file.name));
    expect(kept.slice(0, SNAPSHOTS_HOURLY_KEPT).map((file) => file.name)).toEqual(files.slice(0, SNAPSHOTS_HOURLY_KEPT).map((file) => file.name));
    const olderKept = kept.slice(SNAPSHOTS_HOURLY_KEPT);
    expect(olderKept.length).toBeLessThanOrEqual(SNAPSHOTS_DAILY_KEPT);
    const days = olderKept.map((file) => Math.floor(file.takenAt / DAY_MS));
    expect(new Set(days).size).toBe(days.length);
  });

  it("delete nothing while there are few", () => {
    const files = Array.from({ length: SNAPSHOTS_HOURLY_KEPT }, (_unused, index) => snapshot(index, ONE_PM - index * HOUR_MS));
    expect(chooseSnapshotsToDelete(files)).toEqual([]);
  });

  it("keep only the newest copies from before a restore", () => {
    const files: SnapshotFile[] = Array.from({ length: BEFORE_RESTORE_SNAPSHOTS_KEPT + 2 }, (_unused, index) => ({ name: `Before Restore ${index}`, kind: "beforeRestore", takenAt: ONE_PM - index * DAY_MS }));
    expect(chooseSnapshotsToDelete(files)).toEqual(["Before Restore 5", "Before Restore 6"]);
  });
});
