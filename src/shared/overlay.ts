/**
 * WHY this file exists:
 *   Panels that float above the web page (Command Bar, Library, site controls, Find) live in a separate transparent
 *   page, the overlay, because the page card is a native view that covers the window's own page. This file lists
 *   the messages between that overlay page and the main process, so both sides agree on their shape.
 *
 * Data source:
 *   None. Types and channel names only.
 *
 * Data flow:
 *   main.ts openOverlay(panel) → "overlay:show" → overlay.ts draws the panel
 *   overlay.ts → overlayApi.query / choose / siteCommand / find → main.ts
 */
import type { SymbolImage } from "./symbols";
import type { ArchivedTab, ItemId, RoutingRule, SitePermissionKind, SpaceTheme, ThemeAppearance } from "./types";

/** What a Command Bar line does when chosen. */
export type CommandBarResultKind = "navigate" | "search" | "tab" | "history" | "action";

export type CommandBarMode = "newTab" | "editUrl" | "splitWith";

export type LibrarySection = "archive" | "history" | "media" | "downloads" | "spaces" | "boosts" | "extensions" | "settings";

/** A screenshot or capture kept in the Library (captures.ts). */
export interface MediaLine {
  id: string;
  title: string;
  url: string;
  createdAt: number;
  width: number;
  height: number;
  thumbnailUrl: string | null;
}

/** What the Library's Media buttons do with a picture. */
export type MediaCommand = "copy" | "reveal" | "save" | "delete";

/** Which panel the overlay shows. */
export type OverlayPanel =
  | { kind: "commandBar"; mode: CommandBarMode; initialText: string }
  | { kind: "library"; section: LibrarySection }
  | { kind: "siteControls" }
  | { kind: "find" }
  | { kind: "boost"; site: string; css: string; hueShift: number; isInverted: boolean; fontId: string; javascript: string; isJavaScriptOn: boolean; zapCount: number }
  | { kind: "theme"; spaceId: string; spaceName: string; spaceIcon: string; theme: SpaceTheme; sidebarWidth: number; presets: { label: string; colors: string[]; appearance: ThemeAppearance }[] }
  /** Arc's icon picker for a Space, pointing at the Space's button (anchor, in window coordinates). */
  | { kind: "spaceIcon"; spaceId: string; icon: string; anchor: OverlayRect }
  /**
   * Arc's Peek: `frame` is where the page view sits; the overlay draws the card's toolbar row above it (from the
   * window's top edge, in `chromeColor`, the window frame's color), dims the page card (`card`) behind it and stacks
   * the buttons right of it.
   */
  | { kind: "peek"; frame: OverlayRect; card: OverlayRect; url: string; chromeColor: string; canGoBack: boolean; canGoForward: boolean }
  | { kind: "permission"; requestId: string; host: string; kinds: SitePermissionKind[]; appName: string | null }
  | { kind: "capture"; frame: { x: number; y: number; width: number; height: number } }
  | { kind: "switcher"; tabs: SwitcherTab[]; index: number }
  /** Arc's list of a closed folder's tabs, beside the sidebar (the frame is the list itself, window coordinates). */
  | { kind: "folderList"; frame: OverlayRect; folderTitle: string; entries: FolderListEntry[] }
  /** Arc's tab tooltip; the frame (window coordinates) is the box itself, sized by the sidebar. */
  | { kind: "tabTooltip"; frame: OverlayRect; title: string; showsRenameHint: boolean }
  | { kind: "welcome"; spaceId: string; importSources: { id: string; label: string }[]; presets: { label: string; colors: string[]; appearance: ThemeAppearance }[] };

/** One tab in the list a closed folder shows on hover (main/folderList.ts). */
export interface FolderListEntry {
  tabId: string;
  title: string;
  url: string;
  faviconUrl: string | null;
  lastActiveAt: number;
}

/** One card of the recent-tab switcher (⌃Tab): most recently used first, the selected tab at index 0. */
export interface SwitcherTab {
  tabId: string;
  title: string;
  url: string;
  faviconUrl: string | null;
  /** A small picture of the page from while it was showing (tabSnapshots.ts), or null. */
  snapshotUrl: string | null;
}

/** A rectangle in the overlay page, which covers the window (so also in window coordinates). */
export interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The Peek header's buttons. */
export type PeekCommand = "openAsTab" | "split" | "close" | "back" | "forward" | "reload";

/** One line in the Command Bar, as the overlay draws it. */
export interface CommandBarLine {
  id: string;
  kind: CommandBarResultKind;
  title: string;
  subtitle: string;
  url: string | null;
  faviconUrl: string | null;
}

/** A file being downloaded or already downloaded in this run. */
export interface DownloadRecord {
  id: string;
  fileName: string;
  url: string;
  savePath: string;
  receivedBytes: number;
  totalBytes: number;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  startedAt: number;
}

/** A visited page, as the Library lists it. */
export interface HistoryLine {
  url: string;
  title: string;
  lastVisitAt: number;
}

/** What the Library shows. */
/** One extension as the Library lists it. */
export interface ExtensionLine {
  id: string;
  profileId: string;
  profileName: string;
  name: string;
  version: string;
  isEnabled: boolean;
  source: "arc" | "webstore" | "unpacked";
  /** The extension's icon as a data: URL, or null when it has none. */
  iconUrl: string | null;
  /** Why it failed to load, or null. */
  loadError: string | null;
}

/** A Space as the Library lists it. */
export interface LibrarySpace {
  id: string;
  name: string;
  icon: string;
  /** The theme's first color, for a swatch. */
  color: string | null;
  pinnedCount: number;
  todayCount: number;
  profileName: string;
  isActive: boolean;
}

/** A Boost as the Library lists it. */
export interface LibraryBoost {
  site: string;
  isEnabled: boolean;
  zapCount: number;
  hasCss: boolean;
}

export interface LibraryData {
  archive: ArchivedTab[];
  spaces: LibrarySpace[];
  boosts: LibraryBoost[];
  history: HistoryLine[];
  downloads: DownloadRecord[];
  media: MediaLine[];
  archiveAfterMs: number | null;
  areSoundEffectsOn: boolean;
  appIcon: string;
  areTitlesTidy: boolean;
  showsFullUrls: boolean;
  adBlock: { isOn: boolean; status: "off" | "loading" | "ready" | "failed"; filterCount: number };
  routingRules: RoutingRule[];
  extensions: ExtensionLine[];
}

/** What the site controls show about the selected page. */
export interface SiteInfo {
  tabId: ItemId;
  url: string;
  host: string;
  isSecure: boolean;
  isMuted: boolean;
  zoomPercent: number;
  isLoaded: boolean;
  /** The site's Boost key ("example.com"), and its Boost if it has one. */
  site: string | null;
  boost: { isEnabled: boolean; zapCount: number; hasCss: boolean } | null;
  /** The page's profile and origin, and what the site was allowed or refused there (permission prompts). */
  profileId: string;
  origin: string | null;
  permissions: { kind: SitePermissionKind; isAllowed: boolean }[];
  /** Arc's per-site Developer Mode (shared/developerMode.ts). */
  isDeveloperMode: boolean;
  /** Ad blocking for this page: null while it is off in Library › Settings. */
  adBlock: { isOnForSite: boolean; blockedCount: number } | null;
  /** The profile's turned-on extensions, for the Control Center's grid. */
  extensions: { id: string; name: string; iconUrl: string | null }[];
}

/** Everything the overlay needs to draw a panel. */
export interface OverlayShowMessage {
  panel: OverlayPanel;
  /** Light or dark, from the active Space's theme (or the system for "auto"). */
  isDark: boolean;
  library: LibraryData | null;
  site: SiteInfo | null;
}

/** Commands the site controls can send. */
export type SiteCommand =
  | "copyLink"
  | "share"
  | "screenshot"
  | "capture"
  | "toggleMute"
  | "devTools"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "clearSiteData"
  | "reload"
  | "zap"
  | "addExtension";

/** Find-in-page progress. */
export interface FindProgress {
  activeMatch: number;
  matches: number;
}

/** The functions the overlay page may call. The overlay preload provides them as window.overlayApi. */
export interface OverlayApi {
  onShow(listener: (message: OverlayShowMessage) => void): void;
  onResults(listener: (query: string, lines: CommandBarLine[]) => void): void;
  onLibraryUpdate(listener: (library: LibraryData) => void): void;
  onFindProgress(listener: (progress: FindProgress) => void): void;
  /** The panel is closing: play the closing animation and clear the page (the view goes away right after). */
  onClosing(listener: () => void): void;
  /** The switcher: ⌃Tab pressed again (+1) or ⌃⇧Tab (−1), and ⌃ let go while the page still had the keyboard. */
  onSwitcherStep(listener: (step: number) => void): void;
  onSwitcherCommit(listener: () => void): void;
  /** The switcher picked a tab. */
  chooseTab(tabId: string): Promise<void>;
  query(text: string, mode: CommandBarMode): Promise<CommandBarLine[]>;
  choose(resultId: string | null, typedText: string, mode: CommandBarMode): Promise<void>;
  close(): Promise<void>;
  siteCommand(command: SiteCommand): Promise<void>;
  /** isNewSearch: true when the text changed (a new search), false for "next / previous match". */
  find(text: string, forward: boolean, isNewSearch: boolean): Promise<void>;
  searchHistory(query: string): Promise<HistoryLine[]>;
  clearHistory(): Promise<void>;
  showDownload(downloadId: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  peekCommand(command: PeekCommand): Promise<void>;
  /** Capture: the part of the page the user dragged out (null: cancelled). */
  captureRegion(region: OverlayRect | null): Promise<void>;
  /** The Control Center: open an extension's popup under its tile, or the "…" menu under the button. */
  activateExtension(extensionId: string, anchor: OverlayRect): Promise<void>;
  showSiteMenu(anchor: OverlayRect): Promise<void>;
  /** Library › Media: copy, show in Finder, save to Downloads or delete a picture. */
  mediaCommand(mediaId: string, command: MediaCommand): Promise<void>;
  /** The SF Symbols our icons use, rendered by macOS. */
  getSymbols(): Promise<Record<string, SymbolImage>>;
}

/** Channel names between the overlay page and main.ts. */
export const OVERLAY_CHANNELS = {
  show: "overlay:show",
  results: "overlay:results",
  libraryUpdate: "overlay:library-update",
  findProgress: "overlay:find-progress",
  query: "overlay:query",
  choose: "overlay:choose",
  close: "overlay:close",
  siteCommand: "overlay:site-command",
  find: "overlay:find",
  searchHistory: "overlay:search-history",
  clearHistory: "overlay:clear-history",
  showDownload: "overlay:show-download",
  openUrl: "overlay:open-url",
  peekCommand: "overlay:peek-command",
  captureRegion: "overlay:capture-region",
  activateExtension: "overlay:activate-extension",
  showSiteMenu: "overlay:show-site-menu",
  closing: "overlay:closing",
  switcherStep: "overlay:switcher-step",
  switcherCommit: "overlay:switcher-commit",
  chooseTab: "overlay:choose-tab",
  mediaCommand: "overlay:media-command",
} as const;
