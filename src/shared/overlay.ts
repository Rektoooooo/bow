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
import type { ArchivedTab, ItemId, RoutingRule, SitePermissionKind, SpaceTheme, ThemeAppearance } from "./types";

/** What a Command Bar line does when chosen. */
export type CommandBarResultKind = "navigate" | "search" | "tab" | "history" | "action";

export type CommandBarMode = "newTab" | "editUrl" | "splitWith";

export type LibrarySection = "archive" | "history" | "downloads" | "extensions" | "settings";

/** Which panel the overlay shows. */
export type OverlayPanel =
  | { kind: "commandBar"; mode: CommandBarMode; initialText: string }
  | { kind: "library"; section: LibrarySection }
  | { kind: "siteControls" }
  | { kind: "find" }
  | { kind: "boost"; site: string; css: string }
  | { kind: "theme"; spaceId: string; spaceName: string; spaceIcon: string; theme: SpaceTheme; sidebarWidth: number; presets: { label: string; colors: string[]; appearance: ThemeAppearance }[] }
  | { kind: "peek"; frame: { x: number; y: number; width: number; height: number }; url: string; title: string }
  | { kind: "permission"; requestId: string; host: string; kinds: SitePermissionKind[]; appName: string | null };

/** The Peek header's buttons. */
export type PeekCommand = "openAsTab" | "split" | "close";

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

export interface LibraryData {
  archive: ArchivedTab[];
  spaces: { id: string; name: string; icon: string }[];
  history: HistoryLine[];
  downloads: DownloadRecord[];
  archiveAfterMs: number | null;
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
export type SiteCommand = "copyLink" | "screenshot" | "toggleMute" | "devTools" | "zoomIn" | "zoomOut" | "zoomReset" | "clearSiteData" | "reload" | "zap";

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
} as const;
