/**
 * WHY this file exists:
 *   Arc's Boosts: per-site changes you make yourself. A Boost holds CSS you wrote and the selectors of elements you
 *   zapped (clicked to remove), and applies to every page of its site. These pure functions find, build and edit them.
 *
 * Data source:
 *   BrowserState.boosts, and page addresses (a Boost matches by site, see urls.ts getSiteKey()).
 *
 * Data flow:
 *   site controls / Command Bar → actions setBoostCss / addZappedSelector / setBoostEnabled / deleteBoost → here
 *   page loads → boostPages.ts → findBoostForUrl() → buildBoostCss() → insertCSS into the page
 */
import type { Boost, BrowserState } from "../shared/types";
import { createId } from "./tree";
import { getSiteKey } from "./urls";

/** Longest CSS a Boost may hold. Our choice: far more than hand-written tweaks need; bounds what a message can store. */
export const MAX_BOOST_CSS_LENGTH = 20000;

/** Most zapped elements per Boost, and the longest selector kept. Our choice. */
export const MAX_ZAPPED_SELECTORS = 100;
export const MAX_SELECTOR_LENGTH = 500;

/**
 * Returns the Boost of the site an address belongs to, or undefined.
 * Example: a Boost for "github.com" matches "https://gist.github.com/x"
 */
export function findBoostForUrl(state: BrowserState, url: string): Boost | undefined {
  const site = getSiteKey(url);
  if (site === null) {
    return undefined;
  }
  return (state.boosts ?? []).find((boost) => boost.site === site);
}

/**
 * Returns the CSS to put into a page: the user's CSS, then a rule hiding every zapped element. Empty when disabled.
 */
export function buildBoostCss(boost: Boost): string {
  if (!boost.isEnabled) {
    return "";
  }
  const parts: string[] = [];
  if (boost.css.trim() !== "") {
    parts.push(boost.css);
  }
  if (boost.zappedSelectors.length > 0) {
    parts.push(`${boost.zappedSelectors.join(",\n")} { display: none !important; }`);
  }
  return parts.join("\n");
}

/**
 * Returns a copy of the state with one site's Boost changed, creating the Boost when the site has none.
 */
function changeBoost(state: BrowserState, site: string, now: number, change: (boost: Boost) => Boost): BrowserState {
  const boosts = state.boosts ?? [];
  const existing = boosts.find((boost) => boost.site === site);
  if (existing === undefined) {
    const created: Boost = change({ id: createId("boost", now), site: site, css: "", zappedSelectors: [], isEnabled: true });
    return { ...state, boosts: [...boosts, created] };
  }
  const changed = change(existing);
  if (changed === existing) {
    return state;
  }
  return { ...state, boosts: boosts.map((boost) => (boost === existing ? changed : boost)) };
}

/**
 * Sets a site's CSS (too long CSS is refused).
 */
export function setBoostCss(state: BrowserState, site: string, css: string, now: number): BrowserState {
  if (css.length > MAX_BOOST_CSS_LENGTH || site.trim() === "") {
    return state;
  }
  return changeBoost(state, site, now, (boost) => (boost.css === css ? boost : { ...boost, css: css }));
}

/**
 * Adds a zapped element's selector (duplicates, overlong selectors and a full list are ignored).
 */
export function addZappedSelector(state: BrowserState, site: string, selector: string, now: number): BrowserState {
  const trimmedSelector = selector.trim();
  if (trimmedSelector === "" || trimmedSelector.length > MAX_SELECTOR_LENGTH || site.trim() === "") {
    return state;
  }
  return changeBoost(state, site, now, (boost) => {
    const isKnown = boost.zappedSelectors.includes(trimmedSelector);
    if (isKnown || boost.zappedSelectors.length >= MAX_ZAPPED_SELECTORS) {
      return boost;
    }
    return { ...boost, zappedSelectors: [...boost.zappedSelectors, trimmedSelector], isEnabled: true };
  });
}

/**
 * Turns a site's Boost on or off without losing it. Returns the same state when the site has no Boost.
 */
export function setBoostEnabled(state: BrowserState, site: string, isEnabled: boolean): BrowserState {
  const boosts = state.boosts ?? [];
  const existing = boosts.find((boost) => boost.site === site);
  if (existing === undefined || existing.isEnabled === isEnabled) {
    return state;
  }
  return { ...state, boosts: boosts.map((boost) => (boost === existing ? { ...boost, isEnabled: isEnabled } : boost)) };
}

/**
 * Deletes a site's Boost.
 */
export function deleteBoost(state: BrowserState, site: string): BrowserState {
  const boosts = state.boosts ?? [];
  const remaining = boosts.filter((boost) => boost.site !== site);
  if (remaining.length === boosts.length) {
    return state;
  }
  return { ...state, boosts: remaining };
}
