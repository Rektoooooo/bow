/**
 * WHY this file exists:
 *   A page can close itself (`window.close()`, as sign-in "you can close this window" pages do). Electron then destroys
 *   its web contents, and the view's `webContents` reads as undefined from then on, although Electron's types say it
 *   is always there. Code that read `view.webContents.isDestroyed()` threw a TypeError in the main process on every
 *   runtime push (2026-11-19, connecting an MCP server to NetSuite). Every read of a view's page that may come after
 *   that goes through here (loops over the tab views, Peek, Little Windows, picture in picture, Bow Passwords).
 *
 * Data source:
 *   A WebContentsView (a tab's, the Peek's or a Little Window's page).
 *
 * Data flow:
 *   view → getLiveContents → its page while it lives, else null
 */
import type { WebContents, WebContentsView } from "electron";

/**
 * The view's page while it lives, or null once it is destroyed (closed by Bow or by the page itself).
 */
export function getLiveContents(view: WebContentsView): WebContents | null {
  // Undefined after destruction, whatever the type says (see the header).
  const contents = view.webContents as WebContents | undefined;
  if (contents === undefined || contents.isDestroyed()) {
    return null;
  }
  return contents;
}
