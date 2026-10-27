/**
 * WHY this file exists:
 *   Each tab's web page is an Electron WebContentsView laid over the window as the "card". BrowserState says which
 *   tabs exist and which one is selected; this file makes the views match it: it shows the selected tab, or every
 *   pane of its split view, and reports what the pages do (navigation, titles, icons, loading, sound).
 *
 * Data source:
 *   BrowserState (from main.ts), Electron's BrowserWindow / WebContentsView APIs, and profile sessions (profiles.ts).
 *
 * Data flow:
 *   main.ts applyChange() → syncTabViews() → destroy views of removed tabs → show the visible tabs → lay out panes
 *   page events → TabViewEvents callbacks → main.ts → state change or runtime update
 *
 * Pattern: "reconcile". We never add or remove views by hand from a click handler.
 * We change the state, then one function compares state with the views and fixes the difference.
 *
 * Views are created lazily: a tab gets a web view the first time it is shown. Tabs restored from disk
 * stay unloaded until you click them, which keeps memory low when you have many tabs.
 */
import { WebContentsView } from "electron";
import * as path from "node:path";
import type { BrowserWindow, ContextMenuParams, HandlerDetails, Rectangle, WebContents } from "electron";
import { CARD_RADIUS_PX, LAYOUT_MOTION_MS } from "../shared/settings";
import type { BrowserState, ItemId, TabItem, TabRuntimeInfo } from "../shared/types";
import { computeCardBounds, computePaneBounds } from "./layout";
import type { CardLayoutOptions } from "./layout";
import { getProfileSession } from "./profiles";
import { getToolbarColor, sampleToolbarColorSoon } from "./toolbarTint";
import { captureSnapshotSoon, forgetSnapshot } from "./tabSnapshots";
import { isNoteUrl } from "../shared/notes";
import { isEaselUrl } from "../shared/easels";
import { getSelectedTabId } from "./state";
import { findProfileIdOfItem, findSplitOfTab, findTab } from "./tree";
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
  /** The pointer moved onto a link (its address) or off it (""). */
  onLinkHover(url: string): void;
}

/** One web view per loaded tab, keyed by tab id. Lives only in memory. */
const tabViews = new Map<ItemId, WebContentsView>();

/** The profile whose session each loaded tab's page runs in. A tab moved to another profile must reload there. */
const viewProfileIds = new Map<ItemId, string>();

/** The tabs whose views are in the window right now, in pane order. */
let shownTabIds: ItemId[] = [];

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

/** The tab whose pane has focus (the selected tab), or null. */
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
 * Returns the ids of the tabs whose pages are on screen, in pane order.
 */
export function getShownTabIds(): ItemId[] {
  return shownTabIds;
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
  contents.on("update-target-url", (_event, url) => events.onLinkHover(url));
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
  view.setBorderRadius(CARD_RADIUS_PX);
}

/**
 * Samples a page's toolbar color and keeps a picture of it when it is on screen (pages off screen cannot be
 * captured).
 */
function sampleIfShown(tabId: ItemId, contents: WebContents): void {
  if (shownTabIds.includes(tabId)) {
    sampleToolbarColorSoon(contents);
    captureSnapshotSoon(tabId, contents);
  }
}

/**
 * Refreshes the pictures of the pages on screen (main.ts calls this every SNAPSHOT_REFRESH_MS).
 */
export function refreshShownSnapshots(): void {
  for (const tabId of shownTabIds) {
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
  view.webContents.loadURL(tab.url).catch(ignoreLoadFailure);
  tabViews.set(tab.id, view);
  viewProfileIds.set(tab.id, profileId);
  return view;
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
 * Removes a tab's web view from the window and closes its page to free memory.
 */
export function destroyTabView(window: BrowserWindow, tabId: ItemId): void {
  const view = tabViews.get(tabId);
  if (view === undefined) {
    return;
  }

  window.contentView.removeChildView(view);
  view.webContents.close();
  tabViews.delete(tabId);
  forgetSnapshot(tabId);
  viewProfileIds.delete(tabId);
  shownTabIds = shownTabIds.filter((shownId) => shownId !== tabId);
  if (focusedTabId === tabId) {
    focusedTabId = null;
  }
}

/**
 * Returns the tabs that should be on screen: the selected tab, or every tab of its split view in pane order.
 */
export function computeVisibleTabIds(state: BrowserState): ItemId[] {
  const selectedTabId = getSelectedTabId(state);
  if (selectedTabId === null || findTab(state, selectedTabId) === undefined) {
    return [];
  }
  const splitId = findSplitOfTab(state, selectedTabId);
  const split = splitId === null ? undefined : state.items[splitId];
  const shownIds = split !== undefined && split.kind === "split" ? split.childIds : [selectedTabId];
  // Notes and easels have no web page: the sidebar page draws their editor in the card (shared/notes.ts, easels.ts).
  return shownIds.filter((tabId) => {
    const url = findTab(state, tabId)?.url ?? "";
    return !isNoteUrl(url) && !isEaselUrl(url);
  });
}

/**
 * Places the shown views: one card, or the card divided into split panes. With isAnimated, views already on screen
 * glide to their new place (⌘S, the sidebar peeking in, split changes); window resizes and drags follow at once.
 */
export function layoutShownTabViews(window: BrowserWindow, state: BrowserState, layoutOptions: CardLayoutOptions, isAnimated: boolean = false): void {
  const contentSize = window.getContentSize();
  const contentWidth = contentSize[0] ?? 0;
  const contentHeight = contentSize[1] ?? 0;
  const card = computeCardBounds(contentWidth, contentHeight, layoutOptions);

  const selectedTabId = getSelectedTabId(state);
  const splitId = selectedTabId === null ? null : findSplitOfTab(state, selectedTabId);
  const split = splitId === null ? undefined : state.items[splitId];
  const orientation = split !== undefined && split.kind === "split" ? split.orientation : "horizontal";
  const paneBounds = computePaneBounds(card, shownTabIds.length, orientation);

  for (let index = 0; index < shownTabIds.length; index++) {
    const view = tabViews.get(shownTabIds[index] as ItemId);
    const bounds = paneBounds[index];
    if (view === undefined || bounds === undefined) {
      continue;
    }
    const previousTarget = targetBounds.get(view);
    const isSameTarget =
      previousTarget !== undefined &&
      previousTarget.x === bounds.x &&
      previousTarget.y === bounds.y &&
      previousTarget.width === bounds.width &&
      previousTarget.height === bounds.height;
    if (isSameTarget) {
      continue;
    }
    targetBounds.set(view, bounds);
    // A view that was off screen (just added) appears in place; only views already showing glide.
    if (isAnimated && previousTarget !== undefined && previousTarget.width > 0) {
      glideView(view, bounds);
    } else {
      placeAt(view, bounds);
    }
  }
}

/**
 * Makes the views match the state: destroys views for tabs that left the sidebar, shows exactly the visible tabs,
 * and lays them out. Returns true when the set of shown views changed (main.ts then raises the overlay again,
 * because a newly added view lands on top of it).
 */
export function syncTabViews(window: BrowserWindow, state: BrowserState, layoutOptions: CardLayoutOptions, events: TabViewEvents): boolean {
  // Copy the keys first, because destroyTabView deletes from the map we are looping over.
  const loadedTabIds = Array.from(tabViews.keys());
  for (const tabId of loadedTabIds) {
    const expectedProfileId = findProfileIdOfItem(state, tabId) ?? DEFAULT_PROFILE_ID;
    const recordedProfileId = viewProfileIds.get(tabId);
    const changedProfile = recordedProfileId !== undefined && recordedProfileId !== expectedProfileId;
    if (findTab(state, tabId) === undefined || changedProfile) {
      destroyTabView(window, tabId);
    }
  }

  const visibleTabIds = computeVisibleTabIds(state);
  const sameTabsShown = visibleTabIds.length === shownTabIds.length && visibleTabIds.every((tabId, index) => shownTabIds[index] === tabId);
  focusedTabId = getSelectedTabId(state);
  if (sameTabsShown) {
    // Same pages, new places: the sidebar was hidden or shown, or a split changed. They glide there.
    layoutShownTabViews(window, state, layoutOptions, true);
    return false;
  }

  for (const shownTabId of shownTabIds) {
    const view = tabViews.get(shownTabId);
    if (view !== undefined && !visibleTabIds.includes(shownTabId)) {
      // The page keeps running after it leaves the window, so audio keeps playing.
      window.contentView.removeChildView(view);
      targetBounds.delete(view);
      glides.delete(view);
    }
  }

  for (const tabId of visibleTabIds) {
    const tab = findTab(state, tabId) as TabItem;
    const view = tabViews.get(tabId) ?? createTabView(state, tab, events);
    window.contentView.addChildView(view);
    // A page coming on screen may be on a site whose toolbar color is not known yet.
    if (getToolbarColor(view.webContents.getURL()) === null) {
      sampleToolbarColorSoon(view.webContents);
    }
    captureSnapshotSoon(tabId, view.webContents);
  }
  shownTabIds = visibleTabIds;
  // Pages that stay on screen (a split gaining or losing a pane) glide to their new place; new ones appear in place.
  layoutShownTabViews(window, state, layoutOptions, true);
  return true;
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
