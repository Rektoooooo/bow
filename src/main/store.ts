/**
 * WHY this file exists:
 *   Spaces, pinned tabs and the archive must survive a restart, like Arc's sidebar does.
 *
 * Data source:
 *   One JSON file, browser-state.json, in Electron's per-user data folder
 *   (on macOS: ~/Library/Application Support/sidebar-browser/).
 *
 * Data flow:
 *   app start → loadState() → upgradeToCurrentVersion() (older files are upgraded) → BrowserState
 *   every change → saveState() → temporary file → renamed over browser-state.json
 */
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BrowserState } from "../shared/types";
import { upgradeToCurrentVersion } from "./migrate";
import { createInitialState } from "./state";

const STATE_FILE_NAME = "browser-state.json";

/** Spaces used to indent the saved JSON, so the file stays readable when you open it by hand. */
const JSON_INDENT_SPACES = 2;

/**
 * Returns the full path of browser-state.json inside Electron's user data folder.
 */
export function getStateFilePath(): string {
  const userDataFolder = app.getPath("userData");
  return path.join(userDataFolder, STATE_FILE_NAME);
}

/**
 * Renames an unreadable state file to browser-state.broken-<time>.json, so nothing is lost.
 */
function keepBrokenFile(filePath: string, now: number): void {
  const folder = path.dirname(filePath);
  const brokenFilePath = path.join(folder, `browser-state.broken-${now}.json`);
  fs.renameSync(filePath, brokenFilePath);
  console.warn(`Saved state was unreadable; kept it as ${brokenFilePath} and started fresh.`);
}

/**
 * Reads the saved state, upgrading older versions. Returns a fresh initial state when the file does not exist yet.
 * When the file is unreadable, not valid JSON, or from an unknown version, keeps a copy and starts fresh.
 */
export function loadState(filePath: string, now: number): BrowserState {
  if (!fs.existsSync(filePath)) {
    return createInitialState();
  }

  try {
    const fileText = fs.readFileSync(filePath, "utf8");
    const parsedValue: unknown = JSON.parse(fileText);
    const upgradedState = upgradeToCurrentVersion(parsedValue);
    if (upgradedState !== null) {
      return upgradedState;
    }
  } catch (error) {
    console.warn("Could not read saved state:", error);
  }

  keepBrokenFile(filePath, now);
  return createInitialState();
}

/**
 * Writes the state to disk. Writes to a temporary file first and then renames it,
 * so a crash halfway through never leaves a half-written file.
 */
export function saveState(filePath: string, state: BrowserState): void {
  const temporaryFilePath = `${filePath}.tmp`;
  const fileText = JSON.stringify(state, null, JSON_INDENT_SPACES);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(temporaryFilePath, fileText, "utf8");
  // A rename on the same disk is atomic: readers see the old file or the new one, never half of each.
  fs.renameSync(temporaryFilePath, filePath);
}
