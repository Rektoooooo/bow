/**
 * WHY this file exists:
 *   Arc's recent-tab switcher: hold ⌃ and press Tab to step through the tabs you used last, shown as cards with a
 *   picture of each page; let go of ⌃ to switch. A quick ⌃Tab tap switches to the previous tab without the cards
 *   ever appearing (they show only after a short moment).
 *
 * Data source:
 *   The "switcher" panel message: the recent tabs (pictures from tabSnapshots.ts) and the card to start on.
 *
 * Data flow:
 *   ⌃Tab (app menu) → "overlay:show" (switcher) → Tab / ⇧Tab / arrows move the highlight, also ⌃Tab sent again by the
 *   menu ("overlay:switcher-step") → ⌃ let go (here, or on the page: "overlay:switcher-commit") → overlayApi.chooseTab
 */
import type { OverlayPanel, SwitcherTab } from "../shared/overlay";
import { createElement, createFavicon } from "../renderer/dom.js";

type SwitcherPanel = Extract<OverlayPanel, { kind: "switcher" }>;

/** The cards appear only if ⌃ is still held this long, so a quick tap does not flash them. Our choice. */
const SHOW_DELAY_MS = 120;

let switcherTabs: SwitcherTab[] = [];
let highlightedIndex = 0;
let isChosen = false;
let showTimer: number | null = null;

/**
 * Moves the highlight by a step, wrapping around.
 */
function stepHighlight(step: number): void {
  const count = switcherTabs.length;
  if (count === 0) {
    return;
  }
  highlightedIndex = (highlightedIndex + step + count) % count;
  for (const card of document.querySelectorAll<HTMLElement>(".switcher-card")) {
    card.classList.toggle("is-highlighted", card.dataset.index === String(highlightedIndex));
  }
}

/**
 * Switches to the highlighted tab (once).
 */
function chooseHighlighted(): void {
  const tab = switcherTabs[highlightedIndex];
  if (isChosen || tab === undefined) {
    return;
  }
  isChosen = true;
  if (showTimer !== null) {
    window.clearTimeout(showTimer);
    showTimer = null;
  }
  window.overlayApi.chooseTab(tab.tabId);
}

/**
 * One card: the page's picture (or its icon when there is none yet), its icon and its name.
 */
function createCard(tab: SwitcherTab, index: number): HTMLElement {
  const card = createElement("button", "switcher-card");
  card.dataset.index = String(index);
  card.classList.toggle("is-highlighted", index === highlightedIndex);
  card.title = tab.url;
  const picture = createElement("span", "switcher-picture");
  if (tab.snapshotUrl === null) {
    picture.classList.add("is-empty");
    picture.append(createFavicon(tab.faviconUrl, tab.url, "favicon switcher-big-icon"));
  } else {
    const image = document.createElement("img");
    image.src = tab.snapshotUrl;
    image.alt = "";
    picture.append(image);
  }
  const caption = createElement("span", "switcher-caption");
  caption.append(createFavicon(tab.faviconUrl, tab.url), createElement("span", "switcher-title", tab.title));
  card.append(picture, caption);
  card.addEventListener("mouseenter", () => stepHighlight(index - highlightedIndex));
  card.addEventListener("click", () => {
    highlightedIndex = index;
    chooseHighlighted();
  });
  return card;
}

/**
 * Builds the switcher; the cards show after SHOW_DELAY_MS unless a tab was chosen by then.
 */
export function renderSwitcher(host: HTMLElement, panel: SwitcherPanel): void {
  switcherTabs = panel.tabs;
  highlightedIndex = panel.index;
  isChosen = false;
  const container = createElement("div", "panel switcher");
  container.setAttribute("role", "listbox");
  container.setAttribute("aria-label", "Recent tabs");
  container.hidden = true;
  container.append(...panel.tabs.map((tab, index) => createCard(tab, index)));
  host.replaceChildren(container);
  showTimer = window.setTimeout(() => {
    showTimer = null;
    container.hidden = false;
  }, SHOW_DELAY_MS);
}

/**
 * Keys while the switcher is open: Tab / ⇧Tab and arrows move, Return or letting go of ⌃ switches. Returns true when
 * the key was the switcher's.
 */
export function handleSwitcherKey(event: KeyboardEvent): boolean {
  if (document.body.dataset.panel !== "switcher" || isChosen) {
    return false;
  }
  if (event.type === "keyup") {
    if (event.key === "Control") {
      chooseHighlighted();
      return true;
    }
    return false;
  }
  if (event.key === "Tab") {
    stepHighlight(event.shiftKey ? -1 : 1);
    return true;
  }
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    stepHighlight(event.key === "ArrowRight" ? 1 : -1);
    return true;
  }
  if (event.key === "Enter") {
    chooseHighlighted();
    return true;
  }
  return false;
}

/**
 * Starts listening for the menu's repeated ⌃Tab and for ⌃ let go on the page.
 */
export function installSwitcherMessages(): void {
  window.overlayApi.onSwitcherStep((step) => stepHighlight(step));
  window.overlayApi.onSwitcherCommit(() => chooseHighlighted());
}
