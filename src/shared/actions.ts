/**
 * WHY this file exists:
 *   The sidebar can ask for about thirty different changes. Instead of thirty message channels, every request is
 *   one "action" object with a `type`, sent on a single channel. TypeScript checks the sender, and ipc.ts checks
 *   every field again on arrival, because anything that crosses IPC is untrusted.
 *
 * Data source:
 *   None. Types only.
 *
 * Data flow:
 *   sidebar.ts → window.browserApi.dispatch(action) → preload → ipc.ts parseAction() → main.ts runAction()
 */
import type { SearchEngineId } from "./searchEngines";
import type { GitHubLiveList, ItemId, ItemLocation, RoutingMatchType, SitePermissionKind, SpaceId, SpaceTheme, SplitOrientation } from "./types";

/** Toolbar and keyboard navigation commands for the page on screen. */
export type NavigationCommand = "back" | "forward" | "reload" | "stop" | "hardReload" | "emptyCacheAndReload";

/** Developer Mode's toolbar buttons that open the page's developer tools on a panel, or pick an element. */
export type DeveloperTool = "console" | "network" | "inspect";

/** The page commands the toolbar may run itself (Developer Mode's copy, capture and screenshot buttons). */
export type ToolbarSiteCommand = "copyLink" | "capture" | "screenshot";

/** Which native menu the sidebar wants to show (main.ts builds it, so it can call Electron). */
export type MenuRequest =
  | { menu: "item"; itemId: ItemId }
  /** Several picked tab rows (renderer/multiSelect.ts): Close, Move to Space, Pin, Split View for all of them. */
  | { menu: "tabs"; tabIds: ItemId[] }
  | { menu: "space"; spaceId: SpaceId }
  | { menu: "plus" }
  | { menu: "sidebar" }
  | { menu: "split" }
  | { menu: "reload" }
  | { menu: "import" };

/**
 * Requests from the main process to the sidebar page, for things only the page can do (inline editing).
 * Example: the tab menu's "Rename…" sends { kind: "beginRename", itemId }.
 */
export type SidebarCommand =
  | { kind: "dropItemFromOtherWindow"; itemId: ItemId; clientX: number; clientY: number }
  | { kind: "beginRename"; itemId: ItemId }
  | { kind: "beginSpaceRename"; spaceId: SpaceId }
  | { kind: "beginSpaceIconEdit"; spaceId: SpaceId }
  /** Notes and Easels another Mac changed (syncController.ts): an editor showing one reads it again. */
  | { kind: "reloadFiles"; noteIds: string[]; easelIds: string[] };

export type BrowserAction =
  | { type: "openTab"; typedText: string }
  | { type: "selectTab"; tabId: ItemId }
  | { type: "closeTab"; tabId: ItemId }
  | { type: "deleteItem"; itemId: ItemId }
  | { type: "pinTab"; tabId: ItemId }
  | { type: "unpinTab"; tabId: ItemId }
  | { type: "addToFavorites"; tabId: ItemId }
  | { type: "moveItem"; itemId: ItemId; target: ItemLocation; index: number }
  | { type: "createFolder"; title: string }
  | { type: "renameItem"; itemId: ItemId; name: string }
  | { type: "toggleFolder"; folderId: ItemId }
  | { type: "setPinnedSectionOpen"; spaceId: SpaceId; isOpen: boolean }
  | { type: "clearTodayTabs" }
  | { type: "restoreArchivedTab"; tabId: ItemId }
  | { type: "duplicateTab"; tabId: ItemId }
  | { type: "resetTab"; tabId: ItemId }
  | { type: "setTabMuted"; tabId: ItemId; isMuted: boolean }
  | { type: "splitTabs"; firstTabId: ItemId; secondTabId: ItemId }
  | { type: "separateTabFromSplit"; tabId: ItemId }
  | { type: "unsplit"; splitId: ItemId }
  | { type: "closeSplit"; splitId: ItemId }
  | { type: "setSplitOrientation"; splitId: ItemId; orientation: SplitOrientation }
  | { type: "switchSpace"; spaceId: SpaceId }
  | { type: "switchSpaceByOffset"; offset: number }
  | { type: "createSpace"; name: string; icon: string; theme: SpaceTheme }
  | { type: "renameSpace"; spaceId: SpaceId; name: string }
  | { type: "setSpaceIcon"; spaceId: SpaceId; icon: string }
  | { type: "setSpaceTheme"; spaceId: SpaceId; theme: SpaceTheme }
  | { type: "deleteSpace"; spaceId: SpaceId }
  | { type: "moveSpace"; spaceId: SpaceId; index: number }
  | { type: "moveItemToSpace"; itemId: ItemId; spaceId: SpaceId }
  | { type: "setArchiveAfter"; archiveAfterMs: number | null }
  | { type: "setTabSleepAfter"; tabSleepAfterMs: number | null }
  | { type: "setSearchEngine"; engineId: SearchEngineId }
  | { type: "setSidebarVisible"; isVisible: boolean }
  | { type: "setSidebarPeek"; isPeeking: boolean }
  | { type: "setSidebarWidth"; width: number; isFinal: boolean }
  | { type: "setSpaceProfile"; spaceId: SpaceId; profileId: string }
  | { type: "createProfileForSpace"; spaceId: SpaceId }
  | { type: "addRoutingRule"; matchType: RoutingMatchType; value: string; spaceId: SpaceId }
  | { type: "removeRoutingRule"; ruleId: string }
  | { type: "setBoostCss"; site: string; css: string }
  | { type: "setBoostEnabled"; site: string; isEnabled: boolean }
  | { type: "setBoostStyle"; site: string; hueShift: number; isInverted: boolean; fontId: string }
  | { type: "setBoostJavaScript"; site: string; javascript: string; isOn: boolean }
  | { type: "deleteBoost"; site: string }
  | { type: "openBoostEditor"; site?: string }
  | { type: "toggleMediaPlayback" }
  | { type: "dismissMedia" }
  | { type: "navigate"; command: NavigationCommand }
  | { type: "openCommandBar"; mode: "newTab" | "editUrl" }
  | { type: "openLibrary" }
  | { type: "openSiteControls" }
  | { type: "openThemeEditor"; spaceId: SpaceId }
  /** The icon picker popover, pointing at the Space's button (anchor: where it sits in the window). */
  | { type: "openSpaceIconPicker"; spaceId: SpaceId; anchor: { x: number; y: number; width: number; height: number } }
  | { type: "showMenu"; request: MenuRequest }
  | { type: "setExtensionEnabled"; profileId: string; extensionId: string; isEnabled: boolean }
  | { type: "removeExtension"; profileId: string; extensionId: string }
  | { type: "loadUnpackedExtension" }
  | { type: "importFromArc" }
  | { type: "exportBackup" }
  | { type: "restoreBackup" }
  | { type: "showExtensionsMenu"; anchor: { x: number; y: number; width: number; height: number } }
  | { type: "answerPermissionPrompt"; requestId: string; isAllowed: boolean }
  | { type: "removeSitePermission"; profileId: string; origin: string; kind: SitePermissionKind }
  | { type: "installWebStoreExtension"; extensionId: string }
  | { type: "checkExtensionUpdates" }
  | { type: "setDeveloperMode"; site: string; isOn: boolean }
  | { type: "openDeveloperTool"; tool: DeveloperTool }
  | { type: "runSiteCommand"; command: ToolbarSiteCommand }
  | { type: "importFromBrowser"; sourceId: string }
  | { type: "setAdBlock"; isOn: boolean }
  | { type: "setAdBlockForSite"; site: string; isOn: boolean }
  | { type: "setAppIcon"; variantId: string }
  | { type: "showTabTooltip"; title: string; showsRenameHint: boolean; frame: { x: number; y: number; width: number; height: number } }
  | { type: "hideTabTooltip" }
  | { type: "showFolderList"; folderId: ItemId; anchor: { x: number; y: number; width: number; height: number } }
  | { type: "hideFolderList" }
  | { type: "folderListPointer"; isInside: boolean }
  | { type: "fadeHoverPanel" }
  | { type: "setTidyTitles"; isOn: boolean }
  | { type: "setShowFullUrls"; isOn: boolean }
  | { type: "setSnapshots"; isOn: boolean }
  | { type: "revealBackups" }
  | { type: "addSearchKeyword"; keyword: string; name: string; url: string }
  | { type: "removeSearchKeyword"; keyword: string }
  | { type: "chooseDownloadFolder" }
  | { type: "setAskWhereToSave"; isOn: boolean }
  | { type: "setTabNeverArchived"; tabId: ItemId; isNeverArchived: boolean }
  | { type: "setSpaceArchiveAfter"; spaceId: SpaceId; archiveAfterMs: number | null | "default" }
  | { type: "runNoticeAction" }
  | { type: "dismissNotice" }
  | { type: "closeDuplicateTabs" }
  | { type: "closeTabs"; tabIds: ItemId[] }
  | { type: "sleepTab"; tabId: ItemId }
  | { type: "sleepOtherTabs" }
  | { type: "setSiteKeptAwake"; site: string; isKeptAwake: boolean }
  | { type: "setFavoritesKeptAwake"; isOn: boolean }
  | { type: "openTaskManager" }
  | { type: "chooseSyncFolder" }
  | { type: "stopSyncing" }
  | { type: "revealSyncFolder" }
  | { type: "createNote" }
  | { type: "createEasel" }
  | { type: "finishWelcome" }
  | { type: "setAsDefaultBrowser" }
  /** The sidebar's update notice: quit and start the version that has downloaded. */
  | { type: "restartToUpdate" }
  | { type: "translatePage" }
  | { type: "createGitHubLiveFolder"; list: GitHubLiveList }
  | { type: "createFeedLiveFolder" }
  | { type: "refreshLiveFolder"; folderId: ItemId }
  | { type: "openLiveFolderSource"; folderId: ItemId }
  | { type: "showHiddenLiveFolderItems"; folderId: ItemId }
  /** "Move to This Window": the window takes the pages it selected that another window shows. */
  | { type: "moveTabToThisWindow" }
  /** The sidebar page opened or closed a Note or Easel editor (sent after its last save; see tabViews.ts). */
  | { type: "reportOpenEditor"; tabId: ItemId; isOpen: boolean }
  /** A sidebar item started or stopped being dragged in this window: other windows' sidebars accept it as a drop. */
  | { type: "beginItemDrag"; itemId: ItemId }
  | { type: "endItemDrag" }
  /** An item dragged from another window was dropped here: a tab or split comes along (windows.ts). */
  | { type: "takeItemFromOtherWindow"; itemId: ItemId }
  /** A drag was let go outside its window, at a point of the screen: main hands it to the main window there. */
  | { type: "dropItemInOtherWindow"; itemId: ItemId; screenX: number; screenY: number };

/** Every action type, for checking an incoming `type` string. */
export const BROWSER_ACTION_TYPES: BrowserAction["type"][] = [
  "openTab",
  "selectTab",
  "closeTab",
  "deleteItem",
  "pinTab",
  "unpinTab",
  "addToFavorites",
  "moveItem",
  "createFolder",
  "renameItem",
  "toggleFolder",
  "setPinnedSectionOpen",
  "clearTodayTabs",
  "restoreArchivedTab",
  "duplicateTab",
  "resetTab",
  "setTabMuted",
  "splitTabs",
  "separateTabFromSplit",
  "unsplit",
  "closeSplit",
  "setSplitOrientation",
  "switchSpace",
  "switchSpaceByOffset",
  "createSpace",
  "renameSpace",
  "setSpaceIcon",
  "setSpaceTheme",
  "deleteSpace",
  "moveSpace",
  "moveItemToSpace",
  "setArchiveAfter",
  "setTabSleepAfter",
  "setSearchEngine",
  "setSidebarVisible",
  "setSidebarPeek",
  "setSidebarWidth",
  "setSpaceProfile",
  "createProfileForSpace",
  "addRoutingRule",
  "removeRoutingRule",
  "setBoostCss",
  "setBoostEnabled",
  "setBoostStyle",
  "setBoostJavaScript",
  "deleteBoost",
  "openBoostEditor",
  "toggleMediaPlayback",
  "dismissMedia",
  "navigate",
  "openCommandBar",
  "openLibrary",
  "openSiteControls",
  "openThemeEditor",
  "openSpaceIconPicker",
  "showMenu",
  "setExtensionEnabled",
  "removeExtension",
  "loadUnpackedExtension",
  "importFromArc",
  "exportBackup",
  "restoreBackup",
  "showExtensionsMenu",
  "answerPermissionPrompt",
  "removeSitePermission",
  "installWebStoreExtension",
  "checkExtensionUpdates",
  "setDeveloperMode",
  "openDeveloperTool",
  "runSiteCommand",
  "importFromBrowser",
  "setAdBlock",
  "setAdBlockForSite",
  "setAppIcon",
  "showTabTooltip",
  "hideTabTooltip",
  "showFolderList",
  "hideFolderList",
  "folderListPointer",
  "fadeHoverPanel",
  "setTidyTitles",
  "setShowFullUrls",
  "setSnapshots",
  "revealBackups",
  "addSearchKeyword",
  "removeSearchKeyword",
  "chooseDownloadFolder",
  "setAskWhereToSave",
  "setTabNeverArchived",
  "setSpaceArchiveAfter",
  "runNoticeAction",
  "dismissNotice",
  "closeDuplicateTabs",
  "closeTabs",
  "sleepTab",
  "sleepOtherTabs",
  "setSiteKeptAwake",
  "setFavoritesKeptAwake",
  "openTaskManager",
  "chooseSyncFolder",
  "stopSyncing",
  "revealSyncFolder",
  "createNote",
  "createEasel",
  "finishWelcome",
  "setAsDefaultBrowser",
  "restartToUpdate",
  "translatePage",
  "createGitHubLiveFolder",
  "createFeedLiveFolder",
  "refreshLiveFolder",
  "openLiveFolderSource",
  "showHiddenLiveFolderItems",
  "moveTabToThisWindow",
  "reportOpenEditor",
  "beginItemDrag",
  "endItemDrag",
  "takeItemFromOtherWindow",
  "dropItemInOtherWindow",
];
