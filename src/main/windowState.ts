/**
 * WHY this file exists:
 *   Each main window should open where you left it, at the size you left it. Their bounds are saved in a small file
 *   of their own (window-state.json), apart from the browser state, because they change on every drag. The file maps
 *   window ids (BrowserState.focusedWindowId / otherWindows) to rectangles.
 *
 * Data source:
 *   The main windows' bounds, and Electron's screen module to check they still fit a connected display.
 *
 * Data flow:
 *   app start → loadWindowBounds(windowId) → BrowserWindow options
 *   window moved or resized → rememberWindowBounds(windowId, window) → saved a moment later
 *   window closed (not quitting) → forgetWindowBounds(windowId)
 */
import { app, screen } from "electron";
import type { BrowserWindow, Rectangle } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { FIRST_WINDOW_ID } from "../shared/settings";
import type { WindowId } from "../shared/types";

const WINDOW_STATE_FILE_NAME = "window-state.json";

/** Wait this long after the last move or resize before writing. Our choice. */
const SAVE_DELAY_MS = 500;

/** A window must keep at least this much of itself on a display, or it opens at the default place. */
const MIN_VISIBLE_PX = 100;

let saveTimer: NodeJS.Timeout | null = null;

/** The saved bounds by window id; read from the file the first time they are needed. */
let savedBounds: Record<WindowId, Rectangle> | null = null;

/** Windows that moved or resized since the last write. */
const movedWindows = new Map<WindowId, BrowserWindow>();

function getWindowStateFilePath(): string {
  return path.join(app.getPath("userData"), WINDOW_STATE_FILE_NAME);
}

/**
 * True when enough of the rectangle lies on some connected display (a display may have been unplugged).
 */
function isOnSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const overlapWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapHeight = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return overlapWidth >= MIN_VISIBLE_PX && overlapHeight >= MIN_VISIBLE_PX;
  });
}

/**
 * True when a parsed value has the four numbers of a rectangle.
 */
function isRectangle(value: unknown): value is Rectangle {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Rectangle>;
  return [candidate.x, candidate.y, candidate.width, candidate.height].every((number) => typeof number === "number");
}

/**
 * Turns the parsed file into bounds by window id. Before several windows existed it held one rectangle: that one is
 * the first window's.
 */
function toBoundsByWindow(parsedValue: unknown): Record<WindowId, Rectangle> {
  const boundsByWindow: Record<WindowId, Rectangle> = {};
  if (isRectangle(parsedValue)) {
    boundsByWindow[FIRST_WINDOW_ID] = parsedValue;
    return boundsByWindow;
  }
  const entries = typeof parsedValue === "object" && parsedValue !== null ? Object.entries(parsedValue) : [];
  for (const [windowId, bounds] of entries) {
    if (isRectangle(bounds)) {
      boundsByWindow[windowId] = bounds;
    }
  }
  return boundsByWindow;
}

/**
 * Reads the file once; later calls get the copy in memory.
 */
function readSavedBounds(): Record<WindowId, Rectangle> {
  if (savedBounds !== null) {
    return savedBounds;
  }
  try {
    const parsedValue: unknown = JSON.parse(fs.readFileSync(getWindowStateFilePath(), "utf8"));
    savedBounds = toBoundsByWindow(parsedValue);
  } catch {
    // No file yet, or an unreadable one: every window opens at the default place.
    savedBounds = {};
  }
  return savedBounds;
}

/**
 * Returns a window's saved bounds, or null when there are none or they are off every display.
 */
export function loadWindowBounds(windowId: WindowId): Rectangle | null {
  const bounds = readSavedBounds()[windowId];
  if (bounds === undefined || !isOnSomeDisplay(bounds)) {
    return null;
  }
  return bounds;
}

/**
 * Writes every window's bounds shortly after they stop moving or resizing.
 */
function scheduleSave(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const allBounds = readSavedBounds();
    for (const [windowId, window] of movedWindows) {
      if (!window.isDestroyed() && !window.isFullScreen() && !window.isMinimized()) {
        allBounds[windowId] = window.getNormalBounds();
      }
    }
    movedWindows.clear();
    fs.writeFileSync(getWindowStateFilePath(), JSON.stringify(allBounds), "utf8");
  }, SAVE_DELAY_MS);
}

/**
 * Saves a window's bounds shortly after it stops moving or resizing.
 */
export function rememberWindowBounds(windowId: WindowId, window: BrowserWindow): void {
  movedWindows.set(windowId, window);
  scheduleSave();
}

/**
 * Forgets a closed window's bounds (the window will not open again).
 */
export function forgetWindowBounds(windowId: WindowId): void {
  movedWindows.delete(windowId);
  delete readSavedBounds()[windowId];
  scheduleSave();
}
