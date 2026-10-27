/**
 * WHY this file exists:
 *   Arc keeps a video playing in a small floating window when you leave its tab. Chromium's own picture-in-picture
 *   window has fixed controls the user did not like, and Document Picture-in-Picture (which would let a page draw its
 *   own) is not in Electron 44. So the window is ours: the tab's own page moves into a small floating window, a style
 *   sheet makes its video fill the page and hides the rest, and our controls page lies on top. The page keeps
 *   playing the whole time, signed in and at the same second, because it is the same page.
 *
 * Data source:
 *   media.ts (a tab with a playing video left the screen, or came back), the tab's page view (tabViews.ts), its
 *   <video> (small scripts in an isolated world: the page's own scripts cannot interfere), the tab in the state, the
 *   cursor's place on screen, and the controls page's IPC messages.
 *
 * Data flow:
 *   media.ts → enterPictureInPicture(tabId) → mark the video, insert the style sheet → floating window: the tab's
 *   view + the controls view (src/pip) above it
 *   every STATUS_INTERVAL_MS → read the video → "pip:status" → controls; every HOVER_INTERVAL_MS → cursor inside? →
 *   "pip:hover"
 *   controls → "pip:command" / "pip:seek" → play / pause, mute, seek, back to the tab, close
 *   the tab is shown in a main window again (syncTabViews took the view back) → media.ts → endPictureInPictureOfTab()
 */
import { app, BaseWindow, ipcMain, screen, WebContentsView } from "electron";
import type { IpcMainInvokeEvent, Rectangle, WebContents } from "electron";
import * as path from "node:path";
import { PIP_CHANNELS, PIP_COMMANDS } from "../shared/pictureInPicture";
import type { PictureInPictureCommand, PictureInPictureStatus } from "../shared/pictureInPicture";
import { CARD_RADIUS_PX } from "../shared/settings";
import type { ItemId } from "../shared/types";
import { applyChange, getState, getWindow } from "./browserCore";
import { selectTab } from "./state";
import { setMuted } from "./tabActions";
import { findWindowShowingTab, getTabViews } from "./tabViews";
import { findTab } from "./tree";

/** The window's width the first time, and its smallest. Our choice: about a fifth of a laptop screen, like Chromium's. */
const DEFAULT_WIDTH_PX = 400;
const MIN_WIDTH_PX = 240;

/** Distance from the screen's corner the first time. Our choice. */
const SCREEN_MARGIN_PX = 16;

/** The shape before the video knows its size (audio-only, still loading). */
const FALLBACK_ASPECT_RATIO = 16 / 9;

/** A video whose shape differs from the window's by less than this keeps the window as it is. Our choice. */
const ASPECT_RATIO_TOLERANCE = 0.01;

/** How often the controls learn where the video is, and how often the cursor is checked. Our choice. */
const STATUS_INTERVAL_MS = 500;
const HOVER_INTERVAL_MS = 100;

/** A world of our own inside the page: shares the page's DOM, not its JavaScript (media.ts uses 1031). */
const PIP_SCRIPT_WORLD_ID = 1032;

const WINDOW_TITLE = "Picture in Picture";

/**
 * Marks the first playing video with sound, and the elements around it, so the style sheet can find them. Muted
 * videos (the silent previews many sites autoplay) are left alone, like Arc does. Kept as source text, because it
 * runs inside the page.
 */
const MARK_PLAYING_VIDEO_FUNCTION = `function markPlayingVideo() {
  const videos = Array.from(document.querySelectorAll("video"));
  const playingVideo = videos.find((video) => !video.paused && !video.ended && !video.muted && video.volume > 0);
  if (playingVideo === undefined) {
    return null;
  }
  document.documentElement.setAttribute("data-sidebar-browser-pip", "page");
  playingVideo.setAttribute("data-sidebar-browser-pip", "video");
  for (let element = playingVideo.parentElement; element !== null && element !== document.body; element = element.parentElement) {
    element.setAttribute("data-sidebar-browser-pip", "around");
  }
  return playingVideo;
}`;

/** Finds the marked video (marking a playing one when the page replaced it). */
const FIND_VIDEO_FUNCTION = `function findVideo() {
  return document.querySelector('video[data-sidebar-browser-pip="video"]') ?? markPlayingVideo();
}`;

/** Marks the playing video and resolves to its size, or null when no video plays with sound. */
const MARK_SCRIPT = `(() => {
  ${MARK_PLAYING_VIDEO_FUNCTION}
  const video = markPlayingVideo();
  return video === null ? null : { width: video.videoWidth, height: video.videoHeight };
})()`;

/** Resolves to the video's play state, time and size, or null. */
const READ_SCRIPT = `(() => {
  ${MARK_PLAYING_VIDEO_FUNCTION}
  ${FIND_VIDEO_FUNCTION}
  const video = findVideo();
  if (video === null) {
    return null;
  }
  return { isPaused: video.paused, currentTime: video.currentTime, duration: video.duration, width: video.videoWidth, height: video.videoHeight };
})()`;

/** Plays the video when it is paused, pauses it when it plays. */
const TOGGLE_SCRIPT = `(() => {
  ${MARK_PLAYING_VIDEO_FUNCTION}
  ${FIND_VIDEO_FUNCTION}
  const video = findVideo();
  if (video !== null && video.paused) {
    video.play();
  } else if (video !== null) {
    video.pause();
  }
  return true;
})()`;

/** Takes the marks off again; with pause, also pauses the video (the close button, like Chromium's). */
function buildUnmarkScript(pausesVideo: boolean): string {
  return `(() => {
    const video = document.querySelector('video[data-sidebar-browser-pip="video"]');
    if (${pausesVideo} && video !== null) {
      video.pause();
    }
    document.querySelectorAll("[data-sidebar-browser-pip]").forEach((element) => element.removeAttribute("data-sidebar-browser-pip"));
    return true;
  })()`;
}

/** Jumps to a share (0…1) of the video. The share was checked to be a number in that range. */
function buildSeekScript(fraction: number): string {
  return `(() => {
    const video = document.querySelector('video[data-sidebar-browser-pip="video"]');
    if (video !== null && Number.isFinite(video.duration)) {
      video.currentTime = video.duration * ${fraction};
    }
    return true;
  })()`;
}

/**
 * Makes the marked video fill the page and hides everything else. !important wins over the sizes sites set on their
 * video element (YouTube sets width and height inline). A fixed position only escapes its container when nothing
 * around it transforms, filters, clips or contains it, so those are switched off there. Hidden elements cannot hide
 * a child that is visible again, so the video alone becomes visible. Every rule needs the page's mark, so taking the
 * marks off turns the sheet off too. It is an author style sheet: Electron removes only those (removeInsertedCSS).
 */
const FILL_WITH_VIDEO_CSS = `
html[data-sidebar-browser-pip="page"] * { visibility: hidden !important; }
html[data-sidebar-browser-pip="page"], html[data-sidebar-browser-pip="page"] body { overflow: hidden !important; background: #000 !important; }
[data-sidebar-browser-pip="around"] {
  transform: none !important; filter: none !important; backdrop-filter: none !important; perspective: none !important;
  will-change: auto !important; contain: none !important; clip-path: none !important; mask: none !important;
  overflow: visible !important; opacity: 1 !important;
}
video[data-sidebar-browser-pip="video"] {
  visibility: visible !important; position: fixed !important; inset: 0 !important;
  width: 100vw !important; height: 100vh !important; min-width: 0 !important; min-height: 0 !important;
  max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important;
  border: 0 !important; transform: none !important; object-fit: contain !important; background: #000 !important;
  z-index: 2147483647 !important;
}`;

/** The picture-in-picture window that is open. */
interface OpenPictureInPicture {
  tabId: ItemId;
  window: BaseWindow;
  pageView: WebContentsView;
  controlsView: WebContentsView;
  cssKey: string;
  aspectRatio: number;
  isHovered: boolean;
  statusTimer: NodeJS.Timeout;
  hoverTimer: NodeJS.Timeout;
  /** Stops listening to the page (it outlives the window). */
  stopWatchingPage: () => void;
}

/** One window at a time, like Chromium's. */
let current: OpenPictureInPicture | null = null;

/** Where the window was when it last closed, so the next one opens there (this run only). */
let lastBounds: Rectangle | null = null;

/** What the video scripts report. */
interface VideoSize {
  width: number;
  height: number;
}

interface VideoReading extends VideoSize {
  isPaused: boolean;
  currentTime: number;
  duration: number;
}

/**
 * Runs one of the scripts above in the page's isolated world. User gesture is set, because browsers only allow
 * play() after one. Resolves to null when the page is gone or the script failed.
 */
async function runScript(contents: WebContents, script: string): Promise<unknown> {
  if (contents.isDestroyed()) {
    return null;
  }
  try {
    return await contents.executeJavaScriptInIsolatedWorld(PIP_SCRIPT_WORLD_ID, [{ code: script }], true);
  } catch {
    return null;
  }
}

function isVideoSize(value: unknown): value is VideoSize {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const size = value as Partial<VideoSize>;
  return typeof size.width === "number" && typeof size.height === "number";
}

function isVideoReading(value: unknown): value is VideoReading {
  if (!isVideoSize(value)) {
    return false;
  }
  const reading = value as Partial<VideoReading>;
  return typeof reading.isPaused === "boolean" && typeof reading.currentTime === "number" && typeof reading.duration === "number";
}

/**
 * The video's width divided by its height, or the fallback while it does not know its size.
 */
function computeAspectRatio(size: VideoSize): number {
  if (size.width <= 0 || size.height <= 0) {
    return FALLBACK_ASPECT_RATIO;
  }
  return size.width / size.height;
}

/**
 * Where a new window goes: where the last one was (with its width), else the bottom-right corner of the screen the
 * main window is on.
 */
function computeOpeningBounds(aspectRatio: number): Rectangle {
  const width = lastBounds?.width ?? DEFAULT_WIDTH_PX;
  const height = Math.round(width / aspectRatio);
  if (lastBounds !== null) {
    return { x: lastBounds.x, y: lastBounds.y, width: width, height: height };
  }
  const mainWindow = getWindow();
  const display = mainWindow === null ? screen.getPrimaryDisplay() : screen.getDisplayMatching(mainWindow.getBounds());
  const area = display.workArea;
  return {
    x: area.x + area.width - width - SCREEN_MARGIN_PX,
    y: area.y + area.height - height - SCREEN_MARGIN_PX,
    width: width,
    height: height,
  };
}

/**
 * Both views fill the window: the page below, the controls above.
 */
function layoutViews(pip: OpenPictureInPicture): void {
  const contentSize = pip.window.getContentSize();
  const bounds = { x: 0, y: 0, width: contentSize[0] ?? 0, height: contentSize[1] ?? 0 };
  pip.pageView.setBounds(bounds);
  pip.controlsView.setBounds(bounds);
}

/**
 * Gives the window the video's shape, keeping its width. Videos that only learn their size after a moment (and
 * playlists whose next video is narrower) change it.
 */
function applyAspectRatio(pip: OpenPictureInPicture, aspectRatio: number): void {
  if (Math.abs(aspectRatio - pip.aspectRatio) < ASPECT_RATIO_TOLERANCE) {
    return;
  }
  pip.aspectRatio = aspectRatio;
  pip.window.setAspectRatio(aspectRatio);
  const bounds = pip.window.getBounds();
  pip.window.setBounds({ ...bounds, height: Math.round(bounds.width / aspectRatio) });
}

/**
 * Reads the video and tells the controls what to show.
 */
async function sendStatus(pip: OpenPictureInPicture): Promise<void> {
  const reading = await runScript(pip.pageView.webContents, READ_SCRIPT);
  const tab = findTab(getState(), pip.tabId);
  if (current !== pip || tab === undefined || pip.controlsView.webContents.isDestroyed()) {
    return;
  }
  const hasVideo = isVideoReading(reading);
  const status: PictureInPictureStatus = {
    title: tab.customTitle ?? tab.title,
    faviconUrl: tab.faviconUrl,
    isPaused: hasVideo ? reading.isPaused : true,
    isMuted: tab.isMuted,
    currentTime: hasVideo ? reading.currentTime : 0,
    duration: hasVideo && Number.isFinite(reading.duration) ? reading.duration : null,
  };
  pip.controlsView.webContents.send(PIP_CHANNELS.status, status);
  if (hasVideo && reading.width > 0) {
    applyAspectRatio(pip, computeAspectRatio(reading));
  }
}

/**
 * The controls show while the cursor is over the window. Asked of the screen, because the window is moved by its
 * background (a drag region), and pages hear no pointer events there.
 */
function checkHover(pip: OpenPictureInPicture): void {
  if (pip.window.isDestroyed() || pip.controlsView.webContents.isDestroyed()) {
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  const bounds = pip.window.getBounds();
  const isInsideX = cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width;
  const isInsideY = cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height;
  const isHovered = isInsideX && isInsideY;
  if (isHovered === pip.isHovered) {
    return;
  }
  pip.isHovered = isHovered;
  pip.controlsView.webContents.send(PIP_CHANNELS.hover, isHovered);
}

/**
 * Creates the controls view: our own sandboxed page with its own preload, see-through, that never navigates.
 */
function createControlsView(): WebContentsView {
  const preloadPath = path.join(__dirname, "..", "preload", "pipPreload.js");
  const controlsView = new WebContentsView({
    webPreferences: { preload: preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  controlsView.setBackgroundColor("#00000000");
  controlsView.webContents.on("will-navigate", (event) => event.preventDefault());
  controlsView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  controlsView.webContents.loadFile(path.join(__dirname, "..", "..", "web", "pip", "pip.html"));
  return controlsView;
}

/**
 * Creates the floating window: frameless with the system's rounded corners and shadow, above other apps' windows
 * (also full-screen ones) and on every Space, and never taking the focus from the main window.
 */
function createWindow(bounds: Rectangle, aspectRatio: number): BaseWindow {
  const window = new BaseWindow({
    ...bounds,
    minWidth: MIN_WIDTH_PX,
    minHeight: Math.round(MIN_WIDTH_PX / aspectRatio),
    title: WINDOW_TITLE,
    show: false,
    frame: false,
    type: "panel",
    focusable: false,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: "#000000",
  });
  window.setAlwaysOnTop(true, "floating");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setAspectRatio(aspectRatio);
  return window;
}

/**
 * Puts the window away: the page goes back to being an off-screen tab (unless a main window already took it), its
 * video loses the style sheet and the marks, and pauses when asked (the close button).
 */
function closePictureInPicture(pausesVideo: boolean): void {
  const pip = current;
  if (pip === null) {
    return;
  }
  current = null;
  clearInterval(pip.statusTimer);
  clearInterval(pip.hoverTimer);
  pip.stopWatchingPage();
  const contents = pip.pageView.webContents;
  if (!pip.window.isDestroyed()) {
    lastBounds = pip.window.getBounds();
    if (pip.window.contentView.children.includes(pip.pageView)) {
      pip.window.contentView.removeChildView(pip.pageView);
    }
  }
  if (!contents.isDestroyed()) {
    pip.pageView.setBorderRadius(CARD_RADIUS_PX);
    contents.removeInsertedCSS(pip.cssKey).catch(() => undefined);
    runScript(contents, buildUnmarkScript(pausesVideo));
  }
  if (!pip.controlsView.webContents.isDestroyed()) {
    pip.controlsView.webContents.close();
  }
  if (!pip.window.isDestroyed()) {
    pip.window.close();
  }
}

/**
 * Called when a tab left the screen: when its page plays a video with sound, the video continues in our floating
 * window (a window that is already open for another tab gives way, and its video pauses).
 */
export async function enterPictureInPicture(tabId: ItemId): Promise<void> {
  const pageView = getTabViews().get(tabId);
  if (pageView === undefined || pageView.webContents.isDestroyed() || current?.tabId === tabId) {
    return;
  }
  const contents = pageView.webContents;
  const videoSize = await runScript(contents, MARK_SCRIPT);
  if (!isVideoSize(videoSize)) {
    return;
  }
  const cssKey = await contents.insertCSS(FILL_WITH_VIDEO_CSS).catch(() => null);
  // The tab may have come back on screen (or closed) while the page answered: then a main window has its view.
  const isStillOffScreen = findWindowShowingTab(tabId) === null && getTabViews().get(tabId) === pageView && !contents.isDestroyed();
  if (cssKey === null || !isStillOffScreen || current?.tabId === tabId) {
    if (cssKey !== null) {
      contents.removeInsertedCSS(cssKey).catch(() => undefined);
    }
    runScript(contents, buildUnmarkScript(false));
    return;
  }
  closePictureInPicture(true);

  const aspectRatio = computeAspectRatio(videoSize);
  const window = createWindow(computeOpeningBounds(aspectRatio), aspectRatio);
  const controlsView = createControlsView();
  // The window's own corners round the page; a radius of its own would leave a gap there.
  pageView.setBorderRadius(0);
  window.contentView.addChildView(pageView);
  window.contentView.addChildView(controlsView);

  // The tab was closed, or its page replaced, or a new document dropped the style sheet: nothing is left to show.
  const endWithPage = (): void => {
    if (current === pip) {
      closePictureInPicture(false);
    }
  };
  const pip: OpenPictureInPicture = {
    tabId: tabId,
    window: window,
    pageView: pageView,
    controlsView: controlsView,
    cssKey: cssKey,
    aspectRatio: aspectRatio,
    isHovered: false,
    statusTimer: setInterval(() => sendStatus(pip), STATUS_INTERVAL_MS),
    hoverTimer: setInterval(() => checkHover(pip), HOVER_INTERVAL_MS),
    stopWatchingPage: () => {
      contents.off("destroyed", endWithPage);
      contents.off("did-navigate", endWithPage);
    },
  };
  current = pip;
  layoutViews(pip);
  window.on("resize", () => layoutViews(pip));
  // Closed some other way (the app quits): the page must leave first, or it would close with the window.
  window.on("close", () => {
    if (current === pip) {
      closePictureInPicture(false);
    }
  });
  contents.on("destroyed", endWithPage);
  contents.on("did-navigate", endWithPage);
  controlsView.webContents.once("did-finish-load", () => sendStatus(pip));
  window.showInactive();
}

/**
 * The tab whose video is in the window, or null (auto-archive leaves it alone: activity.ts).
 */
export function getPictureInPictureTabId(): ItemId | null {
  return current?.tabId ?? null;
}

/**
 * Called for each tab that is on screen again: when its video was in the window, the window goes (the main window
 * already took the page view back) and the video stays playing in the page.
 */
export function endPictureInPictureOfTab(tabId: ItemId): void {
  if (current?.tabId === tabId) {
    closePictureInPicture(false);
  }
}

/**
 * "Back to tab": selects the tab in the last focused main window and brings that window forward. Showing the tab
 * there ends picture-in-picture (endPictureInPictureOfTab) with the video still playing.
 */
function returnToTab(pip: OpenPictureInPicture): void {
  const mainWindow = getWindow();
  if (mainWindow === null) {
    closePictureInPicture(false);
    return;
  }
  applyChange((state) => selectTab(state, pip.tabId, Date.now()));
  // The tab could not be shown (it is gone from the sidebar): the window must not stay open on its own.
  if (current === pip) {
    closePictureInPicture(false);
  }
  app.focus({ steal: true });
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Runs one of the controls' buttons.
 */
async function runCommand(pip: OpenPictureInPicture, command: PictureInPictureCommand): Promise<void> {
  if (command === "backToTab") {
    returnToTab(pip);
    return;
  }
  if (command === "close") {
    closePictureInPicture(true);
    return;
  }
  if (command === "toggleMute") {
    const tab = findTab(getState(), pip.tabId);
    if (tab !== undefined) {
      setMuted(pip.tabId, !tab.isMuted);
    }
  } else {
    await runScript(pip.pageView.webContents, TOGGLE_SCRIPT);
  }
  await sendStatus(pip);
}

/**
 * The open window whose controls page sent a message, or null for any other sender.
 */
function findSender(event: IpcMainInvokeEvent): OpenPictureInPicture | null {
  if (current === null || current.controlsView.webContents.isDestroyed() || event.sender !== current.controlsView.webContents) {
    return null;
  }
  return current;
}

function isCommand(value: unknown): value is PictureInPictureCommand {
  return typeof value === "string" && (PIP_COMMANDS as readonly string[]).includes(value);
}

/**
 * Registers the controls page's IPC handlers. Messages from anything but the open window's controls are ignored.
 */
export function registerPictureInPictureIpc(): void {
  ipcMain.handle(PIP_CHANNELS.command, async (event, command: unknown) => {
    const pip = findSender(event);
    if (pip !== null && isCommand(command)) {
      await runCommand(pip, command);
    }
  });
  ipcMain.handle(PIP_CHANNELS.seek, async (event, fraction: unknown) => {
    const pip = findSender(event);
    const isShare = typeof fraction === "number" && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1;
    if (pip === null || !isShare) {
      return;
    }
    await runScript(pip.pageView.webContents, buildSeekScript(fraction));
    await sendStatus(pip);
  });
}
