/**
 * WHY this file exists:
 *   What each application-menu item (and therefore each keyboard shortcut) does. The Command Bar's actions reuse
 *   the same commands, so ⌘D and typing "pin" in the Command Bar do exactly the same thing.
 *
 * Data source:
 *   browserCore.ts (state), tabActions.ts and overlayController.ts.
 *
 * Data flow:
 *   ⌘D → appMenu.ts → appMenuCommands.togglePinSelected() → applyChange(pinTab / unpinTab)
 */
import type { AppMenuCommands } from "./appMenu";
import { importFromArc } from "./arcImportController";
import { setAsDefaultBrowser } from "./defaultBrowser";
import { applyChange, getState } from "./browserCore";
import { openLittleWindow } from "./littleWindow";
import { findNextMatch, openCommandBar, openFind, openLibrary, openTabSwitcher, runSiteCommand } from "./overlayController";
import { copyTabUrl, toggleDevTools, zoomPage } from "./pageCommands";
import { closePeek, isPeekOpen, openPeekAsTab } from "./peek";
import { buildImportMenu, showMenuRequest } from "./menus";
import { menuHost } from "./actionRunner";
import {
  clearTodayTabs,
  createFolder,
  duplicateTab,
  findNeighbourTabId,
  findTabIdByNumber,
  getSelectedTabId,
  pinTab,
  restoreLastArchivedTab,
  setSidebarVisible,
  unpinTab,
} from "./state";
import { switchSpaceByNumber, switchSpaceByOffset } from "./spaces";
import { closeSelectedTab, closeTabByUser, navigateFocusedPage, openLinkInNewTab, selectTabIfAny } from "./tabActions";
import { getFocusedContents } from "./tabViews";
import { findSplitOfTab, findTab, isInToday } from "./tree";

/**
 * Returns the selected tab id of the active Space, or null.
 */
function getSelectedId(): string | null {
  return getSelectedTabId(getState());
}

export const appMenuCommands: AppMenuCommands = {
  openCommandBar: (mode) => openCommandBar(mode),
  closeSelectedTab: () => {
    // With a Peek open, ⌘W dismisses the Peek, like Arc.
    if (isPeekOpen()) {
      closePeek();
      return;
    }
    closeSelectedTab();
  },
  reopenClosedTab: () => applyChange((state) => restoreLastArchivedTab(state, Date.now())),
  togglePinSelected: () => {
    const selectedTabId = getSelectedId();
    if (selectedTabId === null) {
      return;
    }
    if (isInToday(getState(), selectedTabId)) {
      applyChange((state) => pinTab(state, selectedTabId));
      return;
    }
    applyChange((state) => unpinTab(state, selectedTabId, Date.now()));
  },
  copySelectedUrl: (format) => {
    const selectedTabId = getSelectedId();
    const tab = selectedTabId === null ? undefined : findTab(getState(), selectedTabId);
    if (tab !== undefined) {
      copyTabUrl(tab, format);
    }
  },
  duplicateSelected: () => {
    const selectedTabId = getSelectedId();
    if (selectedTabId !== null) {
      applyChange((state) => duplicateTab(state, selectedTabId, Date.now()));
    }
  },
  cycleTab: (offset) => selectTabIfAny(findNeighbourTabId(getState(), offset)),
  selectTabNumber: (tabNumber) => selectTabIfAny(findTabIdByNumber(getState(), tabNumber)),
  switchRecentTab: (step) => openTabSwitcher(step),
  clearTodayTabs: () => applyChange((state) => clearTodayTabs(state, Date.now())),
  addSplitPane: () => {
    if (getSelectedId() !== null) {
      openCommandBar("splitWith");
    }
  },
  closeSplitPane: () => {
    const selectedTabId = getSelectedId();
    if (selectedTabId !== null && findSplitOfTab(getState(), selectedTabId) !== null) {
      closeTabByUser(selectedTabId);
    }
  },
  switchSpaceByOffset: (offset) => applyChange((state) => switchSpaceByOffset(state, offset, Date.now())),
  switchSpaceByNumber: (spaceNumber) => applyChange((state) => switchSpaceByNumber(state, spaceNumber, Date.now())),
  newSpace: () => showMenuRequest(menuHost, { menu: "plus" }),
  newFolder: () => applyChange((state) => createFolder(state, "New Folder", Date.now())),
  toggleSidebar: () => applyChange((state) => setSidebarVisible(state, !state.settings.isSidebarVisible)),
  navigate: (command) => navigateFocusedPage(command),
  forceReload: () => getFocusedContents()?.reloadIgnoringCache(),
  zoom: (direction) => {
    const contents = getFocusedContents();
    if (contents !== null) {
      zoomPage(contents, direction);
    }
  },
  toggleDevTools: () => {
    const contents = getFocusedContents();
    if (contents !== null) {
      toggleDevTools(contents);
    }
  },
  openFind: () => openFind(),
  findNext: (forward) => findNextMatch(forward),
  openLibrary: () => openLibrary(),
  openLittleWindow: () => openLittleWindow(null),
  buildImportMenu: () => buildImportMenu(menuHost),
  newNote: () => menuHost.runAction({ type: "createNote" }),
  newEasel: () => menuHost.runAction({ type: "createEasel" }),
  importFromArc: () => {
    importFromArc().catch((error) => console.error("Import from Arc failed:", error));
  },
  openUrlInNewTab: (url) => openLinkInNewTab(url, "foreground"),
  openPeekAsTab: () => openPeekAsTab(),
  openPrivateWindow: () => openLittleWindow(null, { isPrivate: true }),
  zapElements: () => runSiteCommand("zap"),
  printPage: () => getFocusedContents()?.print(),
  setAsDefaultBrowser: () => {
    setAsDefaultBrowser().catch((error) => console.error("Set as default browser failed:", error));
  },
};
