/**
 * WHY this file exists:
 *   One place that describes the browser's data: profiles, Spaces, the sidebar items, the archive and settings.
 *   The main process and the sidebar page both use these shapes, so they must agree.
 *
 * Data source:
 *   None. Types only; they disappear when compiled.
 *   The shape follows how Arc stores its sidebar (docs/research/arc-data-model.md): every sidebar object is an
 *   item, and order lives only in ordered lists of child ids (Arc also stores a parent pointer; we do not, so the
 *   two can never disagree).
 *
 * Data flow:
 *   store.ts loads a BrowserState → state.ts / spaces.ts / autoArchive.ts return changed copies → sidebar.ts draws it
 */

import type { BrowserAction } from "./actions";

/** Any sidebar item's unique id, for example "tab-1793020000000-3". */
export type ItemId = string;

/** A Space's unique id, for example "space-personal". */
export type SpaceId = string;

/** A profile's unique id, for example "profile-default". Each profile has its own cookies and logins. */
export type ProfileId = string;

/** One web page in the sidebar. */
export interface TabItem {
  kind: "tab";
  id: ItemId;
  /** The page's current address. */
  url: string;
  /** The page's own title. */
  title: string;
  /** A name the user gave the tab. Null when not renamed; then the page title is shown. */
  customTitle: string | null;
  /** The page's icon address, or null until the page reports one. */
  faviconUrl: string | null;
  /** The address a Pinned or Favorite tab goes back to ("Reset tab"). Null for Today tabs. */
  homeUrl: string | null;
  /** When the tab was last in use, in milliseconds since 1970. Auto-archive measures from here. */
  lastActiveAt: number;
  /** True when the user muted the tab. */
  isMuted: boolean;
}

/** A folder in the Pinned section. Folders can hold tabs, split views and other folders. */
export interface FolderItem {
  kind: "folder";
  id: ItemId;
  title: string;
  /** Children in sidebar order. */
  childIds: ItemId[];
  /** True when the folder is expanded in the sidebar. */
  isOpen: boolean;
}

/** Side-by-side or stacked panes. */
export type SplitOrientation = "horizontal" | "vertical";

/** Two to four tabs shown together in the page card. Shown as one row in the sidebar. */
export interface SplitItem {
  kind: "split";
  id: ItemId;
  /** The tabs in pane order. Only tab ids. */
  childIds: ItemId[];
  orientation: SplitOrientation;
}

export type SidebarItem = TabItem | FolderItem | SplitItem;

/** Light or dark sidebar text, or follow the system. */
export type ThemeAppearance = "light" | "dark" | "auto";

/** How a Space colors the window frame. */
export interface SpaceTheme {
  /** One to three CSS hex colors. One color = flat, more = gradient. */
  colors: string[];
  appearance: ThemeAppearance;
  /** Film-grain texture strength, 0 (none) to 1. */
  grain: number;
}

/** A named workspace with its own Pinned and Today tabs. */
export interface Space {
  id: SpaceId;
  name: string;
  /** One emoji shown in the Space switcher and heading. */
  icon: string;
  theme: SpaceTheme;
  /** Whose cookies, logins and Favorites this Space uses. */
  profileId: ProfileId;
  /** Top-level Pinned items in sidebar order (tabs, folders, split views). */
  pinnedIds: ItemId[];
  /** Today items in sidebar order, newest first (tabs and split views). */
  todayIds: ItemId[];
  /** True when the Pinned section is expanded. */
  isPinnedOpen: boolean;
}

/** A browsing identity: its own cookies and logins, and its own Favorites shared by every Space that uses it. */
export interface Profile {
  id: ProfileId;
  name: string;
  /** Favorite tabs (the tiles at the top of the sidebar), in order. Only tab ids. */
  favoriteIds: ItemId[];
}

/** Why a tab ended up in the archive. */
export type ArchiveReason = "auto" | "manual" | "clear-button";

/** A tab that left the sidebar, kept so it can be found and restored. */
export interface ArchivedTab {
  tab: TabItem;
  /** The Space it left, so Restore can put it back there. Null when unknown. */
  fromSpaceId: SpaceId | null;
  archivedAt: number;
  reason: ArchiveReason;
}

/** The user's preferences. */
export interface BrowserSettings {
  /** How long an unpinned tab may go unused before it is archived. Null means never. */
  archiveAfterMs: number | null;
  /** False after ⌘S hides the sidebar. */
  isSidebarVisible: boolean;
}

/** Everything the browser saves to disk. */
export interface BrowserState {
  /** Raise this number when the saved shape changes, and add an upgrade step to migrate.ts. */
  version: 2;
  /** Every sidebar item, by id. Where an item sits is decided by the lists that contain its id. */
  items: Record<ItemId, SidebarItem>;
  profiles: Profile[];
  /** Spaces in switcher order. */
  spaces: Space[];
  activeSpaceId: SpaceId;
  /** Which tab is selected in each Space (a tab inside a split view shows the whole split). Null when none. */
  selectedTabIdBySpace: Record<SpaceId, ItemId | null>;
  /** Newest first. */
  archive: ArchivedTab[];
  settings: BrowserSettings;
}

/**
 * Live facts about a tab that are not saved: they only exist while its web page is loaded.
 * main.ts sends them to the sidebar next to the BrowserState.
 */
export interface TabRuntimeInfo {
  isLoaded: boolean;
  isLoading: boolean;
  isAudible: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** Runtime facts for every loaded tab, by tab id. Tabs that are not loaded are missing. */
export type RuntimeState = Record<ItemId, TabRuntimeInfo>;

/** Where an item lives. Exactly one list in the state contains each item's id. */
export type ItemLocation =
  | { kind: "favorites"; profileId: ProfileId }
  | { kind: "pinned"; spaceId: SpaceId }
  | { kind: "today"; spaceId: SpaceId }
  | { kind: "folder"; folderId: ItemId }
  | { kind: "split"; splitId: ItemId };

/** The functions the sidebar page may call. The preload script provides them as window.browserApi. */
export interface BrowserApi {
  getState(): Promise<BrowserState>;
  getRuntimeState(): Promise<RuntimeState>;
  onStateChanged(listener: (state: BrowserState) => void): void;
  onRuntimeChanged(listener: (runtimeState: RuntimeState) => void): void;
  dispatch(action: BrowserAction): Promise<void>;
}
