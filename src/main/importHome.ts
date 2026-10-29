/**
 * WHY this file exists:
 *   Imports read other browsers' files in the user's home folder. The e2e checks must never read the real ones, so
 *   they start Bow with `--import-home=<folder>`: a made-up home with made-up browser data
 *   (e2e/fixtures/importHome.mjs). Like --skip-welcome and --github-origin, only whoever starts the app can pass it.
 *   Electron on macOS keeps the real home whatever HOME says, so the switch is the way in.
 *
 * Data source:
 *   The command line, else the user's home folder.
 *
 * Data flow:
 *   browserImportController.ts / arcImportController.ts → getImportHomeFolder() → their paths
 */
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

const IMPORT_HOME_FLAG = "--import-home=";

/**
 * The home folder imports read from: the user's, or the made-up one a test passed (an existing absolute folder).
 */
export function getImportHomeFolder(): string {
  const flag = process.argv.find((argument) => argument.startsWith(IMPORT_HOME_FLAG));
  if (flag === undefined) {
    return app.getPath("home");
  }
  const folder = flag.slice(IMPORT_HOME_FLAG.length);
  const isUsable = path.isAbsolute(folder) && fs.existsSync(folder);
  return isUsable ? folder : app.getPath("home");
}
