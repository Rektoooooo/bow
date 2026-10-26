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
import { SIDEBAR_MAX_WIDTH_PX, SIDEBAR_MIN_WIDTH_PX, SIDEBAR_WIDTH_PX } from "../shared/settings";
import type { BrowserState, ItemId, RuntimeState } from "../shared/types";
import { getActiveDownloadCount } from "./downloads";
import { findMediaInfo, handleShownTabsChanged } from "./media";
import type { CardLayoutOptions } from "./layout";
import { raiseOverlayIfShown } from "./overlay";
import { getSelectedTabId } from "./state";
import { loadState, saveState } from "./store";
import { collectTabRuntime, getShownTabIds, layoutShownTabViews, syncTabViews } from "./tabViews";
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

/** True while the hidden sidebar shows because the mouse is at the window's left edge. Not saved. */
let isSidebarPeeking = false;

/** True while the Command Bar is open to make a new tab (RuntimeState.isNewTabPending). */
let isNewTabPending = false;

/** The sidebar width while its edge is being dragged; null otherwise (the saved width applies). */
let previewSidebarWidth: number | null = null;

/** Functions to run after new page views were added (they land on top): floating layers raise themselves again. */
const afterSyncHooks: (() => void)[] = [];

/**
 * Registers a function to run whenever the set of shown page views changed.
 */
export function addAfterSyncHook(hook: () => void): void {
  afterSyncHooks.push(hook);
}

/** Functions to run after every state change, once the views match the new state. */
const stateChangeListeners: ((state: BrowserState) => void)[] = [];

/**
 * Registers a function to run after every state change (extensionHost.ts loads and unloads extensions this way).
 */
export function onStateChanged(listener: (state: BrowserState) => void): void {
  stateChangeListeners.push(listener);
}

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

/**
 * Returns the main window, or null before it exists and once it is destroyed (while quitting, page events still
 * arrive; touching a destroyed window throws, and an uncaught error's dialog would stop the app from quitting).
 */
export function getWindow(): BrowserWindow | null {
  return mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow : null;
}

export function getRecentTabIds(): ItemId[] {
  return recentTabIds;
}

/**
 * The card sits right of the sidebar (unless hidden) and below the toolbar.
 */
export function getLayoutOptions(): CardLayoutOptions {
  const sidebarWidth = previewSidebarWidth ?? currentState.settings.sidebarWidth ?? SIDEBAR_WIDTH_PX;
  return { isSidebarVisible: currentState.settings.isSidebarVisible, isToolbarVisible: true, isSidebarPeeking: isSidebarPeeking, sidebarWidth: sidebarWidth };
}

/**
 * Moves the page card while the sidebar's edge is dragged, without saving (null ends the preview).
 */
export function previewSidebarWidthWhileDragging(width: number | null): void {
  previewSidebarWidth = width === null ? null : Math.max(SIDEBAR_MIN_WIDTH_PX, Math.min(width, SIDEBAR_MAX_WIDTH_PX));
  if (mainWindow !== null) {
    layoutShownTabViews(mainWindow, currentState, getLayoutOptions());
  }
}

/**
 * Shows or hides the sidebar for a moment while it is hidden (Arc's hover at the left edge). The page slides aside.
 */
export function setSidebarPeek(isPeeking: boolean): void {
  const canPeek = !currentState.settings.isSidebarVisible;
  const newValue = isPeeking && canPeek;
  if (newValue === isSidebarPeeking || mainWindow === null) {
    return;
  }
  isSidebarPeeking = newValue;
  // The page slides aside (and back) together with the sidebar sliding in.
  layoutShownTabViews(mainWindow, currentState, getLayoutOptions(), true);
  scheduleRuntimePush();
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
  if (mainWindow === null || mainWindow.isDestroyed() || tabViewEvents === null) {
    return;
  }
  const previouslyShownTabIds = [...getShownTabIds()];
  const viewsChanged = syncTabViews(mainWindow, currentState, getLayoutOptions(), tabViewEvents);
  if (!viewsChanged) {
    return;
  }
  handleShownTabsChanged(previouslyShownTabIds, getShownTabIds());
  raiseOverlayIfShown(mainWindow);
  for (const hook of afterSyncHooks) {
    hook();
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
  if (currentState.settings.isSidebarVisible) {
    isSidebarPeeking = false;
  }
  rememberSelectedTab();
  saveState(stateFilePath, currentState);
  syncViews();
  for (const listener of stateChangeListeners) {
    listener(currentState);
  }
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
  const tabs = collectTabRuntime();
  return {
    tabs: tabs,
    activeDownloadCount: getActiveDownloadCount(),
    isSidebarPeeking: isSidebarPeeking,
    media: findMediaInfo(tabs, getShownTabIds()),
    isNewTabPending: isNewTabPending,
  };
}

/**
 * The Command Bar opened or closed for a new tab: the sidebar moves its highlight to "New Tab" and back.
 */
export function setNewTabPending(isPending: boolean): void {
  if (isNewTabPending === isPending) {
    return;
  }
  isNewTabPending = isPending;
  scheduleRuntimePush();
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
