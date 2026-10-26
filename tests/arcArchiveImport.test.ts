/**
 * WHY this file exists:
 *   The archive importer reads a file we do not control, so it must handle odd shapes without crashing and must be
 *   safe to run twice. These tests pin down what ends up in the archive and in the report.
 *
 * Data source:
 *   Synthetic Arc archive files written by hand below, following docs/research/arc-data-model.md. No real Arc data.
 *
 * Data flow:
 *   fixture builders → importArcArchive() with createInitialState() → checks on the returned state and report
 */
import { describe, expect, it } from "vitest";
import { importArcArchive } from "../src/main/arcArchiveImport";
import { createInitialState } from "../src/main/state";
import { ARCHIVE_LIMIT } from "../src/shared/settings";
import type { BrowserState, TabItem } from "../src/shared/types";
import { ONE_PM } from "./builders";

/** 800000000 Arc seconds = 1778307200 Unix seconds. */
const ARC_SECONDS = 800000000;
const EXPECTED_UNIX_MILLISECONDS = 1778307200000;

interface ArchivedItemFixture {
  id: string;
  archivedAt?: number;
  reason?: string;
  source?: Record<string, unknown>;
  title?: string | null;
  savedUrl?: string;
  savedTitle?: string;
  timeLastActiveAt?: number;
  savedMuteStatus?: string;
}

/** Builds the flat [id, item, id, item, …] list of Arc's archive file. */
function createArchiveFile(fixtures: ArchivedItemFixture[]): unknown {
  const flatItems: unknown[] = [];
  for (const fixture of fixtures) {
    const tabData: Record<string, unknown> = {
      savedURL: fixture.savedUrl ?? "https://example.com/",
      savedTitle: fixture.savedTitle ?? "Example",
    };
    if (fixture.timeLastActiveAt !== undefined) {
      tabData["timeLastActiveAt"] = fixture.timeLastActiveAt;
    }
    if (fixture.savedMuteStatus !== undefined) {
      tabData["savedMuteStatus"] = fixture.savedMuteStatus;
    }
    flatItems.push(fixture.id, {
      archivedAt: fixture.archivedAt ?? ARC_SECONDS,
      reason: fixture.reason ?? "auto",
      source: fixture.source ?? { unknown: {} },
      sidebarItem: { id: fixture.id, title: fixture.title ?? null, data: { tab: tabData } },
    });
  }
  return { version: 1, items: flatItems };
}

function createStateWithSpace(arcSpaceId: string): BrowserState {
  const state = createInitialState();
  const firstSpace = state.spaces[0];
  if (firstSpace === undefined) {
    throw new Error("Test setup problem: the initial state has no Space");
  }
  const importedSpace = { ...firstSpace, id: `arc-space-${arcSpaceId}` };
  return { ...state, spaces: [...state.spaces, importedSpace] };
}

describe("importArcArchive", () => {
  it("maps every field of an archived tab", () => {
    const file = createArchiveFile([
      {
        id: "ITEM-1",
        title: "My rename",
        savedUrl: "https://a.example/page",
        savedTitle: "A page",
        timeLastActiveAt: ARC_SECONDS - 100,
        savedMuteStatus: "mute",
        reason: "manual",
      },
    ]);
    const result = importArcArchive(file, createInitialState(), ONE_PM);
    expect(result.report).toEqual({ archivedImported: 1, archivedSkipped: 0, error: null });
    expect(result.state.archive[0]).toEqual({
      tab: {
        kind: "tab",
        id: "arc-ITEM-1",
        url: "https://a.example/page",
        title: "A page",
        customTitle: "My rename",
        faviconUrl: null,
        homeUrl: null,
        lastActiveAt: EXPECTED_UNIX_MILLISECONDS - 100000,
        isMuted: true,
      },
      fromSpaceId: null,
      archivedAt: EXPECTED_UNIX_MILLISECONDS,
      reason: "manual",
    });
  });

  it("falls back to the address as title, no custom title, archive time as last active time and not muted", () => {
    const file = createArchiveFile([{ id: "ITEM-1", savedTitle: "  ", title: "  " }]);
    const archivedTab = importArcArchive(file, createInitialState(), ONE_PM).state.archive[0];
    expect(archivedTab?.tab.title).toBe("https://example.com/");
    expect(archivedTab?.tab.customTitle).toBeNull();
    expect(archivedTab?.tab.lastActiveAt).toBe(EXPECTED_UNIX_MILLISECONDS);
    expect(archivedTab?.tab.isMuted).toBe(false);
  });

  it("converts every reason", () => {
    const reasonByArcReason: Array<[string, string]> = [
      ["auto", "auto"],
      ["manual", "manual"],
      ["clearButton", "clear-button"],
      ["clearTabGroup", "clear-button"],
      ["somethingNew", "manual"],
    ];
    for (const [arcReason, expectedReason] of reasonByArcReason) {
      const file = createArchiveFile([{ id: "ITEM-1", reason: arcReason }]);
      const archivedTab = importArcArchive(file, createInitialState(), ONE_PM).state.archive[0];
      expect(archivedTab?.reason, arcReason).toBe(expectedReason);
    }
  });

  it("sets fromSpaceId only when the Space exists in the state", () => {
    const file = createArchiveFile([
      { id: "KNOWN", source: { space: { _0: "SPACE-1" } }, archivedAt: ARC_SECONDS + 3 },
      { id: "MISSING", source: { space: { _0: "SPACE-GONE" } }, archivedAt: ARC_SECONDS + 2 },
      { id: "LITTLE", source: { littleArc: {} }, archivedAt: ARC_SECONDS + 1 },
    ]);
    const archive = importArcArchive(file, createStateWithSpace("SPACE-1"), ONE_PM).state.archive;
    expect(archive.map((archivedTab) => archivedTab.fromSpaceId)).toEqual(["arc-space-SPACE-1", null, null]);
  });

  it("skips addresses that are not http(s) and counts them", () => {
    const file = createArchiveFile([
      { id: "FILE", savedUrl: "file:///etc/hosts" },
      { id: "ABOUT", savedUrl: "about:blank" },
      { id: "WEB", savedUrl: "http://plain.example/" },
    ]);
    const result = importArcArchive(file, createInitialState(), ONE_PM);
    expect(result.state.archive.map((archivedTab) => archivedTab.tab.id)).toEqual(["arc-WEB"]);
    expect(result.report).toEqual({ archivedImported: 1, archivedSkipped: 2, error: null });
  });

  it("does nothing the second time", () => {
    const file = createArchiveFile([{ id: "ITEM-1" }, { id: "ITEM-2" }]);
    const first = importArcArchive(file, createInitialState(), ONE_PM);
    const second = importArcArchive(file, first.state, ONE_PM);
    expect(second.state).toBe(first.state);
    expect(second.report).toEqual({ archivedImported: 0, archivedSkipped: 2, error: null });
  });

  it("skips an item whose id is already a tab in the sidebar", () => {
    const state = createInitialState();
    const tab: TabItem = {
      kind: "tab",
      id: "arc-ITEM-1",
      url: "https://x.example/",
      title: "X",
      customTitle: null,
      faviconUrl: null,
      homeUrl: null,
      lastActiveAt: ONE_PM,
      isMuted: false,
    };
    const stateWithTab: BrowserState = { ...state, items: { ...state.items, [tab.id]: tab } };
    const result = importArcArchive(createArchiveFile([{ id: "ITEM-1" }]), stateWithTab, ONE_PM);
    expect(result.state).toBe(stateWithTab);
    expect(result.report.archivedSkipped).toBe(1);
  });

  it("merges with the existing archive, newest first", () => {
    const firstFile = createArchiveFile([
      { id: "OLD", archivedAt: ARC_SECONDS },
      { id: "NEWEST", archivedAt: ARC_SECONDS + 20 },
    ]);
    const firstImport = importArcArchive(firstFile, createInitialState(), ONE_PM);
    const secondFile = createArchiveFile([
      { id: "OLDEST", archivedAt: ARC_SECONDS - 5 },
      { id: "MIDDLE", archivedAt: ARC_SECONDS + 10 },
    ]);
    const merged = importArcArchive(secondFile, firstImport.state, ONE_PM).state.archive;
    expect(merged.map((archivedTab) => archivedTab.tab.id)).toEqual(["arc-NEWEST", "arc-MIDDLE", "arc-OLD", "arc-OLDEST"]);
  });

  it("keeps only the newest ARCHIVE_LIMIT entries", () => {
    const fixtures: ArchivedItemFixture[] = [];
    for (let index = 0; index < ARCHIVE_LIMIT + 10; index += 1) {
      fixtures.push({ id: `ITEM-${index}`, archivedAt: ARC_SECONDS + index });
    }
    const archive = importArcArchive(createArchiveFile(fixtures), createInitialState(), ONE_PM).state.archive;
    expect(archive).toHaveLength(ARCHIVE_LIMIT);
    expect(archive[0]?.tab.id).toBe(`arc-ITEM-${ARCHIVE_LIMIT + 9}`);
    expect(archive[ARCHIVE_LIMIT - 1]?.tab.id).toBe("arc-ITEM-10");
  });

  it("returns the same state with an error for unreadable input", () => {
    const state = createInitialState();
    for (const badInput of [null, undefined, {}, { items: "x" }, [], "text", 7]) {
      const result = importArcArchive(badInput, state, ONE_PM);
      expect(result.state).toBe(state);
      expect(result.report.error).not.toBeNull();
    }
  });

  it("skips malformed entries without failing", () => {
    const file = { version: 1, items: ["A", null, "B", "not an object", 5, {}, "C", { sidebarItem: {} }, "D"] };
    const state = createInitialState();
    const result = importArcArchive(file, state, ONE_PM);
    expect(result.state).toBe(state);
    expect(result.report.error).toBeNull();
    expect(result.report.archivedImported).toBe(0);
  });
});
