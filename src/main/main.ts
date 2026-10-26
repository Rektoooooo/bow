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
 *   any action → applyChange(change) → saveState() → syncTabViews() → pushStateToSidebar()
 *
 * Pattern: "single source of truth". Only applyChange() replaces the state, so every change
 * is saved and shown the same way.
 */
import { app, BrowserWindow, session } from "electron";
import * as path from "node:path";
import { IPC_CHANNELS } from "../shared/ipcChannels";
import { ARCHIVE_PRUNE_INTERVAL_MS, ARCHIVE_SWEEP_INTERVAL_MS, IN_USE_REFRESH_INTERVAL_MS } from "../shared/settings";
import type { BrowserState, TabId } from "../shared/types";
import { findTabsInUse, markTabsActive } from "./activity";
import { findTabsToArchive, pruneArchive } from "./autoArchive";
import { registerIpcHandlers } from "./ipc";
import type { SidebarActions } from "./ipc";
import {
  clearTodayTabs,
  closeTab,
  moveTabsToArchive,
  openTab,
  pinTab,
  restoreArchivedTab,
  selectTab,
  setArchiveAfter,
  switchSpace,
  unpinTab,
  updateTabPage,
} from "./state";
import { getStateFilePath, loadState, saveState } from "./store";
import { getTabViews, layoutShownTabView, syncTabViews } from "./tabViews";
import { normalizeTypedInput } from "./urls";

/** Starting window size in pixels. Our choice: fits a 13-inch laptop screen. */
const WINDOW_WIDTH_PX = 1280;
const WINDOW_HEIGHT_PX = 820;

/** Smallest window that still leaves a usable page next to the sidebar. */
const MIN_WINDOW_WIDTH_PX = 640;
const MIN_WINDOW_HEIGHT_PX = 400;

/** Where macOS draws the close/minimize/zoom buttons, so they sit in the sidebar's top strip. */
const TRAFFIC_LIGHT_POSITION = { x: 16, y: 16 };

/**
 * Website permissions we allow without asking. Electron would otherwise grant every request,
 * including camera, microphone and location. Everything else is refused until a permission prompt exists.
 */
const ALLOWED_WEB_PERMISSIONS = new Set(["fullscreen", "clipboard-sanitized-write"]);

/** The current state. Replaced only inside applyChange(). */
let currentState: BrowserState;

/** The browser window. Null before the app is ready. */
let mainWindow: BrowserWindow | null = null;

/** Where the state is saved. Known once Electron is ready. */
let stateFilePath = "";

/** When this run of the app started. Auto-archive counts inactivity from here at the earliest. */
const launchedAt = Date.now();

/**
 * Creates the window: sidebar page on the left, hidden title bar with the traffic-light buttons inset,
 * the sidebar's preload script attached, and a resize listener that re-lays out the selected tab.
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
    layoutShownTabView(window);
  });
  return window;
}

/**
 * Decides website permission requests (camera, location, notifications, …) for every tab.
 * Only the permissions in ALLOWED_WEB_PERMISSIONS are granted.
 */
function restrictWebPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const isAllowed = ALLOWED_WEB_PERMISSIONS.has(permission);
    callback(isAllowed);
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return ALLOWED_WEB_PERMISSIONS.has(permission);
  });
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
  saveState(stateFilePath, currentState);
  if (mainWindow === null) {
    return;
  }
  syncTabViews(mainWindow, currentState, handlePageChanged);
  pushStateToSidebar();
}

/**
 * Stores a page's new URL and title. tabViews.ts calls this from web view events.
 */
function handlePageChanged(tabId: TabId, url: string, title: string): void {
  applyChange((state) => updateTabPage(state, tabId, url, title));
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
 * Builds the SidebarActions object for ipc.ts. Each action is one applyChange() call
 * with the matching function from state.ts.
 */
function createSidebarActions(): SidebarActions {
  return {
    getState: () => currentState,
    openTab: (typedText) => {
      if (typedText.trim() === "") {
        return;
      }
      const url = normalizeTypedInput(typedText);
      applyChange((state) => openTab(state, url, Date.now()));
    },
    selectTab: (tabId) => applyChange((state) => selectTab(state, tabId, Date.now())),
    closeTab: (tabId) => applyChange((state) => closeTab(state, tabId, Date.now())),
    pinTab: (tabId) => applyChange((state) => pinTab(state, tabId)),
    unpinTab: (tabId) => applyChange((state) => unpinTab(state, tabId, Date.now())),
    clearTodayTabs: () => applyChange((state) => clearTodayTabs(state, Date.now())),
    switchSpace: (spaceId) => applyChange((state) => switchSpace(state, spaceId, Date.now())),
    restoreArchivedTab: (tabId) => applyChange((state) => restoreArchivedTab(state, tabId, Date.now())),
    setArchiveAfter: (archiveAfterMs) => applyChange((state) => setArchiveAfter(state, archiveAfterMs)),
  };
}

/**
 * Refreshes lastActiveAt for tabs in use and returns their ids. Runs more often than the sweep,
 * so a video you watch for two hours never looks unused.
 */
async function refreshTabsInUse(): Promise<TabId[]> {
  const inUseTabIds = await findTabsInUse(currentState, getTabViews());
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

  restrictWebPermissions();
  registerIpcHandlers(createSidebarActions());
  mainWindow = createMainWindow();
  syncTabViews(mainWindow, currentState, handlePageChanged);

  pruneOldArchiveEntries();
  startAutoArchiveTimers();
}

/**
 * Entry point: waits for Electron to be ready, then starts the app. Quits when the window closes.
 */
function startApp(): void {
  app.whenReady().then(handleAppReady);
  app.on("window-all-closed", () => {
    app.quit();
  });
}

startApp();
