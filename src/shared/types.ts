/**
 * WHY this file exists:
 *   One place that describes the browser's data: Spaces, tabs, the archive and settings.
 *   The main process and the sidebar page both use these shapes, so they must agree.
 *
 * Data source:
 *   None. Types only; they disappear when compiled.
 *
 * Data flow:
 *   store.ts loads a BrowserState → state.ts / autoArchive.ts return changed copies → sidebar.ts draws it
 */

/** A tab's unique id, for example "tab-1793020000000-3". */
export type TabId = string;

/** A Space's unique id, for example "space-personal". */
export type SpaceId = string;

/** One open tab. Its position in BrowserState.tabs is its order in the sidebar. */
export interface Tab {
  id: TabId;
  spaceId: SpaceId;
  url: string;
  title: string;
  /** Pinned tabs never auto-archive. */
  isPinned: boolean;
  /** The URL a pinned tab goes back to when reset. Null for unpinned tabs. */
  homeUrl: string | null;
  /** When the tab was last in use, in milliseconds since 1970. Auto-archive measures from here. */
  lastActiveAt: number;
}

/** A named workspace with its own pinned and today tabs. */
export interface Space {
  id: SpaceId;
  name: string;
  /** One emoji shown in the Space switcher. */
  icon: string;
  /** CSS color for the window frame while this Space is active. */
  color: string;
}

/** Why a tab ended up in the archive. */
export type ArchiveReason = "auto" | "manual" | "clear-button";

/** A tab that left the sidebar, kept so it can be found and restored. */
export interface ArchivedTab {
  tab: Tab;
  archivedAt: number;
  reason: ArchiveReason;
}

/** The user's preferences. */
export interface BrowserSettings {
  /** How long an unpinned tab may go unused before it is archived. Null means never. */
  archiveAfterMs: number | null;
}

/** Everything the browser saves to disk. */
export interface BrowserState {
  /** Raise this number when the saved shape changes, so old files can be upgraded. */
  version: 1;
  spaces: Space[];
  tabs: Tab[];
  activeSpaceId: SpaceId;
  /** Which tab is selected in each Space. Null when a Space has no tabs. */
  selectedTabIdBySpace: Record<SpaceId, TabId | null>;
  archive: ArchivedTab[];
  settings: BrowserSettings;
}

/** The functions the sidebar page may call. The preload script provides them as window.browserApi. */
export interface BrowserApi {
  getState(): Promise<BrowserState>;
  onStateChanged(listener: (state: BrowserState) => void): void;
  openTab(typedText: string): Promise<void>;
  selectTab(tabId: TabId): Promise<void>;
  closeTab(tabId: TabId): Promise<void>;
  pinTab(tabId: TabId): Promise<void>;
  unpinTab(tabId: TabId): Promise<void>;
  clearTodayTabs(): Promise<void>;
  switchSpace(spaceId: SpaceId): Promise<void>;
  restoreArchivedTab(tabId: TabId): Promise<void>;
  setArchiveAfter(archiveAfterMs: number | null): Promise<void>;
}
