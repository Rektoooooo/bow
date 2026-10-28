/**
 * WHY this file exists:
 *   Every action from the sidebar (and many menu items) arrives as one BrowserAction object. This file turns each
 *   one into the matching state change, page action, native menu or overlay panel. Actions act on the focused main
 *   window; one from a background window's sidebar first gives that window the focus.
 *
 * Data source:
 *   A BrowserAction that ipc.ts already checked field by field, and the window whose sidebar sent it.
 *
 * Data flow:
 *   ipc.ts parseAction() → runActionFromWindow(action, windowId) → runAction(action) → applyChange(state function) /
 *   tabActions / menus / overlayController
 */
import type { BrowserAction } from "../shared/actions";
import { SIDEBAR_COLLAPSE_WIDTH_PX } from "../shared/settings";
import type { SpaceTheme, WindowId } from "../shared/types";
import {
  applyChange,
  getState,
  getWindow,
  moveShownElsewhereTabsHere,
  previewSidebarWidthWhileDragging,
  reportOpenEditor,
  setItemDrag,
  handOverDrop,
  scheduleRuntimePush,
  sendSidebarCommand,
  setSidebarPeek,
} from "./browserCore";
import { focusMainWindow } from "./mainWindows";
import { dismissMedia, toggleMediaPlayback } from "./media";
import { addRoutingRule, removeRoutingRule } from "./routing";
import { deleteBoost, setBoostCss, setBoostEnabled, setBoostJavaScript, setBoostStyle } from "./boosts";
import { reapplyBoostsToAllPages } from "./boostPages";
import { importFromArc } from "./arcImportController";
import { exportBackup, restoreBackup, revealBackupsFolder } from "./backupController";
import { chooseSyncFolder, revealSyncFolder, stopSyncing } from "./syncController";
import { setFavoritesKeptAwake, setSiteKeptAwake } from "./tabSleep";
import { canSleepNow, sleepOtherTabsNow, sleepTabNow } from "./tabSleepController";
import { clearTodayTabsWithUndo, dismissArchiveUndo, undoLastArchive } from "./archiveUndoController";
import { importFromBrowser } from "./browserImportController";
import { applyCosmeticFilters, ensureFilterLists } from "./adBlock";
import { applyAppIcon } from "./appIcon";
import { showExtensionsMenu } from "./extensionHost";
import { setExtensionEnabled } from "./extensionList";
import { checkForExtensionUpdatesNow, installFromWebStore, loadUnpackedExtension, removeExtensionAndCopy } from "./extensionsController";
import { answerPermissionPrompt } from "./permissionPrompts";
import { removePermissionAnswer } from "./sitePermissions";
import { showMenuRequest } from "./menus";
import type { MenuHost } from "./menus";
import {
  fadeHoverPanel,
  hideFolderList,
  hideTabTooltip,
  openBoostEditor,
  openCommandBar,
  openLibrary,
  openSiteControls,
  openSpaceIconPicker,
  openThemeEditor,
  runSiteCommand,
  setFolderListPointer,
  showFolderList,
  showTabTooltip,
} from "./overlayController";
import { setDeveloperMode } from "../shared/developerMode";
import { openDeveloperTool, translatePage } from "./pageCommands";
import { setAsDefaultBrowser } from "./defaultBrowser";
import { setTabSleepAfter } from "./tabSleep";
import { restartToUpdate } from "./appUpdates";
import { createFeedLiveFolderFromPage, createGitHubLiveFolder, openLiveFolderSource, refreshLiveFolder } from "./liveFolderRefresher";
import { showHiddenLiveFolderItems } from "./liveFolders";
import { setSplitOrientation, separateTabFromSplit, splitTabs, unsplit } from "./split";
import {
  addToFavorites,
  setSpaceArchiveAfter,
  setTabNeverArchived,
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
  setSearchEngine,
  setAdBlock,
  setAdBlockForSite,
  setAppIcon,
  setTidyTitles,
  setShowFullUrls,
  setSnapshots,
  createNote,
  createEasel,
  finishWelcome,
  setPinnedSectionOpen,
  setSidebarVisible,
  setSidebarWidth,
  toggleFolder,
  unpinTab,
} from "./state";
import {
  createProfile,
  createSpace,
  deleteSpace,
  moveItemToSpace,
  moveSpace,
  renameSpace,
  setSpaceIcon,
  setSpaceProfile,
  setSpaceTheme,
  switchSpace,
  switchSpaceByOffset,
} from "./spaces";
import { takeItemIntoFocusedWindow } from "./windows";
import { closeSplitByUser, closeTabByUser, navigateFocusedPage, openLinkInNewTab, resetTabToHome, setMuted } from "./tabActions";
import { getFocusedContents, getTabContents, getTabViews } from "./tabViews";
import { createId } from "./tree";
import { normalizeTypedInput } from "./urls";
import { findSearchEngine } from "../shared/searchEngines";

/** What menus.ts needs from the rest of the app. */
export const menuHost: MenuHost = {
  getState: () => getState(),
  getWindow: () => getWindow(),
  runAction: (action) => runAction(action),
  sendSidebarCommand: (command) => sendSidebarCommand(command),
  openInNewTab: (url, inBackground) => openLinkInNewTab(url, inBackground ? "background" : "foreground"),
  isTabLoaded: (tabId) => getTabContents(tabId) !== null,
  canTabSleep: (tabId) => canSleepNow(tabId),
};

/**
 * Dragging the sidebar's edge: moves the page live, and saves the width when the drag ends. Letting go far to the
 * left hides the sidebar, like Arc.
 */
function resizeSidebar(width: number, isFinal: boolean): void {
  if (!isFinal) {
    previewSidebarWidthWhileDragging(width);
    return;
  }
  previewSidebarWidthWhileDragging(null);
  if (width < SIDEBAR_COLLAPSE_WIDTH_PX) {
    applyChange((state) => setSidebarVisible(state, false));
    return;
  }
  applyChange((state) => setSidebarWidth(state, width));
}

/**
 * Creates a Space and puts its name into edit mode right away, so the user names it while it is fresh.
 */
function createSpaceAndRename(name: string, icon: string, theme: SpaceTheme): void {
  const activeSpaceBefore = getState().activeSpaceId;
  applyChange((state) => createSpace(state, { name: name, icon: icon, theme: theme }, Date.now()));
  const activeSpaceAfter = getState().activeSpaceId;
  if (activeSpaceAfter !== activeSpaceBefore) {
    sendSidebarCommand({ kind: "beginSpaceRename", spaceId: activeSpaceAfter });
  }
}

/**
 * Puts the ad-blocking CSS into every loaded page again (or takes it out), after the setting changed.
 */
function reapplyCosmeticFiltersToAllPages(): void {
  for (const view of getTabViews().values()) {
    applyCosmeticFilters(view.webContents).catch(() => undefined);
  }
}

/**
 * Actions that come from the pointer moving (the edge of a hidden sidebar, a tab row's tooltip). The pointer also moves
 * over background windows, so these never bring a window forward.
 */
const POINTER_ACTION_TYPES: BrowserAction["type"][] = ["setSidebarPeek", "showTabTooltip", "hideTabTooltip", "showFolderList", "hideFolderList", "folderListPointer", "fadeHoverPanel"];

/**
 * Runs an action from a page: the sidebar of a main window (windowId), or the overlay (null, it is always in the
 * focused window). An action from a background window's sidebar (a drop, a click that arrived before the window's
 * focus event) gives that window the focus first, so it acts there. Pointer actions stay where they are: the sidebar
 * peek is per window, and tooltips only show in the focused window.
 */
export function runActionFromWindow(action: BrowserAction, windowId: WindowId | null): void {
  const isFromBackgroundWindow = windowId !== null && windowId !== getState().focusedWindowId;
  // Every window's sidebar reports its editors and drags as they start and end, in the background too (a drag ends
  // in its own window after the drop landed in another).
  if (windowId !== null && action.type === "reportOpenEditor") {
    reportOpenEditor(windowId, action.tabId, action.isOpen);
    return;
  }
  if (windowId !== null && action.type === "beginItemDrag") {
    setItemDrag(windowId, action.itemId);
    return;
  }
  if (windowId !== null && action.type === "endItemDrag") {
    setItemDrag(windowId, null);
    return;
  }
  if (windowId !== null && action.type === "dropItemInOtherWindow") {
    handOverDrop(windowId, action.itemId, action.screenX, action.screenY);
    return;
  }
  if (windowId !== null && action.type === "setSidebarPeek") {
    setSidebarPeek(windowId, action.isPeeking);
    return;
  }
  if (isFromBackgroundWindow && POINTER_ACTION_TYPES.includes(action.type)) {
    return;
  }
  if (isFromBackgroundWindow) {
    focusMainWindow(windowId);
  }
  runAction(action);
}

/**
 * Runs one action in the focused window. Each state action is one applyChange() call with the matching pure function.
 */
export function runAction(action: BrowserAction): void {
  const now = Date.now();
  switch (action.type) {
    case "openTab": {
      if (action.typedText.trim() === "") {
        return;
      }
      const searchEngine = findSearchEngine(getState().settings.searchEngine);
      const url = normalizeTypedInput(action.typedText, searchEngine);
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
      return clearTodayTabsWithUndo();
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
    case "closeSplit":
      return closeSplitByUser(action.splitId);
    case "setSplitOrientation":
      return applyChange((state) => setSplitOrientation(state, action.splitId, action.orientation));
    case "switchSpace":
      return applyChange((state) => switchSpace(state, action.spaceId, now));
    case "switchSpaceByOffset":
      return applyChange((state) => switchSpaceByOffset(state, action.offset, now));
    case "createSpace":
      return createSpaceAndRename(action.name, action.icon, action.theme);
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
    case "setTabSleepAfter":
      return applyChange((state) => setTabSleepAfter(state, action.tabSleepAfterMs));
    case "setSearchEngine":
      return applyChange((state) => setSearchEngine(state, action.engineId));
    case "setSidebarVisible":
      return applyChange((state) => setSidebarVisible(state, action.isVisible));
    case "setSidebarPeek":
      return setSidebarPeek(getState().focusedWindowId, action.isPeeking);
    case "setSidebarWidth":
      return resizeSidebar(action.width, action.isFinal);
    case "setSpaceProfile":
      return applyChange((state) => setSpaceProfile(state, action.spaceId, action.profileId));
    case "addRoutingRule":
      return applyChange((state) => addRoutingRule(state, action.matchType, action.value, action.spaceId, now));
    case "removeRoutingRule":
      return applyChange((state) => removeRoutingRule(state, action.ruleId));
    case "setBoostCss":
      applyChange((state) => setBoostCss(state, action.site, action.css, now));
      return reapplyBoostsToAllPages(getState());
    case "setBoostStyle":
      applyChange((state) => setBoostStyle(state, action.site, { hueShift: action.hueShift, isInverted: action.isInverted, fontId: action.fontId }, now));
      reapplyBoostsToAllPages(getState());
      return;
    case "setBoostJavaScript":
      applyChange((state) => setBoostJavaScript(state, action.site, action.javascript, action.isOn, now));
      return;
    case "setBoostEnabled":
      applyChange((state) => setBoostEnabled(state, action.site, action.isEnabled));
      return reapplyBoostsToAllPages(getState());
    case "deleteBoost":
      applyChange((state) => deleteBoost(state, action.site));
      return reapplyBoostsToAllPages(getState());
    case "openBoostEditor":
      return openBoostEditor(action.site);
    case "createProfileForSpace":
      return applyChange((state) => {
        const created = createProfile(state, "", now);
        return setSpaceProfile(created.state, action.spaceId, created.profileId);
      });
    case "toggleMediaPlayback":
      toggleMediaPlayback().then(scheduleRuntimePush);
      return;
    case "dismissMedia":
      dismissMedia().then(scheduleRuntimePush);
      return;
    case "navigate":
      return navigateFocusedPage(action.command);
    case "openCommandBar":
      return openCommandBar(action.mode);
    case "openLibrary":
      return openLibrary();
    case "openSiteControls":
      return openSiteControls();
    case "openThemeEditor":
      return openThemeEditor(action.spaceId);
    case "openSpaceIconPicker":
      return openSpaceIconPicker(action.spaceId, action.anchor);
    case "showMenu":
      return showMenuRequest(menuHost, action.request);
    case "setExtensionEnabled":
      return applyChange((state) => setExtensionEnabled(state, action.profileId, action.extensionId, action.isEnabled));
    case "removeExtension":
      removeExtensionAndCopy(action.profileId, action.extensionId).catch((error) => console.error("Removing the extension failed:", error));
      return;
    case "loadUnpackedExtension":
      loadUnpackedExtension().catch((error) => console.error("Load Unpacked failed:", error));
      return;
    case "importFromArc":
      importFromArc().catch((error) => console.error("Import from Arc failed:", error));
      return;
    case "exportBackup":
      exportBackup().catch((error) => console.error("Exporting a backup failed:", error));
      return;
    case "restoreBackup":
      restoreBackup().catch((error) => console.error("Restoring a backup failed:", error));
      return;
    case "showExtensionsMenu":
      return showExtensionsMenu(action.anchor);
    case "answerPermissionPrompt":
      return answerPermissionPrompt(action.requestId, action.isAllowed);
    case "removeSitePermission":
      return applyChange((state) => removePermissionAnswer(state, action.profileId, action.origin, action.kind));
    case "installWebStoreExtension":
      installFromWebStore(action.extensionId).catch((error) => console.error("Adding the extension failed:", error));
      return;
    case "checkExtensionUpdates":
      checkForExtensionUpdatesNow().catch((error) => console.error("Checking for extension updates failed:", error));
      return;
    case "setDeveloperMode":
      return applyChange((state) => setDeveloperMode(state, action.site, action.isOn));
    case "openDeveloperTool": {
      const contents = getFocusedContents();
      if (contents !== null) {
        openDeveloperTool(contents, action.tool).catch((error) => console.error("Opening the developer tools failed:", error));
      }
      return;
    }
    case "runSiteCommand":
      return runSiteCommand(action.command);
    case "setAdBlock":
      applyChange((state) => setAdBlock(state, action.isOn));
      if (action.isOn) {
        ensureFilterLists()
          .then(() => reapplyCosmeticFiltersToAllPages())
          .catch(() => undefined);
      } else {
        reapplyCosmeticFiltersToAllPages();
      }
      return;
    case "setAdBlockForSite":
      applyChange((state) => setAdBlockForSite(state, action.site, action.isOn));
      reapplyCosmeticFiltersToAllPages();
      return;
    case "finishWelcome":
      return applyChange((state) => finishWelcome(state));
    case "setAsDefaultBrowser":
      setAsDefaultBrowser().catch((error) => console.error("Setting the default browser failed:", error));
      return;
    case "restartToUpdate":
      restartToUpdate();
      return;
    case "translatePage": {
      const contents = getFocusedContents();
      if (contents !== null) {
        translatePage(contents);
      }
      return;
    }
    case "createEasel":
      return applyChange((state) => createEasel(state, createId("easel", now), now));
    case "createNote":
      return applyChange((state) => createNote(state, createId("note", now), now));
    case "setTidyTitles":
      return applyChange((state) => setTidyTitles(state, action.isOn));
    case "setShowFullUrls":
      return applyChange((state) => setShowFullUrls(state, action.isOn));
    case "setSnapshots":
      return applyChange((state) => setSnapshots(state, action.isOn));
    case "revealBackups":
      return revealBackupsFolder();
    case "setTabNeverArchived":
      return applyChange((state) => setTabNeverArchived(state, action.tabId, action.isNeverArchived));
    case "setSpaceArchiveAfter":
      return applyChange((state) => setSpaceArchiveAfter(state, action.spaceId, action.archiveAfterMs));
    case "undoArchive":
      return undoLastArchive();
    case "dismissArchiveUndo":
      return dismissArchiveUndo();
    case "sleepTab":
      sleepTabNow(action.tabId);
      return;
    case "sleepOtherTabs":
      sleepOtherTabsNow();
      return;
    case "setSiteKeptAwake":
      return applyChange((state) => setSiteKeptAwake(state, action.site, action.isKeptAwake));
    case "setFavoritesKeptAwake":
      return applyChange((state) => setFavoritesKeptAwake(state, action.isOn));
    case "openTaskManager":
      return openLibrary("tasks");
    case "chooseSyncFolder":
      chooseSyncFolder().catch((error) => console.error("Starting sync failed:", error));
      return;
    case "stopSyncing":
      return stopSyncing();
    case "revealSyncFolder":
      return revealSyncFolder();
    case "showTabTooltip":
      return showTabTooltip(action.title, action.showsRenameHint, action.frame);
    case "hideTabTooltip":
      return hideTabTooltip();
    case "showFolderList":
      return showFolderList(action.folderId, action.anchor);
    case "hideFolderList":
      return hideFolderList();
    case "folderListPointer":
      return setFolderListPointer(action.isInside);
    case "fadeHoverPanel":
      return fadeHoverPanel();
    case "setAppIcon":
      applyChange((state) => setAppIcon(state, action.variantId));
      applyAppIcon(action.variantId).catch((error) => console.error("Changing the app icon failed:", error));
      return;
    case "importFromBrowser":
      importFromBrowser(action.sourceId).catch((error) => console.error("Import from browser failed:", error));
      return;
    case "createGitHubLiveFolder":
      return createGitHubLiveFolder(action.list);
    case "createFeedLiveFolder":
      createFeedLiveFolderFromPage().catch((error) => console.error("Making a feed live folder failed:", error));
      return;
    case "refreshLiveFolder":
      return refreshLiveFolder(action.folderId);
    case "openLiveFolderSource":
      return openLiveFolderSource(action.folderId);
    case "showHiddenLiveFolderItems":
      applyChange((state) => showHiddenLiveFolderItems(state, action.folderId));
      refreshLiveFolder(action.folderId);
      return;
    case "moveTabToThisWindow":
      return moveShownElsewhereTabsHere();
    case "reportOpenEditor":
    case "beginItemDrag":
    case "endItemDrag":
    case "dropItemInOtherWindow":
      // Only a window's sidebar reports editors and drags (runActionFromWindow handles them with the window's id).
      return;
    case "takeItemFromOtherWindow":
      return applyChange((state) => takeItemIntoFocusedWindow(state, action.itemId, now));
  }
}
