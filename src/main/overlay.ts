/**
 * WHY this file exists:
 *   The page card is a native view drawn above the window's own page, so nothing in the sidebar page can float over
 *   a web page. Panels that must (Command Bar, Library, site controls, Find) live in one more view, the overlay: a
 *   transparent page that is added on top only while a panel is open, and removed afterwards so it never blocks clicks.
 *   There is one overlay for all main windows: it goes into the window a panel opens in (the focused one).
 *
 * Data source:
 *   Electron's WebContentsView; the overlay page in dist/web/overlay and its preload script.
 *
 * Data flow:
 *   overlayController.ts showOverlay(message, bounds) → view added on top → "overlay:show" → overlay.ts draws
 *   Escape / click outside → overlay calls close → hideOverlay() → "overlay:closing" (the panel animates out) →
 *   view removed shortly after; the page has the keyboard at once
 */
import { WebContentsView } from "electron";
import type { BrowserWindow, WebContents } from "electron";
import * as path from "node:path";
import { OVERLAY_CHANNELS } from "../shared/overlay";
import type { OverlayShowMessage } from "../shared/overlay";
import type { Bounds } from "./layout";

/** Fully transparent, so only the panel itself is drawn over the page. */
const TRANSPARENT_BACKGROUND = "#00000000";

/** How long a closing panel animates out before the view leaves the window (= panel-out in overlay.css). */
const CLOSE_ANIMATION_MS = 120;

/** The pending removal of a closing overlay; a panel opening meanwhile cancels it. */
let removalTimer: NodeJS.Timeout | null = null;

let overlayView: WebContentsView | null = null;
let isShown = false;

/** The main window the overlay sits in: it moves to the focused window when a panel opens there. */
let overlayWindow: BrowserWindow | null = null;

/** Resolves once the overlay page has loaded; messages sent earlier would be lost. */
let overlayReady: Promise<void> = Promise.resolve();

/**
 * Creates the overlay view and loads its page. It stays out of the window until a panel opens.
 */
export function createOverlayView(): void {
  // __dirname is dist/node/main when running.
  const preloadPath = path.join(__dirname, "..", "preload", "overlayPreload.js");
  const pagePath = path.join(__dirname, "..", "..", "web", "overlay", "overlay.html");
  const view = new WebContentsView({
    webPreferences: { preload: preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  view.setBackgroundColor(TRANSPARENT_BACKGROUND);

  // Like the sidebar page, the overlay holds a bridge to the app, so it must never load anything else.
  view.webContents.on("will-navigate", (event) => event.preventDefault());
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  overlayReady = new Promise((resolve) => {
    view.webContents.once("did-finish-load", () => resolve());
  });
  view.webContents.loadFile(pagePath);
  overlayView = view;
}

/**
 * Shows a panel: places the overlay, puts it on top, tells the page what to draw and gives it the keyboard (except
 * for panels that must not take it, like a tab preview).
 */
export async function showOverlay(window: BrowserWindow, bounds: Bounds, message: OverlayShowMessage, takesKeyboard: boolean = true): Promise<void> {
  await overlayReady;
  if (overlayView === null) {
    return;
  }
  if (removalTimer !== null) {
    clearTimeout(removalTimer);
    removalTimer = null;
  }
  overlayView.setBounds(bounds);
  // Adding a view that is already a child moves it to the top; adding it to another window moves it there.
  window.contentView.addChildView(overlayView);
  overlayWindow = window;
  isShown = true;
  overlayView.webContents.send(OVERLAY_CHANNELS.show, message);
  if (takesKeyboard) {
    overlayView.webContents.focus();
  }
}

/**
 * Takes the overlay out of its window: the panel animates out first, then the view goes.
 */
export function hideOverlay(): void {
  const window = overlayWindow;
  if (overlayView === null || window === null || !isShown) {
    return;
  }
  isShown = false;
  const view = overlayView;
  view.webContents.send(OVERLAY_CHANNELS.closing);
  removalTimer = setTimeout(() => {
    removalTimer = null;
    if (!window.isDestroyed()) {
      window.contentView.removeChildView(view);
    }
  }, CLOSE_ANIMATION_MS);
}

/**
 * Puts the overlay back on top of its window after new page views were added there (they land above it).
 */
export function raiseOverlayIfShown(window: BrowserWindow): void {
  if (overlayView === null || !isShown || window !== overlayWindow) {
    return;
  }
  window.contentView.addChildView(overlayView);
}

/**
 * A main window is closing: the overlay leaves it at once (it lives on for the other windows).
 */
export function leaveWindow(window: BrowserWindow): void {
  if (overlayView === null || window !== overlayWindow) {
    return;
  }
  if (removalTimer !== null) {
    clearTimeout(removalTimer);
    removalTimer = null;
  }
  if (!window.isDestroyed()) {
    window.contentView.removeChildView(overlayView);
  }
  overlayWindow = null;
  isShown = false;
}

/**
 * Moves or resizes the overlay (after the window was resized).
 */
export function setOverlayBounds(bounds: Bounds): void {
  if (overlayView !== null && isShown) {
    overlayView.setBounds(bounds);
  }
}

export function isOverlayShown(): boolean {
  return isShown;
}

/**
 * The overlay's web contents, used to check that IPC messages really come from it.
 */
export function getOverlayContents(): WebContents | null {
  return overlayView === null ? null : overlayView.webContents;
}

/**
 * Sends a message to the overlay page when it is open.
 */
export function sendToOverlay(channel: string, ...values: unknown[]): void {
  if (overlayView === null || !isShown) {
    return;
  }
  overlayView.webContents.send(channel, ...values);
}
