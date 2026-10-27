/**
 * WHY this file exists:
 *   While the pointer is over a link, browsers show where it goes in a small bubble at the bottom of the page. The page
 *   is a native view, so the bubble is one more small transparent view above it. A view catches the pointer, so when
 *   the pointer is near the bubble's corner it moves to the other corner (like Chrome's), and links under it stay usable.
 *   The same view shows short confirmations ("Copied link"), like Arc's toast, centered at the card's bottom: one more
 *   renderer process for those would cost about 70 MB (measured 2026-10-27).
 *
 * Data source:
 *   "update-target-url" from the tabs' pages (tabViews.ts), the card's position and the pointer position; commands
 *   that confirm what they did (appMenuCommands.ts, overlayController.ts).
 *
 * Data flow:
 *   pointer over a link → main.ts → showLinkStatus(tabId, url) → bubble shown in the focused window; "" → hidden
 *   Copy URL → showToast("Copied link") → shown for TOAST_SHOWN_MS, then it fades and leaves
 */
import { screen, WebContentsView } from "electron";
import type { BrowserWindow } from "electron";
import * as path from "node:path";
import type { ItemId } from "../shared/types";
import { getLayoutOptions, getState, getWindow } from "./browserCore";
import { computeCardBounds } from "./layout";
import type { Bounds } from "./layout";
import { isOverlayShown } from "./overlay";
import { getShownTabIdsInWindow } from "./tabViews";

/** Bubble size and distance from the card's corner. Our choice. */
const BUBBLE_MAX_WIDTH_PX = 520;
const BUBBLE_HEIGHT_PX = 26;
const BUBBLE_MARGIN_PX = 6;

/** Longest address shown; the rest ends in "…". */
const MAX_SHOWN_LENGTH = 300;

/** A confirmation's size and distance from the card's bottom. Our choice. */
const TOAST_WIDTH_PX = 260;
const TOAST_HEIGHT_PX = 40;
const TOAST_MARGIN_PX = 14;

/** How long a confirmation stays, and how long it takes to fade (= toast-out in status.css). Our choice. */
const TOAST_SHOWN_MS = 1600;
const TOAST_FADE_MS = 160;

/** Ends the confirmation on screen, or null when none is. */
let toastTimer: NodeJS.Timeout | null = null;

let bubbleView: WebContentsView | null = null;
let isBubbleShown = false;

/** The main window the bubble is in while shown (it moves to the focused window). */
let bubbleWindow: BrowserWindow | null = null;
let bubbleReady: Promise<void> = Promise.resolve();

/**
 * Creates the bubble view (hidden until a link is hovered).
 */
export function createStatusBubble(): void {
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  view.setBackgroundColor("#00000000");
  view.webContents.on("will-navigate", (event) => event.preventDefault());
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  bubbleReady = new Promise((resolve) => view.webContents.once("did-finish-load", () => resolve()));
  view.webContents.loadFile(path.join(__dirname, "..", "..", "web", "status", "status.html"));
  bubbleView = view;
}

/**
 * Chooses the bubble's place: the card's bottom-left corner, or bottom-right when the pointer is there.
 */
function computeBubbleBounds(): Bounds | null {
  const window = getWindow();
  if (window === null) {
    return null;
  }
  const contentSize = window.getContentSize();
  const card = computeCardBounds(contentSize[0] ?? 0, contentSize[1] ?? 0, getLayoutOptions());
  const width = Math.min(BUBBLE_MAX_WIDTH_PX, Math.max(card.width - 2 * BUBBLE_MARGIN_PX, 0));
  const y = card.y + card.height - BUBBLE_HEIGHT_PX - BUBBLE_MARGIN_PX;
  const leftBounds = { x: card.x + BUBBLE_MARGIN_PX, y: y, width: width, height: BUBBLE_HEIGHT_PX };

  const cursor = screen.getCursorScreenPoint();
  const contentOrigin = window.getContentBounds();
  const pointerX = cursor.x - contentOrigin.x;
  const pointerY = cursor.y - contentOrigin.y;
  const pointerIsOverLeftBubble = pointerX >= leftBounds.x && pointerX <= leftBounds.x + width && pointerY >= y - BUBBLE_MARGIN_PX;
  if (!pointerIsOverLeftBubble) {
    return leftBounds;
  }
  return { ...leftBounds, x: card.x + card.width - width - BUBBLE_MARGIN_PX };
}

/**
 * Takes the bubble out of the window it is in.
 */
function hideBubble(): void {
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  if (bubbleView !== null && bubbleWindow !== null && !bubbleWindow.isDestroyed()) {
    bubbleWindow.contentView.removeChildView(bubbleView);
  }
  bubbleWindow = null;
  isBubbleShown = false;
}

/**
 * A main window is closing: the bubble leaves it (it lives on for the other windows).
 */
export function leaveWindow(window: BrowserWindow): void {
  if (window === bubbleWindow) {
    hideBubble();
  }
}

/**
 * Shows where a hovered link in a tab's page goes, or hides the bubble for an empty address. Only for pages in the
 * focused window (the mouse also moves over background windows); stays out of the way of open panels.
 */
export async function showLinkStatus(tabId: ItemId, url: string): Promise<void> {
  const window = getWindow();
  if (window === null || bubbleView === null) {
    return;
  }
  const focusedWindowTabIds = getShownTabIdsInWindow(getState().focusedWindowId);
  const isInFocusedWindow = focusedWindowTabIds.includes(tabId);
  if (url === "" || isOverlayShown() || !isInFocusedWindow) {
    if (isBubbleShown) {
      hideBubble();
    }
    return;
  }
  await bubbleReady;
  const bounds = computeBubbleBounds();
  if (bounds === null || bubbleView === null) {
    return;
  }
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  const withoutScheme = url.replace(/^https?:\/\//, "");
  const shownText = withoutScheme.length > MAX_SHOWN_LENGTH ? `${withoutScheme.slice(0, MAX_SHOWN_LENGTH)}…` : withoutScheme;
  // JSON.stringify makes the address a safe string literal inside the script.
  bubbleView.webContents.executeJavaScript(`window.showStatus(${JSON.stringify(shownText)})`).catch(() => undefined);
  bubbleView.setBounds(bounds);
  // Adding it to another window moves it there.
  window.contentView.addChildView(bubbleView);
  bubbleWindow = window;
  isBubbleShown = true;
}

/**
 * Confirms a command with a short message at the bottom center of the focused window's card, like Arc's toast. It
 * fades away after TOAST_SHOWN_MS; a link hovered meanwhile takes the view back.
 */
export async function showToast(message: string): Promise<void> {
  const window = getWindow();
  if (window === null || bubbleView === null) {
    return;
  }
  await bubbleReady;
  const contentSize = window.getContentSize();
  const card = computeCardBounds(contentSize[0] ?? 0, contentSize[1] ?? 0, getLayoutOptions());
  const width = Math.min(TOAST_WIDTH_PX, card.width);
  const bounds = { x: Math.round(card.x + (card.width - width) / 2), y: card.y + card.height - TOAST_HEIGHT_PX - TOAST_MARGIN_PX, width: width, height: TOAST_HEIGHT_PX };
  bubbleView.webContents.executeJavaScript(`window.showToast(${JSON.stringify(message)})`).catch(() => undefined);
  bubbleView.setBounds(bounds);
  window.contentView.addChildView(bubbleView);
  bubbleWindow = window;
  isBubbleShown = true;
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    bubbleView?.webContents.executeJavaScript("window.fadeToast()").catch(() => undefined);
    toastTimer = setTimeout(() => {
      toastTimer = null;
      hideBubble();
    }, TOAST_FADE_MS);
  }, TOAST_SHOWN_MS);
}
