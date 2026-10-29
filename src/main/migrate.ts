/**
 * WHY this file exists:
 *   The saved file's shape changes as the browser grows. Old files must still open, so each shape change gets one
 *   upgrade step here. Version 1 (milestone 1) kept one flat tab list with isPinned flags; version 2 keeps Arc-style
 *   item lists with folders, Favorites, split views and profiles; version 3 adds the list of open main windows;
 *   version 4 gives each window its own sidebar (shown or hidden, width) and its own open folders and Pinned sections;
 *   version 5 moves the Favorites from the profile to the Space.
 *
 * Data source:
 *   The parsed JSON of browser-state.json, as read by store.ts. It is untrusted: fields may be missing.
 *
 * Data flow:
 *   store.ts loadState() → upgradeToCurrentVersion(parsed, now) → version 1 → 2 → 3 → 4 → 5 → BrowserState, or null when
 *   unreadable
 */
import { DEFAULT_ARCHIVE_AFTER_MS, DEFAULT_PROFILE_ID, FIRST_WINDOW_ID } from "../shared/settings";
import type { ArchiveReason, ArchivedTab, BrowserState, ItemId, ParkedWindow, Profile, SidebarItem, Space, SpaceId, TabItem } from "../shared/types";
import { moveTabsToArchive, repairSelections } from "./state";
import { repairOtherWindows } from "./windows";

/** A tab as version 1 saved it. */
interface TabV1 {
  id: string;
  spaceId: string;
  url: string;
  title: string;
  isPinned: boolean;
  homeUrl: string | null;
  lastActiveAt: number;
}

/** A Space as version 1 saved it. */
interface SpaceV1 {
  id: string;
  name: string;
  icon: string;
  color: string;
}

/** The whole version 1 file. */
interface BrowserStateV1 {
  version: 1;
  spaces: SpaceV1[];
  tabs: TabV1[];
  activeSpaceId: string;
  selectedTabIdBySpace: Record<string, string | null>;
  archive: { tab: TabV1; archivedAt: number; reason: ArchiveReason }[];
  settings: { archiveAfterMs: number | null };
}

/** A parked window as version 3 saved it: its Space and selection only. */
type ParkedWindowV3 = Pick<ParkedWindow, "id" | "activeSpaceId" | "selectedTabIdBySpace">;

/** A Space as versions 1 to 4 saved it: no Favorites of its own (they sat on the profile). */
type SpaceV4 = Omit<Space, "favoriteIds">;

/** A profile as versions 1 to 4 saved it: with the Favorites of every Space that used it. */
type ProfileV4 = Profile & { favoriteIds: ItemId[] };

/** The whole version 4 file: Favorites on the profile. */
type BrowserStateV4 = Omit<BrowserState, "version" | "spaces" | "profiles"> & { version: 4; spaces: SpaceV4[]; profiles: ProfileV4[] };

/** The whole version 3 file: the window list, with one sidebar and one set of open folders for every window. */
type BrowserStateV3 = Omit<BrowserStateV4, "version" | "otherWindows" | "newWindowSidebar"> & { version: 3; otherWindows: ParkedWindowV3[] };

/** The whole version 2 file: one window, so no window list yet. */
type BrowserStateV2 = Omit<BrowserStateV3, "version" | "focusedWindowId" | "otherWindows"> & { version: 2 };

/**
 * Turns a version 1 tab into a version 2 tab item.
 */
function upgradeTab(tab: TabV1): TabItem {
  return {
    kind: "tab",
    id: tab.id,
    url: tab.url,
    title: tab.title,
    customTitle: null,
    faviconUrl: null,
    homeUrl: tab.isPinned ? tab.homeUrl ?? tab.url : null,
    lastActiveAt: tab.lastActiveAt,
    isMuted: false,
  };
}

/**
 * Upgrades a version 1 file. The order of the old flat tab list becomes the order of each Space's Pinned and Today lists.
 * Example: v1 tabs [pinned A (Personal), today B (Personal)] → Personal pinnedIds [A], todayIds [B]
 */
export function upgradeFromVersion1(oldState: BrowserStateV1): BrowserStateV2 {
  const items: Record<ItemId, SidebarItem> = {};
  for (const oldTab of oldState.tabs) {
    items[oldTab.id] = upgradeTab(oldTab);
  }

  const spaces: SpaceV4[] = [];
  for (const oldSpace of oldState.spaces) {
    const spaceTabs = oldState.tabs.filter((tab) => tab.spaceId === oldSpace.id);
    const pinnedIds = spaceTabs.filter((tab) => tab.isPinned).map((tab) => tab.id);
    const todayIds = spaceTabs.filter((tab) => !tab.isPinned).map((tab) => tab.id);
    spaces.push({
      id: oldSpace.id,
      name: oldSpace.name,
      icon: oldSpace.icon,
      theme: { colors: [oldSpace.color], appearance: "auto", grain: 0 },
      profileId: DEFAULT_PROFILE_ID,
      pinnedIds: pinnedIds,
      todayIds: todayIds,
      isPinnedOpen: true,
    });
  }

  const archive: ArchivedTab[] = oldState.archive.map((entry) => ({
    tab: upgradeTab({ ...entry.tab, isPinned: false }),
    fromSpaceId: entry.tab.spaceId,
    archivedAt: entry.archivedAt,
    reason: entry.reason,
  }));

  return {
    version: 2,
    items: items,
    profiles: [{ id: DEFAULT_PROFILE_ID, name: "Default", favoriteIds: [] }],
    spaces: spaces,
    activeSpaceId: oldState.activeSpaceId,
    selectedTabIdBySpace: { ...oldState.selectedTabIdBySpace },
    archive: archive,
    settings: { archiveAfterMs: oldState.settings?.archiveAfterMs ?? DEFAULT_ARCHIVE_AFTER_MS, isSidebarVisible: true },
  };
}

/**
 * Upgrades a version 2 file: its one window becomes the first (focused) window, with no others open.
 * Example: v2 with activeSpaceId "space-work" → v3 with focusedWindowId "window-1", otherWindows [], same Space
 */
export function upgradeFromVersion2(oldState: BrowserStateV2): BrowserStateV3 {
  return { ...oldState, version: 3, focusedWindowId: FIRST_WINDOW_ID, otherWindows: [] };
}

/**
 * Upgrades a version 3 file: every other window gets the sidebar, collapsed Pinned sections and open folders all
 * windows shared until now (the focused window keeps them where they are).
 * Example: v3 with the sidebar hidden and folder F open → each parked window { isSidebarVisible: false, openFolderIds: [F] }
 */
export function upgradeFromVersion3(oldState: BrowserStateV3): BrowserStateV4 {
  const collapsedSpaces = oldState.spaces.filter((space) => !space.isPinnedOpen);
  const collapsedPinnedSpaceIds: SpaceId[] = collapsedSpaces.map((space) => space.id);
  const openFolderIds: ItemId[] = [];
  for (const item of Object.values(oldState.items)) {
    if (item.kind === "folder" && item.isOpen) {
      openFolderIds.push(item.id);
    }
  }
  const otherWindows: ParkedWindow[] = oldState.otherWindows.map((parked) => ({
    ...parked,
    isSidebarVisible: oldState.settings.isSidebarVisible,
    sidebarWidth: oldState.settings.sidebarWidth,
    collapsedPinnedSpaceIds: [...collapsedPinnedSpaceIds],
    openFolderIds: [...openFolderIds],
  }));
  return { ...oldState, version: 4, otherWindows: otherWindows };
}

/**
 * The Space that takes a profile's Favorites. Favorites used to be shared by every Space with the profile; now one
 * Space holds them: the focused window's active Space if it uses the profile, else a parked window's active Space that
 * does, else the first Space (in switcher order) that does. Undefined when no Space uses the profile.
 */
function findSpaceToKeepFavorites(oldState: BrowserStateV4, profileId: string): SpaceV4 | undefined {
  const activeSpaceIds = [oldState.activeSpaceId, ...oldState.otherWindows.map((parked) => parked.activeSpaceId)];
  for (const activeSpaceId of activeSpaceIds) {
    const activeSpace = oldState.spaces.find((space) => space.id === activeSpaceId);
    if (activeSpace !== undefined && activeSpace.profileId === profileId) {
      return activeSpace;
    }
  }
  return oldState.spaces.find((space) => space.profileId === profileId);
}

/**
 * Upgrades a version 4 file: each profile's Favorites go to one Space that uses the profile (findSpaceToKeepFavorites),
 * the other Spaces start with none, and the Favorites of a profile no Space uses go to the Archive. Selections that
 * pointed at a Favorite which went to another Space are repaired, in every window.
 * Example: Personal and Work share a profile with Favorites [A, B], Work is active → Work [A, B], Personal []
 */
export function upgradeFromVersion4(oldState: BrowserStateV4, now: number): BrowserState {
  const favoriteIdsBySpaceId = new Map<SpaceId, ItemId[]>();
  const archivedTabIds: ItemId[] = [];
  for (const profile of oldState.profiles) {
    // A damaged or hand-made file may lack the list; that profile simply had no Favorites.
    const profileFavoriteIds = Array.isArray(profile.favoriteIds) ? profile.favoriteIds : [];
    const keeper = findSpaceToKeepFavorites(oldState, profile.id);
    if (keeper === undefined) {
      archivedTabIds.push(...profileFavoriteIds);
      continue;
    }
    favoriteIdsBySpaceId.set(keeper.id, [...(favoriteIdsBySpaceId.get(keeper.id) ?? []), ...profileFavoriteIds]);
  }

  const spaces: Space[] = oldState.spaces.map((space) => ({ ...space, favoriteIds: favoriteIdsBySpaceId.get(space.id) ?? [] }));
  const profiles: Profile[] = oldState.profiles.map(({ favoriteIds: _favoriteIds, ...profile }) => profile);
  const upgraded: BrowserState = { ...oldState, version: 5, spaces: spaces, profiles: profiles };
  const archived = moveTabsToArchive(upgraded, archivedTabIds, now, "manual");
  return repairOtherWindows(repairSelections(archived));
}

/**
 * Checks the parts of a version 2 file that the app cannot run without.
 * It does not check every field; it catches files that are clearly not ours.
 */
function looksLikeVersion2(value: Record<string, unknown>): boolean {
  const hasItems = typeof value.items === "object" && value.items !== null;
  const hasLists = Array.isArray(value.spaces) && Array.isArray(value.profiles) && Array.isArray(value.archive);
  const hasActiveSpace = typeof value.activeSpaceId === "string";
  return hasItems && hasLists && hasActiveSpace && (value.spaces as unknown[]).length > 0;
}

/**
 * Checks a version 3 or 4 file: a version 2 file plus the window list.
 */
function looksLikeVersion3(value: Record<string, unknown>): boolean {
  const hasWindows = typeof value.focusedWindowId === "string" && Array.isArray(value.otherWindows);
  return hasWindows && looksLikeVersion2(value);
}

/**
 * Checks the parts of a version 1 file that the upgrade needs.
 */
function looksLikeVersion1(value: Record<string, unknown>): boolean {
  const hasLists = Array.isArray(value.spaces) && Array.isArray(value.tabs) && Array.isArray(value.archive);
  return hasLists && typeof value.activeSpaceId === "string" && (value.spaces as unknown[]).length > 0;
}

/**
 * Returns the parsed file as a current-version state, upgrading it when it is older.
 * Returns null when the value is not a state file this app understands (store.ts then keeps a copy and starts fresh).
 */
export function upgradeToCurrentVersion(parsedValue: unknown, now: number): BrowserState | null {
  if (typeof parsedValue !== "object" || parsedValue === null) {
    return null;
  }
  const value = parsedValue as Record<string, unknown>;

  if (value.version === 5 && looksLikeVersion3(value)) {
    return value as unknown as BrowserState;
  }
  if (value.version === 4 && looksLikeVersion3(value)) {
    return upgradeFromVersion4(value as unknown as BrowserStateV4, now);
  }
  if (value.version === 3 && looksLikeVersion3(value)) {
    return upgradeFromVersion4(upgradeFromVersion3(value as unknown as BrowserStateV3), now);
  }
  if (value.version === 2 && looksLikeVersion2(value)) {
    const version3State = upgradeFromVersion2(value as unknown as BrowserStateV2);
    return upgradeFromVersion4(upgradeFromVersion3(version3State), now);
  }
  if (value.version === 1 && looksLikeVersion1(value)) {
    const version2State = upgradeFromVersion1(value as unknown as BrowserStateV1);
    const version3State = upgradeFromVersion2(version2State);
    return upgradeFromVersion4(upgradeFromVersion3(version3State), now);
  }
  return null;
}
