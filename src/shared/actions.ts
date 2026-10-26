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
import type { ItemId, ItemLocation, SpaceId, SpaceTheme, SplitOrientation } from "./types";

/** Toolbar and keyboard navigation commands for the page on screen. */
export type NavigationCommand = "back" | "forward" | "reload" | "stop";

/** Which native menu the sidebar wants to show (main.ts builds it, so it can call Electron). */
export type MenuRequest =
  | { menu: "item"; itemId: ItemId }
  | { menu: "space"; spaceId: SpaceId }
  | { menu: "plus" }
  | { menu: "sidebar" }
  | { menu: "split" };

/**
 * Requests from the main process to the sidebar page, for things only the page can do (inline editing).
 * Example: the tab menu's "Rename…" sends { kind: "beginRename", itemId }.
 */
export type SidebarCommand =
  | { kind: "beginRename"; itemId: ItemId }
  | { kind: "beginSpaceRename"; spaceId: SpaceId }
  | { kind: "beginSpaceIconEdit"; spaceId: SpaceId };

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
  | { type: "setSidebarVisible"; isVisible: boolean }
  | { type: "navigate"; command: NavigationCommand }
  | { type: "openCommandBar"; mode: "newTab" | "editUrl" }
  | { type: "openLibrary" }
  | { type: "openSiteControls" }
  | { type: "showMenu"; request: MenuRequest };

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
  "setSidebarVisible",
  "navigate",
  "openCommandBar",
  "openLibrary",
  "openSiteControls",
  "showMenu",
];
