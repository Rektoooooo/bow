/**
 * WHY this file exists:
 *   Arc's Peek: links clicked in a Pinned tab or Favorite that lead to another site (and Shift-clicked links anywhere)
 *   open in a floating card over the page instead of replacing it. The Peek can become a tab (⌘O) or a split view,
 *   or be dismissed (Escape, ⌘W, a click outside). It is not saved: like Arc's, a Peek is transient.
 *
 * Data source:
 *   Link events from tabViews.ts (through main.ts), the selected tab, the card's position, and where the clicked link
 *   is in its page (asked of that page when the Peek opens).
 *
 * Data flow:
 *   link in a Pinned tab → main.ts onWillNavigate → openPeek(url, sourceTabId) → the overlay grows an empty card out
 *   of the link → "grown" → the page view goes on top of it
 *   close → a picture of the page → the overlay shows it in the card → "closeReady" → the page view goes while the
 *   card shrinks back into the link
 *   "Open as Tab" → adoptTabView() + openTab({ id }) → the same page becomes a Today tab, nothing reloads
 */
import { nativeTheme, screen, WebContentsView } from "electron";
import type { BrowserWindow, WebContents } from "electron";
import {
  CARD_INSET_PX,
  DEFAULT_PROFILE_ID,
  PEEK_BOTTOM_SPACE_PX,
  PEEK_GROW_DELAY_MS,
  PEEK_GROW_MS,
  PEEK_LINK_LOOKUP_MS,
  PEEK_PICTURE_WAIT_MS,
  PEEK_SHRINK_FADE_MS,
  PEEK_SHRINK_MS,
  PEEK_TOOLBAR_HEIGHT_PX,
  PEEK_TOP_SPACE_PX,
} from "../shared/settings";
import { computeFramePalette } from "../shared/themePalette";
import type { ItemId } from "../shared/types";
import { addAfterSyncHook, applyChange, getLayoutOptions, getState, getWindow, setPeekWindow } from "./browserCore";
import { computeCardBounds } from "./layout";
import type { Bounds } from "./layout";
import { getOverlayShowCount, hideOverlay, raiseOverlayIfShown, sendPeekClosing, showOverlay } from "./overlay";
import { getProfileSession } from "./profiles";
import { splitTabs } from "./split";
import { getSelectedTabId, openTab, updateTabPage } from "./state";
import { adoptTabView, getTabViews } from "./tabViews";
import type { TabViewEvents } from "./tabViews";
import { createId, findProfileIdOfItem, getActiveSpace } from "./tree";

/*
 * Arc's Peek (settings.ts PEEK_*: measured 2026-10-28): the card starts 10 pt below the window's top with its own
 * toolbar row (back, forward, reload, address) 33 pt tall in the window frame's color, the page below it ending 11 pt
 * above the window's bottom; it is 80 % as wide as the page card (10 % free on each side), centered on it. The
 * overlay draws the card and its toolbar row with the same numbers.
 */
const PEEK_SIDE_MARGIN_RATIO = 0.1;

/** Corner radius of the Peek's page (its bottom corners show; the top ones sit under the toolbar row). */
const PEEK_RADIUS_PX = 10;

/**
 * Without a link to grow from (the pointer was outside the window), the card grows from this share of its size,
 * about its middle. Our choice.
 */
const PEEK_START_SCALE = 0.94;

/** Without the link's own box, the card grows from a square this big around the pointer. Our choice. */
const PEEK_POINTER_ORIGIN_PX = 16;

/**
 * The page's color before it paints, also the empty card that grows in: black in dark mode, like Arc's in the user's
 * recording; white in light mode (no light capture exists; it is what a page without a background shows).
 */
const PEEK_PAGE_COLOR_DARK = "#000000";
const PEEK_PAGE_COLOR_LIGHT = "#ffffff";

/** The page's picture for the closing card: JPEG at this quality, at 1× (it shows for about 120 ms). Our choice. */
const PEEK_PICTURE_JPEG_QUALITY = 80;

/** The link lookup runs in its own JavaScript world, so the page's scripts never see it. Any id above 0 works. */
const LINK_LOOKUP_WORLD_ID = 1007;

/** If the overlay never says the card has grown (or the picture is in place), the page shows (or goes) after this. */
const PEEK_STEP_FALLBACK_MS = 600;

/**
 * The Peek's bounds scaled about their middle (where the card grows from when there is no link).
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

/**
 * Where the open Peek grew from (the clicked link, window coordinates); it shrinks back there. Null until the frame's
 * first draw, which waits for it.
 */
let peekOrigin: Bounds | null = null;

/** True once the open Peek's card has grown and its page is on screen. */
let isPeekPageShown = false;

/** A closed Peek's page, on screen until the overlay shows its picture in the shrinking card. */
let closingPeek: { view: WebContentsView; window: BrowserWindow; showCount: number; fallbackTimer: NodeJS.Timeout | null } | null = null;

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
 * The Peek's page, or null when no Peek is open: the menu's Back, Forward, Reload and zoom act on it then, like Arc.
 */
export function getPeekContents(): WebContents | null {
  if (peekView === null || peekView.webContents.isDestroyed()) {
    return null;
  }
  return peekView.webContents;
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
  const pageTop = PEEK_TOP_SPACE_PX + PEEK_TOOLBAR_HEIGHT_PX;
  return {
    x: card.x + sideMargin,
    y: pageTop,
    width: Math.max(card.width - 2 * sideMargin, 0),
    height: Math.max(contentHeight - pageTop - PEEK_BOTTOM_SPACE_PX, 0),
  };
}

/**
 * What dims behind the Peek: the whole page card, its toolbar included, like Arc's (its toolbar's buttons do not show
 * through).
 */
function computeDimmedCard(window: BrowserWindow): Bounds {
  const card = computeWindowCard(window);
  return { x: card.x, y: CARD_INSET_PX, width: card.width, height: card.y + card.height - CARD_INSET_PX };
}

/**
 * The page's color before it paints (and the growing card's): it follows the system's appearance, as pages do.
 */
function getPeekPageColor(): string {
  return nativeTheme.shouldUseDarkColors ? PEEK_PAGE_COLOR_DARK : PEEK_PAGE_COLOR_LIGHT;
}

/**
 * Where the pointer is in a window's content (the link just clicked), or null when it is outside the window.
 */
function findPointerInWindow(window: BrowserWindow): { x: number; y: number } | null {
  const pointer = screen.getCursorScreenPoint();
  const content = window.getContentBounds();
  const x = pointer.x - content.x;
  const y = pointer.y - content.y;
  const isInside = x >= 0 && y >= 0 && x < content.width && y < content.height;
  return isInside ? { x: x, y: y } : null;
}

/**
 * True for a box as the link lookup returns it (it comes from a web page, so it is checked).
 */
function isBox(value: unknown): value is Bounds {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const box = value as Record<string, unknown>;
  const numbers = [box.x, box.y, box.width, box.height];
  return numbers.every((number) => typeof number === "number" && Number.isFinite(number));
}

/**
 * The box of the clicked link in the tab the Peek came from, in window coordinates, or null (no such tab on screen,
 * no such link, the page did not answer within PEEK_LINK_LOOKUP_MS). The page is asked for, in order: the link to
 * `url` under the pointer, the focused link to `url` (opened with the keyboard), the first link to `url` on screen,
 * and any link under the pointer (one that goes elsewhere through a script).
 */
async function findClickedLink(sourceTabId: ItemId | null, url: string, pointer: { x: number; y: number } | null): Promise<Bounds | null> {
  const sourceView = sourceTabId === null ? undefined : getTabViews().get(sourceTabId);
  if (sourceView === undefined || sourceView.webContents.isDestroyed()) {
    return null;
  }
  const viewBounds = sourceView.getBounds();
  const zoomFactor = sourceView.webContents.getZoomFactor();
  // Page coordinates are CSS pixels; the view's zoom scales them. Off the page means "no pointer".
  const pageX = pointer === null ? -1 : Math.round((pointer.x - viewBounds.x) / zoomFactor);
  const pageY = pointer === null ? -1 : Math.round((pointer.y - viewBounds.y) / zoomFactor);
  // JSON.stringify makes the address a safe string literal in the script.
  const code = `(() => {
    const url = ${JSON.stringify(url)};
    const isOnScreen = (box) => box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
    const pointed = document.elementFromPoint(${pageX}, ${pageY})?.closest("a") ?? null;
    const focused = document.activeElement?.closest?.("a") ?? null;
    const firstShown = [...document.querySelectorAll("a[href]")].find((link) => link.href === url && isOnScreen(link.getBoundingClientRect())) ?? null;
    const candidates = [pointed?.href === url ? pointed : null, focused?.href === url ? focused : null, firstShown, pointed];
    const link = candidates.find((candidate) => candidate !== null);
    if (!link) return null;
    const box = link.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  })()`;
  const lookup = sourceView.webContents.executeJavaScriptInIsolatedWorld(LINK_LOOKUP_WORLD_ID, [{ code: code }]).catch(() => null);
  const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), PEEK_LINK_LOOKUP_MS));
  const found: unknown = await Promise.race([lookup, deadline]);
  if (!isBox(found) || found.width <= 0 || found.height <= 0) {
    return null;
  }
  return {
    x: Math.round(viewBounds.x + found.x * zoomFactor),
    y: Math.round(viewBounds.y + found.y * zoomFactor),
    width: Math.round(found.width * zoomFactor),
    height: Math.round(found.height * zoomFactor),
  };
}

/**
 * Where the card grows from: the clicked link, else a small square at the pointer, else the card (its toolbar row
 * above the page's `bounds`) a little smaller.
 */
function chooseGrowOrigin(linkBox: Bounds | null, pointer: { x: number; y: number } | null, bounds: Bounds): Bounds {
  if (linkBox !== null) {
    return linkBox;
  }
  if (pointer !== null) {
    const half = PEEK_POINTER_ORIGIN_PX / 2;
    return { x: Math.round(pointer.x - half), y: Math.round(pointer.y - half), width: PEEK_POINTER_ORIGIN_PX, height: PEEK_POINTER_ORIGIN_PX };
  }
  const cardBox = { x: bounds.x, y: bounds.y - PEEK_TOOLBAR_HEIGHT_PX, width: bounds.width, height: bounds.height + PEEK_TOOLBAR_HEIGHT_PX };
  return scaleAboutCenter(cardBox, PEEK_START_SCALE);
}

/**
 * Draws the overlay part of the Peek (its toolbar row, the dimmed page card, the buttons) under the Peek's page view,
 * and gives the page the keyboard unless the Peek is only being redrawn. The first draw (`isFirstDraw`) makes the
 * card grow out of the link; until it has, the page stays off screen.
 */
function showPeekFrame(contents: WebContents, takesKeyboard: boolean = true, isFirstDraw: boolean = false): void {
  const window = peekWindow;
  const frame = computePeekBounds(window);
  // Page events before the first draw wait for it (it reads the address and history when it happens).
  if (window === null || frame === null || peekView === null || peekOrigin === null) {
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
    card: computeDimmedCard(window),
    url: contents.getURL(),
    chromeColor: palette.colors[0],
    pageColor: getPeekPageColor(),
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward(),
    growFrom: isFirstDraw ? peekOrigin : null,
  };
  const view = peekView;
  showOverlay(window, fullWindow, { panel: panel, isDark: palette.isDark, library: null, site: null }, takesKeyboard).then(() => {
    // The overlay was just put on top; the page view must sit above it (once the card has grown).
    if (peekView !== view || !isPeekPageShown) {
      return;
    }
    window.contentView.addChildView(view);
    if (takesKeyboard) {
      view.webContents.focus();
    }
  });
}

/**
 * The card has grown (the overlay says so, or the fallback timer): the page goes on top of it and takes the keyboard.
 */
function showPeekPage(view: WebContentsView): void {
  const window = peekWindow;
  if (peekView !== view || isPeekPageShown || window === null || window.isDestroyed()) {
    return;
  }
  isPeekPageShown = true;
  window.contentView.addChildView(view);
  view.webContents.focus();
}

/**
 * The overlay's card has grown: the open Peek's page shows.
 */
export function finishPeekGrow(): void {
  if (peekView !== null) {
    showPeekPage(peekView);
  }
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
  if (isPeekPageShown) {
    window.contentView.addChildView(peekView);
  }
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
  // Read at once: the pointer is still on the link that was clicked.
  const pointer = findPointerInWindow(window);
  closePeek();
  peekWindow = window;
  setPeekWindow(window);

  const state = getState();
  const profileId = sourceTabId === null ? DEFAULT_PROFILE_ID : findProfileIdOfItem(state, sourceTabId) ?? DEFAULT_PROFILE_ID;
  const view = new WebContentsView({
    webPreferences: { session: getProfileSession(profileId), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  view.setBorderRadius(PEEK_RADIUS_PX);
  // The same color as the empty card that grows in, so the page taking its place does not flash.
  view.setBackgroundColor(getPeekPageColor());
  view.setBounds(bounds);
  peekView = view;
  peekOrigin = null;
  isPeekPageShown = false;
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
  // The card grows out of the clicked link, like Arc's; its page loads meanwhile and shows once it has grown.
  findClickedLink(sourceTabId, url, pointer).then((linkBox) => {
    if (peekView !== view) {
      return;
    }
    peekOrigin = chooseGrowOrigin(linkBox, pointer, bounds);
    showPeekFrame(contents, true, true);
    setTimeout(() => showPeekPage(view), PEEK_GROW_DELAY_MS + PEEK_GROW_MS + PEEK_STEP_FALLBACK_MS);
  });
}

/**
 * A picture of a Peek's page as a 1× JPEG data: URL, or null when it fails.
 */
async function encodePeekPicture(view: WebContentsView): Promise<string | null> {
  try {
    const image = await view.webContents.capturePage();
    const picture = image.resize({ width: view.getBounds().width, quality: "good" });
    const jpegBytes = picture.toJPEG(PEEK_PICTURE_JPEG_QUALITY);
    return `data:image/jpeg;base64,${jpegBytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * A picture of a Peek's page for its closing card, or null when it takes longer than PEEK_PICTURE_WAIT_MS or fails.
 */
async function capturePeekPicture(view: WebContentsView): Promise<string | null> {
  const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), PEEK_PICTURE_WAIT_MS));
  return Promise.race([encodePeekPicture(view), deadline]);
}

/**
 * Closes a Peek the way Arc does: a picture of its page takes the page's place in the card, which shrinks back into
 * the link it came from while the dim fades. The page view goes once the overlay shows the picture (finishPeekClose).
 */
async function playPeekClose(window: BrowserWindow, view: WebContentsView, origin: Bounds | null): Promise<void> {
  // A Peek still closing goes at once.
  finishPeekClose();
  const showCount = getOverlayShowCount();
  closingPeek = { view: view, window: window, showCount: showCount, fallbackTimer: null };
  const pictureUrl = await capturePeekPicture(view);
  if (closingPeek?.view !== view) {
    return;
  }
  // Another panel (or a new Peek) took the overlay meanwhile: the old page just goes.
  if (getOverlayShowCount() !== showCount || window.isDestroyed()) {
    finishPeekClose();
    return;
  }
  sendPeekClosing({ target: origin, pictureUrl: pictureUrl });
  closingPeek.fallbackTimer = setTimeout(() => finishPeekClose(), PEEK_STEP_FALLBACK_MS);
}

/**
 * The closing card shows the page's picture (the overlay says so, or the fallback timer): the page view goes, and
 * the overlay once the card has shrunk, unless a new panel took it meanwhile.
 */
export function finishPeekClose(): void {
  const closing = closingPeek;
  if (closing === null) {
    return;
  }
  closingPeek = null;
  if (closing.fallbackTimer !== null) {
    clearTimeout(closing.fallbackTimer);
  }
  if (!closing.window.isDestroyed()) {
    closing.window.contentView.removeChildView(closing.view);
  }
  closing.view.webContents.close();
  setTimeout(() => {
    if (getOverlayShowCount() === closing.showCount) {
      hideOverlay(true);
    }
  }, PEEK_SHRINK_MS + PEEK_SHRINK_FADE_MS);
}

/**
 * Takes the Peek off the screen. With `keepPage` its page lives on (it is becoming a tab); otherwise it is closed.
 */
function removePeek(keepPage: boolean): WebContentsView | null {
  const window = peekWindow;
  const view = peekView;
  const origin = peekOrigin;
  const wasPageShown = isPeekPageShown;
  peekView = null;
  peekWindow = null;
  peekOrigin = null;
  isPeekPageShown = false;
  setPeekWindow(null);
  if (view === null) {
    hideOverlay();
    return null;
  }
  if (keepPage) {
    hideOverlay();
    return view;
  }
  if (window !== null && !window.isDestroyed() && wasPageShown) {
    playPeekClose(window, view, origin).catch(() => finishPeekClose());
    return null;
  }
  // Closed before its page showed (Escape while the card grows): the frame fades, the page never appeared.
  hideOverlay();
  if (window !== null && !window.isDestroyed()) {
    window.contentView.removeChildView(view);
  }
  view.webContents.close();
  return null;
}

/**
 * A main window is closing: its Peek goes at once, without the shrink.
 */
export function closePeekIn(window: BrowserWindow): void {
  if (closingPeek?.window === window) {
    finishPeekClose();
  }
  if (peekView === null || peekWindow !== window) {
    return;
  }
  const view = peekView;
  peekView = null;
  peekWindow = null;
  peekOrigin = null;
  isPeekPageShown = false;
  peekSourceTabId = null;
  setPeekWindow(null);
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
