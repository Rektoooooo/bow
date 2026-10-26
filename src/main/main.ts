/**
 * WHY this file exists:
 *   The app's starting point. It owns the one copy of BrowserState, the window and the timers,
 *   and it is the only place that turns a state change into "save, update views, redraw sidebar".
 *
 * Data source:
 *   store.ts (saved state), Electron's app / BrowserWindow, and the clock (Date.now()).
 *
 * Data flow:
 *   app ready → loadState() → createMainWindow() → registerIpcHandlers() → startAutoArchiveTimers()
 *   any action → runAction() → applyChange(change) → saveState() → syncTabViews() → pushStateToSidebar()
 *   page events (loading, sound) → scheduleRuntimePush() → sidebar redraws its indicators
 *
 * Pattern: "single source of truth". Only applyChange() replaces the state, so every change
 * is saved and shown the same way.
 */
import { app, BrowserWindow, dialog, session } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BrowserAction, NavigationCommand, SidebarCommand } from "../shared/actions";
import { IPC_CHANNELS } from "../shared/ipcChannels";
import { ARCHIVE_PRUNE_INTERVAL_MS, ARCHIVE_SWEEP_INTERVAL_MS, IN_USE_REFRESH_INTERVAL_MS } from "../shared/settings";
import type { BrowserState, ItemId } from "../shared/types";
import { findTabsInUse, markTabsActive } from "./activity";
import { installAppMenu } from "./appMenu";
import type { AppMenuCommands } from "./appMenu";
import { attachArcFavicons } from "./arcFavicons";
import { importArcSidebar } from "./arcImport";
import { findTabsToArchive, pruneArchive } from "./autoArchive";
import { registerIpcHandlers } from "./ipc";
import type { CardLayoutOptions } from "./layout";
import { showMenuRequest, showPageContextMenu } from "./menus";
import type { MenuHost } from "./menus";
import { copyTabUrl, toggleDevTools, zoomPage } from "./pageCommands";
import { restrictWebPermissions, useChromeUserAgent } from "./profiles";
import { setSplitOrientation, separateTabFromSplit, splitTabs, unsplit } from "./split";
import {
  addToFavorites,
  clearTodayTabs,
  closeTab,
  createFolder,
  deleteItem,
  duplicateTab,
  findNeighbourTabId,
  findTabIdByNumber,
  getSelectedTabId,
  moveItem,
  moveTabsToArchive,
  openTab,
  pinTab,
  renameItem,
  resetPinnedTab,
  restoreArchivedTab,
  restoreLastArchivedTab,
  selectTab,
  setArchiveAfter,
  setPinnedSectionOpen,
  setSidebarVisible,
  setTabMuted,
  toggleFolder,
  unpinTab,
  updateTab,
  updateTabFavicon,
  updateTabPage,
} from "./state";
import type { OpenTabOptions } from "./state";
import {
  createSpace,
  deleteSpace,
  moveItemToSpace,
  moveSpace,
  removeEmptySpaces,
  renameSpace,
  setSpaceIcon,
  setSpaceTheme,
  switchSpace,
  switchSpaceByNumber,
  switchSpaceByOffset,
} from "./spaces";
import { getStateFilePath, loadState, saveState } from "./store";
import {
  collectRuntimeState,
  destroyTabView,
  getFocusedContents,
  getShownTabIds,
  getTabContents,
  getTabViews,
  layoutShownTabViews,
  syncTabViews,
} from "./tabViews";
import type { OpenDisposition, TabViewEvents } from "./tabViews";
import { findSplitOfTab, findTab, isInToday } from "./tree";
import { normalizeTypedInput } from "./urls";

/** Starting window size in pixels. Our choice: fits a 13-inch laptop screen. */
const WINDOW_WIDTH_PX = 1280;
const WINDOW_HEIGHT_PX = 820;

/** Smallest window that still leaves a usable page next to the sidebar. */
const MIN_WINDOW_WIDTH_PX = 640;
const MIN_WINDOW_HEIGHT_PX = 400;

/** Where macOS draws the close/minimize/zoom buttons, so they sit in the sidebar's top strip. */
const TRAFFIC_LIGHT_POSITION = { x: 16, y: 16 };

/** Page events come in bursts (a load fires several); wait this long and send one runtime update. */
const RUNTIME_PUSH_DELAY_MS = 50;

/** The current state. Replaced only inside applyChange(). */
let currentState: BrowserState;

/** The browser window. Null before the app is ready. */
let mainWindow: BrowserWindow | null = null;

/** Where the state is saved. Known once Electron is ready. */
let stateFilePath = "";

/** When this run of the app started. Auto-archive counts inactivity from here at the earliest. */
const launchedAt = Date.now();

/** A pending runtime push, so a burst of page events sends one message. */
let runtimePushTimer: NodeJS.Timeout | null = null;

/** Recently selected tabs, newest first, for ⌃Tab ("Recent Tab"). Lives only in memory. */
let recentTabIds: ItemId[] = [];

/** How many recent tabs ⌃Tab remembers. */
const RECENT_TABS_LIMIT = 20;

/** Where Arc keeps its sidebar on the account that uses it (docs/research/arc-data-model.md). */
const ARC_SIDEBAR_FILE = path.join(app.getPath("home"), "Library", "Application Support", "Arc", "StorableSidebar.json");

/** The two Spaces a fresh install starts with; an import replaces them while they are still empty. */
const STARTER_SPACE_IDS = ["space-personal", "space-work"];

/**
 * The card sits right of the sidebar (unless hidden) and below the toolbar.
 */
function getLayoutOptions(): CardLayoutOptions {
  return { isSidebarVisible: currentState.settings.isSidebarVisible, isToolbarVisible: true };
}

/**
 * Creates the window: sidebar page on the left, hidden title bar with the traffic-light buttons inset,
 * the sidebar's preload script attached, and a resize listener that re-lays out the shown tabs.
 */
function createMainWindow(): BrowserWindow {
  // __dirname is dist/node/main when running, so these paths point into the build output.
  const preloadPath = path.join(__dirname, "..", "preload", "sidebarPreload.js");
  const sidebarPagePath = path.join(__dirname, "..", "..", "web", "renderer", "index.html");

  const window = new BrowserWindow({
    width: WINDOW_WIDTH_PX,
    height: WINDOW_HEIGHT_PX,
    minWidth: MIN_WINDOW_WIDTH_PX,
    minHeight: MIN_WINDOW_HEIGHT_PX,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: TRAFFIC_LIGHT_POSITION,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // The sidebar page holds the bridge to Electron, so it must never navigate away or open windows.
  // Without this, dropping a link onto the sidebar would load that website with the bridge attached.
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => {
    return { action: "deny" };
  });

  window.loadFile(sidebarPagePath);
  window.on("resize", () => {
    layoutShownTabViews(window, currentState, getLayoutOptions());
  });
  return window;
}

/**
 * The one way to change the state. Runs the change function on the current state, then saves,
 * updates the web views and redraws the sidebar.
 * Example: applyChange((state) => selectTab(state, "tab-3", Date.now()))
 */
function applyChange(change: (state: BrowserState) => BrowserState): void {
  const newState = change(currentState);
  // Functions in state.ts return the same object when nothing changed; then there is nothing to do.
  if (newState === currentState) {
    return;
  }

  currentState = newState;
  rememberSelectedTab();
  saveState(stateFilePath, currentState);
  if (mainWindow === null) {
    return;
  }
  syncTabViews(mainWindow, currentState, getLayoutOptions(), tabViewEvents);
  pushStateToSidebar();
  scheduleRuntimePush();
}

/**
 * Puts the selected tab at the front of the recent-tabs list, for ⌃Tab.
 */
function rememberSelectedTab(): void {
  const selectedTabId = getSelectedTabId(currentState);
  if (selectedTabId === null || recentTabIds[0] === selectedTabId) {
    return;
  }
  const others = recentTabIds.filter((tabId) => tabId !== selectedTabId);
  recentTabIds = [selectedTabId, ...others].slice(0, RECENT_TABS_LIMIT);
}

/**
 * Sends a request to the sidebar page that only it can carry out (inline renaming).
 */
function sendSidebarCommand(command: SidebarCommand): void {
  if (mainWindow === null) {
    return;
  }
  mainWindow.webContents.send(IPC_CHANNELS.sidebarCommand, command);
}

/**
 * Sends the current state to the sidebar page so it can redraw.
 */
function pushStateToSidebar(): void {
  if (mainWindow === null) {
    return;
  }
  mainWindow.webContents.send(IPC_CHANNELS.stateChanged, currentState);
}

/**
 * Sends the runtime facts (loading, sound, back/forward) to the sidebar shortly, once per burst of page events.
 */
function scheduleRuntimePush(): void {
  if (runtimePushTimer !== null) {
    return;
  }
  runtimePushTimer = setTimeout(() => {
    runtimePushTimer = null;
    if (mainWindow === null || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send(IPC_CHANNELS.runtimeChanged, collectRuntimeState());
  }, RUNTIME_PUSH_DELAY_MS);
}

/**
 * Opens a link from a page in a new Today tab. Background links (⌘-click) do not take the selection.
 */
function openLinkInNewTab(url: string, disposition: OpenDisposition): void {
  const options: OpenTabOptions = { select: disposition === "foreground" };
  applyChange((state) => openTab(state, url, Date.now(), options));
}

/** What tabViews.ts calls when a page does something. */
const tabViewEvents: TabViewEvents = {
  onPageChanged: (tabId, url, title) => applyChange((state) => updateTabPage(state, tabId, url, title)),
  onFaviconChanged: (tabId, faviconUrl) => applyChange((state) => updateTabFavicon(state, tabId, faviconUrl)),
  onRuntimeChanged: () => scheduleRuntimePush(),
  onOpenInNewTab: (_tabId, url, disposition) => openLinkInNewTab(url, disposition),
  onContextMenu: (_tabId, contents, params) => showPageContextMenu(menuHost, contents, params),
};

/** What menus.ts needs from this file. */
const menuHost: MenuHost = {
  getState: () => currentState,
  getWindow: () => mainWindow,
  runAction: (action) => runAction(action),
  sendSidebarCommand: sendSidebarCommand,
  openInNewTab: (url, inBackground) => openLinkInNewTab(url, inBackground ? "background" : "foreground"),
  isTabLoaded: (tabId) => getTabContents(tabId) !== null,
};

/**
 * ⌘W and the close button. A Today tab goes to the archive. A Pinned tab or Favorite keeps its place: its page is
 * put away and it goes back to its home URL, like Arc.
 */
function closeTabByUser(tabId: ItemId): void {
  if (isInToday(currentState, tabId)) {
    applyChange((state) => closeTab(state, tabId, Date.now()));
    return;
  }
  if (mainWindow !== null) {
    destroyTabView(mainWindow, tabId);
  }
  applyChange((state) => resetPinnedTab(state, tabId));
  // The page is gone even when the state did not change, so the sidebar must hear about it.
  scheduleRuntimePush();
}

/**
 * Sends a Pinned tab or Favorite back to its home URL ("Reset Tab"). A loaded page navigates; an unloaded tab
 * just remembers the URL for when it loads.
 */
function resetTabToHome(tabId: ItemId): void {
  const tab = findTab(currentState, tabId);
  if (tab === undefined || tab.homeUrl === null) {
    return;
  }
  const contents = getTabContents(tabId);
  if (contents === null) {
    const homeUrl = tab.homeUrl;
    applyChange((state) => updateTab(state, tabId, { url: homeUrl }));
    return;
  }
  contents.loadURL(tab.homeUrl).catch(() => undefined);
}

/**
 * Mutes or unmutes a tab: saved in the state and applied to the page if it is loaded.
 */
function setMuted(tabId: ItemId, isMuted: boolean): void {
  applyChange((state) => setTabMuted(state, tabId, isMuted));
  const contents = getTabContents(tabId);
  if (contents !== null) {
    contents.setAudioMuted(isMuted);
  }
}

/**
 * Back, forward, reload and stop for the page that has focus.
 */
function navigateFocusedPage(command: NavigationCommand): void {
  const contents = getFocusedContents();
  if (contents === null) {
    return;
  }
  if (command === "back" && contents.navigationHistory.canGoBack()) {
    contents.navigationHistory.goBack();
  }
  if (command === "forward" && contents.navigationHistory.canGoForward()) {
    contents.navigationHistory.goForward();
  }
  if (command === "reload") {
    contents.reload();
  }
  if (command === "stop") {
    contents.stop();
  }
}

/**
 * Runs one action from the sidebar (or the menu). Each state action is one applyChange() call.
 */
function runAction(action: BrowserAction): void {
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
    case "showMenu":
      return showMenuRequest(menuHost, action.request);
    case "openCommandBar":
    case "openLibrary":
    case "openSiteControls":
      // These open overlay panels (overlay.ts), wired in the next step.
      return;
  }
}

/**
 * Selects a tab when there is one. Used by the keyboard commands that pick a tab by position.
 */
function selectTabIfAny(tabId: ItemId | null): void {
  if (tabId !== null) {
    applyChange((state) => selectTab(state, tabId, Date.now()));
  }
}

/**
 * Reads Arc's sidebar file and adds the user's Arc Spaces, Favorites, Pinned and Today tabs. The two empty starter
 * Spaces are removed afterwards. Asks for the file when Arc's usual one is missing, and reports what happened.
 */
async function importFromArc(): Promise<void> {
  if (mainWindow === null) {
    return;
  }
  let filePath = ARC_SIDEBAR_FILE;
  if (!fs.existsSync(filePath)) {
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: "Choose Arc's StorableSidebar.json",
      properties: ["openFile"],
      filters: [{ name: "Arc sidebar", extensions: ["json"] }],
    });
    const chosenPath = choice.filePaths[0];
    if (choice.canceled || chosenPath === undefined) {
      return;
    }
    filePath = chosenPath;
  }

  let parsedFile: unknown = null;
  try {
    parsedFile = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    dialog.showErrorBox("Import from Arc", `The file could not be read: ${String(error)}`);
    return;
  }

  const result = importArcSidebar(parsedFile, currentState, Date.now());
  if (result.report.error !== null) {
    dialog.showErrorBox("Import from Arc", result.report.error);
    return;
  }
  const firstImportedSpace = result.state.spaces.find((space) => space.id.startsWith("arc-space-") && currentState.spaces.every((existing) => existing.id !== space.id));
  const arcFaviconFolder = path.join(path.dirname(filePath), "SidebarItemsFaviconCache");
  applyChange(() => {
    const withIcons = attachArcFavicons(result.state, arcFaviconFolder);
    const withoutStarters = result.report.spacesImported > 0 ? removeEmptySpaces(withIcons, STARTER_SPACE_IDS) : withIcons;
    if (firstImportedSpace === undefined) {
      return withoutStarters;
    }
    return switchSpace(withoutStarters, firstImportedSpace.id, Date.now());
  });

  const report = result.report;
  const skippedCount = Object.values(report.skippedByKind).reduce((sum, count) => sum + count, 0);
  await dialog.showMessageBox(mainWindow, {
    type: "info",
    message: report.spacesImported > 0 ? "Imported your Arc sidebar" : "Nothing new to import",
    detail:
      `Spaces: ${report.spacesImported} (already imported: ${report.spacesAlreadyImported})\n` +
      `Tabs: ${report.tabsImported}, folders: ${report.foldersImported}, split views: ${report.splitViewsImported}\n` +
      `Favorites: ${report.favoritesImported}` +
      (report.favoritesDropped > 0 ? ` (${report.favoritesDropped} over the limit of 12 left out)` : "") +
      (skippedCount > 0 ? `\nLeft out: ${skippedCount} item(s) this browser cannot show yet` : ""),
  });
}

/** What the application menu's items do. */
const appMenuCommands: AppMenuCommands = {
  openCommandBar: (mode) => runAction({ type: "openCommandBar", mode: mode }),
  closeSelectedTab: () => {
    const selectedTabId = getSelectedTabId(currentState);
    if (selectedTabId !== null) {
      closeTabByUser(selectedTabId);
    }
  },
  reopenClosedTab: () => applyChange((state) => restoreLastArchivedTab(state, Date.now())),
  togglePinSelected: () => {
    const selectedTabId = getSelectedTabId(currentState);
    if (selectedTabId === null) {
      return;
    }
    if (isInToday(currentState, selectedTabId)) {
      applyChange((state) => pinTab(state, selectedTabId));
      return;
    }
    applyChange((state) => unpinTab(state, selectedTabId, Date.now()));
  },
  copySelectedUrl: (format) => {
    const selectedTabId = getSelectedTabId(currentState);
    const tab = selectedTabId === null ? undefined : findTab(currentState, selectedTabId);
    if (tab !== undefined) {
      copyTabUrl(tab, format);
    }
  },
  duplicateSelected: () => {
    const selectedTabId = getSelectedTabId(currentState);
    if (selectedTabId !== null) {
      applyChange((state) => duplicateTab(state, selectedTabId, Date.now()));
    }
  },
  cycleTab: (offset) => selectTabIfAny(findNeighbourTabId(currentState, offset)),
  selectTabNumber: (tabNumber) => selectTabIfAny(findTabIdByNumber(currentState, tabNumber)),
  selectRecentTab: () => {
    const previousTabId = recentTabIds.find((tabId) => tabId !== getSelectedTabId(currentState) && findTab(currentState, tabId) !== undefined);
    selectTabIfAny(previousTabId ?? null);
  },
  clearTodayTabs: () => applyChange((state) => clearTodayTabs(state, Date.now())),
  addSplitPane: () => {
    const selectedTabId = getSelectedTabId(currentState);
    const partnerTabId = recentTabIds.find((tabId) => tabId !== selectedTabId && findTab(currentState, tabId) !== undefined);
    if (selectedTabId !== null && partnerTabId !== undefined) {
      applyChange((state) => splitTabs(state, selectedTabId, partnerTabId, Date.now()));
    }
  },
  closeSplitPane: () => {
    const selectedTabId = getSelectedTabId(currentState);
    if (selectedTabId !== null && findSplitOfTab(currentState, selectedTabId) !== null) {
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
  openFind: () => undefined,
  findNext: () => undefined,
  openLibrary: () => runAction({ type: "openLibrary" }),
  openLittleWindow: () => undefined,
  importFromArc: () => {
    importFromArc().catch((error) => console.error("Import from Arc failed:", error));
  },
  openUrlInNewTab: (url) => openLinkInNewTab(url, "foreground"),
};

/**
 * Refreshes lastActiveAt for tabs in use and returns their ids. Runs more often than the sweep,
 * so a video you watch for two hours never looks unused.
 */
async function refreshTabsInUse(): Promise<ItemId[]> {
  const inUseTabIds = await findTabsInUse(getTabViews(), getShownTabIds());
  const now = Date.now();
  applyChange((state) => markTabsActive(state, inUseTabIds, now));
  return inUseTabIds;
}

/**
 * One auto-archive pass: refresh tabs in use first, then archive the ones past the threshold with reason "auto".
 */
async function runArchiveSweep(): Promise<void> {
  const inUseTabIds = await refreshTabsInUse();
  const now = Date.now();
  const tabIdsToArchive = findTabsToArchive(currentState, now, launchedAt, inUseTabIds);
  if (tabIdsToArchive.length === 0) {
    return;
  }

  console.log(`Auto-archived ${tabIdsToArchive.length} tab(s).`);
  applyChange((state) => moveTabsToArchive(state, tabIdsToArchive, now, "auto"));
}

/**
 * Deletes archive entries past the retention period.
 */
function pruneOldArchiveEntries(): void {
  applyChange((state) => pruneArchive(state, Date.now()));
}

/**
 * Logs a failed timer run. The next run tries again, so one failure never stops auto-archive for good.
 */
function logTimerError(error: unknown): void {
  console.error("Auto-archive timer failed:", error);
}

/**
 * Starts the three timers: refresh tabs in use (every minute), archive sweep (every 5 minutes)
 * and archive pruning (every hour). Intervals come from shared/settings.ts.
 */
function startAutoArchiveTimers(): void {
  setInterval(() => {
    refreshTabsInUse().catch(logTimerError);
  }, IN_USE_REFRESH_INTERVAL_MS);

  setInterval(() => {
    runArchiveSweep().catch(logTimerError);
  }, ARCHIVE_SWEEP_INTERVAL_MS);

  setInterval(pruneOldArchiveEntries, ARCHIVE_PRUNE_INTERVAL_MS);
}

/**
 * Runs once Electron is ready: loads the state, opens the window, shows the selected tab
 * and starts the timers.
 */
function handleAppReady(): void {
  stateFilePath = getStateFilePath();
  currentState = loadState(stateFilePath, Date.now());

  // Our own pages (sidebar) use the default session; lock it down like the profile sessions.
  restrictWebPermissions(session.defaultSession);
  registerIpcHandlers({
    getState: () => currentState,
    getRuntimeState: () => collectRuntimeState(),
    runAction: runAction,
  });
  installAppMenu(appMenuCommands);
  mainWindow = createMainWindow();
  syncTabViews(mainWindow, currentState, getLayoutOptions(), tabViewEvents);
  rememberSelectedTab();

  pruneOldArchiveEntries();
  startAutoArchiveTimers();
}

/**
 * Entry point: waits for Electron to be ready, then starts the app. Quits when the window closes.
 */
function startApp(): void {
  useChromeUserAgent();
  app.whenReady().then(handleAppReady);
  app.on("window-all-closed", () => {
    app.quit();
  });
}

startApp();
