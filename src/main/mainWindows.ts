/**
 * WHY this file exists:
 *   Arc's ⌘N: more than one main window, each a full browser window with its own sidebar, Space and selected tabs.
 *   This file makes them (and opens the saved ones again at start), follows which one has the focus, and closes them:
 *   the app quits with the last one, and ⌘Q keeps every window for the next start.
 *
 * Data source:
 *   The window list in BrowserState (windows.ts), window-state.json (windowState.ts), Electron's BrowserWindow.
 *
 * Data flow:
 *   start → restoreMainWindows() → one BrowserWindow per saved window → attachWindow() → (main.ts) syncViews()
 *   ⌘N → openNewWindow() → openWindow(state, id) → its sidebar asks for the state as it shows it → Command Bar
 *   a main window gets the focus → floating panels close → focusWindow(state, id)
 *   a main window closes → its pages leave it → closeWindow(state, id) (not while quitting) → quit after the last
 */
import { app, BrowserWindow } from "electron";
import type { Rectangle } from "electron";
import * as path from "node:path";
import type { WindowId } from "../shared/types";
import { applyChange, attachWindow, detachWindow, getMainWindow, getState, getWindow, isLibraryOpenIn, listMainWindows, relayoutWindow, scheduleRuntimePush } from "./browserCore";
import { closeOverlay, openCommandBar, relayoutOverlay } from "./overlayController";
import { leaveWindow as overlayLeaveWindow } from "./overlay";
import { closePeekIn, refreshPeekFrame, relayoutPeek } from "./peek";
import { leaveWindow as statusBubbleLeaveWindow } from "./statusBubble";
import { createId } from "./tree";
import { closeWindow, focusWindow, listWindowIds, openWindow } from "./windows";
import { forgetWindowBounds, loadWindowBounds, rememberWindowBounds } from "./windowState";

/** Starting window size in pixels. Our choice: fits a 13-inch laptop screen. */
const WINDOW_WIDTH_PX = 1280;
const WINDOW_HEIGHT_PX = 820;

/** Smallest window that still leaves a usable page next to the sidebar. */
const MIN_WINDOW_WIDTH_PX = 640;
const MIN_WINDOW_HEIGHT_PX = 400;

/** A new window opens this far right of and below the window it came from, like macOS cascading windows. Our choice. */
const NEW_WINDOW_OFFSET_PX = 22;

/**
 * Where macOS draws the close/minimize/zoom buttons, so they sit in the sidebar's top strip: the top-left corner of
 * the close button's 14 × 14 pt frame (Electron centers the buttons in a strip 2 × y taller than them). Measured on
 * the user's Arc (1 px per pt): the close button's center is at 19, 22.5 pt.
 */
const TRAFFIC_LIGHT_POSITION = { x: 12, y: 16 };

/** True once the app is quitting (⌘Q): closing windows then keeps them in the saved list for the next start. */
let isQuitting = false;

/**
 * A main window got the focus: panels and a Peek stay with the window they opened in (a click in another window is a
 * click outside, so they close), then the window's own Space and selection come forward.
 */
function handleWindowFocus(windowId: WindowId): void {
  const state = getState();
  const isOpen = listWindowIds(state).includes(windowId);
  if (!isOpen || windowId === state.focusedWindowId) {
    return;
  }
  closeOverlay(false);
  applyChange((current) => focusWindow(current, windowId));
}

/**
 * A main window is closing: the shared floating views and its pages leave it (they live on), and unless the app is
 * quitting, the window leaves the saved list (the last window always stays, so the next start opens it again).
 */
function handleWindowClose(windowId: WindowId, window: BrowserWindow): void {
  if (windowId === getState().focusedWindowId) {
    closeOverlay(false);
  }
  overlayLeaveWindow(window);
  statusBubbleLeaveWindow(window);
  closePeekIn(window);
  detachWindow(windowId);
  if (isQuitting) {
    return;
  }
  applyChange((state) => closeWindow(state, windowId));
  const othersStayOpen = listMainWindows().length > 0;
  if (othersStayOpen) {
    forgetWindowBounds(windowId);
  }
}

/**
 * Creates one main window (hidden; the caller shows it): sidebar page on the left, hidden title bar with the
 * traffic-light buttons inset, the sidebar's preload script attached, and listeners for resizing, moving, the focus
 * and closing.
 */
function createMainWindow(windowId: WindowId, bounds: Rectangle | null): BrowserWindow {
  // __dirname is dist/node/main when running, so these paths point into the build output.
  const preloadPath = path.join(__dirname, "..", "preload", "sidebarPreload.js");
  const sidebarPagePath = path.join(__dirname, "..", "..", "web", "renderer", "index.html");

  const window = new BrowserWindow({
    width: bounds?.width ?? WINDOW_WIDTH_PX,
    height: bounds?.height ?? WINDOW_HEIGHT_PX,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: MIN_WINDOW_WIDTH_PX,
    minHeight: MIN_WINDOW_HEIGHT_PX,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: TRAFFIC_LIGHT_POSITION,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // The sidebar page holds the bridge to Electron, so it must never navigate away or open windows.
  // Without this, dropping a link onto the sidebar would load that website with the bridge attached.
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => {
    return { action: "deny" };
  });

  window.loadFile(sidebarPagePath);
  window.on("resize", () => {
    relayoutWindow(windowId);
    relayoutOverlay();
    relayoutPeek();
    rememberWindowBounds(windowId, window);
    // Library › Spaces is as wide as the window allows: the sidebar page's column follows.
    if (isLibraryOpenIn(windowId)) {
      scheduleRuntimePush();
    }
  });
  window.on("move", () => rememberWindowBounds(windowId, window));
  window.on("focus", () => handleWindowFocus(windowId));
  // Arc draws an active window darker than an inactive one: the sidebar hears of every change (also to another app).
  window.on("focus", () => scheduleRuntimePush());
  window.on("blur", () => scheduleRuntimePush());
  window.on("focus", () => refreshPeekFrame(window));
  window.on("blur", () => refreshPeekFrame(window));
  // The frame is darker in the active window, and so are the card's rounded corners drawn over the page.
  window.on("focus", () => relayoutWindow(windowId));
  window.on("blur", () => relayoutWindow(windowId));
  window.on("close", () => handleWindowClose(windowId, window));
  // Little Windows cannot live without a main window; closing the last one ends the app.
  window.on("closed", () => {
    if (listMainWindows().length === 0) {
      app.quit();
    }
  });
  attachWindow(windowId, window);
  // Saved right away, so a window that is never moved still opens in its place next time.
  rememberWindowBounds(windowId, window);
  return window;
}

/**
 * Opens every window of the saved list, each at its saved place. The focused one opens last, so it ends up in front
 * with the focus. Runs once at startup; main.ts then makes the views match.
 */
export function restoreMainWindows(): void {
  app.on("before-quit", () => {
    isQuitting = true;
  });
  const state = getState();
  const openingOrder = [...listWindowIds(state)].reverse();
  for (const windowId of openingOrder) {
    const window = createMainWindow(windowId, loadWindowBounds(windowId));
    if (windowId === state.focusedWindowId) {
      window.show();
    } else {
      window.showInactive();
    }
  }
}

/**
 * File › New Window (⌘N, like Arc): a second full window on the same Space, with nothing selected and the Command
 * Bar open for a new tab (our choice: a new window is for something new).
 */
export function openNewWindow(): void {
  const fromWindow = getWindow();
  const fromBounds = fromWindow === null ? null : fromWindow.getNormalBounds();
  const bounds = fromBounds === null ? null : { ...fromBounds, x: fromBounds.x + NEW_WINDOW_OFFSET_PX, y: fromBounds.y + NEW_WINDOW_OFFSET_PX };
  const windowId = createId("window", Date.now());
  // Panels stay with the window they opened in.
  closeOverlay(false);
  const window = createMainWindow(windowId, bounds);
  applyChange((state) => openWindow(state, windowId));
  window.show();
  window.webContents.once("did-finish-load", () => {
    if (getState().focusedWindowId === windowId) {
      openCommandBar("newTab");
    }
  });
}

/**
 * Gives a main window the focus, also in the state (an action from a background window's sidebar acts there).
 */
export function focusMainWindow(windowId: WindowId): void {
  handleWindowFocus(windowId);
  getMainWindow(windowId)?.focus();
}

/**
 * File › Close Window (⇧⌘W): closes the window in front, which may be a Little Window; with none in front (another
 * app is active), the last focused main window.
 */
export function closeFrontWindow(): void {
  const frontWindow = BrowserWindow.getFocusedWindow() ?? getWindow();
  frontWindow?.close();
}
