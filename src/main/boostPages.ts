/**
 * WHY this file exists:
 *   Puts Boosts into pages: the site's CSS (and the rule hiding zapped elements) is inserted when a page loads and
 *   replaced whenever the Boost changes. It also runs Zap mode: an outline follows the pointer, and each click hides
 *   that element for good (its selector is added to the Boost); Escape ends zapping.
 *
 * Data source:
 *   The state's Boosts (boosts.ts) and the tabs' pages (tabViews.ts). The zap script runs in an isolated world, so the
 *   page's own scripts cannot see or change it; it shares the page's DOM.
 *
 * Data flow:
 *   page "dom-ready" → applyBoostToPage() → insertCSS
 *   Boost changed → reapplyBoostsToAllPages()
 *   site controls "Zap" → zapElements() → script resolves a selector per click → onZapped(selector) → state
 */
import type { WebContents } from "electron";
import type { BrowserState, ItemId } from "../shared/types";
import { buildBoostCss, findBoostForUrl, getBoostJavaScript } from "./boosts";
import { getTabContents, getTabViews } from "./tabViews";

/** An isolated world of our own inside the page (any number above 0; media.ts uses another). */
const ZAP_WORLD_ID = 1032;

/** The isolated world a Boost's JavaScript runs in: it sees the page's DOM, not the page's own scripts. */
const BOOST_SCRIPT_WORLD_ID = 1033;

/**
 * Waits for one click on the page and resolves to a CSS selector for the clicked element (null on Escape).
 * While waiting, a red outline shows which element would be zapped. The selector is our own: a unique id when there
 * is one, otherwise the shortest path of tag names, stable class names and positions that matches only that element.
 */
const ZAP_SCRIPT = `new Promise((resolve) => {
  const outline = document.createElement("div");
  Object.assign(outline.style, {
    position: "fixed", zIndex: "2147483647", pointerEvents: "none", border: "2px solid #ff5a5f",
    background: "rgba(255, 90, 95, 0.15)", borderRadius: "4px", left: "0px", top: "0px", width: "0px", height: "0px",
  });
  document.documentElement.appendChild(outline);
  let current = null;
  const isUnique = (selector) => { try { return document.querySelectorAll(selector).length === 1; } catch { return false; } };
  const describe = (element) => {
    let part = element.tagName.toLowerCase();
    const stableClasses = Array.from(element.classList).filter((name) => !/\\d/.test(name)).slice(0, 2);
    if (stableClasses.length > 0) part += "." + stableClasses.map((name) => CSS.escape(name)).join(".");
    const parent = element.parentElement;
    if (parent !== null) {
      const sameTag = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
      if (sameTag.length > 1) part += ":nth-of-type(" + (sameTag.indexOf(element) + 1) + ")";
    }
    return part;
  };
  const buildSelector = (element) => {
    if (element.id !== "" && isUnique("#" + CSS.escape(element.id))) return "#" + CSS.escape(element.id);
    const parts = [];
    let node = element;
    while (node !== null && node !== document.documentElement && node !== document.body) {
      parts.unshift(describe(node));
      const selector = parts.join(" > ");
      if (isUnique(selector)) return selector;
      node = node.parentElement;
    }
    return "body > " + parts.join(" > ");
  };
  const finish = (value) => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    outline.remove();
    resolve(value);
  };
  const onMove = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    current = target;
    const box = target.getBoundingClientRect();
    Object.assign(outline.style, { left: box.left + "px", top: box.top + "px", width: box.width + "px", height: box.height + "px" });
  };
  const onClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.target instanceof Element ? event.target : current;
    if (target !== null) finish(buildSelector(target));
  };
  const onKey = (event) => {
    if (event.key === "Escape") { event.preventDefault(); finish(null); }
  };
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
})`;

/** The keys of the CSS we inserted into each page (by WebContents id), so all of it can be replaced. */
const insertedCssKeys = new Map<number, string[]>();

/**
 * The newest pending update per page. Updates for one page run one after another: two updates running at once
 * would each insert CSS while only one key is remembered, leaving CSS behind that could never be removed.
 */
const pendingUpdates = new Map<number, Promise<void>>();

/** The tab being zapped, so a second Zap does not start a second loop. */
let zappingTabId: ItemId | null = null;

/**
 * Removes every piece of CSS we inserted into a page, then inserts the page's current Boost CSS.
 */
async function replaceBoostCss(contents: WebContents, state: BrowserState): Promise<void> {
  if (contents.isDestroyed()) {
    return;
  }
  const previousKeys = insertedCssKeys.get(contents.id) ?? [];
  insertedCssKeys.set(contents.id, []);
  for (const key of previousKeys) {
    // After a navigation the old CSS is already gone and removing it fails; that is fine.
    await contents.removeInsertedCSS(key).catch(() => undefined);
  }
  const boost = findBoostForUrl(state, contents.getURL());
  const css = boost === undefined ? "" : buildBoostCss(boost);
  if (css === "" || contents.isDestroyed()) {
    return;
  }
  // Author origin (the default): in Electron 44, CSS inserted with cssOrigin "user" cannot be removed again.
  const key = await contents.insertCSS(css);
  insertedCssKeys.get(contents.id)?.push(key);
}

/**
 * Puts the page's Boost CSS into it, replacing what we inserted before. Waits for any update already running for
 * the same page.
 */
export function applyBoostToPage(contents: WebContents, state: BrowserState): Promise<void> {
  const previousUpdate = pendingUpdates.get(contents.id) ?? Promise.resolve();
  const update = previousUpdate.then(() => replaceBoostCss(contents, state)).catch(() => undefined);
  pendingUpdates.set(contents.id, update);
  return update;
}

/**
 * Runs the site's Boost JavaScript in a page that has just loaded, when the user switched it on. It runs in an
 * isolated world, like an extension's content script, so it cannot reach the page's own variables.
 */
export function runBoostJavaScript(contents: WebContents, state: BrowserState): void {
  const boost = findBoostForUrl(state, contents.getURL());
  const javascript = boost === undefined ? "" : getBoostJavaScript(boost);
  if (javascript === "" || contents.isDestroyed()) {
    return;
  }
  contents.executeJavaScriptInIsolatedWorld(BOOST_SCRIPT_WORLD_ID, [{ code: javascript }]).catch((error) => {
    console.warn("A Boost's JavaScript failed:", error);
  });
}

/**
 * Re-applies Boosts to every loaded tab, after a Boost changed.
 */
export function reapplyBoostsToAllPages(state: BrowserState): void {
  for (const view of getTabViews().values()) {
    applyBoostToPage(view.webContents, state).catch(() => undefined);
  }
}

/**
 * Zap mode on a tab: every click hides the clicked element (onZapped stores its selector), until Escape.
 */
export async function zapElements(tabId: ItemId, onZapped: (selector: string) => void): Promise<void> {
  if (zappingTabId !== null) {
    return;
  }
  zappingTabId = tabId;
  try {
    // The page needs the keyboard so Escape reaches the zap script.
    getTabContents(tabId)?.focus();
    for (;;) {
      const contents = getTabContents(tabId);
      if (contents === null) {
        return;
      }
      const selector: unknown = await contents.executeJavaScriptInIsolatedWorld(ZAP_WORLD_ID, [{ code: ZAP_SCRIPT }], true);
      if (typeof selector !== "string") {
        return;
      }
      onZapped(selector);
    }
  } catch {
    // The page navigated or closed while zapping.
  } finally {
    zappingTabId = null;
  }
}
