/**
 * WHY this file exists:
 *   The one copy of BrowserState lives here, with the only function allowed to replace it: applyChange().
 *   Every change is saved, reflected in the web views and pushed to the sidebar the same way, from one place.
 *   Other main-process modules read the state and request changes through these functions.
 *
 * Data source:
 *   store.ts (the saved file), the main window, tabViews.ts (web views), downloads.ts (download count).
 *
 * Data flow:
 *   any module → applyChange(change) → saveState() → syncTabViews() → raise overlay → push state to the sidebar
 *   page events → scheduleRuntimePush() → one runtime message per burst
 *
 * Pattern: "single source of truth". Only applyChange() replaces the state.
 */
import type { BrowserWindow } from "electron";
import type { SidebarCommand } from "../shared/actions";
import { IPC_CHANNELS } from "../shared/ipcChannels";
import type { BrowserState, ItemId, RuntimeState } from "../shared/types";
import { getActiveDownloadCount } from "./downloads";
import type { CardLayoutOptions } from "./layout";
import { raiseOverlayIfShown } from "./overlay";
import { getSelectedTabId } from "./state";
import { loadState, saveState } from "./store";
import { collectTabRuntime, syncTabViews } from "./tabViews";
import type { TabViewEvents } from "./tabViews";

/** Page events come in bursts (a load fires several); wait this long and send one runtime update. */
const RUNTIME_PUSH_DELAY_MS = 50;

/** How many recent tabs ⌃Tab remembers. */
const RECENT_TABS_LIMIT = 20;

/** The current state. Replaced only inside applyChange(). */
let currentState: BrowserState;

/** The browser window. Null before the app is ready. */
let mainWindow: BrowserWindow | null = null;

/** Where the state is saved. */
let stateFilePath = "";

/** What tabViews.ts calls when a page does something. Set once at startup. */
let tabViewEvents: TabViewEvents | null = null;

/** A pending runtime push, so a burst of page events sends one message. */
let runtimePushTimer: NodeJS.Timeout | null = null;

/** Recently selected tabs, newest first, for ⌃Tab and the Command Bar. Lives only in memory. */
let recentTabIds: ItemId[] = [];

/**
 * Loads the saved state (or a fresh one). Runs once, before anything else reads the state.
 */
export function initializeState(filePath: string, now: number): void {
  stateFilePath = filePath;
  currentState = loadState(filePath, now);
  rememberSelectedTab();
}

/**
 * Connects the window and the page-event handlers. Runs once the window exists.
 */
export function attachWindow(window: BrowserWindow, events: TabViewEvents): void {
  mainWindow = window;
  tabViewEvents = events;
}

export function getState(): BrowserState {
  return currentState;
}

export function getWindow(): BrowserWindow | null {
  return mainWindow;
}

export function getRecentTabIds(): ItemId[] {
  return recentTabIds;
}

/**
 * The card sits right of the sidebar (unless hidden) and below the toolbar.
 */
export function getLayoutOptions(): CardLayoutOptions {
  return { isSidebarVisible: currentState.settings.isSidebarVisible, isToolbarVisible: true };
}

/**
 * Puts the selected tab at the front of the recent-tabs list.
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
 * Makes the web views match the state and keeps the overlay above any view that was just added.
 */
export function syncViews(): void {
  if (mainWindow === null || tabViewEvents === null) {
    return;
  }
  const viewsChanged = syncTabViews(mainWindow, currentState, getLayoutOptions(), tabViewEvents);
  if (viewsChanged) {
    raiseOverlayIfShown(mainWindow);
  }
}

/**
 * The one way to change the state. Runs the change function on the current state, then saves,
 * updates the web views and redraws the sidebar.
 * Example: applyChange((state) => selectTab(state, "tab-3", Date.now()))
 */
export function applyChange(change: (state: BrowserState) => BrowserState): void {
  const newState = change(currentState);
  // Functions in state.ts return the same object when nothing changed; then there is nothing to do.
  if (newState === currentState) {
    return;
  }

  currentState = newState;
  rememberSelectedTab();
  saveState(stateFilePath, currentState);
  syncViews();
  pushStateToSidebar();
  scheduleRuntimePush();
}

/**
 * Sends the current state to the sidebar page so it can redraw.
 */
export function pushStateToSidebar(): void {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(IPC_CHANNELS.stateChanged, currentState);
}

/**
 * Builds the runtime facts: every loaded tab's loading / sound / history, and the downloads in progress.
 */
export function collectRuntimeState(): RuntimeState {
  return { tabs: collectTabRuntime(), activeDownloadCount: getActiveDownloadCount() };
}

/**
 * Sends the runtime facts to the sidebar shortly, once per burst of page events.
 */
export function scheduleRuntimePush(): void {
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
 * Sends a request to the sidebar page that only it can carry out (inline renaming).
 */
export function sendSidebarCommand(command: SidebarCommand): void {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(IPC_CHANNELS.sidebarCommand, command);
}
