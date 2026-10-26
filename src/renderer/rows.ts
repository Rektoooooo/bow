/**
 * WHY this file exists:
 *   The sidebar shows four kinds of rows: tabs, folders (with their children), split views (one row, several panes)
 *   and Favorites tiles. Each is built here from the item it shows, with its clicks, hover buttons and drag handle.
 *
 * Data source:
 *   A RowContext: the BrowserState, the runtime facts (loading, sound) and which row is being renamed.
 *
 * Data flow:
 *   sidebar.ts renderAll() → renderItemRows() / renderFavoriteTile() → elements → clicks → dispatch(action)
 */
import type { BrowserState, FolderItem, ItemId, ItemLocation, RuntimeState, SidebarItem, SplitItem, TabItem } from "../shared/types";
import { createElement, createFavicon, createIconButton, dispatch, getDisplayHost } from "./dom.js";
import { createIcon } from "./icons.js";
import { makeDraggable, makeDropTarget } from "./dragDrop.js";

/** Everything a row needs to know to draw itself. */
export interface RowContext {
  state: BrowserState;
  runtime: RuntimeState;
  selectedTabId: ItemId | null;
  /** The item whose name is being edited inline, or null. */
  renamingItemId: ItemId | null;
  /** Called when an inline rename ends (saved or cancelled), so sidebar.ts can redraw without the input. */
  onRenameFinished: () => void;
}

/** Indent per folder level, in pixels. Our choice; Arc indents children by about one icon width. */
const INDENT_PER_LEVEL_PX = 14;

/**
 * Returns the name a tab shows: the user's rename, or the page title.
 */
export function getTabDisplayName(tab: TabItem): string {
  return tab.customTitle ?? tab.title;
}

/**
 * True when a Pinned tab or Favorite has navigated away from its home URL. Arc then shows a "/" before the title
 * and offers to go back.
 */
function hasLeftHome(tab: TabItem): boolean {
  return tab.homeUrl !== null && tab.url !== tab.homeUrl;
}

/**
 * Builds the inline rename field. Enter saves, Escape or leaving the field cancels.
 */
function createRenameInput(itemId: ItemId, currentName: string, context: RowContext): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "rename-input";
  input.value = currentName;
  input.setAttribute("aria-label", "New name");
  let isFinished = false;

  const finish = (shouldSave: boolean): void => {
    if (isFinished) {
      return;
    }
    isFinished = true;
    if (shouldSave) {
      dispatch({ type: "renameItem", itemId: itemId, name: input.value });
    }
    context.onRenameFinished();
  };

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      finish(true);
    }
    if (event.key === "Escape") {
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (event) => event.stopPropagation());
  // Focus after the element is in the page.
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
  return input;
}

/**
 * Builds the favicon slot of a tab row. A tab that left its home URL shows a "back" button on hover.
 */
function createTabIconSlot(tab: TabItem, isLoading: boolean): HTMLElement {
  const slot = createElement("span", "row-icon-slot");
  const favicon = createFavicon(tab.faviconUrl, tab.url);
  if (isLoading) {
    favicon.classList.add("is-loading");
  }
  slot.append(favicon);

  if (hasLeftHome(tab)) {
    const resetButton = createIconButton("reset", "Back to pinned URL", "row-reset", () => {
      dispatch({ type: "resetTab", tabId: tab.id });
    });
    slot.append(resetButton);
  }
  return slot;
}

/**
 * Builds the title of a tab row: the inline rename field, or the name with Arc's "/" when the tab left home.
 */
function createTabTitle(tab: TabItem, context: RowContext): HTMLElement {
  const title = createElement("span", "row-title");
  if (context.renamingItemId === tab.id) {
    title.append(createRenameInput(tab.id, getTabDisplayName(tab), context));
    return title;
  }
  if (hasLeftHome(tab)) {
    title.append(createElement("span", "away-slash", "/ "));
  }
  title.append(document.createTextNode(getTabDisplayName(tab)));
  return title;
}

/**
 * Builds one tab row: icon, title, a speaker when it plays or is muted, and a close button on hover.
 * Pinned tabs only show the close button while their page is loaded, because closing puts the page away.
 */
export function renderTabRow(tab: TabItem, location: ItemLocation, index: number, depth: number, context: RowContext): HTMLElement {
  const runtimeInfo = context.runtime.tabs[tab.id];
  const isLoaded = runtimeInfo !== undefined;
  const isSelected = tab.id === context.selectedTabId;
  const isToday = location.kind === "today" || location.kind === "split";

  const row = createElement("div", "row tab-row");
  row.dataset.itemId = tab.id;
  row.title = tab.url;
  row.style.setProperty("--depth", String(depth));
  row.style.paddingLeft = `${8 + depth * INDENT_PER_LEVEL_PX}px`;
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  row.classList.toggle("is-selected", isSelected);
  row.classList.toggle("is-loaded", isLoaded);
  if (isSelected) {
    row.setAttribute("aria-current", "page");
  }

  row.append(createTabIconSlot(tab, runtimeInfo?.isLoading === true));
  row.append(createTabTitle(tab, context));

  const isAudible = runtimeInfo?.isAudible === true;
  if (isAudible || tab.isMuted) {
    const label = tab.isMuted ? "Unmute tab" : "Mute tab";
    const icon = tab.isMuted ? "speakerMuted" : "speaker";
    const muteButton = createIconButton(icon, label, "row-action row-speaker is-visible", () => {
      dispatch({ type: "setTabMuted", tabId: tab.id, isMuted: !tab.isMuted });
    });
    row.append(muteButton);
  }

  if (isToday || isLoaded) {
    const closeLabel = isToday ? "Close tab (moves it to the Archive)" : "Close page (keeps the pinned tab)";
    const closeButton = createIconButton("close", closeLabel, "row-action row-close", () => {
      dispatch({ type: "closeTab", tabId: tab.id });
    });
    row.append(closeButton);
  }

  addTabRowEvents(row, tab.id);
  makeDraggable(row, tab.id);
  makeDropTarget(row, { location: location, index: index, intoFolderId: null });
  return row;
}

/**
 * Click selects, middle-click closes, double-click renames, right-click opens the tab menu, Enter selects.
 */
function addTabRowEvents(row: HTMLElement, tabId: ItemId): void {
  row.addEventListener("click", () => dispatch({ type: "selectTab", tabId: tabId }));
  row.addEventListener("auxclick", (event) => {
    if (event.button === 1) {
      dispatch({ type: "closeTab", tabId: tabId });
    }
  });
  row.addEventListener("dblclick", (event) => {
    event.preventDefault();
    row.dispatchEvent(new CustomEvent("begin-rename", { bubbles: true, detail: tabId }));
  });
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    dispatch({ type: "showMenu", request: { menu: "item", itemId: tabId } });
  });
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      dispatch({ type: "selectTab", tabId: tabId });
    }
  });
}

/**
 * True when the selected tab sits somewhere inside a folder (at any depth).
 */
function folderContainsTab(state: BrowserState, folder: FolderItem, tabId: ItemId | null): boolean {
  if (tabId === null) {
    return false;
  }
  for (const childId of folder.childIds) {
    if (childId === tabId) {
      return true;
    }
    const child: SidebarItem | undefined = state.items[childId];
    if (child !== undefined && child.kind !== "tab" && child.childIds.includes(tabId)) {
      return true;
    }
    if (child !== undefined && child.kind === "folder" && folderContainsTab(state, child, tabId)) {
      return true;
    }
  }
  return false;
}

/**
 * Builds a folder row and, when it is open, its children one level deeper. A closed folder still shows the
 * selected tab beneath it, like Arc, so you never lose sight of the page you are on.
 */
export function renderFolderRows(folder: FolderItem, location: ItemLocation, index: number, depth: number, context: RowContext): HTMLElement[] {
  const row = createElement("div", "row folder-row");
  row.dataset.itemId = folder.id;
  row.style.paddingLeft = `${8 + depth * INDENT_PER_LEVEL_PX}px`;
  row.setAttribute("role", "button");
  row.setAttribute("aria-expanded", String(folder.isOpen));
  row.tabIndex = 0;

  const iconSlot = createElement("span", "row-icon-slot folder-icon");
  iconSlot.append(createIcon(folder.isOpen ? "folderOpen" : "folder"));
  row.append(iconSlot);

  const title = createElement("span", "row-title");
  if (context.renamingItemId === folder.id) {
    title.append(createRenameInput(folder.id, folder.title, context));
  } else {
    title.textContent = folder.title;
  }
  row.append(title);

  row.addEventListener("click", () => dispatch({ type: "toggleFolder", folderId: folder.id }));
  row.addEventListener("dblclick", (event) => {
    event.preventDefault();
    row.dispatchEvent(new CustomEvent("begin-rename", { bubbles: true, detail: folder.id }));
  });
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    dispatch({ type: "showMenu", request: { menu: "item", itemId: folder.id } });
  });
  makeDraggable(row, folder.id);
  makeDropTarget(row, { location: location, index: index, intoFolderId: folder.id });

  const rows: HTMLElement[] = [row];
  const childLocation: ItemLocation = { kind: "folder", folderId: folder.id };
  if (folder.isOpen) {
    rows.push(...renderItemRows(folder.childIds, childLocation, depth + 1, context));
    return rows;
  }

  const selectedTabId = context.selectedTabId;
  if (selectedTabId !== null && folderContainsTab(context.state, folder, selectedTabId)) {
    const selectedTab = context.state.items[selectedTabId];
    if (selectedTab !== undefined && selectedTab.kind === "tab") {
      rows.push(renderTabRow(selectedTab, childLocation, 0, depth + 1, context));
    }
  }
  return rows;
}

/**
 * Builds a split-view row: one pane per tab, side by side. Clicking a pane selects that tab (the split shows whole).
 */
export function renderSplitRow(split: SplitItem, location: ItemLocation, index: number, depth: number, context: RowContext): HTMLElement {
  const row = createElement("div", "row split-row");
  row.dataset.itemId = split.id;
  row.style.paddingLeft = `${4 + depth * INDENT_PER_LEVEL_PX}px`;
  const containsSelection = context.selectedTabId !== null && split.childIds.includes(context.selectedTabId);
  row.classList.toggle("is-selected", containsSelection);

  for (const tabId of split.childIds) {
    const tab = context.state.items[tabId];
    if (tab === undefined || tab.kind !== "tab") {
      continue;
    }
    const pane = createElement("span", "split-pane");
    pane.classList.toggle("is-focused", tabId === context.selectedTabId);
    pane.title = getTabDisplayName(tab);
    pane.append(createFavicon(tab.faviconUrl, tab.url));
    pane.append(createElement("span", "split-pane-title", getTabDisplayName(tab)));
    pane.addEventListener("click", (event) => {
      event.stopPropagation();
      dispatch({ type: "selectTab", tabId: tabId });
    });
    pane.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "showMenu", request: { menu: "item", itemId: tabId } });
    });
    row.append(pane);
  }

  makeDraggable(row, split.id);
  makeDropTarget(row, { location: location, index: index, intoFolderId: null });
  return row;
}

/**
 * Builds the rows for a list of items (a Space's Pinned or Today list, or a folder's children), in order.
 */
export function renderItemRows(itemIds: ItemId[], location: ItemLocation, depth: number, context: RowContext): HTMLElement[] {
  const rows: HTMLElement[] = [];
  itemIds.forEach((itemId, index) => {
    const item = context.state.items[itemId];
    if (item === undefined) {
      return;
    }
    if (item.kind === "tab") {
      rows.push(renderTabRow(item, location, index, depth, context));
      return;
    }
    if (item.kind === "folder") {
      rows.push(...renderFolderRows(item, location, index, depth, context));
      return;
    }
    rows.push(renderSplitRow(item, location, index, depth, context));
  });
  return rows;
}

/**
 * Builds one Favorites tile: a large favicon. Selected tiles are highlighted; tiles whose page is not loaded are dimmed.
 */
export function renderFavoriteTile(tab: TabItem, location: ItemLocation, index: number, context: RowContext): HTMLElement {
  const tile = createElement("div", "favorite-tile");
  tile.dataset.itemId = tab.id;
  tile.title = `${getTabDisplayName(tab)}\n${getDisplayHost(tab.url)}`;
  tile.setAttribute("role", "button");
  tile.setAttribute("aria-label", getTabDisplayName(tab));
  tile.tabIndex = 0;
  tile.classList.toggle("is-selected", tab.id === context.selectedTabId);
  tile.classList.toggle("is-loaded", context.runtime.tabs[tab.id] !== undefined);
  tile.append(createFavicon(tab.faviconUrl, tab.url, "favicon favicon-large"));

  const isAudible = context.runtime.tabs[tab.id]?.isAudible === true;
  if (isAudible) {
    tile.append(createElement("span", "tile-audio-dot"));
  }

  addTabRowEvents(tile, tab.id);
  makeDraggable(tile, tab.id);
  makeDropTarget(tile, { location: location, index: index, intoFolderId: null, isHorizontal: true });
  return tile;
}
