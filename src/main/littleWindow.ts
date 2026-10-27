/**
 * WHY this file exists:
 *   Arc opens links from other apps in "Little Arc": a small window with just the page and a slim bar, which you
 *   either move into a Space or close (it then goes to the Archive; left alone for 6 hours it archives itself).
 *   This is our Little Window: same idea, our own look.
 *
 * Data source:
 *   Links from other apps (app "open-url" / "second-instance"), ⌥⌘N, the bar page's IPC messages, and the clock.
 *
 * Data flow:
 *   link from another app → openLittleWindow(url) → small window: bar page (little.html) + page view
 *   "Open in Space" → openTab in the main window → Little Window closes without archiving
 *   close / 6 hours unused → addPageToArchive() → Archive
 */
import { BrowserWindow, clipboard, ipcMain, WebContentsView } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import * as path from "node:path";
import { LITTLE_WINDOW_ARCHIVE_AFTER_MS } from "../shared/settings";
import type { ArchiveReason } from "../shared/types";
import { menuHost } from "./actionRunner";
import { applyChange, getState, getWindow } from "./browserCore";
import { showPageContextMenu } from "./menus";
import { createPrivateSession, getProfileSession } from "./profiles";
import { findRoutedSpaceId } from "./routing";
import { switchSpace } from "./spaces";
import { addPageToArchive, openTab } from "./state";
import { openLinkInNewTab } from "./tabActions";
import { getActiveSpace } from "./tree";
import { normalizeTypedInput } from "./urls";
import { findSearchEngine } from "../shared/searchEngines";

/** Window size, close to Arc's Little Arc. Our choice. */
const LITTLE_WIDTH_PX = 900;
const LITTLE_HEIGHT_PX = 640;
const LITTLE_MIN_WIDTH_PX = 420;
const LITTLE_MIN_HEIGHT_PX = 300;

/** Height of the bar above the page, and the inset around the page. Must match little.css. */
const BAR_HEIGHT_PX = 40;
const PAGE_INSET_PX = 6;
const PAGE_RADIUS_PX = 8;

/** Channel names between the bar page and this file. littlePreload.ts repeats them. */
export const LITTLE_CHANNELS = {
  info: "little:info",
  navigate: "little:navigate",
  moveToSpace: "little:move-to-space",
  copyLink: "little:copy-link",
  goBack: "little:go-back",
} as const;

/** Private window size: a full browsing window, not a quick look. Our choice. */
const PRIVATE_WIDTH_PX = 1100;
const PRIVATE_HEIGHT_PX = 760;

/** How a Little Window opens. */
export interface LittleWindowOptions {
  /** A private window (⇧⌘N): in-memory session, never archived, cannot move into a Space. */
  isPrivate?: boolean;
}

/** One open Little Window. */
interface LittleWindow {
  window: BrowserWindow;
  pageView: WebContentsView;
  isPrivate: boolean;
  lastActiveAt: number;
  /** Set once the page went somewhere (moved into a Space or archived), so closing does not archive it again. */
  isSettled: boolean;
  faviconUrl: string | null;
}

const littleWindows = new Set<LittleWindow>();

/**
 * Places the page below the bar, inset like the main window's card.
 */
function layoutPage(little: LittleWindow): void {
  const contentSize = little.window.getContentSize();
  const width = (contentSize[0] ?? 0) - 2 * PAGE_INSET_PX;
  const height = (contentSize[1] ?? 0) - BAR_HEIGHT_PX - PAGE_INSET_PX;
  little.pageView.setBounds({ x: PAGE_INSET_PX, y: BAR_HEIGHT_PX, width: Math.max(width, 0), height: Math.max(height, 0) });
}

/**
 * Tells the bar page the current address and title.
 */
function sendInfo(little: LittleWindow): void {
  const contents = little.pageView.webContents;
  if (little.window.isDestroyed() || contents.isDestroyed()) {
    return;
  }
  little.window.webContents.send(LITTLE_CHANNELS.info, {
    url: contents.getURL(),
    title: contents.getTitle(),
    canGoBack: contents.navigationHistory.canGoBack(),
  });
}

/**
 * Puts a Little Window's page in the Archive (unless it already went somewhere) and marks it settled.
 */
function archiveLittleWindow(little: LittleWindow, reason: ArchiveReason): void {
  // A private window leaves no trace, so it is never archived.
  if (little.isSettled || little.isPrivate) {
    return;
  }
  little.isSettled = true;
  const contents = little.pageView.webContents;
  if (contents.isDestroyed()) {
    return;
  }
  const page = { url: contents.getURL(), title: contents.getTitle(), faviconUrl: little.faviconUrl };
  applyChange((state) => addPageToArchive(state, page, Date.now(), reason));
}

/**
 * Listens to the page: address and title go to the bar, new windows open as tabs in the main window, right-click
 * shows the page menu.
 */
function watchPage(little: LittleWindow): void {
  const contents = little.pageView.webContents;
  contents.on("did-navigate", () => sendInfo(little));
  contents.on("did-navigate-in-page", () => sendInfo(little));
  contents.on("page-title-updated", () => sendInfo(little));
  contents.on("page-favicon-updated", (_event, faviconUrls) => {
    little.faviconUrl = faviconUrls[0] ?? little.faviconUrl;
  });
  // Links that want a new tab: in a private window they stay in it (the main sidebar is saved to disk).
  const openElsewhere = (url: string, inBackground: boolean): void => {
    if (little.isPrivate) {
      contents.loadURL(url).catch(() => undefined);
      return;
    }
    openLinkInNewTab(url, inBackground ? "background" : "foreground");
  };
  const pageMenuHost = { ...menuHost, openInNewTab: openElsewhere };
  contents.on("context-menu", (_event, params) => showPageContextMenu(pageMenuHost, contents, params));
  contents.setWindowOpenHandler((details) => {
    openElsewhere(details.url, details.disposition === "background-tab");
    return { action: "deny" };
  });
}

/**
 * Opens a Little Window, on an address or empty (the bar's address field then has the keyboard).
 */
export function openLittleWindow(url: string | null, options: LittleWindowOptions = {}): void {
  const isPrivate = options.isPrivate === true;
  const preloadPath = path.join(__dirname, "..", "preload", "littlePreload.js");
  const barPagePath = path.join(__dirname, "..", "..", "web", "little", "little.html");
  const window = new BrowserWindow({
    width: isPrivate ? PRIVATE_WIDTH_PX : LITTLE_WIDTH_PX,
    height: isPrivate ? PRIVATE_HEIGHT_PX : LITTLE_HEIGHT_PX,
    minWidth: LITTLE_MIN_WIDTH_PX,
    minHeight: LITTLE_MIN_HEIGHT_PX,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: { preload: preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const profileId = getActiveSpace(getState()).profileId;
  const pageSession = isPrivate ? createPrivateSession() : getProfileSession(profileId);
  const pageView = new WebContentsView({
    webPreferences: { session: pageSession, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  pageView.setBorderRadius(PAGE_RADIUS_PX);
  window.contentView.addChildView(pageView);

  const little: LittleWindow = { window: window, pageView: pageView, isPrivate: isPrivate, lastActiveAt: Date.now(), isSettled: false, faviconUrl: null };
  littleWindows.add(little);
  layoutPage(little);
  watchPage(little);

  window.on("resize", () => layoutPage(little));
  window.on("focus", () => {
    little.lastActiveAt = Date.now();
  });
  window.on("close", () => archiveLittleWindow(little, "manual"));
  window.on("closed", () => {
    littleWindows.delete(little);
    if (!pageView.webContents.isDestroyed()) {
      pageView.webContents.close();
    }
  });

  window.webContents.once("did-finish-load", () => sendInfo(little));
  window.loadFile(barPagePath, { query: { empty: url === null ? "1" : "0", private: isPrivate ? "1" : "0" } });
  if (url !== null) {
    pageView.webContents.loadURL(url).catch(() => undefined);
  }
}

/**
 * Opens a link that came from another app. A matching Air Traffic Control rule sends it to its Space as a Today tab
 * (and brings the main window forward); otherwise it opens in a Little Window, like Arc.
 */
export function handleExternalUrl(url: string): void {
  const routedSpaceId = findRoutedSpaceId(getState(), url);
  if (routedSpaceId === null) {
    openLittleWindow(url);
    return;
  }
  const now = Date.now();
  applyChange((state) => openTab(switchSpace(state, routedSpaceId, now), url, now));
  const mainWindow = getWindow();
  mainWindow?.show();
  mainWindow?.focus();
}

/**
 * Archives and closes Little Windows nobody used for LITTLE_WINDOW_ARCHIVE_AFTER_MS. The focused one is in use.
 */
export function archiveIdleLittleWindows(now: number): void {
  for (const little of Array.from(littleWindows)) {
    const isIdle = now - little.lastActiveAt >= LITTLE_WINDOW_ARCHIVE_AFTER_MS;
    if (!isIdle || little.window.isFocused() || little.isPrivate) {
      continue;
    }
    archiveLittleWindow(little, "auto");
    little.window.close();
  }
}

/**
 * Finds the Little Window whose bar page sent a message.
 */
function findSender(event: IpcMainInvokeEvent): LittleWindow | undefined {
  return Array.from(littleWindows).find((little) => little.window.webContents === event.sender);
}

/** Longest address the bar may send. */
const MAX_TEXT_LENGTH = 8192;

/**
 * Registers the bar page's IPC handlers. Messages from anything but a Little Window's bar are ignored.
 */
export function registerLittleWindowIpc(): void {
  ipcMain.handle(LITTLE_CHANNELS.navigate, (event, typedText: unknown) => {
    const little = findSender(event);
    if (little === undefined || typeof typedText !== "string" || typedText.trim() === "" || typedText.length > MAX_TEXT_LENGTH) {
      return;
    }
    const searchEngine = findSearchEngine(getState().settings.searchEngine);
    little.pageView.webContents.loadURL(normalizeTypedInput(typedText, searchEngine)).catch(() => undefined);
  });
  ipcMain.handle(LITTLE_CHANNELS.moveToSpace, (event) => {
    const little = findSender(event);
    const url = little === undefined ? "" : little.pageView.webContents.getURL();
    // A private page must not end up in the saved sidebar.
    if (little === undefined || url === "" || little.isPrivate) {
      return;
    }
    little.isSettled = true;
    applyChange((state) => openTab(state, url, Date.now()));
    little.window.close();
    const mainWindow = getWindow();
    mainWindow?.show();
    mainWindow?.focus();
  });
  ipcMain.handle(LITTLE_CHANNELS.copyLink, (event) => {
    const little = findSender(event);
    if (little !== undefined) {
      clipboard.writeText(little.pageView.webContents.getURL());
    }
  });
  ipcMain.handle(LITTLE_CHANNELS.goBack, (event) => {
    const little = findSender(event);
    if (little !== undefined && little.pageView.webContents.navigationHistory.canGoBack()) {
      little.pageView.webContents.navigationHistory.goBack();
    }
  });
}
