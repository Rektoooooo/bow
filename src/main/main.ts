/**
 * WHY this file exists:
 *   The app's starting point. It wires the parts together once Electron is ready: state, window, overlay, menus,
 *   IPC, history, downloads and the auto-archive timers. The work itself lives in the modules it imports.
 *
 * Data source:
 *   Electron's app / BrowserWindow, the saved state (browserCore.ts), and the clock for the timers.
 *
 * Data flow:
 *   app ready → initializeState() → createMainWindow() → createOverlayView() → registerIpcHandlers() → timers
 *   page events → tabViewEvents → applyChange() / history / menus
 */
import { app, BrowserWindow, session } from "electron";
import * as path from "node:path";
import { ARCHIVE_PRUNE_INTERVAL_MS, ARCHIVE_SWEEP_INTERVAL_MS, IN_USE_REFRESH_INTERVAL_MS } from "../shared/settings";
import type { ItemId } from "../shared/types";
import { menuHost, runAction } from "./actionRunner";
import { findTabsInUse, markTabsActive } from "./activity";
import { installAppMenu } from "./appMenu";
import { appMenuCommands } from "./appMenuCommands";
import { findTabsToArchive, pruneArchive } from "./autoArchive";
import {
  applyChange,
  attachWindow,
  collectRuntimeState,
  getLayoutOptions,
  getState,
  initializeState,
  scheduleRuntimePush,
  syncViews,
} from "./browserCore";
import { createCommandActionRegistry } from "./commandBarActions";
import { startTrackingDownloads } from "./downloads";
import { getExtensionMenuItems, initializeExtensionHost, prepareExtensions } from "./extensionHost";
import { isRecordableUrl } from "./history";
import { addVisit, loadHistory, saveHistoryNow, setVisitTitle } from "./historyStore";
import { registerIpcHandlers } from "./ipc";
import { archiveIdleLittleWindows, handleExternalUrl, registerLittleWindowIpc } from "./littleWindow";
import { showPageContextMenu } from "./menus";
import { applyBoostToPage } from "./boostPages";
import { createStatusBubble, showLinkStatus } from "./statusBubble";
import { initializePeek, openPeek, relayoutPeek } from "./peek";
import { createOverlayView, getOverlayContents } from "./overlay";
import { refreshOpenPanel, registerOverlayIpc, relayoutOverlay, setCommandActionRegistry } from "./overlayController";
import { restrictWebPermissions, useChromeUserAgent } from "./profiles";
import { moveTabsToArchive, updateTabFavicon, updateTabPage } from "./state";
import { getStateFilePath } from "./store";
import { loadWindowBounds, rememberWindowBounds } from "./windowState";
import { openLinkInNewTab } from "./tabActions";
import { getShownTabIds, getTabViews, layoutShownTabViews } from "./tabViews";
import { findRootLocation, findTab } from "./tree";
import { isSameSite } from "./urls";
import type { TabViewEvents } from "./tabViews";

/** Starting window size in pixels. Our choice: fits a 13-inch laptop screen. */
const WINDOW_WIDTH_PX = 1280;
const WINDOW_HEIGHT_PX = 820;

/** Smallest window that still leaves a usable page next to the sidebar. */
const MIN_WINDOW_WIDTH_PX = 640;
const MIN_WINDOW_HEIGHT_PX = 400;

/** Where macOS draws the close/minimize/zoom buttons, so they sit in the sidebar's top strip. */
const TRAFFIC_LIGHT_POSITION = { x: 16, y: 14 };

/** When this run of the app started. Auto-archive counts inactivity from here at the earliest. */
const launchedAt = Date.now();

/** The browser window. */
let mainWindow: BrowserWindow | null = null;

/** Links from other apps that arrived before the app was ready; null once they have been opened. */
let pendingExternalUrls: string[] | null = [];

/** What tabViews.ts calls when a page does something. */
const tabViewEvents: TabViewEvents = {
  onPageChanged: (tabId, url, title) => {
    const isOnScreen = getShownTabIds().includes(tabId);
    applyChange((state) => updateTabPage(state, tabId, url, title, isOnScreen));
    setVisitTitle(url, title);
  },
  onNavigated: (url, title) => addVisit(url, title, Date.now()),
  onFaviconChanged: (tabId, faviconUrl) => applyChange((state) => updateTabFavicon(state, tabId, faviconUrl)),
  onRuntimeChanged: () => scheduleRuntimePush(),
  onOpenInNewTab: (tabId, url, disposition) => {
    if (shouldOpenInPeek(tabId, url)) {
      openPeek(url, tabId);
      return;
    }
    openLinkInNewTab(url, disposition);
  },
  onOpenInPeek: (tabId, url) => openPeek(url, tabId),
  onWillNavigate: (tabId, url, isUserInitiated) => {
    if (!isUserInitiated || !shouldOpenInPeek(tabId, url)) {
      return false;
    }
    openPeek(url, tabId);
    return true;
  },
  onContextMenu: (_tabId, contents, params) => showPageContextMenu(menuHost, contents, params, getExtensionMenuItems(contents, params)),
  onDomReady: (_tabId, contents) => {
    applyBoostToPage(contents, getState()).catch(() => undefined);
  },
  onLinkHover: (url) => {
    showLinkStatus(url).catch(() => undefined);
  },
};

/**
 * Arc's rule: a link from a Pinned tab or Favorite to another site opens in a Peek, so the pinned page stays put.
 */
function shouldOpenInPeek(tabId: ItemId, url: string): boolean {
  const state = getState();
  const tab = findTab(state, tabId);
  const root = findRootLocation(state, tabId);
  if (tab === undefined || root === null || root.kind === "today") {
    return false;
  }
  return !isSameSite(tab.url, url);
}

/**
 * Creates the window: sidebar page on the left, hidden title bar with the traffic-light buttons inset,
 * the sidebar's preload script attached, and a resize listener that re-lays out the page and the overlay.
 */
function createMainWindow(): BrowserWindow {
  // __dirname is dist/node/main when running, so these paths point into the build output.
  const preloadPath = path.join(__dirname, "..", "preload", "sidebarPreload.js");
  const sidebarPagePath = path.join(__dirname, "..", "..", "web", "renderer", "index.html");

  const savedBounds = loadWindowBounds();
  const window = new BrowserWindow({
    width: savedBounds?.width ?? WINDOW_WIDTH_PX,
    height: savedBounds?.height ?? WINDOW_HEIGHT_PX,
    x: savedBounds?.x,
    y: savedBounds?.y,
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
    layoutShownTabViews(window, getState(), getLayoutOptions());
    relayoutOverlay();
    relayoutPeek();
    rememberWindowBounds(window);
  });
  window.on("move", () => rememberWindowBounds(window));
  return window;
}

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
 * Little Windows left alone for 6 hours are archived too, like Arc's Little Arc.
 */
async function runArchiveSweep(): Promise<void> {
  const inUseTabIds = await refreshTabsInUse();
  const now = Date.now();
  archiveIdleLittleWindows(now);
  const tabIdsToArchive = findTabsToArchive(getState(), now, launchedAt, inUseTabIds);
  if (tabIdsToArchive.length === 0) {
    return;
  }

  console.log(`Auto-archived ${tabIdsToArchive.length} tab(s).`);
  applyChange((state) => moveTabsToArchive(state, tabIdsToArchive, now, "auto"));
}

/**
 * Trims the archive to the newest ARCHIVE_LIMIT entries.
 */
function pruneOldArchiveEntries(): void {
  applyChange((state) => pruneArchive(state));
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
 * Returns the first web address in a list of command-line arguments, or null.
 */
function findUrlArgument(argumentList: string[]): string | null {
  const url = argumentList.find((argument) => isRecordableUrl(argument));
  return url ?? null;
}

/**
 * Runs once Electron is ready: loads the state, opens the window and overlay, connects IPC and menus,
 * shows the selected tab and starts the timers.
 */
async function handleAppReady(): Promise<void> {
  initializeState(getStateFilePath(), Date.now());
  loadHistory();

  // Our own pages (sidebar, overlay, Little Window bar) use the default session; lock it down like the profiles.
  restrictWebPermissions(session.defaultSession);
  startTrackingDownloads(() => {
    scheduleRuntimePush();
    refreshOpenPanel();
  });
  registerIpcHandlers({
    isTrustedSender: (sender) => sender === mainWindow?.webContents || sender === getOverlayContents(),
    getState: () => getState(),
    getRuntimeState: () => collectRuntimeState(),
    runAction: (action) => {
      runAction(action);
      refreshOpenPanel();
    },
  });
  registerOverlayIpc();
  registerLittleWindowIpc();
  setCommandActionRegistry(createCommandActionRegistry({ commands: appMenuCommands, runAction: runAction, getState: getState }));
  installAppMenu(appMenuCommands);
  // Extensions load before the first page, so their content scripts reach the pages restored at startup.
  initializeExtensionHost(tabViewEvents);
  await prepareExtensions();

  mainWindow = createMainWindow();
  // Little Windows cannot live without the main window; closing it ends the app.
  mainWindow.on("closed", () => app.quit());
  attachWindow(mainWindow, tabViewEvents);
  initializePeek(tabViewEvents);
  createOverlayView();
  createStatusBubble();
  syncViews();

  const startupUrl = findUrlArgument(process.argv.slice(1));
  if (startupUrl !== null) {
    openLinkInNewTab(startupUrl, "foreground");
  }

  const waitingUrls = pendingExternalUrls ?? [];
  pendingExternalUrls = null;
  for (const url of waitingUrls) {
    handleExternalUrl(url);
  }

  pruneOldArchiveEntries();
  startAutoArchiveTimers();
}

/**
 * Entry point: one instance only (a second launch with a link opens it in a Little Window, like Arc),
 * then start once Electron is ready. Quits when the main window closes.
 */
function startApp(): void {
  useChromeUserAgent();
  const isFirstInstance = app.requestSingleInstanceLock();
  if (!isFirstInstance) {
    app.quit();
    return;
  }
  app.on("second-instance", (_event, argumentList) => {
    const url = findUrlArgument(argumentList);
    if (url !== null) {
      handleExternalUrl(url);
      return;
    }
    mainWindow?.show();
    mainWindow?.focus();
  });
  // Links from other apps (when this browser is the default) open in a Little Window, like Arc. A link that
  // launched the app arrives before it is ready and waits in pendingExternalUrls.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (!isRecordableUrl(url)) {
      return;
    }
    if (pendingExternalUrls === null) {
      handleExternalUrl(url);
      return;
    }
    pendingExternalUrls.push(url);
  });
  app.whenReady().then(handleAppReady);
  app.on("before-quit", () => saveHistoryNow());
  app.on("window-all-closed", () => {
    app.quit();
  });
}

startApp();
