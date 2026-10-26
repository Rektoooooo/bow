/**
 * WHY this file exists:
 *   Every action from the sidebar (and many menu items) arrives as one BrowserAction object. This file turns each
 *   one into the matching state change, page action, native menu or overlay panel.
 *
 * Data source:
 *   A BrowserAction that ipc.ts already checked field by field.
 *
 * Data flow:
 *   ipc.ts parseAction() → runAction(action) → applyChange(state function) / tabActions / menus / overlayController
 */
import type { BrowserAction } from "../shared/actions";
import { applyChange, getState, getWindow, sendSidebarCommand } from "./browserCore";
import { showMenuRequest } from "./menus";
import type { MenuHost } from "./menus";
import { openCommandBar, openLibrary, openSiteControls } from "./overlayController";
import { setSplitOrientation, separateTabFromSplit, splitTabs, unsplit } from "./split";
import {
  addToFavorites,
  clearTodayTabs,
  createFolder,
  deleteItem,
  duplicateTab,
  moveItem,
  openTab,
  pinTab,
  renameItem,
  restoreArchivedTab,
  selectTab,
  setArchiveAfter,
  setPinnedSectionOpen,
  setSidebarVisible,
  toggleFolder,
  unpinTab,
} from "./state";
import {
  createSpace,
  deleteSpace,
  moveItemToSpace,
  moveSpace,
  renameSpace,
  setSpaceIcon,
  setSpaceTheme,
  switchSpace,
  switchSpaceByOffset,
} from "./spaces";
import { closeTabByUser, navigateFocusedPage, openLinkInNewTab, resetTabToHome, setMuted } from "./tabActions";
import { getTabContents } from "./tabViews";
import { normalizeTypedInput } from "./urls";

/** What menus.ts needs from the rest of the app. */
export const menuHost: MenuHost = {
  getState: () => getState(),
  getWindow: () => getWindow(),
  runAction: (action) => runAction(action),
  sendSidebarCommand: (command) => sendSidebarCommand(command),
  openInNewTab: (url, inBackground) => openLinkInNewTab(url, inBackground ? "background" : "foreground"),
  isTabLoaded: (tabId) => getTabContents(tabId) !== null,
};

/**
 * Runs one action. Each state action is one applyChange() call with the matching pure function.
 */
export function runAction(action: BrowserAction): void {
  const now = Date.now();
  switch (action.type) {
    case "openTab": {
      if (action.typedText.trim() === "") {
        return;
      }
      const url = normalizeTypedInput(action.typedText);
      applyChange((state) => openTab(state, url, now));
      return;
    }
    case "selectTab":
      return applyChange((state) => selectTab(state, action.tabId, now));
    case "closeTab":
      return closeTabByUser(action.tabId);
    case "deleteItem":
      return applyChange((state) => deleteItem(state, action.itemId, now));
    case "pinTab":
      return applyChange((state) => pinTab(state, action.tabId));
    case "unpinTab":
      return applyChange((state) => unpinTab(state, action.tabId, now));
    case "addToFavorites":
      return applyChange((state) => addToFavorites(state, action.tabId));
    case "moveItem":
      return applyChange((state) => moveItem(state, action.itemId, action.target, action.index, now));
    case "createFolder":
      return applyChange((state) => createFolder(state, action.title, now));
    case "renameItem":
      return applyChange((state) => renameItem(state, action.itemId, action.name));
    case "toggleFolder":
      return applyChange((state) => toggleFolder(state, action.folderId));
    case "setPinnedSectionOpen":
      return applyChange((state) => setPinnedSectionOpen(state, action.spaceId, action.isOpen));
    case "clearTodayTabs":
      return applyChange((state) => clearTodayTabs(state, now));
    case "restoreArchivedTab":
      return applyChange((state) => restoreArchivedTab(state, action.tabId, now));
    case "duplicateTab":
      return applyChange((state) => duplicateTab(state, action.tabId, now));
    case "resetTab":
      return resetTabToHome(action.tabId);
    case "setTabMuted":
      return setMuted(action.tabId, action.isMuted);
    case "splitTabs":
      return applyChange((state) => splitTabs(state, action.firstTabId, action.secondTabId, now));
    case "separateTabFromSplit":
      return applyChange((state) => separateTabFromSplit(state, action.tabId));
    case "unsplit":
      return applyChange((state) => unsplit(state, action.splitId));
    case "setSplitOrientation":
      return applyChange((state) => setSplitOrientation(state, action.splitId, action.orientation));
    case "switchSpace":
      return applyChange((state) => switchSpace(state, action.spaceId, now));
    case "switchSpaceByOffset":
      return applyChange((state) => switchSpaceByOffset(state, action.offset, now));
    case "createSpace":
      return applyChange((state) => createSpace(state, { name: action.name, icon: action.icon, theme: action.theme }, now));
    case "renameSpace":
      return applyChange((state) => renameSpace(state, action.spaceId, action.name));
    case "setSpaceIcon":
      return applyChange((state) => setSpaceIcon(state, action.spaceId, action.icon));
    case "setSpaceTheme":
      return applyChange((state) => setSpaceTheme(state, action.spaceId, action.theme));
    case "deleteSpace":
      return applyChange((state) => deleteSpace(state, action.spaceId, now));
    case "moveSpace":
      return applyChange((state) => moveSpace(state, action.spaceId, action.index));
    case "moveItemToSpace":
      return applyChange((state) => moveItemToSpace(state, action.itemId, action.spaceId));
    case "setArchiveAfter":
      return applyChange((state) => setArchiveAfter(state, action.archiveAfterMs));
    case "setSidebarVisible":
      return applyChange((state) => setSidebarVisible(state, action.isVisible));
    case "navigate":
      return navigateFocusedPage(action.command);
    case "openCommandBar":
      return openCommandBar(action.mode);
    case "openLibrary":
      return openLibrary();
    case "openSiteControls":
      return openSiteControls();
    case "showMenu":
      return showMenuRequest(menuHost, action.request);
  }
}
