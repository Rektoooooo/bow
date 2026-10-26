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
import { SIDEBAR_COLLAPSE_WIDTH_PX } from "../shared/settings";
import type { SpaceTheme } from "../shared/types";
import { applyChange, getState, getWindow, previewSidebarWidthWhileDragging, scheduleRuntimePush, sendSidebarCommand, setSidebarPeek } from "./browserCore";
import { dismissMedia, toggleMediaPlayback } from "./media";
import { addRoutingRule, removeRoutingRule } from "./routing";
import { deleteBoost, setBoostCss, setBoostEnabled } from "./boosts";
import { reapplyBoostsToAllPages } from "./boostPages";
import { importFromArc } from "./arcImportController";
import { showExtensionsMenu } from "./extensionHost";
import { setExtensionEnabled } from "./extensionList";
import { checkForExtensionUpdatesNow, installFromWebStore, loadUnpackedExtension, removeExtensionAndCopy } from "./extensionsController";
import { answerPermissionPrompt } from "./permissionPrompts";
import { removePermissionAnswer } from "./sitePermissions";
import { showMenuRequest } from "./menus";
import type { MenuHost } from "./menus";
import { openBoostEditor, openCommandBar, openLibrary, openSiteControls, openThemeEditor } from "./overlayController";
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
    case "setSidebarVisible":
      return applyChange((state) => setSidebarVisible(state, action.isVisible));
    case "setSidebarPeek":
      return setSidebarPeek(action.isPeeking);
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
    case "setBoostEnabled":
      applyChange((state) => setBoostEnabled(state, action.site, action.isEnabled));
      return reapplyBoostsToAllPages(getState());
    case "deleteBoost":
      applyChange((state) => deleteBoost(state, action.site));
      return reapplyBoostsToAllPages(getState());
    case "openBoostEditor":
      return openBoostEditor();
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
  }
}
