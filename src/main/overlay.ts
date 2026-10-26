/**
 * WHY this file exists:
 *   The page card is a native view drawn above the window's own page, so nothing in the sidebar page can float over
 *   a web page. Panels that must (Command Bar, Library, site controls, Find) live in one more view, the overlay: a
 *   transparent page that is added on top only while a panel is open, and removed afterwards so it never blocks clicks.
 *
 * Data source:
 *   Electron's WebContentsView; the overlay page in dist/web/overlay and its preload script.
 *
 * Data flow:
 *   overlayController.ts showOverlay(message, bounds) → view added on top → "overlay:show" → overlay.ts draws
 *   Escape / click outside → overlay calls close → hideOverlay() → view removed, focus back to the page
 */
import { WebContentsView } from "electron";
import type { BrowserWindow, WebContents } from "electron";
import * as path from "node:path";
import { OVERLAY_CHANNELS } from "../shared/overlay";
import type { OverlayShowMessage } from "../shared/overlay";
import type { Bounds } from "./layout";

/** Fully transparent, so only the panel itself is drawn over the page. */
const TRANSPARENT_BACKGROUND = "#00000000";

let overlayView: WebContentsView | null = null;
let isShown = false;

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
 * Shows a panel: places the overlay, puts it on top, tells the page what to draw and gives it the keyboard.
 */
export async function showOverlay(window: BrowserWindow, bounds: Bounds, message: OverlayShowMessage): Promise<void> {
  await overlayReady;
  if (overlayView === null) {
    return;
  }
  overlayView.setBounds(bounds);
  // Adding a view that is already a child moves it to the top.
  window.contentView.addChildView(overlayView);
  isShown = true;
  overlayView.webContents.send(OVERLAY_CHANNELS.show, message);
  overlayView.webContents.focus();
}

/**
 * Takes the overlay out of the window.
 */
export function hideOverlay(window: BrowserWindow): void {
  if (overlayView === null || !isShown) {
    return;
  }
  window.contentView.removeChildView(overlayView);
  isShown = false;
}

/**
 * Puts the overlay back on top after new page views were added (they land above it).
 */
export function raiseOverlayIfShown(window: BrowserWindow): void {
  if (overlayView === null || !isShown) {
    return;
  }
  window.contentView.addChildView(overlayView);
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
