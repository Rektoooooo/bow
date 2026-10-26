/**
 * WHY this file exists:
 *   While the pointer is over a link, browsers show where it goes in a small bubble at the bottom of the page. The page
 *   is a native view, so the bubble is one more small transparent view above it. A view catches the pointer, so when
 *   the pointer is near the bubble's corner it moves to the other corner (like Chrome's), and links under it stay usable.
 *
 * Data source:
 *   "update-target-url" from the tabs' pages (tabViews.ts), the card's position and the pointer position.
 *
 * Data flow:
 *   pointer over a link → main.ts → showLinkStatus(url) → bubble shown with the address; "" → hidden
 */
import { screen, WebContentsView } from "electron";
import * as path from "node:path";
import { getLayoutOptions, getWindow } from "./browserCore";
import { computeCardBounds } from "./layout";
import type { Bounds } from "./layout";
import { isOverlayShown } from "./overlay";

/** Bubble size and distance from the card's corner. Our choice. */
const BUBBLE_MAX_WIDTH_PX = 520;
const BUBBLE_HEIGHT_PX = 26;
const BUBBLE_MARGIN_PX = 6;

/** Longest address shown; the rest ends in "…". */
const MAX_SHOWN_LENGTH = 300;

let bubbleView: WebContentsView | null = null;
let isBubbleShown = false;
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
 * Shows where a hovered link goes, or hides the bubble for an empty address. Stays out of the way of open panels.
 */
export async function showLinkStatus(url: string): Promise<void> {
  const window = getWindow();
  if (window === null || bubbleView === null) {
    return;
  }
  if (url === "" || isOverlayShown()) {
    if (isBubbleShown) {
      window.contentView.removeChildView(bubbleView);
      isBubbleShown = false;
    }
    return;
  }
  await bubbleReady;
  const bounds = computeBubbleBounds();
  if (bounds === null || bubbleView === null) {
    return;
  }
  const withoutScheme = url.replace(/^https?:\/\//, "");
  const shownText = withoutScheme.length > MAX_SHOWN_LENGTH ? `${withoutScheme.slice(0, MAX_SHOWN_LENGTH)}…` : withoutScheme;
  // JSON.stringify makes the address a safe string literal inside the script.
  bubbleView.webContents.executeJavaScript(`window.showStatus(${JSON.stringify(shownText)})`).catch(() => undefined);
  bubbleView.setBounds(bounds);
  window.contentView.addChildView(bubbleView);
  isBubbleShown = true;
}
