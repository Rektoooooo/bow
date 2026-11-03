/**
 * WHY this file exists:
 *   Bow Passwords (the list under a field, filling, the save offer, form memory) serves more than tabs: a Peek, a
 *   Little Window and a sign-in popup are pages too, and the user signs in there (Claude in a Little Window opened from
 *   another app, "Sign in with Google" in a popup). Each such page lives in a different place (a view in a main
 *   window, a view in a Little Window, a window of its own), so the list needs to ask one question of all of them:
 *   "which window holds you, and which area of it is your page?". This registry answers it. Only pages registered
 *   here (or tabs, which tabViews.ts already knows) may talk to Bow Passwords; everything else is refused by the
 *   forms bridge. A private window's page is registered like any other, but its in-memory session still keeps the
 *   forms helper out of it (formsBridge.ts registerFormsHelper).
 *
 * Data source:
 *   peek.ts (on open and close), littleWindow.ts (on create and close) and windowOpenRule.ts (a popup, on its
 *   opener's did-create-window) register their pages; tabs are read from tabViews.ts when asked.
 *
 * Data flow:
 *   registerPageHost() → findPageHost(contents) → formsBridge.ts (who sent the message), autofillPopup.ts (where the
 *   list goes), passwordOffers.ts (where the question is asked)
 *   findPageHostByKey(key) → formsBridge.ts fillLogin / fillValue (the page that reported the field)
 *   an entry goes when its page is destroyed
 */
import type { BrowserWindow, WebContents } from "electron";
import type { ItemId } from "../shared/types";
import type { PlacementBox } from "./autofillPlacement";
import { getWindow } from "./browserCore";
import { findTabIdOfContents, getTabViews } from "./tabViews";

/** The kinds of page Bow Passwords serves. */
export type PageKind = "tab" | "peek" | "littleWindow" | "popup";

/** A page Bow Passwords may serve, and where it is. */
export interface PageHost {
  /** Names the page in Bow Passwords' own maps: the tab's id for a tab, "page-<web contents id>" for the others. */
  key: string;
  kind: PageKind;
  contents: WebContents;
  /** The tab's id; null for every other kind. */
  tabId: ItemId | null;
  /** The window that holds the page (a tab's: the last focused main window); null when it is gone. */
  window: BrowserWindow | null;
  /** The page's area in the window's content, in window coordinates; null while the page is not on screen. */
  getArea: () => PlacementBox | null;
  /** The page that opened this popup (a popup only). */
  opener: PageHost | null;
}

/** What a Peek, a Little Window or a popup gives when it registers. */
export interface PageHostDetails {
  kind: "peek" | "littleWindow" | "popup";
  contents: WebContents;
  window: BrowserWindow;
  getArea: () => PlacementBox | null;
  opener?: PageHost;
}

/** Registered pages by web contents id. */
const registeredHosts = new Map<number, PageHost>();

/**
 * Registers a Peek, a Little Window or a popup. The entry goes by itself when the page is destroyed.
 */
export function registerPageHost(details: PageHostDetails): PageHost {
  const contents = details.contents;
  const contentsId = contents.id;
  const host: PageHost = {
    key: `page-${contentsId}`,
    kind: details.kind,
    contents: contents,
    tabId: null,
    window: details.window,
    getArea: details.getArea,
    opener: details.opener ?? null,
  };
  registeredHosts.set(contentsId, host);
  contents.once("destroyed", () => {
    registeredHosts.delete(contentsId);
  });
  return host;
}

/** Takes a page out of the registry (a Peek that becomes a tab is found as a tab from then on). */
export function unregisterPageHost(contents: WebContents): void {
  registeredHosts.delete(contents.id);
}

function makeTabHost(tabId: ItemId, contents: WebContents): PageHost {
  return {
    key: tabId,
    kind: "tab",
    contents: contents,
    tabId: tabId,
    window: getWindow(),
    getArea: () => getTabViews().get(tabId)?.getBounds() ?? null,
    opener: null,
  };
}

/** The page these web contents are, or null when Bow Passwords does not serve them. */
export function findPageHost(contents: WebContents): PageHost | null {
  const tabId = findTabIdOfContents(contents);
  if (tabId !== null) {
    return makeTabHost(tabId, contents);
  }
  return registeredHosts.get(contents.id) ?? null;
}

/** The page with this key (see PageHost.key), or null when it is gone. */
export function findPageHostByKey(key: string): PageHost | null {
  const tabView = getTabViews().get(key);
  if (tabView !== undefined) {
    return tabView.webContents.isDestroyed() ? null : makeTabHost(key, tabView.webContents);
  }
  for (const host of registeredHosts.values()) {
    if (host.key === key && !host.contents.isDestroyed()) {
      return host;
    }
  }
  return null;
}

/** True while the page can still be shown to the user. */
export function isPageHostAlive(host: PageHost): boolean {
  if (host.kind === "tab") {
    return findPageHostByKey(host.key) !== null;
  }
  return !host.contents.isDestroyed();
}

/** The page a popup's sign-in belongs to: the first page up the opener chain that is not a popup itself. */
export function findHomeHost(host: PageHost): PageHost {
  let current = host;
  while (current.kind === "popup" && current.opener !== null) {
    current = current.opener;
  }
  return current;
}
