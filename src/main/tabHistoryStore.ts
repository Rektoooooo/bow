/**
 * WHY this file exists:
 *   Keeps each tab's back/forward list, scroll position included (tabHistory.ts), in tab-history.json: written every
 *   TAB_HISTORY_SAVE_INTERVAL_MS when it changed, and before Bow quits, read at the next start. After a crash the
 *   pages come back where they were a few seconds before.
 *
 * Data source:
 *   tabViews.ts collectTabHistories(), and <userData>/tab-history.json.
 *
 * Data flow:
 *   start → loadTabHistories() → tabViews.ts setRestoredHistories()
 *   every few seconds, and before quitting → saveTabHistoriesNow() → the file (only when it changed)
 */
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { TAB_HISTORY_SAVE_INTERVAL_MS } from "../shared/settings";
import { getState } from "./browserCore";
import { checkSavedHistories } from "./tabHistory";
import { collectTabHistories, setRestoredHistories } from "./tabViews";

const HISTORY_FILE_NAME = "tab-history.json";

let historyFilePath = "";

/** What the file holds now, to write only when it changes. */
let writtenText = "";

/**
 * Reads the lists an earlier run saved and hands them to the tab views (an unreadable file restores nothing).
 */
export function loadTabHistories(): void {
  historyFilePath = path.join(app.getPath("userData"), HISTORY_FILE_NAME);
  if (!fs.existsSync(historyFilePath)) {
    return;
  }
  try {
    const text = fs.readFileSync(historyFilePath, "utf8");
    setRestoredHistories(checkSavedHistories(JSON.parse(text)));
    writtenText = text;
  } catch (error) {
    console.warn("Could not read the tabs' histories; pages open at their addresses:", error);
  }
}

/**
 * Writes the lists now when they changed, through a temporary file so a crash never leaves half a file.
 */
export function saveTabHistoriesNow(): void {
  if (historyFilePath === "") {
    return;
  }
  const text = JSON.stringify(collectTabHistories(getState()));
  if (text === writtenText) {
    return;
  }
  const temporaryPath = `${historyFilePath}.tmp`;
  fs.writeFileSync(temporaryPath, text, "utf8");
  fs.renameSync(temporaryPath, historyFilePath);
  writtenText = text;
}

/**
 * Saves the lists every TAB_HISTORY_SAVE_INTERVAL_MS from now on.
 */
export function startSavingTabHistories(): void {
  setInterval(() => {
    try {
      saveTabHistoriesNow();
    } catch (error) {
      console.error("Saving the tabs' histories failed:", error);
    }
  }, TAB_HISTORY_SAVE_INTERVAL_MS);
}
