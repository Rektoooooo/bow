/**
 * WHY this file exists:
 *   Arc's Peek: links clicked in a Pinned tab or Favorite that lead to another site (and Shift-clicked links anywhere)
 *   open in a floating card over the page instead of replacing it. The Peek can become a tab (⌘O) or a split view,
 *   or be dismissed (Escape, ⌘W, a click outside). It is not saved: like Arc's, a Peek is transient.
 *
 * Data source:
 *   Link events from tabViews.ts (through main.ts), the selected tab, and the card's position.
 *
 * Data flow:
 *   link in a Pinned tab → main.ts onWillNavigate → openPeek(url, sourceTabId) → page view on top of the overlay
 *   "Open as Tab" → adoptTabView() + openTab({ id }) → the same page becomes a Today tab, nothing reloads
 */
import { nativeTheme, WebContentsView } from "electron";
import type { BrowserWindow, WebContents } from "electron";
import { DEFAULT_PROFILE_ID } from "../shared/settings";
import { computeFramePalette } from "../shared/themePalette";
import type { ItemId } from "../shared/types";
import { addAfterSyncHook, applyChange, getLayoutOptions, getState, getWindow } from "./browserCore";
import { computeCardBounds } from "./layout";
import type { Bounds } from "./layout";
import { hideOverlay, raiseOverlayIfShown, showOverlay } from "./overlay";
import { getProfileSession } from "./profiles";
import { splitTabs } from "./split";
import { getSelectedTabId, openTab, updateTabPage } from "./state";
import { adoptTabView, glideView } from "./tabViews";
import { LAYOUT_MOTION_MS } from "../shared/settings";
import type { TabViewEvents } from "./tabViews";
import { createId, findProfileIdOfItem, getActiveSpace } from "./tree";

/*
 * Arc's Peek, measured in the user's recording (2026-10-27): the card hangs from the window's top edge, its own
 * toolbar row (back, forward, reload, address) 44 pt tall in the window frame's color, the page below it ending 12 pt
 * above the window's bottom; it is 80 % as wide as the page card (10 % free on each side), centered on it. The
 * overlay draws the toolbar row and must use the same height (overlay.css --peek-toolbar-height).
 */
const PEEK_TOOLBAR_HEIGHT_PX = 44;
const PEEK_BOTTOM_SPACE_PX = 12;
const PEEK_SIDE_MARGIN_RATIO = 0.1;

/** Corner radius of the Peek's page (its bottom corners show; the top ones sit under the toolbar row). */
const PEEK_RADIUS_PX = 10;

/** A Peek grows from this share of its size when it opens and shrinks back to it when it closes. Our choice. */
const PEEK_START_SCALE = 0.94;

/** A closing Peek's page goes once its shrink has finished: the glide's length plus one step's margin. */
const PEEK_CLOSE_MS = LAYOUT_MOTION_MS + 40;

/**
 * The Peek's bounds scaled about their middle (the size it grows from and shrinks to).
 */
function scaleAboutCenter(bounds: Bounds, scale: number): Bounds {
  const width = Math.round(bounds.width * scale);
  const height = Math.round(bounds.height * scale);
  return { x: bounds.x + Math.round((bounds.width - width) / 2), y: bounds.y + Math.round((bounds.height - height) / 2), width: width, height: height };
}

/** The open Peek, or null. */
let peekView: WebContentsView | null = null;

/** The main window the open Peek is in (the focused one when it opened; it closes when another window is focused). */
let peekWindow: BrowserWindow | null = null;

/** The tab the Peek was opened from; "Split" puts the Peek next to it. */
let peekSourceTabId: ItemId | null = null;

/** Page events for a Peek that becomes a tab. Set once by main.ts. */
let tabViewEvents: TabViewEvents | null = null;

/**
 * Gives Peek the page-event handlers a tab needs, so an adopted Peek behaves like any tab. Runs once at startup.
 */
export function initializePeek(events: TabViewEvents): void {
  tabViewEvents = events;
  // Views added after a state change land on top; keep the overlay and then the Peek above them.
  addAfterSyncHook(() => raisePeek());
}

export function isPeekOpen(): boolean {
  return peekView !== null;
}

/**
 * The page card of a window (what the Peek is centered on and what dims behind it).
 */
function computeWindowCard(window: BrowserWindow): Bounds {
  const contentSize = window.getContentSize();
  return computeCardBounds(contentSize[0] ?? 0, contentSize[1] ?? 0, getLayoutOptions());
}

/**
 * Where the Peek's page goes in a window: below its toolbar row, centered on the page card.
 */
function computePeekBounds(window: BrowserWindow | null): Bounds | null {
  if (window === null || window.isDestroyed()) {
    return null;
  }
  const contentHeight = window.getContentSize()[1] ?? 0;
  const card = computeWindowCard(window);
  const sideMargin = Math.round(card.width * PEEK_SIDE_MARGIN_RATIO);
  return {
    x: card.x + sideMargin,
    y: PEEK_TOOLBAR_HEIGHT_PX,
    width: Math.max(card.width - 2 * sideMargin, 0),
    height: Math.max(contentHeight - PEEK_TOOLBAR_HEIGHT_PX - PEEK_BOTTOM_SPACE_PX, 0),
  };
}

/**
 * Draws the overlay part of the Peek (its toolbar row, the dimmed page card, the buttons) under the Peek's page view,
 * and gives the page the keyboard unless the Peek is only being redrawn.
 */
function showPeekFrame(contents: WebContents, takesKeyboard: boolean = true): void {
  const window = peekWindow;
  const frame = computePeekBounds(window);
  if (window === null || frame === null || peekView === null) {
    return;
  }
  const contentSize = window.getContentSize();
  const fullWindow = { x: 0, y: 0, width: contentSize[0] ?? 0, height: contentSize[1] ?? 0 };
  const theme = getActiveSpace(getState()).theme;
  const palette = computeFramePalette(theme, nativeTheme.shouldUseDarkColors, window.isFocused());
  const history = contents.navigationHistory;
  const panel = {
    kind: "peek" as const,
    frame: frame,
    card: computeWindowCard(window),
    url: contents.getURL(),
    chromeColor: palette.colors[0],
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward(),
  };
  const view = peekView;
  showOverlay(window, fullWindow, { panel: panel, isDark: palette.isDark, library: null, site: null }, takesKeyboard).then(() => {
    // The overlay was just put on top; the page view must sit above it.
    if (peekView !== view) {
      return;
    }
    window.contentView.addChildView(view);
    if (takesKeyboard) {
      view.webContents.focus();
    }
  });
}

/**
 * Keeps the Peek above everything after other views were added.
 */
function raisePeek(): void {
  const window = peekWindow;
  if (window === null || window.isDestroyed() || peekView === null) {
    return;
  }
  raiseOverlayIfShown(window);
  window.contentView.addChildView(peekView);
}

/**
 * Redraws the Peek's frame after its window gained or lost the focus: its toolbar row has the frame's color, which is
 * darker in the active window.
 */
export function refreshPeekFrame(window: BrowserWindow): void {
  if (peekView === null || peekWindow !== window) {
    return;
  }
  showPeekFrame(peekView.webContents, false);
}

/**
 * Re-places the Peek after the window was resized.
 */
export function relayoutPeek(): void {
  const bounds = computePeekBounds(peekWindow);
  if (peekView === null || bounds === null) {
    return;
  }
  peekView.setBounds(bounds);
  showPeekFrame(peekView.webContents);
}

/**
 * Opens a link in a Peek, in the same profile as the tab it came from. An open Peek is replaced.
 */
export function openPeek(url: string, sourceTabId: ItemId | null): void {
  const window = getWindow();
  const bounds = computePeekBounds(window);
  if (window === null || bounds === null) {
    return;
  }
  closePeek();
  peekWindow = window;

  const state = getState();
  const profileId = sourceTabId === null ? DEFAULT_PROFILE_ID : findProfileIdOfItem(state, sourceTabId) ?? DEFAULT_PROFILE_ID;
  const view = new WebContentsView({
    webPreferences: { session: getProfileSession(profileId), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  view.setBorderRadius(PEEK_RADIUS_PX);
  // It grows into place, like Arc's Peek.
  view.setBounds(scaleAboutCenter(bounds, PEEK_START_SCALE));
  glideView(view, bounds);
  peekView = view;
  peekSourceTabId = sourceTabId ?? getSelectedTabId(state);

  const contents = view.webContents;
  // Escape dismisses a Peek, like Arc; ⌘O and ⌘W come through the app menu.
  contents.on("before-input-event", (event, input) => {
    const isPlainEscape = input.type === "keyDown" && input.key === "Escape" && !input.meta && !input.control && !input.alt;
    if (isPlainEscape) {
      event.preventDefault();
      closePeek();
    }
  });
  contents.on("page-title-updated", () => showPeekFrame(contents));
  contents.on("did-navigate", () => showPeekFrame(contents));
  // Back and forward follow in-page navigations too (pages that change their address without loading).
  contents.on("did-navigate-in-page", () => showPeekFrame(contents));
  // Links inside a Peek that open new windows become ordinary tabs.
  contents.setWindowOpenHandler((details) => {
    tabViewEvents?.onOpenInNewTab(peekSourceTabId ?? "", details.url, details.disposition === "background-tab" ? "background" : "foreground");
    return { action: "deny" };
  });

  contents.loadURL(url).catch(() => undefined);
  showPeekFrame(contents);
}

/**
 * Takes the Peek off the screen. With `keepPage` its page lives on (it is becoming a tab); otherwise it is closed.
 */
function removePeek(keepPage: boolean): WebContentsView | null {
  const window = peekWindow;
  const view = peekView;
  peekView = null;
  peekWindow = null;
  hideOverlay();
  if (view === null) {
    return null;
  }
  if (!keepPage) {
    // It shrinks away while its frame fades, then the page goes.
    glideView(view, scaleAboutCenter(view.getBounds(), PEEK_START_SCALE));
    setTimeout(() => {
      if (window !== null && !window.isDestroyed()) {
        window.contentView.removeChildView(view);
      }
      view.webContents.close();
    }, PEEK_CLOSE_MS);
    return null;
  }
  return view;
}

/**
 * A main window is closing: its Peek goes at once, without the shrink.
 */
export function closePeekIn(window: BrowserWindow): void {
  if (peekView === null || peekWindow !== window) {
    return;
  }
  const view = peekView;
  peekView = null;
  peekWindow = null;
  peekSourceTabId = null;
  if (!window.isDestroyed()) {
    window.contentView.removeChildView(view);
  }
  view.webContents.close();
}

/**
 * Dismisses the Peek (Escape, ⌘W, a click outside, ×).
 */
export function closePeek(): void {
  removePeek(false);
  peekSourceTabId = null;
}

/**
 * Back, forward or reload in the Peek's own toolbar row.
 */
export function navigatePeek(command: "back" | "forward" | "reload"): void {
  if (peekView === null) {
    return;
  }
  const contents = peekView.webContents;
  if (command === "back") {
    contents.navigationHistory.goBack();
  }
  if (command === "forward") {
    contents.navigationHistory.goForward();
  }
  if (command === "reload") {
    contents.reload();
  }
}

/**
 * Turns the Peek into a Today tab (⌘O). The page moves over as it is: no reload, scroll and form state kept.
 */
export function openPeekAsTab(): void {
  const view = removePeek(true);
  if (view === null || tabViewEvents === null) {
    return;
  }
  const url = view.webContents.getURL();
  const title = view.webContents.getTitle();
  const tabId = createId("tab", Date.now());
  adoptTabView(tabId, view, tabViewEvents);
  applyChange((state) => {
    const withTab = openTab(state, url, Date.now(), { id: tabId });
    return updateTabPage(withTab, tabId, url, title);
  });
  view.webContents.focus();
  peekSourceTabId = null;
}

/**
 * Shows the Peek next to the tab it came from, as a split view.
 */
export function openPeekInSplit(): void {
  const sourceTabId = peekSourceTabId;
  const view = removePeek(true);
  if (view === null || tabViewEvents === null || sourceTabId === null) {
    return;
  }
  const url = view.webContents.getURL();
  const title = view.webContents.getTitle();
  const tabId = createId("tab", Date.now());
  adoptTabView(tabId, view, tabViewEvents);
  applyChange((state) => {
    const withTab = updateTabPage(openTab(state, url, Date.now(), { id: tabId, select: false }), tabId, url, title);
    return splitTabs(withTab, sourceTabId, tabId, Date.now());
  });
  peekSourceTabId = null;
}
