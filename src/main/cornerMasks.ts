/**
 * WHY this file exists:
 *   Arc's page meets the toolbar with square corners, and the card keeps rounded corners at the bottom. Electron
 *   rounds all four corners of a view alike, and a rounded parent view does not clip a page on macOS (tried
 *   2026-10-27), so page views are square and the two bottom corners are drawn over them: a tiny see-through view at
 *   each bottom corner of the card paints the window's own frame (the gradient, grain and card shadow the sidebar page
 *   draws there) outside the corner's curve. A sampled page colour under rounded top corners was not reliable: it is
 *   unknown at first and wrong whenever a page dims or changes its top.
 *   The window's sidebar page opens the two corner pages itself (window.open, which main allows for exactly these
 *   pages), so they run in the sidebar's process: a view main made itself would get a process of its own, about
 *   70 MB per corner, two per window (measured 2026-10-28).
 *
 * Data source:
 *   The card's place (tabViews.ts lays it out), the window's size, its Space theme and whether it has the focus.
 *
 * Data flow:
 *   tabViews.showTabsInWindow() → raiseCornerMasks() → the first time: the sidebar page runs window.open(corner page)
 *   → mainWindows' window-open handler → answerSidebarWindowOpen() → the new page goes into a view above the pages
 *   tabViews.layoutShownTabViews() → layoutCornerMasks() → each mask glides with the page (moveView) and gets
 *   corner.ts showCorner(info) when something it draws changed
 *   sidebar process gone → the corners go with it → the sidebar's next load opens them again
 *   window closes → tabViews.forgetWindow() → forgetCornerMasks()
 */
import { WebContentsView } from "electron";
import type { BrowserWindow, BrowserWindowConstructorOptions, HandlerDetails, Rectangle, WebContents, WindowOpenHandlerResponse } from "electron";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { CARD_RADIUS_PX } from "../shared/settings";
import type { SpaceTheme, WindowId } from "../shared/types";
import { listShownPageViews, moveView } from "./tabViews";

type CornerKind = "bottom-left" | "bottom-right";

const CORNER_KINDS: CornerKind[] = ["bottom-left", "bottom-right"];

/** A corner page: not asked for yet (or gone with its process), asked of the sidebar page, or open in its view. */
type CornerPageState = "absent" | "requested" | "open";

/** One corner's view and what it was last told to draw. */
interface CornerMask {
  kind: CornerKind;
  windowId: WindowId;
  window: BrowserWindow;
  pageState: CornerPageState;
  /** Null until the sidebar page has opened the corner page. */
  view: WebContentsView | null;
  isLoaded: boolean;
  /** The info it draws now (JSON), so an unchanged layout sends nothing. */
  shownInfo: string | null;
  /** Info that came before the page had loaded. */
  waitingInfo: string | null;
  /** Where it goes, kept for a page that opens later. */
  bounds: Rectangle | null;
}

/** What the corners of one window draw besides their own place. */
export interface CornerFrame {
  theme: SpaceTheme;
  isWindowActive: boolean;
  windowWidth: number;
  windowHeight: number;
}

const masksByWindow = new Map<WindowId, CornerMask[]>();

/** Corner pages asked of a sidebar page and not opened yet, by the window name they are opened with. */
const requestsByName = new Map<string, CornerMask>();

/** Counts the requests, so each one has a window name of its own. */
let requestCount = 0;

const CORNER_PAGE_PATH = path.join(__dirname, "..", "..", "web", "corner", "corner.html");
const CORNER_PAGE_URL = pathToFileURL(CORNER_PAGE_PATH).href;

/**
 * Hands a corner page the info it should draw (or keeps it until the page has opened and loaded).
 */
function sendInfo(mask: CornerMask, info: string): void {
  if (mask.view === null || !mask.isLoaded) {
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
 * Asks a window's sidebar page to open a corner page. Electron runs the script once the sidebar has loaded; a sidebar
 * whose process is gone is asked again at its next load.
 */
function requestCornerPage(mask: CornerMask): void {
  const sidebar = mask.window.webContents;
  if (mask.window.isDestroyed() || sidebar.isDestroyed() || sidebar.isCrashed()) {
    return;
  }
  requestCount += 1;
  const name = `bow-corner-${requestCount}`;
  requestsByName.set(name, mask);
  mask.pageState = "requested";
  // `void`: the opened window itself cannot be sent back to main.
  const script = `void window.open(${JSON.stringify(CORNER_PAGE_URL)}, ${JSON.stringify(name)})`;
  sidebar.executeJavaScript(script).catch(() => {
    requestsByName.delete(name);
    mask.pageState = "absent";
  });
}

/**
 * The sidebar page (re)loaded: corners whose page went away with its process are opened again.
 */
function reopenMissingCorners(windowId: WindowId): void {
  const masks = masksByWindow.get(windowId) ?? [];
  for (const mask of masks) {
    if (mask.pageState === "absent") {
      requestCornerPage(mask);
    }
  }
}

/**
 * A corner page's process is gone (it is the sidebar's): its view leaves the window until the sidebar opens it again.
 * What it drew is sent again to the new page.
 */
function dropCornerPage(mask: CornerMask): void {
  const view = mask.view;
  if (view === null) {
    return;
  }
  mask.view = null;
  mask.pageState = "absent";
  mask.isLoaded = false;
  mask.waitingInfo = mask.waitingInfo ?? mask.shownInfo;
  mask.shownInfo = null;
  if (!mask.window.isDestroyed()) {
    mask.window.contentView.removeChildView(view);
  }
  if (!view.webContents.isDestroyed()) {
    view.webContents.close();
  }
}

/**
 * Puts a corner that opened after its window's pages right above them, under the floating layers (Command Bar,
 * Peek, status bubble) that may have come on top meanwhile.
 */
function insertAbovePages(mask: CornerMask, view: WebContentsView): void {
  const children = mask.window.contentView.children;
  const pageIndexes = listShownPageViews(mask.windowId).map((pageView) => children.indexOf(pageView));
  const topPageIndex = Math.max(-1, ...pageIndexes);
  mask.window.contentView.addChildView(view, topPageIndex + 1);
}

/**
 * Puts the corner page the sidebar opened into its view: our own see-through page, which never navigates.
 */
function adoptCornerPage(mask: CornerMask, options: BrowserWindowConstructorOptions): WebContents {
  // Electron hands over the new page in options.webContents (its typings leave it out).
  const contents = (options as { webContents: WebContents }).webContents;
  const view = new WebContentsView({ webContents: contents });
  view.setBackgroundColor("#00000000");
  mask.view = view;
  mask.pageState = "open";
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.once("did-finish-load", () => {
    // Only now: the page's own first load counts as a navigation too.
    contents.on("will-navigate", (event) => event.preventDefault());
    mask.isLoaded = true;
    if (mask.waitingInfo !== null) {
      sendInfo(mask, mask.waitingInfo);
    }
  });
  contents.on("render-process-gone", () => dropCornerPage(mask));
  if (!mask.window.isDestroyed()) {
    insertAbovePages(mask, view);
  }
  if (mask.bounds !== null) {
    moveView(view, mask.bounds, false);
  }
  return contents;
}

/**
 * A window's sidebar page wants to open a window: allowed only for a corner page main asked that window for; every
 * other page (a link dropped on the sidebar, a script) is refused.
 */
export function answerSidebarWindowOpen(windowId: WindowId, details: HandlerDetails): WindowOpenHandlerResponse {
  const mask = requestsByName.get(details.frameName);
  const isAskedCorner = mask !== undefined && mask.windowId === windowId && details.url === CORNER_PAGE_URL;
  if (!isAskedCorner) {
    return { action: "deny" };
  }
  requestsByName.delete(details.frameName);
  return { action: "allow", createWindow: (options) => adoptCornerPage(mask, options) };
}

/**
 * A corner of a window, before its page is asked for.
 */
function createMask(kind: CornerKind, windowId: WindowId, window: BrowserWindow): CornerMask {
  return { kind: kind, windowId: windowId, window: window, pageState: "absent", view: null, isLoaded: false, shownInfo: null, waitingInfo: null, bounds: null };
}

/**
 * Puts a window's corners on top of its page views (asking its sidebar page for them the first time a page is shown
 * there). Called after page views were added, because a new view lands on top of everything.
 */
export function raiseCornerMasks(windowId: WindowId, window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  let masks = masksByWindow.get(windowId);
  if (masks === undefined) {
    masks = CORNER_KINDS.map((kind) => createMask(kind, windowId, window));
    masksByWindow.set(windowId, masks);
    window.webContents.on("did-finish-load", () => reopenMissingCorners(windowId));
    reopenMissingCorners(windowId);
  }
  for (const mask of masks) {
    if (mask.view !== null) {
      window.contentView.addChildView(mask.view);
    }
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
    mask.bounds = bounds;
    if (mask.view !== null) {
      moveView(mask.view, bounds, isAnimated);
    }
    // During a glide the corner already draws the frame of the place it is going to.
    const info = { corner: mask.kind, x: bounds.x, y: bounds.y, card: card, ...frame };
    sendInfo(mask, JSON.stringify(info));
  }
}

/**
 * A window closed: its corners' pages close too, and requests not answered yet are dropped.
 */
export function forgetCornerMasks(windowId: WindowId): void {
  const masks = masksByWindow.get(windowId) ?? [];
  for (const [name, mask] of requestsByName) {
    if (mask.windowId === windowId) {
      requestsByName.delete(name);
    }
  }
  for (const mask of masks) {
    if (mask.view !== null && !mask.view.webContents.isDestroyed()) {
      mask.view.webContents.close();
    }
  }
  masksByWindow.delete(windowId);
}
