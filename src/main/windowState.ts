/**
 * WHY this file exists:
 *   The window should open where you left it, at the size you left it. Its bounds are saved in a small file of
 *   their own (window-state.json), apart from the browser state, because they change on every drag.
 *
 * Data source:
 *   The main window's bounds, and Electron's screen module to check they still fit a connected display.
 *
 * Data flow:
 *   app start → loadWindowBounds() → BrowserWindow options
 *   window moved or resized → rememberWindowBounds(window) → saved a moment later
 */
import { app, screen } from "electron";
import type { BrowserWindow, Rectangle } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

const WINDOW_STATE_FILE_NAME = "window-state.json";

/** Wait this long after the last move or resize before writing. Our choice. */
const SAVE_DELAY_MS = 500;

/** A window must keep at least this much of itself on a display, or it opens at the default place. */
const MIN_VISIBLE_PX = 100;

let saveTimer: NodeJS.Timeout | null = null;

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
 * Returns the saved bounds, or null when there are none, they are unreadable or off every display.
 */
export function loadWindowBounds(): Rectangle | null {
  try {
    const parsedValue: unknown = JSON.parse(fs.readFileSync(getWindowStateFilePath(), "utf8"));
    const candidate = parsedValue as Partial<Rectangle>;
    const isRectangle = [candidate.x, candidate.y, candidate.width, candidate.height].every((value) => typeof value === "number");
    if (!isRectangle || !isOnSomeDisplay(candidate as Rectangle)) {
      return null;
    }
    return candidate as Rectangle;
  } catch {
    return null;
  }
}

/**
 * Saves the window's bounds shortly after it stops moving or resizing.
 */
export function rememberWindowBounds(window: BrowserWindow): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (window.isDestroyed() || window.isFullScreen() || window.isMinimized()) {
      return;
    }
    fs.writeFileSync(getWindowStateFilePath(), JSON.stringify(window.getNormalBounds()), "utf8");
  }, SAVE_DELAY_MS);
}
