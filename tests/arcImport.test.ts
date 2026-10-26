/**
 * WHY this file exists:
 *   The Arc importer reads a file we do not control, so it must handle odd shapes without crashing and must be
 *   safe to run twice. These tests pin down what ends up in the state and in the report.
 *
 * Data source:
 *   Synthetic Arc files written by hand below, following docs/research/arc-data-model.md. No real Arc data.
 *
 * Data flow:
 *   fixture builders → importArcSidebar() with createInitialState() → checks on the returned state and report
 */
import { describe, expect, it } from "vitest";
import { importArcSidebar } from "../src/main/arcImport";
import { createInitialState } from "../src/main/state";
import { DEFAULT_PROFILE_ID, FAVORITES_LIMIT } from "../src/shared/settings";
import type { BrowserState, FolderItem, SplitItem, TabItem } from "../src/shared/types";
import { ONE_PM } from "./builders";

const DEFAULT_PROFILE_KEY = { default: true };
const CUSTOM_PROFILE_KEY = { custom: { _0: { directoryBasename: "Profile 1", machineID: "machine" } } };

/** 800000000 Arc seconds = 1778307200 Unix seconds. */
const ARC_SECONDS = 800000000;
const EXPECTED_UNIX_MILLISECONDS = 1778307200000;

interface ArcItemFixture {
  id: string;
  value: Record<string, unknown>;
}

function arcTab(id: string, url: string | null, options: { title?: string | null; savedTitle?: string; mute?: boolean; lastActive?: number } = {}): ArcItemFixture {
  const tabData: Record<string, unknown> = { savedTitle: options.savedTitle ?? "Page title" };
  if (url !== null) {
    tabData["savedURL"] = url;
  }
  if (options.mute === true) {
    tabData["savedMuteStatus"] = "mute";
  }
  if (options.lastActive !== undefined) {
    tabData["timeLastActiveAt"] = options.lastActive;
  }
  return { id: id, value: { id: id, title: options.title ?? null, childrenIds: [], data: { tab: tabData } } };
}

function arcFolder(id: string, title: string | null, childrenIds: string[], isLive = false): ArcItemFixture {
  const listData: Record<string, unknown> = isLive ? { automaticLiveFolderData: { github: {} } } : {};
  return { id: id, value: { id: id, title: title, childrenIds: childrenIds, data: { list: listData } } };
}

function arcSplit(id: string, childrenIds: string[], orientation: string): ArcItemFixture {
  return { id: id, value: { id: id, title: null, childrenIds: childrenIds, data: { splitView: { layoutOrientation: orientation } } } };
}

function arcEasel(id: string): ArcItemFixture {
  return { id: id, value: { id: id, title: null, childrenIds: [], data: { easel: {} } } };
}

function arcContainer(id: string, childrenIds: string[]): ArcItemFixture {
  return { id: id, value: { id: id, title: null, childrenIds: childrenIds, data: { itemContainer: {} } } };
}

function color(red: number, green: number, blue: number): Record<string, unknown> {
  return { red: red, green: green, blue: blue, alpha: 1, colorSpace: "extendedSRGB" };
}

function gradientTheme(): Record<string, unknown> {
  const baseColors = [color(1, 0, 0), color(0, 1.2, 0), color(0, 0, 1), color(1, 1, 1)];
  return {
    windowTheme: {
      background: {
        single: {
          _0: {
            style: {
              color: { _0: { blendedGradient: { _0: { baseColors: baseColors } } } },
              modifiers: { intensityFactor: 0.5, noiseFactor: 1.7 },
            },
            contentOverBackgroundAppearance: "dark",
          },
        },
      },
    },
  };
}

function singleColorTheme(): Record<string, unknown> {
  return {
    windowTheme: {
      background: {
        single: {
          _0: {
            style: {
              color: { _0: { blendedSingleColor: { _0: { color: color(0.2, 0.4, 0.6) } } } },
              modifiers: { noiseFactor: 0.25 },
            },
            contentOverBackgroundAppearance: "light",
          },
        },
      },
    },
  };
}

function arcSpace(id: string, title: string, profile: unknown, pinnedId: string, unpinnedId: string, customInfo: unknown): Record<string, unknown> {
  return {
    id: id,
    title: title,
    profile: profile,
    customInfo: customInfo,
    containerIDs: ["unpinned", unpinnedId, "pinned", pinnedId],
  };
}

function flattenPairs(entries: Array<[string, unknown]>): unknown[] {
  return entries.flatMap(([key, value]) => [key, value]);
}

function buildArcFile(spaces: Array<[string, unknown]>, items: ArcItemFixture[], topApps: Array<[unknown, string]>): unknown {
  const itemEntries: Array<[string, unknown]> = items.map((item) => [item.id, item.value]);
  return {
    version: 1,
    sidebar: {
      containers: [
        { global: {} },
        {
          spaces: flattenPairs(spaces),
          items: flattenPairs(itemEntries),
          topAppsContainerIDs: topApps.flatMap(([profileKey, containerId]) => [profileKey, containerId]),
        },
      ],
    },
    sidebarSyncState: { ignored: true },
  };
}

/**
 * Space "alpha" (default profile, planet icon, flat theme):
 *   Pinned: folder "outer" [ folder "inner" [ tab "deep" ], tab "renamed" ], easel, live folder, split, tab without URL
 *   Today: tab "today-one", folder "today-folder" [ tab "today-two" ]
 * Space "beta" (custom profile, gradient theme): Pinned: tab "beta-tab"
 * Favorites: default profile → "fav-default"; "Profile 1" → "fav-custom"
 */
function buildTwoSpaceFile(): unknown {
  const items: ArcItemFixture[] = [
    arcContainer("alpha-pinned", ["outer", "easel-one", "live", "split", "no-url"]),
    arcContainer("alpha-unpinned", ["today-one", "today-folder"]),
    arcContainer("beta-pinned", ["beta-tab"]),
    arcContainer("beta-unpinned", []),
    arcFolder("outer", "Work links", ["inner", "renamed"]),
    arcFolder("inner", null, ["deep"]),
    arcTab("deep", "https://deep.example/", { savedTitle: "Deep page", lastActive: ARC_SECONDS }),
    arcTab("renamed", "https://renamed.example/", { title: "My name", savedTitle: "Original title", mute: true }),
    arcEasel("easel-one"),
    arcFolder("live", "Pull requests", ["live-tab"], true),
    arcTab("live-tab", "https://github.example/pr/1"),
    arcSplit("split", ["split-a", "split-b"], "vertical"),
    arcTab("split-a", "https://a.example/"),
    arcTab("split-b", "https://b.example/"),
    arcTab("no-url", null),
    arcTab("today-one", "https://today-one.example/"),
    arcFolder("today-folder", "Ignored folder", ["today-two"]),
    arcTab("today-two", "https://today-two.example/"),
    arcTab("beta-tab", "https://beta.example/"),
    arcContainer("fav-default", ["fav-one"]),
    arcContainer("fav-custom", ["fav-two", "fav-easel"]),
    arcTab("fav-one", "https://fav-one.example/"),
    arcTab("fav-two", "https://fav-two.example/"),
    arcEasel("fav-easel"),
  ];
  const spaces: Array<[string, unknown]> = [
    ["alpha", arcSpace("alpha", "  Alpha  ", DEFAULT_PROFILE_KEY, "alpha-pinned", "alpha-unpinned", { iconType: { icon: "planet" }, ...singleColorTheme() })],
    ["beta", arcSpace("beta", "", CUSTOM_PROFILE_KEY, "beta-pinned", "beta-unpinned", { iconType: { emoji: "🦊" }, ...gradientTheme() })],
  ];
  const topApps: Array<[unknown, string]> = [
    [DEFAULT_PROFILE_KEY, "fav-default"],
    [CUSTOM_PROFILE_KEY, "fav-custom"],
  ];
  return buildArcFile(spaces, items, topApps);
}

function getTabFrom(state: BrowserState, itemId: string): TabItem {
  const item = state.items[itemId];
  if (item === undefined || item.kind !== "tab") {
    throw new Error(`Test setup problem: ${itemId} is not a tab`);
  }
  return item;
}

function getFolderFrom(state: BrowserState, itemId: string): FolderItem {
  const item = state.items[itemId];
  if (item === undefined || item.kind !== "folder") {
    throw new Error(`Test setup problem: ${itemId} is not a folder`);
  }
  return item;
}

describe("importing Spaces", () => {
  it("appends one new Space per Arc Space, with name, icon, profile and selection", () => {
    const state = createInitialState();

    const { state: imported, report } = importArcSidebar(buildTwoSpaceFile(), state, ONE_PM);

    expect(report.error).toBeNull();
    expect(report.spacesImported).toBe(2);
    expect(imported.spaces.map((space) => space.id)).toEqual(["space-personal", "space-work", "arc-space-alpha", "arc-space-beta"]);
    const alpha = imported.spaces[2];
    const beta = imported.spaces[3];
    expect(alpha.name).toBe("Alpha");
    expect(alpha.icon).toBe("🪐");
    expect(alpha.profileId).toBe(DEFAULT_PROFILE_ID);
    expect(alpha.isPinnedOpen).toBe(true);
    expect(beta.name).toBe("Imported Space");
    expect(beta.icon).toBe("🦊");
    expect(beta.profileId).toBe("arc-profile-profile-1");
    expect(imported.selectedTabIdBySpace["arc-space-alpha"]).toBeNull();
    expect(imported.profiles.map((profile) => profile.id)).toEqual([DEFAULT_PROFILE_ID, "arc-profile-profile-1"]);
    expect(imported.profiles[1].name).toBe("Profile 1");
    expect(state.spaces).toHaveLength(2);
  });

  it("reads a flat theme and a clamped gradient theme, with Arc's intensity (full when missing)", () => {
    const { state: imported } = importArcSidebar(buildTwoSpaceFile(), createInitialState(), ONE_PM);

    expect(imported.spaces[2].theme).toEqual({ colors: ["#336699"], appearance: "light", grain: 0.25, intensity: 1 });
    expect(imported.spaces[3].theme).toEqual({ colors: ["#ff0000", "#00ff00", "#0000ff"], appearance: "dark", grain: 1, intensity: 0.5 });
  });

  it("falls back to the default theme and icon when Arc has none", () => {
    const items = [arcContainer("p", []), arcContainer("u", [])];
    const spaces: Array<[string, unknown]> = [["plain", arcSpace("plain", "Plain", DEFAULT_PROFILE_KEY, "p", "u", { iconType: { icon: "unknown-icon" } })]];

    const { state: imported } = importArcSidebar(buildArcFile(spaces, items, []), createInitialState(), ONE_PM);

    expect(imported.spaces[2].theme).toEqual({ colors: ["#000000"], appearance: "auto", grain: 0 });
    expect(imported.spaces[2].icon).toBe("✦");
  });

  it("drops Spaces beyond the limit together with their items", () => {
    const items = [arcContainer("p", ["t"]), arcContainer("u", []), arcTab("t", "https://limit.example/")];
    const spaceEntries: Array<[string, unknown]> = [];
    for (let index = 0; index < 9; index++) {
      spaceEntries.push([`s${index}`, arcSpace(`s${index}`, `S${index}`, DEFAULT_PROFILE_KEY, index === 8 ? "p" : "u", "u", null)]);
    }

    const { state: imported, report } = importArcSidebar(buildArcFile(spaceEntries, items, []), createInitialState(), ONE_PM);

    expect(imported.spaces).toHaveLength(9);
    expect(report.spacesImported).toBe(7);
    expect(report.spacesDropped).toBe(2);
    expect(imported.items["arc-t"]).toBeUndefined();
  });
});

describe("importing Pinned and Today items", () => {
  it("nests folders, keeps customTitle apart from savedTitle and converts times", () => {
    const { state: imported } = importArcSidebar(buildTwoSpaceFile(), createInitialState(), ONE_PM);

    const alpha = imported.spaces[2];
    expect(alpha.pinnedIds.slice(0, 1)).toEqual(["arc-outer"]);
    const outer = getFolderFrom(imported, "arc-outer");
    expect(outer.title).toBe("Work links");
    expect(outer.childIds).toEqual(["arc-inner", "arc-renamed"]);
    const inner = getFolderFrom(imported, "arc-inner");
    expect(inner.title).toBe("Folder");
    expect(inner.childIds).toEqual(["arc-deep"]);

    const renamed = getTabFrom(imported, "arc-renamed");
    expect(renamed.customTitle).toBe("My name");
    expect(renamed.title).toBe("Original title");
    expect(renamed.isMuted).toBe(true);
    expect(renamed.homeUrl).toBe("https://renamed.example/");
    expect(renamed.lastActiveAt).toBe(ONE_PM);

    const deep = getTabFrom(imported, "arc-deep");
    expect(deep.customTitle).toBeNull();
    expect(deep.lastActiveAt).toBe(EXPECTED_UNIX_MILLISECONDS);
  });

  it("puts Today tabs in Today without home address and flattens folders", () => {
    const { state: imported } = importArcSidebar(buildTwoSpaceFile(), createInitialState(), ONE_PM);

    const alpha = imported.spaces[2];
    expect(alpha.todayIds).toEqual(["arc-today-one", "arc-today-two"]);
    expect(getTabFrom(imported, "arc-today-one").homeUrl).toBeNull();
    expect(imported.items["arc-today-folder"]).toBeUndefined();
  });

  it("imports a split view with its orientation", () => {
    const { state: imported, report } = importArcSidebar(buildTwoSpaceFile(), createInitialState(), ONE_PM);

    const split = imported.items["arc-split"] as SplitItem;
    expect(split.kind).toBe("split");
    expect(split.childIds).toEqual(["arc-split-a", "arc-split-b"]);
    expect(split.orientation).toBe("vertical");
    expect(report.splitViewsImported).toBe(1);
  });

  it("counts live folders, unknown kinds and tabs without a URL", () => {
    const { report } = importArcSidebar(buildTwoSpaceFile(), createInitialState(), ONE_PM);

    expect(report.liveFolders).toBe(1);
    expect(report.skippedByKind["easel"]).toBe(2);
    expect(report.skippedByKind["tabWithoutUrl"]).toBe(1);
    expect(report.foldersImported).toBe(3);
    expect(report.tabsImported).toBe(8);
  });

  it("puts the rest of an oversized split view after it, and loose tabs when fewer than two remain", () => {
    const paneIds = ["a", "b", "c", "d", "e"];
    const items = [
      arcContainer("p", ["big", "small"]),
      arcContainer("u", []),
      arcSplit("big", paneIds, "horizontal"),
      ...paneIds.map((paneId) => arcTab(paneId, `https://${paneId}.example/`)),
      arcSplit("small", ["lonely"], "horizontal"),
      arcTab("lonely", "https://lonely.example/"),
    ];
    const spaces: Array<[string, unknown]> = [["s", arcSpace("s", "S", DEFAULT_PROFILE_KEY, "p", "u", null)]];

    const { state: imported } = importArcSidebar(buildArcFile(spaces, items, []), createInitialState(), ONE_PM);

    expect(imported.spaces[2].pinnedIds).toEqual(["arc-big", "arc-e", "arc-lonely"]);
    expect((imported.items["arc-big"] as SplitItem).childIds).toEqual(["arc-a", "arc-b", "arc-c", "arc-d"]);
  });

  it("survives loops and missing children in Arc's data", () => {
    const items = [
      arcContainer("p", ["loop-a", "ghost"]),
      arcContainer("u", []),
      arcFolder("loop-a", "A", ["loop-b", "missing"]),
      arcFolder("loop-b", "B", ["loop-a"]),
    ];
    const spaces: Array<[string, unknown]> = [["s", arcSpace("s", "S", DEFAULT_PROFILE_KEY, "p", "u", null)]];

    const { state: imported, report } = importArcSidebar(buildArcFile(spaces, items, []), createInitialState(), ONE_PM);

    expect(report.error).toBeNull();
    expect(imported.spaces[2].pinnedIds).toEqual(["arc-loop-a"]);
    expect(getFolderFrom(imported, "arc-loop-a").childIds).toEqual(["arc-loop-b"]);
  });
});

describe("importing Favorites", () => {
  it("maps each Favorites container to its profile", () => {
    const { state: imported, report } = importArcSidebar(buildTwoSpaceFile(), createInitialState(), ONE_PM);

    const defaultProfile = imported.profiles.find((profile) => profile.id === DEFAULT_PROFILE_ID);
    const customProfile = imported.profiles.find((profile) => profile.id === "arc-profile-profile-1");
    expect(defaultProfile?.favoriteIds).toEqual(["arc-fav-one"]);
    expect(customProfile?.favoriteIds).toEqual(["arc-fav-two"]);
    expect(getTabFrom(imported, "arc-fav-one").homeUrl).toBe("https://fav-one.example/");
    expect(report.favoritesImported).toBe(2);
  });

  it("stops at the Favorites limit and counts the rest as dropped", () => {
    const tabCount = FAVORITES_LIMIT + 3;
    const tabIds = Array.from({ length: tabCount }, (_unused, index) => `fav-${index}`);
    const items = [arcContainer("fav", tabIds), ...tabIds.map((tabId) => arcTab(tabId, `https://${tabId}.example/`))];

    const { state: imported, report } = importArcSidebar(buildArcFile([], items, [[DEFAULT_PROFILE_KEY, "fav"]]), createInitialState(), ONE_PM);

    expect(imported.profiles[0].favoriteIds).toHaveLength(FAVORITES_LIMIT);
    expect(report.favoritesImported).toBe(FAVORITES_LIMIT);
    expect(report.favoritesDropped).toBe(3);
  });
});

describe("running the import twice", () => {
  it("changes nothing the second time except the report", () => {
    const arcFile = buildTwoSpaceFile();
    const first = importArcSidebar(arcFile, createInitialState(), ONE_PM);

    const second = importArcSidebar(arcFile, first.state, ONE_PM + 1);

    expect(second.state).toEqual(first.state);
    expect(second.report.spacesImported).toBe(0);
    expect(second.report.spacesAlreadyImported).toBe(2);
    expect(second.report.tabsImported).toBe(0);
    expect(second.report.favoritesImported).toBe(0);
  });
});

describe("malformed input", () => {
  it.each([
    ["null", null],
    ["an empty object", {}],
    ["containers without live data", { sidebar: { containers: [] } }],
    ["a string", "not json object"],
  ])("returns the same state with an error for %s", (_name, arcFile) => {
    const state = createInitialState();

    const result = importArcSidebar(arcFile, state, ONE_PM);

    expect(result.state).toBe(state);
    expect(result.report.error).not.toBeNull();
    expect(result.report.spacesImported).toBe(0);
  });
});
