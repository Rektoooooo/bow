/**
 * WHY this file exists:
 *   The app's starting point. It wires the parts together once Electron is ready: state, windows, overlay, menus,
 *   IPC, history, downloads and the auto-archive timers. The work itself lives in the modules it imports.
 *
 * Data source:
 *   Electron's app, the saved state (browserCore.ts), and the clock for the timers.
 *
 * Data flow:
 *   app ready → initializeState() → registerIpcHandlers() → restoreMainWindows() → createOverlayView() → timers
 *   page events → tabViewEvents → applyChange() / history / menus
 */
import { app, session } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ARCHIVE_PRUNE_INTERVAL_MS,
  ARCHIVE_SWEEP_INTERVAL_MS,
  EXTENSION_UPDATE_FIRST_CHECK_MS,
  EXTENSION_UPDATE_INTERVAL_MS,
  IN_USE_REFRESH_INTERVAL_MS,
} from "../shared/settings";
import type { ItemId } from "../shared/types";
import { menuHost, runAction, runActionFromWindow } from "./actionRunner";
import { findTabsInUse, markTabsActive } from "./activity";
import { installAppMenu } from "./appMenu";
import { appMenuCommands } from "./appMenuCommands";
import { findTabsToArchive, pruneArchive } from "./autoArchive";
import {
  applyChange,
  collectRuntimeState,
  findMainWindowIdOf,
  getState,
  getStateForWindow,
  getWindow,
  initializeState,
  onStateChanged,
  scheduleRuntimePush,
  setTabViewEvents,
  syncViews,
} from "./browserCore";
import { restoreMainWindows } from "./mainWindows";
import { createCommandActionRegistry } from "./commandBarActions";
import { startTrackingDownloads } from "./downloads";
import { getExtensionMenuItems, initializeExtensionHost, prepareExtensions } from "./extensionHost";
import { initializePermissionPrompts } from "./permissionPrompts";
import { registerSymbolIpc } from "./symbols";
import { getPictureInPictureTabId, registerPictureInPictureIpc } from "./pictureInPicture";
import { loadToolbarColors } from "./toolbarTint";
import { initializeFaviconAccents, refreshFaviconAccents } from "./faviconAccents";
import { updateExtensionsFromWebStore } from "./extensionsController";
import { isRecordableUrl } from "./history";
import { addVisit, loadHistory, saveHistoryNow, setVisitTitle } from "./historyStore";
import { registerIpcHandlers } from "./ipc";
import { archiveIdleLittleWindows, handleExternalUrl, registerLittleWindowIpc } from "./littleWindow";
import { showPageContextMenu } from "./menus";
import { applyBoostToPage, runBoostJavaScript } from "./boostPages";
import { createStatusBubble, showLinkStatus } from "./statusBubble";
import { initializePeek, openPeek } from "./peek";
import { createOverlayView, getOverlayContents } from "./overlay";
import { openWelcome, refreshOpenPanel, registerOverlayIpc, setCommandActionRegistry } from "./overlayController";
import { startHandoff } from "./handoff";
import { noticeVisitedPage, startLiveFolderRefreshing } from "./liveFolderRefresher";
import { getProfileSession, onProfileSessionCreated, restrictWebPermissions, useChromeUserAgent } from "./profiles";
import { retakeCapture } from "./liveCaptures";
import { linkNativeMessagingHosts, listOtherBrowserHostFolders } from "./nativeMessagingHosts";
import { moveTabsToArchive, setNoteTitle, updateTabFavicon, updateTabPage } from "./state";
import { getStateFilePath } from "./store";
import { openLinkInNewTab } from "./tabActions";
import { getShownTabIds, getTabViews, refreshShownSnapshots } from "./tabViews";
import { SNAPSHOT_REFRESH_MS } from "./tabSnapshots";
import { listCaptures, loadCaptures, readCaptureAsDataUrl } from "./captures";
import { initializeEaselsStore, readEasel, writeEasel } from "./easelsStore";
import { initializeNotesStore, readNote, writeNote } from "./notesStore";
import { createNoteUrl } from "../shared/notes";
import { applyCosmeticFilters, initializeAdBlocking, installAdBlocker } from "./adBlock";
import { applyAppIcon } from "./appIcon";
import { findRootLocation, findTab, getActiveSpace } from "./tree";
import { isSameSite } from "./urls";
import type { TabViewEvents } from "./tabViews";

/** Command-line flag that skips the first-start tour (the end-to-end checks start with empty data folders). */
const SKIP_WELCOME_FLAG = "--skip-welcome";

/** How many of the Library's captures an easel offers to place. Our choice. */
const EASEL_CAPTURE_CHOICES = 40;

/** When this run of the app started. Auto-archive counts inactivity from here at the earliest. */
const launchedAt = Date.now();

/** Where the per-site toolbar colors are remembered (like Arc's TopBarColorCache). */
const TOOLBAR_COLORS_FILE_NAME = "toolbar-colors.json";

/** Links from other apps that arrived before the app was ready; null once they have been opened. */
let pendingExternalUrls: string[] | null = [];

/** What tabViews.ts calls when a page does something. */
const tabViewEvents: TabViewEvents = {
  onPageChanged: (tabId, url, title) => {
    const isOnScreen = getShownTabIds().includes(tabId);
    applyChange((state) => updateTabPage(state, tabId, url, title, isOnScreen));
    setVisitTitle(url, title);
  },
  onNavigated: (url, title) => {
    addVisit(url, title, Date.now());
    noticeVisitedPage(url);
  },
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
    runBoostJavaScript(contents, getState());
    applyCosmeticFilters(contents).catch(() => undefined);
  },
  onLinkHover: (tabId, url) => {
    showLinkStatus(tabId, url).catch(() => undefined);
  },
};

/**
 * Arc's rule: a link from a Pinned tab or Favorite to another site opens in a Peek, so the pinned page stays put.
 */
function shouldOpenInPeek(tabId: ItemId, url: string): boolean {
  const state = getState();
  const tab = findTab(state, tabId);
  const root = findRootLocation(state, tabId);
  // Links to apps (mailto:, zoommtg:, …) are not pages; they go to the app prompt instead.
  if (tab === undefined || root === null || root.kind === "today" || !isRecordableUrl(url)) {
    return false;
  }
  return !isSameSite(tab.url, url);
}

/**
 * Refreshes lastActiveAt for tabs in use and returns their ids. Runs more often than the sweep,
 * so a video you watch for two hours never looks unused.
 */
async function refreshTabsInUse(): Promise<ItemId[]> {
  const inUseTabIds = findTabsInUse(getTabViews(), getShownTabIds(), getPictureInPictureTabId());
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

/** Where the extension library looks for native messaging host manifests besides Chrome's folders. */
const NATIVE_MESSAGING_HOSTS_FOLDER_NAME = "NativeMessagingHosts";

/**
 * Links the native messaging hosts of other Chromium browsers into ours (nativeMessagingHosts.ts). A failure only
 * means fewer hosts; it never stops the start.
 */
function linkHostsOfOtherBrowsers(): void {
  try {
    const ourFolder = path.join(app.getPath("userData"), NATIVE_MESSAGING_HOSTS_FOLDER_NAME);
    linkNativeMessagingHosts(listOtherBrowserHostFolders(app.getPath("home")), ourFolder);
  } catch (error) {
    console.warn("Could not link the native messaging hosts of other browsers:", error);
  }
}

/**
 * Keeps Web Store extensions current: a first check shortly after startup, then every few hours, like Chrome.
 */
function startExtensionUpdates(): void {
  const runUpdates = (): void => {
    updateExtensionsFromWebStore().catch((error) => console.error("Extension updates failed:", error));
  };
  setTimeout(runUpdates, EXTENSION_UPDATE_FIRST_CHECK_MS);
  setInterval(runUpdates, EXTENSION_UPDATE_INTERVAL_MS);
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
  // A start without a saved state is the first one: the welcome tour shows (tests pass --skip-welcome).
  const isFirstStart = !fs.existsSync(getStateFilePath()) && !process.argv.includes(SKIP_WELCOME_FLAG);
  initializeState(getStateFilePath(), Date.now());
  loadHistory();
  loadToolbarColors(path.join(app.getPath("userData"), TOOLBAR_COLORS_FILE_NAME), scheduleRuntimePush);
  // The selected Favorite's border takes its icon's colour, like Arc's.
  initializeFaviconAccents(scheduleRuntimePush);
  onStateChanged(refreshFaviconAccents);
  refreshFaviconAccents(getState());
  loadCaptures(app.getPath("userData"));
  initializeNotesStore(app.getPath("userData"));
  initializeEaselsStore(app.getPath("userData"));
  // Pictures of the pages on screen stay fresh for the recent-tab switcher and previews.
  setInterval(refreshShownSnapshots, SNAPSHOT_REFRESH_MS);

  // Our own pages (sidebar, overlay, Little Window bar) use the default session; lock it down like the profiles.
  restrictWebPermissions(session.defaultSession);
  // Sites ask before using the camera, microphone, location, notifications or the clipboard.
  initializePermissionPrompts();
  // Ad blocking checks requests in every profile session; the lists load now when it is on.
  initializeAdBlocking(app.getPath("userData"), getState, () => refreshOpenPanel());
  onProfileSessionCreated(installAdBlocker);
  startTrackingDownloads(() => {
    scheduleRuntimePush();
    refreshOpenPanel();
  });
  registerIpcHandlers({
    isTrustedSender: (sender) => findMainWindowIdOf(sender) !== null || sender === getOverlayContents(),
    // The overlay is always in the focused window, so it gets the focused window's state.
    getState: (sender) => getStateForWindow(findMainWindowIdOf(sender) ?? getState().focusedWindowId),
    getRuntimeState: (sender) => collectRuntimeState(findMainWindowIdOf(sender) ?? getState().focusedWindowId),
    runAction: (action, sender) => {
      runActionFromWindow(action, findMainWindowIdOf(sender));
      refreshOpenPanel();
    },
    readNote: (noteId) => readNote(noteId),
    saveNote: (noteId, html, title) => {
      if (writeNote(noteId, html)) {
        applyChange((state) => setNoteTitle(state, createNoteUrl(noteId), title));
      }
    },
    readEasel: (easelId) => readEasel(easelId),
    saveEasel: (easelId, json) => {
      writeEasel(easelId, json);
    },
    listCaptures: () =>
      listCaptures(EASEL_CAPTURE_CHOICES).map((record) => ({ id: record.id, title: record.title, url: record.url, thumbnailUrl: record.thumbnailUrl, source: record.source ?? null })),
    readCapture: (captureId) => readCaptureAsDataUrl(captureId),
    // The easel on screen belongs to the active Space: its profile's sign-ins see the page as the user does.
    retakeCapture: (source) => retakeCapture(source, getProfileSession(getActiveSpace(getState()).profileId)),
  });
  registerOverlayIpc();
  registerLittleWindowIpc();
  registerSymbolIpc();
  registerPictureInPictureIpc();
  setCommandActionRegistry(createCommandActionRegistry({ commands: appMenuCommands, runAction: runAction, getState: getState }));
  installAppMenu(appMenuCommands);
  // Hosts that password managers registered for other Chromium browsers (Arc, Brave, …) are found by extensions here.
  linkHostsOfOtherBrowsers();
  // Extensions load before the first page, so their content scripts reach the pages restored at startup.
  initializeExtensionHost(tabViewEvents);
  await prepareExtensions();

  setTabViewEvents(tabViewEvents);
  // Every window of the last session opens again, each with its own Space and selection (mainWindows.ts).
  restoreMainWindows();
  applyAppIcon(getState().settings.appIcon).catch((error) => console.warn("Could not show the chosen app icon:", error));
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
  startExtensionUpdates();
  startLiveFolderRefreshing();
  startHandoff();
  const firstWindow = getWindow();
  if (isFirstStart && getState().settings.hasSeenWelcome !== true && firstWindow !== null) {
    // Once the sidebar has drawn, so the tour opens over a finished window.
    if (firstWindow.webContents.isLoading()) {
      firstWindow.webContents.once("did-finish-load", () => openWelcome());
    } else {
      openWelcome();
    }
  }
}

/**
 * Entry point: one instance only (a second launch with a link opens it in a Little Window, like Arc),
 * then start once Electron is ready. Quits when the last main window closes (mainWindows.ts).
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
    const lastFocusedWindow = getWindow();
    lastFocusedWindow?.show();
    lastFocusedWindow?.focus();
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
