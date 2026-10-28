/**
 * WHY this file exists:
 *   Asking the user with macOS's own sheets (where to save, which file, a question) over the window they are in, or
 *   on its own when no window is open. Backups and Boost files ask this way.
 *
 * Data source:
 *   The last focused main window (browserCore.ts getWindow) and the options each caller gives.
 *
 * Data flow:
 *   caller → askWhereToSave / askWhichFile / ask → Electron's dialog → the path or button chosen
 */
import { dialog } from "electron";
import type { MessageBoxOptions, OpenDialogOptions, SaveDialogOptions } from "electron";
import { getWindow } from "./browserCore";

/**
 * A save sheet. Null when cancelled.
 */
export async function askWhereToSave(options: SaveDialogOptions): Promise<string | null> {
  const window = getWindow();
  const result = window === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(window, options);
  return result.canceled || result.filePath === undefined ? null : result.filePath;
}

/**
 * An open sheet for one file (or folder, by its options). Null when cancelled.
 */
export async function askWhichFile(options: OpenDialogOptions): Promise<string | null> {
  const window = getWindow();
  const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/**
 * A message or question; returns the index of the button chosen.
 */
export async function ask(options: MessageBoxOptions): Promise<number> {
  const window = getWindow();
  const result = window === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(window, options);
  return result.response;
}
