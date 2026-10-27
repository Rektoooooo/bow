/**
 * WHY this file exists:
 *   Arc's list of a closed folder's tabs: resting on a closed folder in the sidebar shows its tabs beside it, the most
 *   recently used first with how long ago ("1 minute ago"), and a search field that filters them. Clicking a tab (or
 *   Return on the first match) opens it; the folder stays closed and shows the tab beneath it.
 *
 * Data source:
 *   The "folderList" panel message: the folder's name and its tabs (main/folderList.ts).
 *
 * Data flow:
 *   sidebar hover (renderer/folderListHover.ts) → action showFolderList → overlayController.ts → "overlay:show"
 *   (folderList) → renderFolderList() → click → dispatch selectTab → the list closes
 */
import type { FolderListEntry, OverlayPanel } from "../shared/overlay";
import { describeTimeAgo } from "../shared/timeAgo.js";
import { createElement, createFavicon, dispatch } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";

type FolderListPanel = Extract<OverlayPanel, { kind: "folderList" }>;

/**
 * True when a tab's name or address contains every word typed (any case).
 */
function matchesQuery(entry: FolderListEntry, query: string): boolean {
  const lowerQuery = query.toLowerCase();
  const words = lowerQuery.split(/\s+/);
  const typedWords = words.filter((word) => word !== "");
  const text = `${entry.title} ${entry.url}`.toLowerCase();
  return typedWords.every((word) => text.includes(word));
}

/**
 * Opens a tab from the list and closes it.
 */
function openEntry(entry: FolderListEntry): void {
  dispatch({ type: "selectTab", tabId: entry.tabId });
  window.overlayApi.close();
}

/**
 * One tab of the list: its icon, its name and how long ago it was used.
 */
function createEntryRow(entry: FolderListEntry, now: number): HTMLElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "folder-list-row";
  row.title = entry.url;
  const text = createElement("span", "folder-list-text");
  text.append(createElement("span", "folder-list-title", entry.title === "" ? entry.url : entry.title), createElement("span", "folder-list-time", describeTimeAgo(entry.lastActiveAt, now)));
  row.append(createFavicon(entry.faviconUrl, entry.url), text);
  row.addEventListener("click", () => openEntry(entry));
  return row;
}

/**
 * Draws the list, with the search field focused like Arc's.
 */
export function renderFolderList(host: HTMLElement, panel: FolderListPanel): void {
  const list = createElement("div", "panel folder-list");
  list.setAttribute("role", "dialog");
  list.setAttribute("aria-label", panel.folderTitle);

  const searchRow = createElement("label", "folder-list-search-row");
  const search = document.createElement("input");
  search.className = "folder-list-search";
  search.type = "search";
  search.placeholder = `Search ${panel.folderTitle}…`;
  search.spellcheck = false;
  searchRow.append(createIcon("search", "icon folder-list-search-icon"), search);

  const rows = createElement("div", "folder-list-rows");
  const now = Date.now();
  const drawRows = (): void => {
    const matches = panel.entries.filter((entry) => matchesQuery(entry, search.value));
    rows.replaceChildren(...matches.map((entry) => createEntryRow(entry, now)));
    rows.firstElementChild?.classList.add("is-first");
  };
  search.addEventListener("input", drawRows);
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    const firstMatch = panel.entries.find((entry) => matchesQuery(entry, search.value));
    if (firstMatch !== undefined) {
      openEntry(firstMatch);
    }
  });
  drawRows();
  // Main closes the list once the pointer is away from it and from the folder's row (the sidebar reports the row).
  list.addEventListener("pointerenter", () => dispatch({ type: "folderListPointer", isInside: true }));
  list.addEventListener("pointerleave", () => dispatch({ type: "folderListPointer", isInside: false }));
  list.append(searchRow, rows);
  host.replaceChildren(list);
  search.focus();
}
