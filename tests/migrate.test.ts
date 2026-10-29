/**
 * WHY this file exists:
 *   A failed upgrade would empty the user's sidebar. This test feeds a literal version 1 file through the upgrade.
 */
import { describe, expect, it } from "vitest";
import { upgradeToCurrentVersion } from "../src/main/migrate";
import { createInitialState } from "../src/main/state";
import { DEFAULT_PROFILE_ID, FIRST_WINDOW_ID } from "../src/shared/settings";
import type { BrowserState, ItemId, TabItem } from "../src/shared/types";

/** A file exactly as milestone 1 saved it: one pinned and one Today tab in Personal, one archived tab. */
const NOW = 1_800_000_000_000;

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
  it("turns a version 1 file into the current version without losing tabs, selection, archive or settings", () => {
    const state = upgradeToCurrentVersion(VERSION_1_FILE, NOW);

    expect(state?.version).toBe(5);
    expect(state?.spaces[0]?.pinnedIds).toEqual(["tab-pinned"]);
    expect(state?.spaces[0]?.todayIds).toEqual(["tab-today"]);
    expect(state?.spaces[0]?.theme.colors).toEqual(["#e9d8d4"]);
    expect(state?.spaces[0]?.profileId).toBe(DEFAULT_PROFILE_ID);
    expect(state?.items["tab-pinned"]).toMatchObject({ kind: "tab", homeUrl: "https://a.example", customTitle: null });
    expect(state?.selectedTabIdBySpace["space-personal"]).toBe("tab-today");
    expect(state?.archive[0]).toMatchObject({ fromSpaceId: "space-work", archivedAt: 300, reason: "auto" });
    expect(state?.settings.archiveAfterMs).toBe(3600000);
  });

  it("upgrades a version 1 file all the way, with its one window as the first window", () => {
    const state = upgradeToCurrentVersion(VERSION_1_FILE, NOW);

    expect(state?.version).toBe(5);
    expect(state?.focusedWindowId).toBe(FIRST_WINDOW_ID);
    expect(state?.otherWindows).toEqual([]);
  });

  it("turns a version 2 file into the current version: one window, same Space and selection", () => {
    const version2File = { ...createInitialState(), version: 2, focusedWindowId: undefined, otherWindows: undefined, activeSpaceId: "space-work", selectedTabIdBySpace: { "space-personal": null, "space-work": null } };

    const state = upgradeToCurrentVersion(JSON.parse(JSON.stringify(version2File)), NOW);

    expect(state).toMatchObject({ version: 5, focusedWindowId: FIRST_WINDOW_ID, otherWindows: [], activeSpaceId: "space-work" });
  });

  it("turns a version 3 file into the current version: every parked window gets the sidebar, Pinned sections and folders all shared", () => {
    const initial = createInitialState();
    const folder = { kind: "folder", id: "folder-1", title: "F", childIds: [], isOpen: true };
    const spaces = initial.spaces.map((space) => (space.id === "space-work" ? { ...space, isPinnedOpen: false } : space));
    const parkedV3 = { id: "window-2", activeSpaceId: "space-work", selectedTabIdBySpace: { "space-personal": null, "space-work": null } };
    const version3File = {
      ...initial,
      version: 3,
      items: { "folder-1": folder },
      spaces: spaces,
      settings: { ...initial.settings, isSidebarVisible: false, sidebarWidth: 280 },
      otherWindows: [parkedV3],
    };

    const state = upgradeToCurrentVersion(JSON.parse(JSON.stringify(version3File)), NOW);

    expect(state?.version).toBe(5);
    expect(state?.otherWindows[0]).toEqual({
      ...parkedV3,
      isSidebarVisible: false,
      sidebarWidth: 280,
      collapsedPinnedSpaceIds: ["space-work"],
      openFolderIds: ["folder-1"],
    });
    expect(state?.settings).toMatchObject({ isSidebarVisible: false, sidebarWidth: 280 });
  });

  it("returns a current file unchanged", () => {
    const upgraded = upgradeToCurrentVersion(VERSION_1_FILE, NOW);

    expect(upgradeToCurrentVersion(upgraded, NOW)).toBe(upgraded);
  });

  it("refuses files it does not understand", () => {
    expect(upgradeToCurrentVersion(null, NOW)).toBeNull();
    expect(upgradeToCurrentVersion({ version: 5, spaces: [] }, NOW)).toBeNull();
    expect(upgradeToCurrentVersion({ ...createInitialState(), version: 6 }, NOW)).toBeNull();
    expect(upgradeToCurrentVersion({ ...createInitialState(), otherWindows: undefined }, NOW)).toBeNull();
    expect(upgradeToCurrentVersion({ version: 1, spaces: [], tabs: [], archive: [], activeSpaceId: "x" }, NOW)).toBeNull();
  });
});

const WORK_PROFILE_ID = "profile-work";

/** A made-up tab with its own address. */
function makeTab(id: string, lastActiveAt: number): TabItem {
  return { kind: "tab", id: id, url: `https://${id}.example/`, title: id, customTitle: null, faviconUrl: null, homeUrl: `https://${id}.example/`, lastActiveAt: lastActiveAt, isMuted: false };
}

/**
 * A version 4 file as the previous Bow saved it: Favorites on the profiles, none on the Spaces. Personal and Work
 * share the default profile unless `workProfileId` says otherwise.
 */
function buildVersion4File(favoritesByProfile: Record<string, ItemId[]>, options: { workProfileId?: string; activeSpaceId?: string } = {}): Record<string, unknown> {
  const initial = createInitialState();
  const tabIds = Object.values(favoritesByProfile).flat();
  const items: BrowserState["items"] = {};
  tabIds.forEach((tabId, index) => {
    items[tabId] = makeTab(tabId, index + 1);
  });
  const spaces = initial.spaces.map(({ favoriteIds: _unused, ...space }) => (space.id === "space-work" ? { ...space, profileId: options.workProfileId ?? space.profileId } : space));
  const profileIds = [DEFAULT_PROFILE_ID, ...(options.workProfileId === undefined ? [] : [options.workProfileId])];
  const profiles = [...profileIds, ...Object.keys(favoritesByProfile).filter((profileId) => !profileIds.includes(profileId))].map((profileId) => ({
    id: profileId,
    name: profileId,
    favoriteIds: favoritesByProfile[profileId] ?? [],
  }));
  return JSON.parse(JSON.stringify({ ...initial, version: 4, items: items, profiles: profiles, spaces: spaces, activeSpaceId: options.activeSpaceId ?? "space-personal" }));
}

function favoritesOf(state: BrowserState | null, spaceId: string): ItemId[] {
  return state?.spaces.find((space) => space.id === spaceId)?.favoriteIds ?? [];
}

describe("upgrading a version 4 file: Favorites move from the profile to a Space", () => {
  it("leaves Spaces with their own profile as they were, each profile's Favorites on its Space", () => {
    const file = buildVersion4File({ [DEFAULT_PROFILE_ID]: ["fav-home"], [WORK_PROFILE_ID]: ["fav-job"] }, { workProfileId: WORK_PROFILE_ID });

    const state = upgradeToCurrentVersion(file, NOW);

    expect(state?.version).toBe(5);
    expect(favoritesOf(state, "space-personal")).toEqual(["fav-home"]);
    expect(favoritesOf(state, "space-work")).toEqual(["fav-job"]);
    expect(state?.profiles.every((profile) => !("favoriteIds" in profile))).toBe(true);
    expect(state?.archive).toEqual([]);
  });

  it("gives a shared profile's Favorites to the focused window's active Space, the other starts empty", () => {
    const file = buildVersion4File({ [DEFAULT_PROFILE_ID]: ["fav-a", "fav-b"] }, { activeSpaceId: "space-work" });

    const state = upgradeToCurrentVersion(file, NOW);

    expect(favoritesOf(state, "space-work")).toEqual(["fav-a", "fav-b"]);
    expect(favoritesOf(state, "space-personal")).toEqual([]);
  });

  it("uses a parked window's active Space when the focused window's Space has another profile", () => {
    // Work (the focused window's Space) has its own profile; Personal and Work2 share the default one.
    const base = buildVersion4File({ [DEFAULT_PROFILE_ID]: ["fav-a"], [WORK_PROFILE_ID]: [] }, { workProfileId: WORK_PROFILE_ID, activeSpaceId: "space-work" });
    const thirdSpace = { ...(base.spaces as Record<string, unknown>[])[0], id: "space-third", name: "Third", profileId: DEFAULT_PROFILE_ID };
    const parked = { id: "window-2", activeSpaceId: "space-third", selectedTabIdBySpace: {}, isSidebarVisible: true, collapsedPinnedSpaceIds: [], openFolderIds: [] };
    const file = { ...base, spaces: [...(base.spaces as unknown[]), thirdSpace], otherWindows: [parked] };

    const state = upgradeToCurrentVersion(file, NOW);

    expect(favoritesOf(state, "space-third")).toEqual(["fav-a"]);
    expect(favoritesOf(state, "space-personal")).toEqual([]);
  });

  it("falls back to the first Space with the profile when no window shows one", () => {
    const base = buildVersion4File({ [DEFAULT_PROFILE_ID]: ["fav-a"], [WORK_PROFILE_ID]: [] }, { workProfileId: WORK_PROFILE_ID, activeSpaceId: "space-work" });
    const spaces = base.spaces as Record<string, unknown>[];
    const thirdSpace = { ...spaces[0], id: "space-third", name: "Third", profileId: DEFAULT_PROFILE_ID };
    const file = { ...base, spaces: [...spaces, thirdSpace] };

    const state = upgradeToCurrentVersion(file, NOW);

    expect(favoritesOf(state, "space-personal")).toEqual(["fav-a"]);
    expect(favoritesOf(state, "space-third")).toEqual([]);
  });

  it("archives the Favorites of a profile no Space uses", () => {
    const file = buildVersion4File({ [DEFAULT_PROFILE_ID]: [], "profile-unused": ["fav-lost"] });

    const state = upgradeToCurrentVersion(file, NOW);

    expect(state?.items["fav-lost"]).toBeUndefined();
    expect(state?.archive[0]).toMatchObject({ fromSpaceId: null, archivedAt: NOW, reason: "manual" });
    expect(state?.archive[0]?.tab.id).toBe("fav-lost");
  });

  it("repairs selections that pointed at a Favorite which went to another Space, in every window", () => {
    const base = buildVersion4File({ [DEFAULT_PROFILE_ID]: ["fav-a"] }, { activeSpaceId: "space-work" });
    const items = { ...(base.items as Record<string, unknown>), "tab-today": makeTab("tab-today", 5) };
    const spaces = (base.spaces as Record<string, unknown>[]).map((space) => (space.id === "space-personal" ? { ...space, todayIds: ["tab-today"] } : space));
    const parked = { id: "window-2", activeSpaceId: "space-personal", selectedTabIdBySpace: { "space-personal": "fav-a", "space-work": "fav-a" }, isSidebarVisible: true, collapsedPinnedSpaceIds: [], openFolderIds: [] };
    const file = { ...base, items: items, spaces: spaces, selectedTabIdBySpace: { "space-personal": "fav-a", "space-work": "fav-a" }, otherWindows: [parked] };

    const state = upgradeToCurrentVersion(JSON.parse(JSON.stringify(file)), NOW);

    // Work (the active Space) holds the Favorite; Personal now holds only its Today tab.
    expect(favoritesOf(state, "space-work")).toEqual(["fav-a"]);
    expect(state?.selectedTabIdBySpace).toEqual({ "space-personal": "tab-today", "space-work": "fav-a" });
    expect(state?.otherWindows[0]?.selectedTabIdBySpace).toEqual({ "space-personal": "tab-today", "space-work": "fav-a" });
  });
});

