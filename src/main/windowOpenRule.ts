/**
 * WHY this file exists:
 *   A sign-in button ("Continue with Google") opens a small window with window.open(url, name, "width=500,…") and
 *   talks back to the page through window.opener. If Bow turned that into a tab, the opener would be lost and the
 *   sign-in fail. Tabs, Peek and Little Windows all need the same rule for such sized popups, so it lives here once.
 *   Everything else a page opens (a link with target=_blank, a Shift-click) stays each place's own business.
 *
 * Data source:
 *   Electron's window-open details (disposition, features) and the page that asked.
 *
 * Data flow:
 *   page calls window.open → the place's setWindowOpenHandler → chooseSizedPopup() → "allow" with the page's session
 *   → Electron makes the window and tells the opener (did-create-window) → watchPopups() tags it, lists it and
 *   registers it with Bow Passwords (pageHosts.ts) so its sign-in form gets the saved logins
 */
import type { BrowserWindow, HandlerDetails, WebContents, WindowOpenHandlerResponse } from "electron";
import { markLinkView } from "./linkDownloads";
import { findPageHost, registerPageHost } from "./pageHosts";
import type { PlacementBox } from "./autofillPlacement";
import { getPageBackgroundColor } from "./pageColor";

/** A popup window that is open, with the page that opened it. */
export interface OpenPopup {
  window: BrowserWindow;
  openerContents: WebContents;
}

/** The popups that are open now, newest last. */
const openPopups: OpenPopup[] = [];

/** Pages already followed: a Peek that becomes a tab is watched by both, and must not be listed twice. */
const watchedContents = new WeakSet<WebContents>();

/**
 * The popups that are open now. Bow Passwords finds a popup through pageHosts.ts (registered below); its page is in
 * the opener's session, so the forms helper already runs in it.
 */
export function listOpenPopups(): OpenPopup[] {
  return [...openPopups];
}

/**
 * The answer to window.open when it asks for a sized popup (a "new-window" with window features): allowed, as a
 * window in the opener's own session, so window.opener, cookies and postMessage work. Null for anything else; the
 * caller decides what that becomes (a tab, a Peek, the same page).
 */
export function chooseSizedPopup(contents: WebContents, details: HandlerDetails): WindowOpenHandlerResponse | null {
  const isSizedPopup = details.disposition === "new-window" && details.features !== "";
  if (!isSizedPopup) {
    return null;
  }
  return {
    action: "allow",
    overrideBrowserWindowOptions: {
      backgroundColor: getPageBackgroundColor(),
      webPreferences: {
        session: contents.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Electron loads preloads (Bow Passwords' forms helper) in embedded frames only with this; a sandboxed frame
        // still gets no Node.js. Same as the tab views (tabViews.ts createTabView).
        nodeIntegrationInSubFrames: true,
      },
    },
  };
}

/**
 * Lets Bow Passwords serve a popup: its list goes over the popup's own content, and its save offer is asked where the
 * opener lives. A popup whose opener Bow Passwords does not serve gets nothing.
 */
function registerPopupForPasswords(popupWindow: BrowserWindow, openerContents: WebContents): void {
  const openerHost = findPageHost(openerContents);
  if (openerHost === null) {
    return;
  }
  const getArea = (): PlacementBox | null => {
    if (popupWindow.isDestroyed()) {
      return null;
    }
    const [width, height] = popupWindow.getContentSize();
    return { x: 0, y: 0, width: width ?? 0, height: height ?? 0 };
  };
  registerPageHost({ kind: "popup", contents: popupWindow.webContents, window: popupWindow, getArea: getArea, opener: openerHost });
}

/**
 * Follows the popups a page opens: each is listed while it is open, and closes by itself when its first load turns
 * out to be a download (a popup that only fetched a file has nothing to show).
 */
export function watchPopups(openerContents: WebContents): void {
  if (watchedContents.has(openerContents)) {
    return;
  }
  watchedContents.add(openerContents);
  openerContents.on("did-create-window", (popupWindow) => {
    const popup: OpenPopup = { window: popupWindow, openerContents: openerContents };
    openPopups.push(popup);
    markLinkView(popupWindow.webContents, () => popupWindow.close());
    registerPopupForPasswords(popupWindow, openerContents);
    popupWindow.once("closed", () => {
      const index = openPopups.indexOf(popup);
      if (index >= 0) {
        openPopups.splice(index, 1);
      }
    });
  });
}
