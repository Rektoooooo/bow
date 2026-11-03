/**
 * WHY this file exists:
 *   A page stuck in a loop used to hang with no word from the browser. When Chromium calls a tab's page
 *   unresponsive, the tab's window shows a native sheet, "<page> isn't responding", with Wait and Close Page. The
 *   sheet goes away by itself when the page answers again. Close Page ends the page's process on purpose, so the
 *   crashed-tab page (with Reload) shows, like after any crash.
 *
 * Data source:
 *   A tab page's "unresponsive" and "responsive" events (tabViews.ts calls watchResponsiveness for each page).
 *
 * Data flow:
 *   "unresponsive" → showSheet() → dialog.showMessageBox(window, …, signal) → Wait: nothing; Close Page:
 *   forcefullyCrashRenderer() → render-process-gone → tabViews.ts loads the crashed-tab page.
 *   "responsive" (or the page going away) → the sheet's AbortController closes the sheet.
 */
import { dialog } from "electron";
import type { WebContents } from "electron";
import type { ItemId } from "../shared/types";
import { findMainWindowShowingTab } from "./browserCore";

/** The sheet's buttons, in the order they appear; Wait is the default and what Escape does. */
const WAIT_BUTTON_INDEX = 0;
const CLOSE_PAGE_BUTTON_INDEX = 1;

/** A title longer than this is cut in the sheet's headline. Our choice. */
const TITLE_DISPLAY_LIMIT = 60;

/** The open sheet of each page (by WebContents id): at most one per page. */
const openSheets = new Map<number, AbortController>();

/**
 * Starts listening to one tab's page. Called once per page view.
 */
export function watchResponsiveness(tabId: ItemId, contents: WebContents): void {
  contents.on("unresponsive", () => showSheet(tabId, contents));
  contents.on("responsive", () => closeSheet(contents.id));
  contents.once("destroyed", () => closeSheet(contents.id));
}

function closeSheet(contentsId: number): void {
  const controller = openSheets.get(contentsId);
  if (controller === undefined) {
    return;
  }
  openSheets.delete(contentsId);
  controller.abort();
}

/**
 * Asks about a page that stopped responding. A page not on screen has no window to put a sheet on: it is left alone.
 */
function showSheet(tabId: ItemId, contents: WebContents): void {
  const window = findMainWindowShowingTab(tabId);
  if (openSheets.has(contents.id) || window === null) {
    return;
  }
  const controller = new AbortController();
  openSheets.set(contents.id, controller);
  const title = contents.getTitle() === "" ? contents.getURL() : contents.getTitle();
  const shortTitle = title.length > TITLE_DISPLAY_LIMIT ? `${title.slice(0, TITLE_DISPLAY_LIMIT)}…` : title;
  dialog
    .showMessageBox(window, {
      type: "warning",
      message: `${shortTitle} isn't responding`,
      detail: "You can wait for it, or close the page.",
      buttons: ["Wait", "Close Page"],
      defaultId: WAIT_BUTTON_INDEX,
      cancelId: WAIT_BUTTON_INDEX,
      signal: controller.signal,
    })
    .then((answer) => {
      const isSameSheet = openSheets.get(contents.id) === controller;
      if (isSameSheet) {
        openSheets.delete(contents.id);
      }
      // An aborted sheet (the page answered again) must not close anything.
      if (isSameSheet && answer.response === CLOSE_PAGE_BUTTON_INDEX && !contents.isDestroyed()) {
        contents.forcefullyCrashRenderer();
      }
    })
    .catch(() => {
      if (openSheets.get(contents.id) === controller) {
        openSheets.delete(contents.id);
      }
    });
}
