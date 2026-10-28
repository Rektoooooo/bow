/**
 * WHY this file exists:
 *   The handles between split panes. The pages are native views above this page, and the gaps between them show
 *   this page, so the handles live here, placed with the same arithmetic main uses for the pages
 *   (shared/splitLayout.ts) from #card-slot's rectangle, which is where main puts the card. Dragging a handle resizes
 *   the panes live (not saved) and saves when the button is let go; a double-click makes them equal again.
 *
 * Data source:
 *   The state (the selected tab's split view: its layout, sizes and panes) and #card-slot's rectangle.
 *
 * Data flow:
 *   sidebar.ts renderAll → renderSplitDividers(state, selectedTabId) → handles; window resize → ResizeObserver → again
 *   drag → resizeSplit() → action resizeSplit (isFinal false: main previews; true: saved) → main relays the pages out
 */
import { isEaselUrl } from "../shared/easels.js";
import { isNoteUrl } from "../shared/notes.js";
import { computeSplitDividers, resizeSplit } from "../shared/splitLayout.js";
import type { PaneRect, SplitDivider } from "../shared/splitLayout";
import type { BrowserState, ItemId, SplitItem } from "../shared/types";
import { createElement, dispatch } from "./dom.js";

/** The split view on screen, as the handles need it. */
interface ShownSplit {
  split: SplitItem;
  /** Panes with a page view: Notes and Easels have none (main lays out only the others). */
  paneCount: number;
}

/** What was drawn last, for redrawing when only the window's size changes. */
let lastState: BrowserState | null = null;
let lastSelectedTabId: ItemId | null = null;

/** The drag in progress, or null. While dragging, redraws leave the handles alone. */
let drag: { shown: ShownSplit; card: PaneRect; divider: SplitDivider; sizes: number[] | null } | null = null;

/**
 * The split view the selected tab is in, with its panes that have a page view; null outside a split view.
 */
function findShownSplit(state: BrowserState, selectedTabId: ItemId | null): ShownSplit | null {
  if (selectedTabId === null) {
    return null;
  }
  const split = Object.values(state.items).find((item): item is SplitItem => item.kind === "split" && item.childIds.includes(selectedTabId));
  if (split === undefined) {
    return null;
  }
  const pageTabIds = split.childIds.filter((tabId) => {
    const tab = state.items[tabId];
    return tab !== undefined && tab.kind === "tab" && !isNoteUrl(tab.url) && !isEaselUrl(tab.url);
  });
  return { split: split, paneCount: pageTabIds.length };
}

/**
 * Where the card is in the window: #card-slot, the page area under the toolbar.
 */
function readCard(): PaneRect | null {
  const slot = document.getElementById("card-slot");
  if (slot === null) {
    return null;
  }
  const box = slot.getBoundingClientRect();
  return { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) };
}

/**
 * One handle over a divider's gap.
 */
function createHandle(divider: SplitDivider): HTMLElement {
  const handle = createElement("div", `split-divider is-${divider.kind}`);
  // A line across (between stacked panes, or the grid's row line) drags up and down.
  handle.classList.toggle("is-row-line", divider.rect.width > divider.rect.height);
  handle.dataset.kind = divider.kind;
  handle.dataset.index = String(divider.index);
  handle.title = "Drag to resize the panes · double-click to make them equal";
  placeHandle(handle, divider.rect);
  return handle;
}

function placeHandle(handle: HTMLElement, rect: PaneRect): void {
  handle.style.left = `${rect.x}px`;
  handle.style.top = `${rect.y}px`;
  handle.style.width = `${rect.width}px`;
  handle.style.height = `${rect.height}px`;
}

/**
 * Draws the handles of the selected tab's split view (none outside one).
 */
export function renderSplitDividers(state: BrowserState, selectedTabId: ItemId | null): void {
  lastState = state;
  lastSelectedTabId = selectedTabId;
  const layer = document.getElementById("split-dividers");
  if (layer === null || drag !== null) {
    return;
  }
  const shown = findShownSplit(state, selectedTabId);
  const card = readCard();
  if (shown === null || card === null || shown.paneCount < 2) {
    layer.replaceChildren();
    return;
  }
  const dividers = computeSplitDividers(card, shown.paneCount, shown.split.orientation, shown.split.sizes);
  layer.replaceChildren(...dividers.map((divider) => createHandle(divider)));
}

/**
 * Moves the handles to where the dragged sizes put the dividers (the pages follow through main's preview).
 */
function followDrag(sizes: number[]): void {
  const layer = document.getElementById("split-dividers");
  if (layer === null || drag === null) {
    return;
  }
  const dividers = computeSplitDividers(drag.card, drag.shown.paneCount, drag.shown.split.orientation, sizes);
  for (const handle of layer.querySelectorAll<HTMLElement>(".split-divider")) {
    const divider = dividers.find((candidate) => candidate.kind === handle.dataset.kind && String(candidate.index) === handle.dataset.index);
    if (divider !== undefined) {
      placeHandle(handle, divider.rect);
    }
  }
}

/**
 * Wires the handles' layer: dragging, double-click, and redrawing when the card changes size (once, at startup).
 */
export function installSplitDividers(): void {
  const layer = document.getElementById("split-dividers");
  const slot = document.getElementById("card-slot");
  if (layer === null || slot === null) {
    return;
  }
  let animationFrame: number | null = null;
  layer.addEventListener("pointerdown", (event) => {
    const handle = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".split-divider") : null;
    const shown = lastState === null ? null : findShownSplit(lastState, lastSelectedTabId);
    const card = readCard();
    if (handle === null || shown === null || card === null) {
      return;
    }
    const dividers = computeSplitDividers(card, shown.paneCount, shown.split.orientation, shown.split.sizes);
    const divider = dividers.find((candidate) => candidate.kind === handle.dataset.kind && String(candidate.index) === handle.dataset.index);
    if (divider === undefined) {
      return;
    }
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    drag = { shown: shown, card: card, divider: divider, sizes: null };
    document.body.classList.add("is-resizing-split");
  });
  layer.addEventListener("pointermove", (event) => {
    if (drag === null) {
      return;
    }
    const current = drag;
    current.sizes = resizeSplit(current.card, current.shown.paneCount, current.shown.split.orientation, current.shown.split.sizes, current.divider, event.clientX, event.clientY);
    followDrag(current.sizes);
    if (animationFrame !== null) {
      return;
    }
    // One preview per frame is enough; pointer events can come much faster.
    animationFrame = requestAnimationFrame(() => {
      animationFrame = null;
      if (drag !== null && drag.sizes !== null) {
        dispatch({ type: "resizeSplit", splitId: drag.shown.split.id, sizes: drag.sizes, isFinal: false });
      }
    });
  });
  layer.addEventListener("pointerup", (event) => {
    if (drag === null) {
      return;
    }
    const finished = drag;
    drag = null;
    document.body.classList.remove("is-resizing-split");
    if (event.target instanceof HTMLElement && event.target.hasPointerCapture(event.pointerId)) {
      event.target.releasePointerCapture(event.pointerId);
    }
    if (finished.sizes !== null) {
      dispatch({ type: "resizeSplit", splitId: finished.shown.split.id, sizes: finished.sizes, isFinal: true });
    }
  });
  layer.addEventListener("dblclick", () => {
    const shown = lastState === null ? null : findShownSplit(lastState, lastSelectedTabId);
    if (shown !== null) {
      dispatch({ type: "equalizeSplit", splitId: shown.split.id });
    }
  });
  // The window or the sidebar changed size: the gaps moved.
  new ResizeObserver(() => {
    if (lastState !== null) {
      renderSplitDividers(lastState, lastSelectedTabId);
    }
  }).observe(slot);
}
