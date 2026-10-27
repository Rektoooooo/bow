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
import { WebContentsView } from "electron";
import type { WebContents } from "electron";
import { DEFAULT_PROFILE_ID } from "../shared/settings";
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
import { createId, findProfileIdOfItem } from "./tree";

/** Space above the Peek for its header (host and buttons), drawn by the overlay. Must match overlay.css. */
const PEEK_HEADER_SPACE_PX = 52;

/** Space below the Peek, and the share of the card's width left free on each side. Our choice, close to Arc. */
const PEEK_BOTTOM_SPACE_PX = 20;
const PEEK_SIDE_MARGIN_RATIO = 0.07;

/** Corner radius of the Peek card. */
const PEEK_RADIUS_PX = 12;

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
 * Where the Peek card goes: centered over the page card, leaving room for its header above.
 */
function computePeekBounds(): Bounds | null {
  const window = getWindow();
  if (window === null) {
    return null;
  }
  const contentSize = window.getContentSize();
  const contentWidth = contentSize[0] ?? 0;
  const contentHeight = contentSize[1] ?? 0;
  const card = computeCardBounds(contentWidth, contentHeight, getLayoutOptions());
  const sideMargin = Math.round(card.width * PEEK_SIDE_MARGIN_RATIO);
  return {
    x: card.x + sideMargin,
    y: card.y + PEEK_HEADER_SPACE_PX,
    width: Math.max(card.width - 2 * sideMargin, 0),
    height: Math.max(card.height - PEEK_HEADER_SPACE_PX - PEEK_BOTTOM_SPACE_PX, 0),
  };
}

/**
 * Draws the overlay part of the Peek (dimmed page, shadow, header with buttons) under the Peek's page view.
 */
function showPeekFrame(contents: WebContents): void {
  const window = getWindow();
  const frame = computePeekBounds();
  if (window === null || frame === null || peekView === null) {
    return;
  }
  const contentSize = window.getContentSize();
  const fullWindow = { x: 0, y: 0, width: contentSize[0] ?? 0, height: contentSize[1] ?? 0 };
  const panel = { kind: "peek" as const, frame: frame, url: contents.getURL(), title: contents.getTitle() };
  const view = peekView;
  showOverlay(window, fullWindow, { panel: panel, isDark: true, library: null, site: null }).then(() => {
    // The overlay was just put on top; the page view must sit above it.
    if (peekView === view) {
      window.contentView.addChildView(view);
      view.webContents.focus();
    }
  });
}

/**
 * Keeps the Peek above everything after other views were added.
 */
function raisePeek(): void {
  const window = getWindow();
  if (window === null || peekView === null) {
    return;
  }
  raiseOverlayIfShown(window);
  window.contentView.addChildView(peekView);
}

/**
 * Re-places the Peek after the window was resized.
 */
export function relayoutPeek(): void {
  const bounds = computePeekBounds();
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
  const bounds = computePeekBounds();
  if (window === null || bounds === null) {
    return;
  }
  closePeek();

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
  const window = getWindow();
  const view = peekView;
  peekView = null;
  if (window !== null) {
    hideOverlay(window);
  }
  if (view === null) {
    return null;
  }
  if (!keepPage) {
    // It shrinks away while its frame fades, then the page goes.
    glideView(view, scaleAboutCenter(view.getBounds(), PEEK_START_SCALE));
    setTimeout(() => {
      window?.contentView.removeChildView(view);
      view.webContents.close();
    }, PEEK_CLOSE_MS);
    return null;
  }
  return view;
}

/**
 * Dismisses the Peek (Escape, ⌘W, a click outside, ×).
 */
export function closePeek(): void {
  removePeek(false);
  peekSourceTabId = null;
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
