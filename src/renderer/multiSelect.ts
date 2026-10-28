/**
 * WHY this file exists:
 *   Several tabs at once: ⌘-click adds or removes a tab row, ⇧-click takes every row from the last one picked to this
 *   one; right-clicking one of them acts on all (Close, Move to Space, Pin, Split View; main/menus.ts). Like Finder,
 *   the tab on screen joins the selection when ⌘-clicking starts it. Only Pinned and Today rows of this window's
 *   Space take part (not Favorites, not dragging several). Nothing here is saved.
 *
 * Data source:
 *   Clicks with ⌘ or ⇧ on tab rows (sidebarEvents.ts), the rows on screen in sidebar order (sidebar.ts).
 *
 * Data flow:
 *   ⌘/⇧-click → toggleTab / extendTo → sidebar.ts redraws (rows get "is-multi-selected") → right-click →
 *   sidebarEvents.ts asks for the "tabs" menu with getMultiSelection() → main/menus.ts
 *   a plain click, Escape, a Space switch → clearMultiSelection(); every redraw → keepOnly(rows still on screen)
 */
import type { ItemId } from "../shared/types";

/** The picked tabs, in the order they were picked. */
let selectedTabIds: ItemId[] = [];

/** Where a ⇧-click range starts: the tab picked last. */
let anchorTabId: ItemId | null = null;

/**
 * The picked tabs (empty when fewer than two: one picked tab is just the selected one).
 */
export function getMultiSelection(): ItemId[] {
  return selectedTabIds.length > 1 ? [...selectedTabIds] : [];
}

export function isMultiSelected(tabId: ItemId): boolean {
  return selectedTabIds.length > 1 && selectedTabIds.includes(tabId);
}

/**
 * ⌘-click: adds a tab, or takes it out. Starting a selection takes the tab on screen in too.
 */
export function toggleTab(tabId: ItemId, onScreenTabId: ItemId | null): void {
  const isStarting = selectedTabIds.length === 0 && onScreenTabId !== null && onScreenTabId !== tabId;
  const start = isStarting ? [onScreenTabId] : selectedTabIds;
  const isPicked = start.includes(tabId);
  selectedTabIds = isPicked ? start.filter((pickedId) => pickedId !== tabId) : [...start, tabId];
  anchorTabId = tabId;
}

/**
 * ⇧-click: every row from the last one picked (or the tab on screen) to this one, in sidebar order.
 */
export function extendTo(tabId: ItemId, rowOrder: ItemId[], onScreenTabId: ItemId | null): void {
  const fromTabId = anchorTabId ?? onScreenTabId ?? tabId;
  const fromIndex = rowOrder.indexOf(fromTabId);
  const toIndex = rowOrder.indexOf(tabId);
  if (fromIndex === -1 || toIndex === -1) {
    toggleTab(tabId, onScreenTabId);
    return;
  }
  const firstIndex = Math.min(fromIndex, toIndex);
  const lastIndex = Math.max(fromIndex, toIndex);
  selectedTabIds = rowOrder.slice(firstIndex, lastIndex + 1);
}

/**
 * Forgets the selection. Returns whether there was one (so the caller knows to redraw).
 */
export function clearMultiSelection(): boolean {
  const hadSelection = selectedTabIds.length > 0;
  selectedTabIds = [];
  anchorTabId = null;
  return hadSelection;
}

/**
 * Keeps only the picked tabs still on screen (a closed, archived or moved tab leaves the selection).
 */
export function keepOnly(rowOrder: ItemId[]): void {
  selectedTabIds = selectedTabIds.filter((tabId) => rowOrder.includes(tabId));
  if (anchorTabId !== null && !rowOrder.includes(anchorTabId)) {
    anchorTabId = null;
  }
}
