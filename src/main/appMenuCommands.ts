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
import { checkForUpdatesNow, getReadyUpdateVersion, restartToUpdate } from "./appUpdates";
import { applyChange, getState, getWindow } from "./browserCore";
import { openLittleWindow } from "./littleWindow";
import { closeFrontWindow, openNewWindow } from "./mainWindows";
import { findNextMatch, openCommandBar, openFind, openLibrary, openShortcutSheet, openTabSwitcher, runSiteCommand } from "./overlayController";
import { copyTabUrl, exportPageAsPdf, savePageAs, toggleDevTools, zoomPage } from "./pageCommands";
import { closePeek, getPeekContents, isPeekClosing, isPeekOpen, openPeekAsTab } from "./peek";
import { buildImportMenu, showMenuRequest } from "./menus";
import { menuHost } from "./actionRunner";
import { showToast } from "./statusBubble";
import { clearTodayTabsWithUndo, closeDuplicateTabsWithUndo } from "./archiveUndoController";
import {
  createFolder,
  duplicateTab,
  findNeighbourTabId,
  findTabIdByNumber,
  getSelectedTabId,
  pinTab,
  restoreLastArchivedTab,
  selectTab,
  setSidebarVisible,
  setShowFullUrls,
  unpinTab,
} from "./state";
import { switchSpaceByNumber, switchSpaceByOffset } from "./spaces";
import { closeSelectedTab, closeTabByUser, navigateFocusedPage, navigatePage, openLinkInNewTab, selectTabIfAny } from "./tabActions";
import { getFocusedContents } from "./tabViews";
import { findSplitOfTab, findTab, isInToday } from "./tree";
import { findAdjacentPaneTabId } from "./split";

/**
 * Returns the selected tab id of the active Space, or null.
 */
function getSelectedId(): string | null {
  return getSelectedTabId(getState());
}

/**
 * The split view the selected tab is in, or null.
 */
function findSelectedSplitId(): string | null {
  const selectedTabId = getSelectedId();
  return selectedTabId === null ? null : findSplitOfTab(getState(), selectedTabId);
}

export const appMenuCommands: AppMenuCommands = {
  openCommandBar: (mode) => openCommandBar(mode),
  closeSelectedTab: () => {
    // With a Peek open, ⌘W dismisses the Peek, like Arc (a second ⌘W while it shrinks away does nothing more).
    if (isPeekOpen() || isPeekClosing()) {
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
      showToast(format === "markdown" ? "Copied link as Markdown" : "Copied link").catch(() => undefined);
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
  clearTodayTabs: () => clearTodayTabsWithUndo(),
  closeDuplicateTabs: () => closeDuplicateTabsWithUndo(),
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
  setSplitLayout: (orientation) => {
    const splitId = findSelectedSplitId();
    if (splitId !== null) {
      menuHost.runAction({ type: "setSplitOrientation", splitId: splitId, orientation: orientation });
    }
  },
  swapSplitPanes: () => {
    const splitId = findSelectedSplitId();
    if (splitId !== null) {
      menuHost.runAction({ type: "swapSplitPanes", splitId: splitId });
    }
  },
  equalizeSplitPanes: () => {
    const splitId = findSelectedSplitId();
    if (splitId !== null) {
      menuHost.runAction({ type: "equalizeSplit", splitId: splitId });
    }
  },
  focusAdjacentPane: (offset) => {
    const tabId = findAdjacentPaneTabId(getState(), offset);
    if (tabId !== null) {
      applyChange((state) => selectTab(state, tabId, Date.now()));
    }
  },
  switchSpaceByOffset: (offset) => applyChange((state) => switchSpaceByOffset(state, offset, Date.now())),
  switchSpaceByNumber: (spaceNumber) => applyChange((state) => switchSpaceByNumber(state, spaceNumber, Date.now())),
  newSpace: () => showMenuRequest(menuHost, { menu: "plus" }),
  newFolder: () => applyChange((state) => createFolder(state, "New Folder", Date.now())),
  toggleSidebar: () => applyChange((state) => setSidebarVisible(state, !state.settings.isSidebarVisible)),
  toggleFullUrls: () => applyChange((state) => setShowFullUrls(state, state.settings.showsFullUrls !== true)),
  // With a Peek open, ⌘[ / ⌘] / ⌘R and zoom act on the Peek's page (the page behind it is dimmed), like Arc.
  navigate: (command) => {
    const peekContents = getPeekContents();
    if (peekContents === null) {
      navigateFocusedPage(command);
      return;
    }
    navigatePage(peekContents, command);
  },
  forceReload: () => {
    const contents = getPeekContents() ?? getFocusedContents();
    contents?.reloadIgnoringCache();
  },
  zoom: (direction) => {
    const contents = getPeekContents() ?? getFocusedContents();
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
  openSettings: () => openLibrary("settings"),
  openShortcutSheet: () => openShortcutSheet(),
  sleepOtherTabs: () => menuHost.runAction({ type: "sleepOtherTabs" }),
  openTaskManager: () => menuHost.runAction({ type: "openTaskManager" }),
  openLittleWindow: () => openLittleWindow(null),
  openNewWindow: () => openNewWindow(),
  closeWindow: () => closeFrontWindow(),
  buildImportMenu: () => buildImportMenu(menuHost),
  newNote: () => menuHost.runAction({ type: "createNote" }),
  newEasel: () => menuHost.runAction({ type: "createEasel" }),
  importFromArc: () => {
    importFromArc().catch((error) => console.error("Import from Arc failed:", error));
  },
  exportBackup: () => menuHost.runAction({ type: "exportBackup" }),
  restoreBackup: () => menuHost.runAction({ type: "restoreBackup" }),
  openUrlInNewTab: (url) => openLinkInNewTab(url, "foreground"),
  openPeekAsTab: () => openPeekAsTab(),
  openPrivateWindow: () => openLittleWindow(null, { isPrivate: true }),
  zapElements: () => runSiteCommand("zap"),
  printPage: () => getFocusedContents()?.print(),
  savePageAs: () => {
    const contents = getFocusedContents();
    if (contents !== null) {
      savePageAs(contents, getWindow()).catch((error) => console.error("Saving the page failed:", error));
    }
  },
  exportPdf: () => {
    const contents = getFocusedContents();
    if (contents !== null) {
      exportPageAsPdf(contents, getWindow()).catch((error) => console.error("Exporting the page as PDF failed:", error));
    }
  },
  checkForUpdates: () => {
    checkForUpdatesNow().catch((error) => console.error("Checking for updates failed:", error));
  },
  restartToUpdate: () => restartToUpdate(),
  readyUpdateVersion: () => getReadyUpdateVersion(),
  setAsDefaultBrowser: () => {
    setAsDefaultBrowser().catch((error) => console.error("Set as default browser failed:", error));
  },
};
