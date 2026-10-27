/**
 * WHY this file exists:
 *   Arc's page meets the toolbar with square corners, and the card keeps rounded corners at the bottom. Electron
 *   rounds all four corners of a view alike, and a rounded parent view does not clip a page on macOS (tried
 *   2026-10-27), so page views are square and the two bottom corners are drawn over them: a tiny see-through view at
 *   each bottom corner of the card paints the window's own frame (the gradient, grain and card shadow the sidebar page
 *   draws there) outside the corner's curve. A sampled page colour under rounded top corners was not reliable: it is
 *   unknown at first and wrong whenever a page dims or changes its top.
 *
 * Data source:
 *   The card's place (tabViews.ts lays it out), the window's size, its Space theme and whether it has the focus.
 *
 * Data flow:
 *   tabViews.showTabsInWindow() → raiseCornerMasks() (new page views land on top of the masks)
 *   tabViews.layoutShownTabViews() → layoutCornerMasks() → each mask glides with the page (moveView) and gets
 *   corner.ts showCorner(info) when something it draws changed
 *   window closes → tabViews.forgetWindow() → forgetCornerMasks()
 */
import { WebContentsView } from "electron";
import type { BrowserWindow, Rectangle } from "electron";
import * as path from "node:path";
import { CARD_RADIUS_PX } from "../shared/settings";
import type { SpaceTheme, WindowId } from "../shared/types";
import { moveView } from "./tabViews";

type CornerKind = "bottom-left" | "bottom-right";

const CORNER_KINDS: CornerKind[] = ["bottom-left", "bottom-right"];

/** One corner's view and what it was last told to draw. */
interface CornerMask {
  kind: CornerKind;
  view: WebContentsView;
  isLoaded: boolean;
  /** The info it draws now (JSON), so an unchanged layout sends nothing. */
  shownInfo: string | null;
  /** Info that came before the page had loaded. */
  waitingInfo: string | null;
}

/** What the corners of one window draw besides their own place. */
export interface CornerFrame {
  theme: SpaceTheme;
  isWindowActive: boolean;
  windowWidth: number;
  windowHeight: number;
}

const masksByWindow = new Map<WindowId, CornerMask[]>();

const CORNER_PAGE_PATH = path.join(__dirname, "..", "..", "web", "corner", "corner.html");

/**
 * Hands a corner page the info it should draw (or keeps it until the page has loaded).
 */
function sendInfo(mask: CornerMask, info: string): void {
  if (!mask.isLoaded) {
    mask.waitingInfo = info;
    return;
  }
  if (mask.shownInfo === info || mask.view.webContents.isDestroyed()) {
    return;
  }
  mask.shownInfo = info;
  mask.view.webContents.executeJavaScript(`window.showCorner(${info})`).catch(() => undefined);
}

/**
 * Creates one corner's view: our own see-through page, which never navigates.
 */
function createMask(kind: CornerKind): CornerMask {
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  view.setBackgroundColor("#00000000");
  const mask: CornerMask = { kind: kind, view: view, isLoaded: false, shownInfo: null, waitingInfo: null };
  view.webContents.on("will-navigate", (event) => event.preventDefault());
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.once("did-finish-load", () => {
    mask.isLoaded = true;
    if (mask.waitingInfo !== null) {
      sendInfo(mask, mask.waitingInfo);
    }
  });
  view.webContents.loadFile(CORNER_PAGE_PATH).catch(() => undefined);
  return mask;
}

/**
 * Puts a window's corners on top of its page views (creating them the first time a page is shown there). Called
 * after page views were added, because a new view lands on top of everything.
 */
export function raiseCornerMasks(windowId: WindowId, window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  let masks = masksByWindow.get(windowId);
  if (masks === undefined) {
    masks = CORNER_KINDS.map((kind) => createMask(kind));
    masksByWindow.set(windowId, masks);
  }
  for (const mask of masks) {
    window.contentView.addChildView(mask.view);
  }
}

/**
 * Where a corner goes: a square of the card's radius at that bottom corner of the card's page area.
 */
function computeCornerBounds(card: Rectangle, kind: CornerKind): Rectangle {
  const size = Math.min(CARD_RADIUS_PX, card.width, card.height);
  const x = kind === "bottom-left" ? card.x : card.x + card.width - size;
  return { x: x, y: card.y + card.height - size, width: size, height: size };
}

/**
 * Moves a window's corners with its card (gliding with the page when the page glides) and tells them what to draw.
 */
export function layoutCornerMasks(windowId: WindowId, card: Rectangle, frame: CornerFrame, isAnimated: boolean): void {
  const masks = masksByWindow.get(windowId);
  if (masks === undefined) {
    return;
  }
  for (const mask of masks) {
    const bounds = computeCornerBounds(card, mask.kind);
    moveView(mask.view, bounds, isAnimated);
    // During a glide the corner already draws the frame of the place it is going to.
    const info = { corner: mask.kind, x: bounds.x, y: bounds.y, card: card, ...frame };
    sendInfo(mask, JSON.stringify(info));
  }
}

/**
 * A window closed: its corners' pages close too.
 */
export function forgetCornerMasks(windowId: WindowId): void {
  const masks = masksByWindow.get(windowId) ?? [];
  for (const mask of masks) {
    if (!mask.view.webContents.isDestroyed()) {
      mask.view.webContents.close();
    }
  }
  masksByWindow.delete(windowId);
}
