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
import type { SymbolImage } from "./symbols";
import type { CaptureSource } from "./easels";
import type { SearchEngineId } from "./searchEngines";

import type { BrowserAction, SidebarCommand } from "./actions";

/** Any sidebar item's unique id, for example "tab-1793020000000-3". */
export type ItemId = string;

/** A Space's unique id, for example "space-personal". */
export type SpaceId = string;

/** A profile's unique id, for example "profile-default". Each profile has its own cookies and logins. */
export type ProfileId = string;

/** Identifies a main browser window. Kept across restarts, so each window gets its own Space and place back. */
export type WindowId = string;

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
  /**
   * A Pinned tab or Favorite whose page changed while you were elsewhere (a new mail count in the title), like Arc's
   * `isUnread`. Cleared when you open the tab. Optional, so files saved before it existed still load.
   */
  isUnread?: boolean;
}

/** A folder in the Pinned section. Folders can hold tabs, split views and other folders. */
export interface FolderItem {
  kind: "folder";
  id: ItemId;
  title: string;
  /** Children in sidebar order. */
  childIds: ItemId[];
  /** True when the folder is expanded in the focused window's sidebar (other windows: ParkedWindow.openFolderIds). */
  isOpen: boolean;
  /**
   * Set when the folder is a live folder that fills itself (Arc's `automaticLiveFolderData`). Optional: plain folders
   * have none, and files saved before live folders existed still load without an upgrade step.
   */
  live?: LiveFolderData;
}

/** The GitHub lists a live folder can show: the signed-in user's lists on github.com/pulls and github.com/issues. */
export type GitHubLiveList = "pullRequests" | "reviewRequests" | "assignedIssues";

/** Where a live folder's tabs come from. */
export type LiveFolderSource = { kind: "github"; list: GitHubLiveList } | { kind: "feed"; url: string };

/** What makes a folder live. Only what must survive a restart; how the last refresh went is a RuntimeState fact. */
export interface LiveFolderData {
  source: LiveFolderSource;
  /** Addresses the user removed from the folder. Refreshes never bring them back (Arc's `hiddenItems`). */
  hiddenUrls: string[];
}

/** How a live folder's last refresh went, for its status line in the sidebar. */
export interface LiveFolderStatus {
  /** "signedOut": GitHub asked to sign in. "failed": the source could not be read. */
  state: "loading" | "ok" | "signedOut" | "failed";
  /** When the last refresh finished, in milliseconds since 1970, or null while the first one runs. */
  checkedAt: number | null;
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
  /** How strongly the color tints the frame, 0 to 1 (Arc's intensity). Missing means 1, so older files load. */
  intensity?: number;
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
  /** True when the Pinned section is expanded in the focused window (others: ParkedWindow.collapsedPinnedSpaceIds). */
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
  /** False after ⌘S hides the focused window's sidebar (each window has its own, like Arc's sidebarMode). */
  isSidebarVisible: boolean;
  /**
   * The focused window's sidebar width in pixels, set by dragging its edge (each window has its own). Optional:
   * missing means SIDEBAR_WIDTH_PX.
   */
  sidebarWidth?: number;
  /** The engine that searches typed words (shared/searchEngines.ts). Optional: missing means DuckDuckGo. */
  searchEngine?: SearchEngineId;
  /** Blocks ads and trackers (main/adBlock.ts). Optional: missing means off until the user turns it on. */
  isAdBlockOn?: boolean;
  /** The app icon variant shown in the Dock (shared/appIconDrawing.ts). Optional: missing means "classic". */
  appIcon?: string;
  /** Pinned tabs show tidy titles (shared/tidyTitles.ts). Optional: missing means on, like Arc. */
  areTitlesTidy?: boolean;
  /**
   * The toolbar shows the whole address (scheme, path, query) instead of host and path, like Arc's "Show Full URLs"
   * (its toolbarShowFullURLsEnabledPreference). Optional: missing means off, like Arc.
   */
  showsFullUrls?: boolean;
  /** The first-start tour was finished or skipped (overlay/welcome.ts). Optional: missing means not yet. */
  hasSeenWelcome?: boolean;
  /**
   * How long a page may go unused before it sleeps (main/tabSleep.ts); null means never. Optional: missing means
   * DEFAULT_TAB_SLEEP_AFTER_MS.
   */
  tabSleepAfterMs?: number | null;
}

/** How a link-routing rule compares an address. */
export type RoutingMatchType = "contains" | "is";

/**
 * Arc's Air Traffic Control: a link from another app whose address matches goes straight to a Space instead of a
 * Little Window. Example: { matchType: "contains", value: "github.com", spaceId: "space-work" }
 */
export interface RoutingRule {
  id: string;
  matchType: RoutingMatchType;
  value: string;
  spaceId: SpaceId;
}

/**
 * Arc's Boosts: your own changes to a site. CSS you write, and elements you "zapped" (clicked away), applied to
 * every page of that site. Example: { site: "example.com", css: "body { font-size: 18px }", zappedSelectors: ["#ad"] }
 */
export interface Boost {
  id: string;
  /** The site it applies to, as urls.ts getSiteKey() returns it ("github.com", "bbc.co.uk"). */
  site: string;
  css: string;
  zappedSelectors: string[];
  isEnabled: boolean;
  /** Every color on the site shifted round the color wheel, in degrees (pictures keep theirs). Optional: none. */
  hueShift?: number;
  /** Light turned dark and dark turned light, pictures kept as they are. Optional: off. */
  isInverted?: boolean;
  /** A font for the site's text (shared/boostFonts.ts id). Optional: the site's own. */
  fontId?: string;
  /** JavaScript run in each page of the site once loaded, only while isJavaScriptOn. Optional: none. */
  javascript?: string;
  isJavaScriptOn?: boolean;
}

/**
 * A Chrome extension added to one profile (Arc's extensions are per profile too). The extension's files live in
 * `path`: a copy in our data folder (imported from Arc) or the user's own folder (Load Unpacked).
 * Example: { id: "eimadpbcbfnmbkopoojfekhnkhdbieeh", profileId: "profile-default", name: "Dark Reader", … }
 */
export interface InstalledExtension {
  /** Chrome's extension id. For Web Store extensions it is the Web Store id (Chromium derives it from the manifest key). */
  id: string;
  profileId: ProfileId;
  name: string;
  version: string;
  path: string;
  isEnabled: boolean;
  source: "arc" | "webstore" | "unpacked";
}

/** What a site can ask for. A request for camera and microphone together is two kinds. */
export type SitePermissionKind = "camera" | "microphone" | "notifications" | "location" | "clipboard";

/**
 * The user's answer to a site asking for something, per profile, like Arc's (Chromium's) permission prompts.
 * Example: { profileId: "profile-default", origin: "https://meet.google.com", kind: "camera", isAllowed: true }
 */
export interface SitePermission {
  profileId: ProfileId;
  /** The asking page's origin (scheme, host and port). */
  origin: string;
  kind: SitePermissionKind;
  isAllowed: boolean;
}

/** A window's sidebar: shown or hidden (⌘S) and its width. Arc keeps these per window (sidebarMode, sidebarWidth). */
export interface WindowSidebar {
  isSidebarVisible: boolean;
  /** Missing means SIDEBAR_WIDTH_PX. */
  sidebarWidth?: number;
}

/**
 * A main window's own choices while another window has the focus, like Arc's StorableWindows entries: its Space, its
 * selected tab per Space, its sidebar, and which Pinned sections and folders it shows collapsed or open. The focused
 * window's choices live where everything reads them (activeSpaceId, selectedTabIdBySpace, settings.isSidebarVisible
 * and sidebarWidth, Space.isPinnedOpen, FolderItem.isOpen); main/windows.ts swaps them on focus.
 */
export interface ParkedWindow extends WindowSidebar {
  id: WindowId;
  activeSpaceId: SpaceId;
  selectedTabIdBySpace: Record<SpaceId, ItemId | null>;
  /** Spaces whose Pinned section this window shows collapsed (Arc's spacesWithCollapsedPinnedSections). */
  collapsedPinnedSpaceIds: SpaceId[];
  /** Folders this window shows open (Arc's expandedItems). */
  openFolderIds: ItemId[];
}

/** Everything the browser saves to disk. */
export interface BrowserState {
  /** Raise this number when the saved shape changes, and add an upgrade step to migrate.ts. */
  version: 4;
  /** Every sidebar item, by id. Where an item sits is decided by the lists that contain its id. */
  items: Record<ItemId, SidebarItem>;
  profiles: Profile[];
  /** Spaces in switcher order. */
  spaces: Space[];
  /** The focused main window's Space. */
  activeSpaceId: SpaceId;
  /**
   * Which tab the focused main window selected in each Space (a tab inside a split view shows the whole split).
   * Null when none.
   */
  selectedTabIdBySpace: Record<SpaceId, ItemId | null>;
  /** The main window whose choices are activeSpaceId and selectedTabIdBySpace: the last one focused. */
  focusedWindowId: WindowId;
  /** The other open main windows' choices, most recently focused first. One swaps in when its window gets the focus. */
  otherWindows: ParkedWindow[];
  /**
   * The sidebar a new window starts with: the one of the last window closed (Arc's sidebarViewPreferences). Optional:
   * missing means shown, at the default width.
   */
  newWindowSidebar?: WindowSidebar;
  /** Newest first. */
  archive: ArchivedTab[];
  settings: BrowserSettings;
  /** Air Traffic Control rules, checked in order. Optional, so files saved before it existed still load. */
  routingRules?: RoutingRule[];
  /** Boosts, one per site. Optional, so files saved before it existed still load. */
  boosts?: Boost[];
  /** Chrome extensions per profile. Optional, so files saved before it existed still load. */
  extensions?: InstalledExtension[];
  /** Answers to sites' permission requests. Optional, so files saved before it existed still load. */
  sitePermissions?: SitePermission[];
  /**
   * Developer Mode turned on or off by the user, by site (shared/developerMode.ts; local servers are on unless set).
   * Optional, so files saved before it existed still load.
   */
  developerModeSites?: Record<string, boolean>;
  /** Sites where ad blocking is turned off (Control Center). Optional, so files saved before it existed still load. */
  adBlockOffSites?: string[];
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
  /** The color the toolbar takes on this page (sampled from the page's top, remembered per site), or null. */
  toolbarColor: string | null;
}

/** Live facts main.ts sends next to the state. Nothing here is saved. */
export interface RuntimeState {
  /** Facts for every loaded tab, by tab id. Tabs that are not loaded are missing. */
  tabs: Record<ItemId, TabRuntimeInfo>;
  /** Downloads still in progress; the Library button shows a dot while it is above zero. */
  activeDownloadCount: number;
  /** True while the hidden sidebar is shown because the mouse touched the window's left edge. */
  isSidebarPeeking: boolean;
  /** A tab playing (or paused) media in the background, shown as a small player above the bottom bar. */
  media: MediaInfo | null;
  /** True while the Command Bar is open to make a new tab: "New Tab" is highlighted instead of the tab, like Arc. */
  isNewTabPending: boolean;
  /** How each live folder's last refresh went, by folder id. Folders not refreshed since the start are missing. */
  liveFolders: Record<ItemId, LiveFolderStatus>;
  /**
   * Tabs this window would show that another main window has on screen (a page is in one window at a time): the
   * card says "Open in another window" instead.
   */
  tabIdsInOtherWindows: ItemId[];
  /**
   * The Note and Easel tabs this window may draw an editor for: it has them on screen and no other window's editor
   * is still open (one editor at a time writes the file).
   */
  editorTabIdsHere: ItemId[];
  /**
   * True while this main window is the active (key) window. Arc draws its whole frame darker then (measured on the
   * user's Arc: black frame 19 active, 53 inactive); the sidebar switches its palette on it.
   */
  isWindowActive: boolean;
  /**
   * True while this window's sidebar column shows the Library (Arc's): the column widens to libraryWidth and the
   * overlay draws the Library over it.
   */
  isLibraryOpen: boolean;
  /** The Library's column width in this window (layout.ts computeLibraryWidth: Spaces is wider). */
  libraryWidth: number;
  /** The colour of each Favorite's icon, by icon address (shared/faviconColor.ts): the selected tile's border. */
  faviconAccents: Record<string, string>;
  /**
   * The sidebar item being dragged in another main window right now, or null: this window's sidebar accepts it as a
   * drop (main carries the id, because a drag's data stays in the page it started in).
   */
  itemDraggedInOtherWindow: ItemId | null;
  /**
   * Web Store extensions downloading right now, once per profile that asked for each: that profile's toolbar says
   * "Adding…" on the extension's Web Store page until the download is done.
   */
  extensionsBeingAdded: ExtensionBeingAdded[];
  /** A new version of Bow that has downloaded and starts with the next restart (appUpdates.ts), or null. */
  updateReadyVersion: string | null;
}

/** A profile waiting for a Web Store extension's download (RuntimeState.extensionsBeingAdded). */
export interface ExtensionBeingAdded {
  profileId: ProfileId;
  extensionId: string;
}

/** What the sidebar's small media player shows. */
export interface MediaInfo {
  tabId: ItemId;
  isPlaying: boolean;
}

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
  /** The SF Symbols our icons use, rendered by macOS (src/main/symbols.ts). */
  getSymbols(): Promise<Record<string, SymbolImage>>;
  onStateChanged(listener: (state: BrowserState) => void): void;
  onRuntimeChanged(listener: (runtimeState: RuntimeState) => void): void;
  dispatch(action: BrowserAction): Promise<void>;
  onSidebarCommand(listener: (command: SidebarCommand) => void): void;
  /** A note's text (HTML), and saving it with the name its tab takes (shared/notes.ts). */
  readNote(noteId: string): Promise<string>;
  saveNote(noteId: string, html: string, title: string): Promise<void>;
  /** An easel's board (JSON) and saving it (shared/easels.ts). */
  readEasel(easelId: string): Promise<string>;
  saveEasel(easelId: string, json: string): Promise<void>;
  /**
   * The Library's captures, for putting one on an easel (with where each came from, for a live capture), and one
   * capture as a PNG data: URL.
   */
  listCaptures(): Promise<{ id: string; title: string; url: string; thumbnailUrl: string | null; source: CaptureSource | null }[]>;
  readCapture(captureId: string): Promise<string | null>;
  /** Takes a live capture again (main/liveCaptures.ts): a PNG data: URL, or null when the page could not load. */
  retakeCapture(source: CaptureSource): Promise<string | null>;
}
