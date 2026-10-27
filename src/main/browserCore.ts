/**
 * WHY this file exists:
 *   The one copy of BrowserState lives here, with the only function allowed to replace it: applyChange().
 *   Every change is saved, reflected in the web views and pushed to the sidebars the same way, from one place.
 *   Other main-process modules read the state and request changes through these functions. It also knows the open
 *   main windows: each window's sidebar gets the state as that window shows it (its own Space and selection,
 *   windows.ts), and "the window" for menus, panels and dialogs is the focused one.
 *
 * Data source:
 *   store.ts (the saved file), the main windows (mainWindows.ts registers them), tabViews.ts (web views),
 *   downloads.ts (download count).
 *
 * Data flow:
 *   any module → applyChange(change) → repair parked windows → saveState() → syncTabViews(every window) → raise
 *   overlay → push each window's projected state to its sidebar
 *   page events → scheduleRuntimePush() → one runtime message per window per burst
 *
 * Pattern: "single source of truth". Only applyChange() replaces the state.
 */
import type { BrowserWindow, WebContents } from "electron";
import type { SidebarCommand } from "../shared/actions";
import { IPC_CHANNELS } from "../shared/ipcChannels";
import { SIDEBAR_MAX_WIDTH_PX, SIDEBAR_MIN_WIDTH_PX, SIDEBAR_WIDTH_PX } from "../shared/settings";
import type { BrowserState, ExtensionBeingAdded, ItemId, LiveFolderStatus, RuntimeState, WindowId } from "../shared/types";
import { getActiveDownloadCount } from "./downloads";
import { getFaviconAccents } from "./faviconAccents";
import { findMediaInfo, handleShownTabsChanged } from "./media";
import type { CardLayoutOptions } from "./layout";
import { computeLibraryWidth } from "./layout";
import type { LibrarySection } from "../shared/overlay";
import { raiseOverlayIfShown } from "./overlay";
import { getSelectedTabId } from "./state";
import { findTab } from "./tree";
import { isDeveloperModeOn } from "../shared/developerMode";
import { loadState, saveState } from "./store";
import {
  collectTabRuntime,
  findWindowShowingTab,
  forgetWindow,
  getEditorTabIdsHere,
  getShownTabIds,
  getTabIdsShownElsewhere,
  layoutShownTabViews,
  requestTabsMoveToWindow,
  setEditorOpen,
  syncTabViews,
} from "./tabViews";
import type { TabViewEvents, WindowTarget } from "./tabViews";
import { listWindowIds, projectStateForWindow, repairOtherWindows } from "./windows";

/** Page events come in bursts (a load fires several); wait this long and send one runtime update. */
const RUNTIME_PUSH_DELAY_MS = 50;

/** How many recent tabs ⌃Tab remembers. */
const RECENT_TABS_LIMIT = 20;

/** The current state. Replaced only inside applyChange(). */
let currentState: BrowserState;

/** The open main windows by id (mainWindows.ts adds and removes them). The focused one is state.focusedWindowId. */
const mainWindows = new Map<WindowId, BrowserWindow>();

/** Where the state is saved. */
let stateFilePath = "";

/** What tabViews.ts calls when a page does something. Set once at startup. */
let tabViewEvents: TabViewEvents | null = null;

/** A pending runtime push, so a burst of page events sends one message. */
let runtimePushTimer: NodeJS.Timeout | null = null;

/** Recently selected tabs, newest first, for ⌃Tab and the Command Bar. Lives only in memory. */
let recentTabIds: ItemId[] = [];

/** The windows whose hidden sidebar shows because the mouse is at the window's left edge. Not saved. */
const peekingWindowIds = new Set<WindowId>();

/** The window whose sidebar column shows the Library (the overlay is in one window at a time), or null. */
let libraryWindowId: WindowId | null = null;

/** The section the Library shows (its width depends on it). */
let librarySection: LibrarySection = "archive";

/** True while the Command Bar is open to make a new tab (RuntimeState.isNewTabPending). */
let isNewTabPending = false;

/** The sidebar item being dragged and the window it is dragged from, or null (RuntimeState.itemDraggedInOtherWindow). */
let itemDrag: { itemId: ItemId; windowId: WindowId } | null = null;

/** How each live folder's last refresh went (RuntimeState.liveFolders); liveFolderRefresher.ts sets them. */
const liveFolderStatuses = new Map<ItemId, LiveFolderStatus>();

/** Web Store extensions downloading and the profiles waiting for each (RuntimeState.extensionsBeingAdded). */
let extensionsBeingAdded: ExtensionBeingAdded[] = [];

/** A downloaded version of Bow waiting for a restart (RuntimeState.updateReadyVersion). */
let updateReadyVersion: string | null = null;

/** The sidebar width while its edge is being dragged in the focused window; null otherwise (the saved width applies). */
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
 * Connects the page-event handlers. Runs once at startup, before the first window opens.
 */
export function setTabViewEvents(events: TabViewEvents): void {
  tabViewEvents = events;
}

/**
 * Registers an open main window under its id (its views follow at the next sync).
 */
export function attachWindow(windowId: WindowId, window: BrowserWindow): void {
  mainWindows.set(windowId, window);
}

/**
 * Forgets a main window that is closing: its pages leave it, so another window can show them.
 */
export function detachWindow(windowId: WindowId): void {
  mainWindows.delete(windowId);
  peekingWindowIds.delete(windowId);
  forgetWindow(windowId);
}

export function getState(): BrowserState {
  return currentState;
}

/**
 * The state as one window shows it: its own Space and selection (windows.ts).
 */
export function getStateForWindow(windowId: WindowId): BrowserState {
  return projectStateForWindow(currentState, windowId);
}

/**
 * Returns a main window by id, or null when it is not open or already destroyed.
 */
export function getMainWindow(windowId: WindowId): BrowserWindow | null {
  const window = mainWindows.get(windowId);
  return window !== undefined && !window.isDestroyed() ? window : null;
}

/**
 * Returns the focused main window (the last main window that had the focus, also while a Little Window or another
 * app has it), or null before it exists and once it is destroyed (while quitting, page events still arrive; touching
 * a destroyed window throws, and an uncaught error's dialog would stop the app from quitting).
 */
export function getWindow(): BrowserWindow | null {
  return getMainWindow(currentState.focusedWindowId);
}

/**
 * The open main windows, the focused one first, then the others from the most recently focused.
 */
export function listMainWindows(): { windowId: WindowId; window: BrowserWindow }[] {
  const openWindows: { windowId: WindowId; window: BrowserWindow }[] = [];
  for (const windowId of listWindowIds(currentState)) {
    const window = getMainWindow(windowId);
    if (window !== null) {
      openWindows.push({ windowId: windowId, window: window });
    }
  }
  return openWindows;
}

/**
 * Returns the id of the main window whose sidebar page this is, or null for anything else (the overlay, pages).
 */
export function findMainWindowIdOf(contents: WebContents): WindowId | null {
  for (const [windowId, window] of mainWindows) {
    if (!window.isDestroyed() && window.webContents === contents) {
      return windowId;
    }
  }
  return null;
}

/**
 * Returns the main window that has a tab's page on screen, or null.
 */
export function findMainWindowShowingTab(tabId: ItemId): BrowserWindow | null {
  const windowId = findWindowShowingTab(tabId);
  return windowId === null ? null : getMainWindow(windowId);
}

export function getRecentTabIds(): ItemId[] {
  return recentTabIds;
}

/**
 * The card of a window (the focused one unless named) sits right of the sidebar (unless hidden) and below the
 * toolbar.
 */
export function getLayoutOptions(windowId: WindowId = currentState.focusedWindowId): CardLayoutOptions {
  // Each window has its own sidebar (shown or hidden, width): the projected state carries that window's.
  const windowState = getStateForWindow(windowId);
  const isFocused = windowId === currentState.focusedWindowId;
  const draggedWidth = isFocused ? previewSidebarWidth : null;
  const sidebarWidth = draggedWidth ?? windowState.settings.sidebarWidth ?? SIDEBAR_WIDTH_PX;
  const selectedTabId = getSelectedTabId(windowState);
  const selectedTab = selectedTabId === null ? undefined : findTab(windowState, selectedTabId);
  const isDeveloperToolbar = selectedTab !== undefined && isDeveloperModeOn(windowState, selectedTab.url);
  return {
    isSidebarVisible: windowState.settings.isSidebarVisible,
    isToolbarVisible: true,
    isSidebarPeeking: peekingWindowIds.has(windowId),
    sidebarWidth: sidebarWidth,
    isDeveloperToolbar: isDeveloperToolbar,
    isLibraryOpen: libraryWindowId === windowId,
    libraryWidth: getLibraryWidth(windowId),
  };
}

/**
 * How wide a window's Library column is now (layout.ts computeLibraryWidth: Spaces widens it).
 */
export function getLibraryWidth(windowId: WindowId = currentState.focusedWindowId): number {
  const contentWidth = getMainWindow(windowId)?.getContentSize()[0] ?? 0;
  return computeLibraryWidth(librarySection, currentState.spaces.length, contentWidth);
}

/**
 * The Library showed another section: Spaces widens its column (the page glides aside), the others narrow it again.
 */
export function setLibrarySection(section: LibrarySection): void {
  if (section === librarySection) {
    return;
  }
  librarySection = section;
  if (libraryWindowId !== null) {
    relayoutWindow(libraryWindowId, true);
    scheduleRuntimePush();
  }
}

/**
 * True when a window's sidebar column shows the Library.
 */
export function isLibraryOpenIn(windowId: WindowId): boolean {
  return libraryWindowId === windowId;
}

/**
 * What tabViews.ts needs to place one window's pages, or null when the window is not open.
 */
function buildWindowTarget(windowId: WindowId): WindowTarget | null {
  const window = getMainWindow(windowId);
  if (window === null) {
    return null;
  }
  return { windowId: windowId, window: window, state: getStateForWindow(windowId), layoutOptions: getLayoutOptions(windowId) };
}

/**
 * Places a window's pages again at once (after it was resized), or gliding.
 */
export function relayoutWindow(windowId: WindowId, isAnimated: boolean = false): void {
  const target = buildWindowTarget(windowId);
  if (target !== null) {
    layoutShownTabViews(target, isAnimated);
  }
}

/**
 * Moves the focused window's page card while the sidebar's edge is dragged, without saving (null ends the preview).
 */
export function previewSidebarWidthWhileDragging(width: number | null): void {
  previewSidebarWidth = width === null ? null : Math.max(SIDEBAR_MIN_WIDTH_PX, Math.min(width, SIDEBAR_MAX_WIDTH_PX));
  relayoutWindow(currentState.focusedWindowId);
}

/**
 * Notes which window shows the Library in its sidebar column (null: none). That window's page card glides aside to
 * make room, and back when it closes.
 */
export function setLibraryWindow(windowId: WindowId | null): void {
  if (windowId === libraryWindowId) {
    return;
  }
  const previousWindowId = libraryWindowId;
  libraryWindowId = windowId;
  updateAllWindowButtons();
  if (previousWindowId !== null) {
    relayoutWindow(previousWindowId, true);
  }
  if (windowId !== null) {
    relayoutWindow(windowId, true);
  }
  scheduleRuntimePush();
}

/**
 * Shows or hides a window's sidebar for a moment while it is hidden (Arc's hover at the left edge). The page slides
 * aside.
 */
export function setSidebarPeek(windowId: WindowId, isPeeking: boolean): void {
  const canPeek = !getStateForWindow(windowId).settings.isSidebarVisible;
  const newValue = isPeeking && canPeek;
  const isPeekingNow = peekingWindowIds.has(windowId);
  if (newValue === isPeekingNow || getMainWindow(windowId) === null) {
    return;
  }
  if (newValue) {
    peekingWindowIds.add(windowId);
  } else {
    peekingWindowIds.delete(windowId);
  }
  updateAllWindowButtons();
  // The page slides aside (and back) together with the sidebar sliding in.
  relayoutWindow(windowId, true);
  scheduleRuntimePush();
}

/**
 * A drag of a sidebar item started in a window (itemId) or ended there (null): the other windows' sidebars hear of
 * it, so they accept the item as a drop.
 */
export function setItemDrag(windowId: WindowId, itemId: ItemId | null): void {
  if (itemId !== null) {
    itemDrag = { itemId: itemId, windowId: windowId };
  } else if (itemDrag?.windowId === windowId) {
    itemDrag = null;
  }
  scheduleRuntimePush();
}

/**
 * A drag was let go outside its window: the main window under that point of the screen (if any) gets the drop, at
 * the same spot of its sidebar, and comes to the front. Its sidebar then moves the item and takes it in.
 */
export function handOverDrop(fromWindowId: WindowId, itemId: ItemId, screenX: number, screenY: number): void {
  for (const { windowId, window } of listMainWindows()) {
    const bounds = window.getContentBounds();
    const isInside = screenX >= bounds.x && screenX < bounds.x + bounds.width && screenY >= bounds.y && screenY < bounds.y + bounds.height;
    if (windowId === fromWindowId || !isInside) {
      continue;
    }
    window.focus();
    window.webContents.send(IPC_CHANNELS.sidebarCommand, { kind: "dropItemFromOtherWindow", itemId: itemId, clientX: screenX - bounds.x, clientY: screenY - bounds.y });
    return;
  }
}

/**
 * A window's sidebar page opened or closed a Note or Easel editor: a window waiting for that editor may draw it now.
 */
export function reportOpenEditor(windowId: WindowId, tabId: ItemId, isOpen: boolean): void {
  setEditorOpen(windowId, tabId, isOpen);
  syncViews();
  scheduleRuntimePush();
}

/**
 * "Move to This Window": the focused window takes the pages it selected that another window shows. That window then
 * says "Open in another window" while it still selects them.
 */
export function moveShownElsewhereTabsHere(): void {
  const focusedWindowId = currentState.focusedWindowId;
  requestTabsMoveToWindow(getTabIdsShownElsewhere(focusedWindowId), focusedWindowId);
  syncViews();
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
 * Makes the web views of every main window match the state and keeps the overlay above any view that was just added.
 */
export function syncViews(): void {
  if (tabViewEvents === null) {
    return;
  }
  const targets: WindowTarget[] = [];
  for (const windowId of listWindowIds(currentState)) {
    const target = buildWindowTarget(windowId);
    if (target !== null) {
      targets.push(target);
    }
  }
  if (targets.length === 0) {
    return;
  }
  const previouslyShownTabIds = getShownTabIds();
  const changedWindowIds = syncTabViews(targets, tabViewEvents);
  if (changedWindowIds.size === 0) {
    return;
  }
  handleShownTabsChanged(previouslyShownTabIds, getShownTabIds());
  for (const windowId of changedWindowIds) {
    const window = getMainWindow(windowId);
    if (window !== null) {
      raiseOverlayIfShown(window);
    }
  }
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
  // Changes act on the focused window; the other windows' choices are fixed up after each one (windows.ts).
  const newState = repairOtherWindows(change(currentState));
  // Functions in state.ts return the same object when nothing changed; then there is nothing to do.
  if (newState === currentState) {
    return;
  }

  currentState = newState;
  // A window whose sidebar is shown again has nothing to peek.
  for (const windowId of Array.from(peekingWindowIds)) {
    if (getStateForWindow(windowId).settings.isSidebarVisible) {
      peekingWindowIds.delete(windowId);
    }
  }
  rememberSelectedTab();
  saveState(stateFilePath, currentState);
  // At once, not with the runtime push 50 ms later: the lights must go and come with the sidebar's own buttons.
  updateAllWindowButtons();
  syncViews();
  for (const listener of stateChangeListeners) {
    listener(currentState);
  }
  pushStateToSidebar();
  scheduleRuntimePush();
}

/**
 * Sends the current state to every main window's sidebar page, as that window shows it, so it can redraw.
 */
export function pushStateToSidebar(): void {
  for (const { windowId, window } of listMainWindows()) {
    window.webContents.send(IPC_CHANNELS.stateChanged, getStateForWindow(windowId));
  }
}

/**
 * Builds a window's runtime facts (the focused window's unless named): every loaded tab's loading / sound / history,
 * the downloads in progress, and what only that window has (its sidebar peeking, pages another window shows).
 */
export function collectRuntimeState(windowId: WindowId = currentState.focusedWindowId): RuntimeState {
  const tabs = collectTabRuntime();
  const isFocused = windowId === currentState.focusedWindowId;
  return {
    tabs: tabs,
    activeDownloadCount: getActiveDownloadCount(),
    isSidebarPeeking: peekingWindowIds.has(windowId),
    media: findMediaInfo(tabs, getShownTabIds()),
    // The Command Bar opens in the focused window, so only its "New Tab" row lights up.
    isNewTabPending: isNewTabPending && isFocused,
    liveFolders: getLiveFolderStatuses(),
    tabIdsInOtherWindows: getTabIdsShownElsewhere(windowId),
    editorTabIdsHere: getEditorTabIdsHere(windowId),
    itemDraggedInOtherWindow: itemDrag !== null && itemDrag.windowId !== windowId ? itemDrag.itemId : null,
    extensionsBeingAdded: extensionsBeingAdded,
    isWindowActive: getMainWindow(windowId)?.isFocused() ?? false,
    isLibraryOpen: libraryWindowId === windowId,
    libraryWidth: getLibraryWidth(windowId),
    faviconAccents: getFaviconAccents(),
    updateReadyVersion: updateReadyVersion,
  };
}

/**
 * How every live folder's last refresh went, by folder id.
 */
export function getLiveFolderStatuses(): Record<ItemId, LiveFolderStatus> {
  return Object.fromEntries(liveFolderStatuses);
}

/**
 * Records how a live folder's refresh went (null forgets a deleted folder) and tells the sidebar.
 */
export function setLiveFolderStatus(folderId: ItemId, status: LiveFolderStatus | null): void {
  if (status === null) {
    liveFolderStatuses.delete(folderId);
  } else {
    liveFolderStatuses.set(folderId, status);
  }
  scheduleRuntimePush();
}

/**
 * The Web Store extensions downloading right now, once per profile waiting for each.
 */
export function getExtensionsBeingAdded(): ExtensionBeingAdded[] {
  return extensionsBeingAdded;
}

/**
 * Records which profiles wait for which Web Store downloads (extensionsController.ts) and tells the sidebars, whose
 * toolbars say "Adding…" until the list drops them.
 */
export function setExtensionsBeingAdded(entries: ExtensionBeingAdded[]): void {
  extensionsBeingAdded = entries;
  scheduleRuntimePush();
}

/**
 * A new version of Bow has downloaded (appUpdates.ts): every sidebar shows its notice.
 */
export function setUpdateReadyVersion(version: string | null): void {
  updateReadyVersion = version;
  scheduleRuntimePush();
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
    for (const { windowId, window } of listMainWindows()) {
      updateWindowButtons(windowId, window);
      window.webContents.send(IPC_CHANNELS.runtimeChanged, collectRuntimeState(windowId));
    }
  }, RUNTIME_PUSH_DELAY_MS);
}

/** Whether each window shows its traffic lights now, so they are only touched when that changes. */
const windowButtonsShown = new WeakMap<BrowserWindow, boolean>();

/**
 * Shows or hides every main window's traffic lights to match its sidebar right now.
 */
function updateAllWindowButtons(): void {
  for (const { windowId, window } of listMainWindows()) {
    updateWindowButtons(windowId, window);
  }
}

/**
 * Arc hides the traffic lights while the sidebar is hidden (its toolbar then starts at the window's left edge, with
 * the sidebar button first) and shows them with the sidebar, when it peeks in, and with the Library's column (the
 * user's recording, 2026-10-27).
 */
function updateWindowButtons(windowId: WindowId, window: BrowserWindow): void {
  const isSidebarVisible = getStateForWindow(windowId).settings.isSidebarVisible;
  const isShown = isSidebarVisible || peekingWindowIds.has(windowId) || libraryWindowId === windowId;
  if (windowButtonsShown.get(window) === isShown || process.platform !== "darwin") {
    return;
  }
  windowButtonsShown.set(window, isShown);
  window.setWindowButtonVisibility(isShown);
}

/**
 * Sends a request to the focused window's sidebar page that only it can carry out (inline renaming).
 */
export function sendSidebarCommand(command: SidebarCommand): void {
  const window = getWindow();
  if (window === null) {
    return;
  }
  window.webContents.send(IPC_CHANNELS.sidebarCommand, command);
}
