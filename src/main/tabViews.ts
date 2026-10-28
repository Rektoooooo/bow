/**
 * WHY this file exists:
 *   Each tab's web page is an Electron WebContentsView laid over a main window as the "card". BrowserState says which
 *   tabs exist and which one each window selected; this file makes the views match it: every window shows its
 *   selected tab, or every pane of its split view, and the pages report what they do (navigation, titles, icons,
 *   loading, sound). A view has one parent, so a page is on screen in one window at a time: it stays with the window
 *   that shows it, and another window selecting it gets "Open in another window" instead (until it is moved there).
 *   Notes and Easels follow the same rule (Arc's notes are tabs too), so only one editor at a time writes the file:
 *   their editor is drawn by the sidebar page, which tells us when it opened or closed one, and a window may draw an
 *   editor only once no other window has it open (its last save came first).
 *
 * Data source:
 *   BrowserState as each window shows it (browserCore.ts), Electron's BrowserWindow / WebContentsView APIs, and
 *   profile sessions (profiles.ts).
 *
 * Data flow:
 *   browserCore.ts applyChange() → syncTabViews(windows) → destroy views of removed tabs → take views out of the
 *   windows that no longer show them → put each window's visible tabs in → lay out panes
 *   page events → TabViewEvents callbacks → main.ts → state change or runtime update
 *
 * Pattern: "reconcile". We never add or remove views by hand from a click handler.
 * We change the state, then one function compares state with the views and fixes the difference.
 *
 * Views are created lazily: a tab gets a web view the first time it is shown. Tabs restored from disk
 * stay unloaded until you click them, which keeps memory low when you have many tabs. Pages left alone go to sleep
 * (tabSleep.ts decides which): sleepTabView() closes the page but keeps its back/forward list with Chromium's page
 * state, and the next createTabView() for that tab restores it, scroll position and form values included.
 */
import { WebContentsView } from "electron";
import * as path from "node:path";
import type { BrowserWindow, ContextMenuParams, HandlerDetails, NavigationEntry, Rectangle, WebContents } from "electron";
import { LAYOUT_MOTION_MS } from "../shared/settings";
import type { BrowserState, ItemId, TabItem, TabRuntimeInfo, WindowId } from "../shared/types";
import { computeCardBounds } from "./layout";
import { computePaneBounds } from "../shared/splitLayout";
import type { CardLayoutOptions } from "./layout";
import { getProfileSession } from "./profiles";
import { getToolbarColor, sampleToolbarColorSoon } from "./toolbarTint";
import { captureSnapshotSoon, forgetSnapshot } from "./tabSnapshots";
import { isNoteUrl } from "../shared/notes";
import { isEaselUrl } from "../shared/easels";
import { getSelectedTabId } from "./state";
import { findProfileIdOfItem, findSplitOfTab, findTab, getActiveSpace } from "./tree";
import { forgetCornerMasks, layoutCornerMasks, raiseCornerMasks } from "./cornerMasks";
import { isCapturing } from "./mediaCapture";
import { DEFAULT_PROFILE_ID } from "../shared/settings";

/** How a page asked to open a link somewhere else. */
export type OpenDisposition = "foreground" | "background";

/** What main.ts wants to hear from the pages. */
export interface TabViewEvents {
  /** The page navigated or its title changed. */
  onPageChanged(tabId: ItemId, url: string, title: string): void;
  /** The page loaded a new address (for history). */
  onNavigated(url: string, title: string): void;
  /** The page reported its icon. */
  onFaviconChanged(tabId: ItemId, faviconUrl: string): void;
  /** Loading, sound or history changed; the sidebar and toolbar should redraw their indicators. */
  onRuntimeChanged(): void;
  /** The page wants a link opened in a new tab (target=_blank, middle-click, ⌘-click). */
  onOpenInNewTab(tabId: ItemId, url: string, disposition: OpenDisposition): void;
  /** A link was Shift-clicked: Arc opens those in a Peek. */
  onOpenInPeek(tabId: ItemId, url: string): void;
  /**
   * The page is about to leave for another address. `isUserInitiated` is true when the user clicked or typed in the
   * page just before (a link), false for redirects and scripts. Return true to stop it (main.ts opens a Peek instead).
   */
  onWillNavigate(tabId: ItemId, url: string, isUserInitiated: boolean): boolean;
  /** The user right-clicked in the page. */
  onContextMenu(tabId: ItemId, contents: WebContents, params: ContextMenuParams): void;
  /** The page's document is ready (Boost CSS goes in now). */
  onDomReady(tabId: ItemId, contents: WebContents): void;
  /** The pointer moved onto a link in a tab's page (its address) or off it (""). */
  onLinkHover(tabId: ItemId, url: string): void;
}

/** One main window as this file sees it: where its pages go, and the state as that window shows it. */
export interface WindowTarget {
  windowId: WindowId;
  window: BrowserWindow;
  /** The state projected for this window (windows.ts projectStateForWindow): its Space and selection. */
  state: BrowserState;
  layoutOptions: CardLayoutOptions;
}

/** The views a main window holds right now: the window, and its shown tabs in pane order. */
interface ShownInWindow {
  window: BrowserWindow;
  tabIds: ItemId[];
}

/** One web view per loaded tab, keyed by tab id. Lives only in memory. */
const tabViews = new Map<ItemId, WebContentsView>();

/** A sleeping page's back/forward list, restored when its tab is shown again. */
interface SleepingHistory {
  entries: NavigationEntry[];
  activeIndex: number;
}

/** Tabs whose page sleeps, with what it needs to wake where it was. */
const sleepingHistories = new Map<ItemId, SleepingHistory>();

/** The profile whose session each loaded tab's page runs in. A tab moved to another profile must reload there. */
const viewProfileIds = new Map<ItemId, string>();

/** The tabs whose views are in each main window right now. A tab is in one window's list at most. */
const shownByWindow = new Map<WindowId, ShownInWindow>();

/** The tabs each window would show but another window has on screen (the card says "Open in another window"). */
const shownElsewhereByWindow = new Map<WindowId, ItemId[]>();

/** Tabs asked to move to a window ("Move to This Window"); the next sync puts them there. */
const requestedMoves = new Map<ItemId, WindowId>();

/** The Note and Easel tabs whose editor each window's sidebar page has open right now, as it reported. */
const openEditorsByWindow = new Map<WindowId, Set<ItemId>>();

/** The Note and Easel tabs each window may draw an editor for (it has them, and no other window's editor is open). */
const editorsHereByWindow = new Map<WindowId, ItemId[]>();

/** Where each shown view was last sent (it may still be gliding there), so an unchanged layout sends nothing. */
const targetBounds = new WeakMap<WebContentsView, Rectangle>();

/** A view moving to a new place: where it started, where it goes, and when. */
interface Glide {
  from: Rectangle;
  to: Rectangle;
  startedAt: number;
}

/** The views gliding right now. */
const glides = new Map<WebContentsView, Glide>();
let glideTimer: NodeJS.Timeout | null = null;

/** Steps per second of a glide: twice a 60 Hz display's, so each refresh shows a fresh place. Our choice. */
const GLIDE_STEP_MS = 8;

/**
 * Cubic ease-out: fast at first, settling softly. The same curve as --motion-layout-ease in sidebar.css.
 */
function easeOut(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

/**
 * The rectangle a fraction of the way from one to another, in whole points.
 */
function interpolateBounds(from: Rectangle, to: Rectangle, fraction: number): Rectangle {
  return {
    x: Math.round(from.x + (to.x - from.x) * fraction),
    y: Math.round(from.y + (to.y - from.y) * fraction),
    width: Math.round(from.width + (to.width - from.width) * fraction),
    height: Math.round(from.height + (to.height - from.height) * fraction),
  };
}

/**
 * Moves every gliding view one step; stops when all have arrived.
 */
function stepGlides(): void {
  const now = performance.now();
  for (const [view, glide] of glides) {
    const progress = Math.min((now - glide.startedAt) / LAYOUT_MOTION_MS, 1);
    view.setBounds(interpolateBounds(glide.from, glide.to, easeOut(progress)));
    if (progress >= 1) {
      glides.delete(view);
    }
  }
  if (glides.size === 0 && glideTimer !== null) {
    clearInterval(glideTimer);
    glideTimer = null;
  }
}

/**
 * Starts a view gliding from where it is now (also mid-glide) to its new place (Peek uses it too).
 */
export function glideView(view: WebContentsView, bounds: Rectangle): void {
  glides.set(view, { from: view.getBounds(), to: bounds, startedAt: performance.now() });
  if (glideTimer === null) {
    glideTimer = setInterval(stepGlides, GLIDE_STEP_MS);
  }
  stepGlides();
}

/**
 * Puts a view in place at once, ending any glide it was in.
 */
function placeAt(view: WebContentsView, bounds: Rectangle): void {
  glides.delete(view);
  view.setBounds(bounds);
}

/** The focused window's selected tab while that window shows its page, or null. */
let focusedTabId: ItemId | null = null;

/** When the user last clicked or pressed a key in each tab's page, to tell link clicks from redirects. */
const lastUserInputAt = new Map<ItemId, number>();

/** A navigation this soon after a click or key press counts as the user's. Our choice. */
const USER_NAVIGATION_WINDOW_MS = 1000;

/**
 * Gives other modules (activity.ts, main.ts) read access to the views.
 */
export function getTabViews(): Map<ItemId, WebContentsView> {
  return tabViews;
}

/**
 * Returns the ids of the tabs whose pages are on screen in any window.
 */
export function getShownTabIds(): ItemId[] {
  const shownTabIds: ItemId[] = [];
  for (const shown of shownByWindow.values()) {
    shownTabIds.push(...shown.tabIds);
  }
  return shownTabIds;
}

/**
 * Returns the ids of the tabs whose pages are in one window, in pane order.
 */
export function getShownTabIdsInWindow(windowId: WindowId): ItemId[] {
  return shownByWindow.get(windowId)?.tabIds ?? [];
}

/**
 * Returns the window that has a tab's page on screen, or null.
 */
export function findWindowShowingTab(tabId: ItemId): WindowId | null {
  for (const [windowId, shown] of shownByWindow) {
    if (shown.tabIds.includes(tabId)) {
      return windowId;
    }
  }
  return null;
}

/**
 * Returns the tabs a window would show that another window has on screen.
 */
export function getTabIdsShownElsewhere(windowId: WindowId): ItemId[] {
  return shownElsewhereByWindow.get(windowId) ?? [];
}

/**
 * Returns the Note and Easel tabs a window may draw an editor for.
 */
export function getEditorTabIdsHere(windowId: WindowId): ItemId[] {
  return editorsHereByWindow.get(windowId) ?? [];
}

/**
 * A window's sidebar page opened or closed a Note or Easel editor. It reports a closing only after its last save, so
 * the next window to draw that editor reads the newest text.
 */
export function setEditorOpen(windowId: WindowId, tabId: ItemId, isOpen: boolean): void {
  const openEditors = openEditorsByWindow.get(windowId) ?? new Set<ItemId>();
  if (isOpen) {
    openEditors.add(tabId);
  } else {
    openEditors.delete(tabId);
  }
  openEditorsByWindow.set(windowId, openEditors);
}

/**
 * True when another window than this one has the tab's editor open.
 */
function isEditorOpenElsewhere(tabId: ItemId, windowId: WindowId): boolean {
  for (const [otherWindowId, openEditors] of openEditorsByWindow) {
    if (otherWindowId !== windowId && openEditors.has(tabId)) {
      return true;
    }
  }
  return false;
}

/**
 * Asks for tabs to move to a window at the next sync ("Move to This Window"). The window they leave shows
 * "Open in another window" while it still selects them.
 */
export function requestTabsMoveToWindow(tabIds: ItemId[], windowId: WindowId): void {
  for (const tabId of tabIds) {
    requestedMoves.set(tabId, windowId);
  }
}

/**
 * Returns the web contents of the selected tab when it is loaded, or null.
 */
export function getFocusedContents(): WebContents | null {
  if (focusedTabId === null) {
    return null;
  }
  const view = tabViews.get(focusedTabId);
  if (view === undefined || view.webContents.isDestroyed()) {
    return null;
  }
  return view.webContents;
}

/**
 * Returns the web contents of a loaded tab, or null when the tab has no page right now.
 */
export function getTabContents(tabId: ItemId): WebContents | null {
  const view = tabViews.get(tabId);
  if (view === undefined || view.webContents.isDestroyed()) {
    return null;
  }
  return view.webContents;
}

/**
 * Turns Electron's window-open details into our two dispositions. Background tabs come from ⌘-click and middle-click.
 */
function toDisposition(details: HandlerDetails): OpenDisposition {
  return details.disposition === "background-tab" ? "background" : "foreground";
}

/**
 * Decides what happens when a page opens a window. Real popups (sign-in windows that talk back to the page through
 * window.opener, opened with a size) open as small windows in the same session. A Shift-click asks for a new window
 * without a size; Arc opens those in a Peek. Everything else becomes a new tab.
 */
function handleWindowOpen(tabId: ItemId, contents: WebContents, details: HandlerDetails, events: TabViewEvents) {
  const isNewWindow = details.disposition === "new-window";
  if (isNewWindow && details.features === "") {
    events.onOpenInPeek(tabId, details.url);
    return { action: "deny" as const };
  }
  if (isNewWindow) {
    return {
      action: "allow" as const,
      overrideBrowserWindowOptions: {
        webPreferences: { session: contents.session, sandbox: true, contextIsolation: true, nodeIntegration: false },
      },
    };
  }
  events.onOpenInNewTab(tabId, details.url, toDisposition(details));
  return { action: "deny" as const };
}

/** The crashed-tab page (a local file). Tabs never record local file addresses, so this page never ends up saved. */
const CRASH_PAGE_PATH = path.join(__dirname, "..", "..", "web", "crash", "crash.html");

/**
 * True for addresses a tab may record: web pages. Our crashed-tab page and other local pages are left out.
 */
function isRecordableTabUrl(url: string): boolean {
  return !url.startsWith("file://");
}

/**
 * Listens to a tab's page: navigation, titles, icons, loading, sound, links, right-clicks and crashes.
 */
function watchTabView(tabId: ItemId, view: WebContentsView, events: TabViewEvents): void {
  const contents = view.webContents;
  contents.on("page-title-updated", (_event, title) => {
    if (isRecordableTabUrl(contents.getURL())) {
      events.onPageChanged(tabId, contents.getURL(), title);
    }
  });
  contents.on("update-target-url", (_event, url) => events.onLinkHover(tabId, url));
  contents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") {
      return;
    }
    const crashedUrl = contents.getURL();
    contents.loadFile(CRASH_PAGE_PATH, { query: { url: crashedUrl, reason: details.reason } }).catch(ignoreLoadFailure);
  });
  contents.on("input-event", (_event, input) => {
    if (input.type === "mouseDown" || input.type === "keyDown") {
      lastUserInputAt.set(tabId, Date.now());
    }
  });
  contents.on("will-navigate", (details) => {
    if (!details.isMainFrame || details.isSameDocument) {
      return;
    }
    const lastInputAt = lastUserInputAt.get(tabId) ?? 0;
    const isUserInitiated = Date.now() - lastInputAt <= USER_NAVIGATION_WINDOW_MS;
    if (events.onWillNavigate(tabId, details.url, isUserInitiated)) {
      details.preventDefault();
    }
  });
  contents.on("did-navigate", (_event, url) => {
    events.onRuntimeChanged();
    if (!isRecordableTabUrl(url)) {
      return;
    }
    events.onPageChanged(tabId, url, contents.getTitle());
    events.onNavigated(url, contents.getTitle());
  });
  contents.on("did-navigate-in-page", (_event, url) => {
    events.onRuntimeChanged();
    sampleIfShown(tabId, contents);
    if (isRecordableTabUrl(url)) {
      events.onPageChanged(tabId, url, contents.getTitle());
    }
  });
  contents.on("page-favicon-updated", (_event, faviconUrls) => {
    const firstFaviconUrl = faviconUrls[0];
    if (firstFaviconUrl !== undefined) {
      events.onFaviconChanged(tabId, firstFaviconUrl);
    }
  });
  contents.on("dom-ready", () => events.onDomReady(tabId, contents));
  contents.on("did-start-loading", () => events.onRuntimeChanged());
  contents.on("did-stop-loading", () => {
    events.onRuntimeChanged();
    sampleIfShown(tabId, contents);
  });
  contents.on("audio-state-changed", () => events.onRuntimeChanged());
  contents.on("context-menu", (_event, params) => {
    events.onContextMenu(tabId, contents, params);
  });
  contents.setWindowOpenHandler((details) => handleWindowOpen(tabId, contents, details, events));
  // No radius: the page meets the toolbar square, and cornerMasks.ts rounds the card's bottom corners over it.
}

/**
 * Samples a page's toolbar color and keeps a picture of it when it is on screen (pages off screen cannot be
 * captured).
 */
function sampleIfShown(tabId: ItemId, contents: WebContents): void {
  if (findWindowShowingTab(tabId) !== null) {
    sampleToolbarColorSoon(contents);
    captureSnapshotSoon(tabId, contents);
  }
}

/**
 * Refreshes the pictures of the pages on screen (main.ts calls this every SNAPSHOT_REFRESH_MS).
 */
export function refreshShownSnapshots(): void {
  for (const tabId of getShownTabIds()) {
    const contents = tabViews.get(tabId)?.webContents;
    if (contents !== undefined && !contents.isLoading()) {
      captureSnapshotSoon(tabId, contents);
    }
  }
}

/**
 * Creates a web view for one tab in its profile's session, loads its URL and listens to the page.
 */
export function createTabView(state: BrowserState, tab: TabItem, events: TabViewEvents): WebContentsView {
  const profileId = findProfileIdOfItem(state, tab.id) ?? DEFAULT_PROFILE_ID;
  const profileSession = getProfileSession(profileId);
  // Web pages get no preload script: sandboxed, context-isolated, no Node.js.
  const view = new WebContentsView({
    webPreferences: { session: profileSession, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  watchTabView(tab.id, view, events);
  view.webContents.setAudioMuted(tab.isMuted);
  const sleepingHistory = sleepingHistories.get(tab.id);
  sleepingHistories.delete(tab.id);
  // A page that slept wakes with its back/forward list, scroll and form values; unless the tab's address changed
  // meanwhile (Reset to its pinned address), then that address loads.
  const activeEntry = sleepingHistory?.entries[sleepingHistory.activeIndex];
  if (sleepingHistory !== undefined && activeEntry?.url === tab.url) {
    view.webContents.navigationHistory.restore({ entries: sleepingHistory.entries, index: sleepingHistory.activeIndex }).catch(ignoreLoadFailure);
  } else {
    view.webContents.loadURL(tab.url).catch(ignoreLoadFailure);
  }
  tabViews.set(tab.id, view);
  viewProfileIds.set(tab.id, profileId);
  return view;
}

/**
 * Puts a page to sleep: keeps its back/forward list (with scroll and form state) and closes it, which ends its
 * renderer process. A page on screen in any window, with developer tools open, or in a call or screen share
 * (mediaCapture.ts) stays awake. Returns whether it
 * slept. The tab's snapshot stays for the tab switcher.
 */
export function sleepTabView(tabId: ItemId): boolean {
  const view = tabViews.get(tabId);
  if (view === undefined || view.webContents.isDestroyed() || findWindowShowingTab(tabId) !== null || view.webContents.isDevToolsOpened()) {
    return false;
  }
  if (isCapturing(view.webContents)) {
    return false;
  }
  const history = view.webContents.navigationHistory;
  sleepingHistories.set(tabId, { entries: history.getAllEntries(), activeIndex: history.getActiveIndex() });
  view.webContents.close();
  tabViews.delete(tabId);
  viewProfileIds.delete(tabId);
  requestedMoves.delete(tabId);
  return true;
}

/**
 * The tabs whose page sleeps now.
 */
export function getSleepingTabIds(): ItemId[] {
  return Array.from(sleepingHistories.keys());
}

/**
 * Takes over a page that already exists (a Peek becoming a tab) for a tab id made in advance, so the page keeps its
 * state instead of loading again. Call before the state change that adds the tab.
 */
export function adoptTabView(tabId: ItemId, view: WebContentsView, events: TabViewEvents): void {
  watchTabView(tabId, view, events);
  tabViews.set(tabId, view);
  events.onPageChanged(tabId, view.webContents.getURL(), view.webContents.getTitle());
}

/**
 * loadURL rejects when a page fails to load (no network, unknown host, or the user navigated away first).
 * The failure is already visible in the tab, so there is nothing more to do here.
 */
function ignoreLoadFailure(): void {
  // Intentionally empty.
}

/**
 * Takes a shown view out of its window (the page keeps running, so audio keeps playing).
 */
function takeOutOfWindow(shown: ShownInWindow, tabId: ItemId): void {
  const view = tabViews.get(tabId);
  if (view !== undefined && !shown.window.isDestroyed()) {
    shown.window.contentView.removeChildView(view);
  }
  if (view !== undefined) {
    targetBounds.delete(view);
    glides.delete(view);
  }
  shown.tabIds = shown.tabIds.filter((shownId) => shownId !== tabId);
}

/**
 * Removes a tab's web view from the window that shows it and closes its page to free memory.
 */
export function destroyTabView(tabId: ItemId): void {
  const view = tabViews.get(tabId);
  if (view === undefined) {
    return;
  }

  for (const shown of shownByWindow.values()) {
    if (shown.tabIds.includes(tabId)) {
      takeOutOfWindow(shown, tabId);
    }
  }
  view.webContents.close();
  tabViews.delete(tabId);
  sleepingHistories.delete(tabId);
  forgetSnapshot(tabId);
  viewProfileIds.delete(tabId);
  requestedMoves.delete(tabId);
  if (focusedTabId === tabId) {
    focusedTabId = null;
  }
}

/**
 * A window is closing: its pages leave it but stay loaded, so another window can show them.
 */
export function forgetWindow(windowId: WindowId): void {
  const shown = shownByWindow.get(windowId);
  if (shown !== undefined) {
    for (const tabId of [...shown.tabIds]) {
      takeOutOfWindow(shown, tabId);
    }
  }
  shownByWindow.delete(windowId);
  forgetCornerMasks(windowId);
  shownElsewhereByWindow.delete(windowId);
  openEditorsByWindow.delete(windowId);
  editorsHereByWindow.delete(windowId);
}

/**
 * Returns the tabs that should be on screen: the selected tab, or every tab of its split view in pane order. Notes
 * and Easels are among them; they get an editor instead of a page view (isEditorTab).
 */
export function computeVisibleTabIds(state: BrowserState): ItemId[] {
  const selectedTabId = getSelectedTabId(state);
  if (selectedTabId === null || findTab(state, selectedTabId) === undefined) {
    return [];
  }
  const splitId = findSplitOfTab(state, selectedTabId);
  const split = splitId === null ? undefined : state.items[splitId];
  return split !== undefined && split.kind === "split" ? split.childIds : [selectedTabId];
}

/**
 * True for Notes and Easels: they have no web page; the sidebar page draws their editor in the card
 * (shared/notes.ts, easels.ts).
 */
function isEditorTab(state: BrowserState, tabId: ItemId): boolean {
  const url = findTab(state, tabId)?.url ?? "";
  return isNoteUrl(url) || isEaselUrl(url);
}

/**
 * Places a window's shown views: one card, or the card divided into split panes. With isAnimated, views already on
 * screen glide to their new place (⌘S, the sidebar peeking in, split changes); window resizes and drags follow at once.
 */
export function layoutShownTabViews(target: WindowTarget, isAnimated: boolean = false): void {
  const contentSize = target.window.getContentSize();
  const contentWidth = contentSize[0] ?? 0;
  const contentHeight = contentSize[1] ?? 0;
  const card = computeCardBounds(contentWidth, contentHeight, target.layoutOptions);

  const state = target.state;
  // Notes and Easels have no view: the pages share the card among themselves.
  const shownTabIds = getShownTabIdsInWindow(target.windowId).filter((tabId) => tabViews.has(tabId));
  const selectedTabId = getSelectedTabId(state);
  const splitId = selectedTabId === null ? null : findSplitOfTab(state, selectedTabId);
  const split = splitId === null ? undefined : state.items[splitId];
  const isSplit = split !== undefined && split.kind === "split";
  const orientation = isSplit ? split.orientation : "horizontal";
  // While a divider is dragged, its sizes are shown before they are saved (layout options, like the sidebar width).
  const preview = target.layoutOptions.paneSizesPreview;
  const isPreviewed = isSplit && preview !== undefined && preview.splitId === split.id;
  const savedSizes = isSplit ? split.sizes : undefined;
  const sizes = isPreviewed ? preview.sizes : savedSizes;
  const paneBounds = computePaneBounds(card, shownTabIds.length, orientation, sizes);

  for (let index = 0; index < shownTabIds.length; index++) {
    const view = tabViews.get(shownTabIds[index] as ItemId);
    const bounds = paneBounds[index];
    if (view !== undefined && bounds !== undefined) {
      moveView(view, bounds, isAnimated);
    }
  }
  const frame = {
    theme: getActiveSpace(state).theme,
    isWindowActive: target.window.isFocused(),
    windowWidth: contentWidth,
    windowHeight: contentHeight,
  };
  layoutCornerMasks(target.windowId, card, frame, isAnimated);
}

/**
 * Sends a view to its place in the window. With isAnimated, a view already on screen glides there; a view that was
 * off screen (just added) appears in place. An unchanged place sends nothing. The corner masks move this way too.
 */
export function moveView(view: WebContentsView, bounds: Rectangle, isAnimated: boolean): void {
  const previousTarget = targetBounds.get(view);
  const isSameTarget =
    previousTarget !== undefined &&
    previousTarget.x === bounds.x &&
    previousTarget.y === bounds.y &&
    previousTarget.width === bounds.width &&
    previousTarget.height === bounds.height;
  if (isSameTarget) {
    return;
  }
  targetBounds.set(view, bounds);
  if (isAnimated && previousTarget !== undefined && previousTarget.width > 0) {
    glideView(view, bounds);
  } else {
    placeAt(view, bounds);
  }
}

/**
 * Destroys the views of tabs that left the sidebar, and of tabs moved to another profile (they reload there).
 */
function destroyLeftoverViews(state: BrowserState): void {
  // Copy the keys first, because destroyTabView deletes from the map we are looping over.
  const loadedTabIds = Array.from(tabViews.keys());
  for (const tabId of loadedTabIds) {
    const expectedProfileId = findProfileIdOfItem(state, tabId) ?? DEFAULT_PROFILE_ID;
    const recordedProfileId = viewProfileIds.get(tabId);
    const changedProfile = recordedProfileId !== undefined && recordedProfileId !== expectedProfileId;
    if (findTab(state, tabId) === undefined || changedProfile) {
      destroyTabView(tabId);
    }
  }
  // A sleeping page of a tab that left the sidebar (closed, archived) is not restored.
  for (const tabId of Array.from(sleepingHistories.keys())) {
    if (findTab(state, tabId) === undefined) {
      sleepingHistories.delete(tabId);
      forgetSnapshot(tabId);
    }
  }
}

/**
 * Decides which window gets each wanted tab's view. A tab stays with the window that shows it while that window still
 * wants it, unless it was asked to move; a free tab goes to the first window (the focused one first) that wants it.
 */
function assignTabsToWindows(targets: WindowTarget[], wantedByWindow: Map<WindowId, ItemId[]>): Map<ItemId, WindowId> {
  const owners = new Map<ItemId, WindowId>();
  for (const target of targets) {
    const wanted = wantedByWindow.get(target.windowId) ?? [];
    const keptTabIds = getShownTabIdsInWindow(target.windowId).filter((tabId) => wanted.includes(tabId));
    for (const tabId of keptTabIds) {
      owners.set(tabId, target.windowId);
    }
  }
  for (const [tabId, windowId] of requestedMoves) {
    const wantedThere = wantedByWindow.get(windowId) ?? [];
    if (wantedThere.includes(tabId)) {
      owners.set(tabId, windowId);
    }
  }
  requestedMoves.clear();
  for (const target of targets) {
    const wanted = wantedByWindow.get(target.windowId) ?? [];
    const freeTabIds = wanted.filter((tabId) => !owners.has(tabId));
    for (const tabId of freeTabIds) {
      owners.set(tabId, target.windowId);
    }
  }
  return owners;
}

/**
 * Puts a window's tabs on screen (making views for tabs shown for the first time) and lays them out.
 */
function showTabsInWindow(target: WindowTarget, tabIds: ItemId[], events: TabViewEvents): void {
  const shown = shownByWindow.get(target.windowId) ?? { window: target.window, tabIds: [] };
  const pageTabIds = tabIds.filter((tabId) => !isEditorTab(target.state, tabId));
  for (const tabId of pageTabIds) {
    const tab = findTab(target.state, tabId) as TabItem;
    const view = tabViews.get(tabId) ?? createTabView(target.state, tab, events);
    target.window.contentView.addChildView(view);
    // A page coming on screen may be on a site whose toolbar color is not known yet.
    if (getToolbarColor(view.webContents.getURL()) === null) {
      sampleToolbarColorSoon(view.webContents);
    }
    captureSnapshotSoon(tabId, view.webContents);
  }
  shown.window = target.window;
  shown.tabIds = tabIds;
  shownByWindow.set(target.windowId, shown);
  raiseCornerMasks(target.windowId, target.window);
}

/**
 * Makes the views match the state in every main window (the focused one first): destroys views for tabs that left
 * the sidebar, takes views out of windows that no longer show them (all windows first, so a tab one window lets go
 * of is free for another in the same change), then puts each window's tabs in and lays them out. Returns the
 * windows whose set of shown views changed (browserCore.ts then raises the floating layers there, because a newly
 * added view lands on top of them).
 */
export function syncTabViews(targets: WindowTarget[], events: TabViewEvents): Set<WindowId> {
  const firstTarget = targets[0];
  if (firstTarget === undefined) {
    return new Set();
  }
  destroyLeftoverViews(firstTarget.state);
  // Windows that closed without saying so keep nothing.
  const targetIds = new Set(targets.map((target) => target.windowId));
  for (const windowId of Array.from(shownByWindow.keys())) {
    if (!targetIds.has(windowId)) {
      forgetWindow(windowId);
    }
  }

  const wantedByWindow = new Map<WindowId, ItemId[]>();
  for (const target of targets) {
    wantedByWindow.set(target.windowId, computeVisibleTabIds(target.state));
  }
  const owners = assignTabsToWindows(targets, wantedByWindow);

  const newShownByWindow = new Map<WindowId, ItemId[]>();
  for (const target of targets) {
    const wanted = wantedByWindow.get(target.windowId) ?? [];
    const ownTabIds = wanted.filter((tabId) => owners.get(tabId) === target.windowId);
    const elsewhereTabIds = wanted.filter((tabId) => owners.get(tabId) !== target.windowId);
    const ownEditorTabIds = ownTabIds.filter((tabId) => isEditorTab(target.state, tabId));
    // An editor another window still has open waits until that window closed it (after its last save).
    const drawableEditorTabIds = ownEditorTabIds.filter((tabId) => !isEditorOpenElsewhere(tabId, target.windowId));
    newShownByWindow.set(target.windowId, ownTabIds);
    shownElsewhereByWindow.set(target.windowId, elsewhereTabIds);
    editorsHereByWindow.set(target.windowId, drawableEditorTabIds);
  }

  // Release first: every view leaving a window goes before any window takes one.
  for (const [windowId, shown] of shownByWindow) {
    const newTabIds = newShownByWindow.get(windowId) ?? [];
    const leavingTabIds = shown.tabIds.filter((tabId) => !newTabIds.includes(tabId));
    for (const tabId of leavingTabIds) {
      takeOutOfWindow(shown, tabId);
    }
  }

  const changedWindowIds = new Set<WindowId>();
  for (const target of targets) {
    const previousTabIds = getShownTabIdsInWindow(target.windowId);
    const newTabIds = newShownByWindow.get(target.windowId) ?? [];
    const sameTabsShown = previousTabIds.length === newTabIds.length && previousTabIds.every((tabId, index) => newTabIds[index] === tabId);
    if (!sameTabsShown) {
      showTabsInWindow(target, newTabIds, events);
      changedWindowIds.add(target.windowId);
    }
    // Pages that stay on screen (the sidebar hidden or shown, a split gaining or losing a pane) glide to their new
    // place; new ones appear in place.
    layoutShownTabViews(target, true);
  }

  const focusedSelectedTabId = getSelectedTabId(firstTarget.state);
  const focusedWindowTabIds = getShownTabIdsInWindow(firstTarget.windowId);
  const isFocusedTabHere = focusedSelectedTabId !== null && focusedWindowTabIds.includes(focusedSelectedTabId);
  focusedTabId = isFocusedTabHere ? focusedSelectedTabId : null;
  return changedWindowIds;
}

/**
 * Collects the live facts the sidebar and toolbar show for every loaded tab: loading, sound, back/forward.
 */
export function collectTabRuntime(): Record<ItemId, TabRuntimeInfo> {
  const runtimeState: Record<ItemId, TabRuntimeInfo> = {};
  for (const [tabId, view] of tabViews) {
    const contents = view.webContents;
    if (contents.isDestroyed()) {
      continue;
    }
    runtimeState[tabId] = {
      isLoaded: true,
      isLoading: contents.isLoading(),
      isAudible: contents.isCurrentlyAudible(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      toolbarColor: getToolbarColor(contents.getURL()),
    };
  }
  return runtimeState;
}
