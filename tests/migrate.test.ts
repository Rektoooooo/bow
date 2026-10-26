/**
 * WHY this file exists:
 *   A failed upgrade would empty the user's sidebar. This test feeds a literal version 1 file through the upgrade.
 */
import { describe, expect, it } from "vitest";
import { upgradeToCurrentVersion } from "../src/main/migrate";
import { DEFAULT_PROFILE_ID } from "../src/shared/settings";

/** A file exactly as milestone 1 saved it: one pinned and one Today tab in Personal, one archived tab. */
const VERSION_1_FILE = {
  version: 1,
  spaces: [
    { id: "space-personal", name: "Personal", icon: "🏠", color: "#e9d8d4" },
    { id: "space-work", name: "Work", icon: "💼", color: "#d4dfe9" },
  ],
  tabs: [
    { id: "tab-today", spaceId: "space-personal", url: "https://b.example", title: "B", isPinned: false, homeUrl: null, lastActiveAt: 200 },
    { id: "tab-pinned", spaceId: "space-personal", url: "https://a.example/x", title: "A", isPinned: true, homeUrl: "https://a.example", lastActiveAt: 100 },
  ],
  activeSpaceId: "space-personal",
  selectedTabIdBySpace: { "space-personal": "tab-today", "space-work": null },
  archive: [
    {
      tab: { id: "tab-old", spaceId: "space-work", url: "https://c.example", title: "C", isPinned: false, homeUrl: null, lastActiveAt: 50 },
      archivedAt: 300,
      reason: "auto",
    },
  ],
  settings: { archiveAfterMs: 3600000 },
};

describe("upgradeToCurrentVersion", () => {
  it("turns a version 1 file into version 2 without losing tabs, selection, archive or settings", () => {
    const state = upgradeToCurrentVersion(VERSION_1_FILE);

    expect(state?.version).toBe(2);
    expect(state?.spaces[0]?.pinnedIds).toEqual(["tab-pinned"]);
    expect(state?.spaces[0]?.todayIds).toEqual(["tab-today"]);
    expect(state?.spaces[0]?.theme.colors).toEqual(["#e9d8d4"]);
    expect(state?.spaces[0]?.profileId).toBe(DEFAULT_PROFILE_ID);
    expect(state?.items["tab-pinned"]).toMatchObject({ kind: "tab", homeUrl: "https://a.example", customTitle: null });
    expect(state?.selectedTabIdBySpace["space-personal"]).toBe("tab-today");
    expect(state?.archive[0]).toMatchObject({ fromSpaceId: "space-work", archivedAt: 300, reason: "auto" });
    expect(state?.settings.archiveAfterMs).toBe(3600000);
  });

  it("returns a version 2 file unchanged", () => {
    const upgraded = upgradeToCurrentVersion(VERSION_1_FILE);

    expect(upgradeToCurrentVersion(upgraded)).toBe(upgraded);
  });

  it("refuses files it does not understand", () => {
    expect(upgradeToCurrentVersion(null)).toBeNull();
    expect(upgradeToCurrentVersion({ version: 3, spaces: [] })).toBeNull();
    expect(upgradeToCurrentVersion({ version: 1, spaces: [], tabs: [], archive: [], activeSpaceId: "x" })).toBeNull();
  });
});
