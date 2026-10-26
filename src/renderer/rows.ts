/**
 * WHY this file exists:
 *   The sidebar shows four kinds of rows: tabs, folders (with their children), split views (one row, several panes)
 *   and Favorites tiles. Each is described here from the item it shows: what it looks like and, as data attributes,
 *   what clicking, dragging and dropping on it means.
 *
 * Data source:
 *   A RowContext: the BrowserState, the runtime facts (loading, sound) and which row is being renamed.
 *
 * Data flow:
 *   sidebar.ts renderAll() → renderItemRows() / renderFavoriteTile() → morph.ts keeps the page's elements in step
 *   → clicks and drags are handled by sidebarEvents.ts / dragDrop.ts from the data attributes
 *
 * Rule: no event listeners here (morph.ts keeps elements across redraws, so a listener would remember stale data).
 * The one exception is the rename field, which morphing never replaces while it has the focus.
 */
import type { BrowserState, FolderItem, ItemId, ItemLocation, RuntimeState, SidebarItem, SplitItem, TabItem } from "../shared/types";
import { createActionButton, createElement, createFavicon, dispatch, getDisplayHost } from "./dom.js";
import { createIcon } from "./icons.js";
import { encodeLocation, markDraggable, markDropTarget } from "./dragDrop.js";
import { isDeveloperModeOn } from "../shared/developerMode.js";
import { tidyTitle } from "../shared/tidyTitles.js";

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

/**
 * Indent per folder level, in pixels. Measured on the user's Arc: a child row, its highlight included, starts about
 * 16 pt further right (the highlight of a selected child begins at 22.5 pt, a top-level one at 7).
 */
const INDENT_PER_LEVEL_PX = 16;

/** Left padding of a row at the top level. */
const ROW_BASE_PADDING_PX = 8;

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
  // Focus once the field is in the page. Only the field that made it into the page (morphing may keep an older one)
  // takes the focus.
  requestAnimationFrame(() => {
    if (input.isConnected) {
      input.focus();
      input.select();
    }
  });
  return input;
}

/**
 * Builds the favicon slot of a tab row. A tab that left its home URL shows a "back" button on hover.
 */
function createTabIconSlot(tab: TabItem, isLoading: boolean): HTMLElement {
  const slot = createElement("span", "row-icon-slot");
  const favicon = createFavicon(tab.faviconUrl, tab.url);
  favicon.classList.toggle("is-loading", isLoading);
  slot.append(favicon);

  if (hasLeftHome(tab)) {
    slot.append(createActionButton("reset", "Back to pinned URL", "row-reset", "reset-tab", { itemId: tab.id }));
  }
  return slot;
}

/**
 * Builds the title of a tab row: the inline rename field, or the name with Arc's "/" when the tab left home.
 * Pinned tabs without a name of the user's own show a tidy title (shared/tidyTitles.ts) unless that is turned off.
 */
function createTabTitle(tab: TabItem, context: RowContext, isPinned: boolean): HTMLElement {
  const title = createElement("span", "row-title");
  if (context.renamingItemId === tab.id) {
    title.append(createRenameInput(tab.id, getTabDisplayName(tab), context));
    return title;
  }
  if (hasLeftHome(tab)) {
    title.append(createElement("span", "away-slash", "/ "));
  }
  const isTidy = isPinned && tab.customTitle === null && context.state.settings.areTitlesTidy !== false;
  title.append(document.createTextNode(isTidy ? tidyTitle(tab.title, tab.url) : getTabDisplayName(tab)));
  return title;
}

/**
 * Sets a row's indent for its folder depth: the whole row moves right, like Arc's, not just its content.
 */
function setIndent(row: HTMLElement, depth: number, basePadding: number = ROW_BASE_PADDING_PX): void {
  row.style.setProperty("--depth", String(depth));
  row.style.marginLeft = `${depth * INDENT_PER_LEVEL_PX}px`;
  row.style.paddingLeft = `${basePadding}px`;
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
  row.dataset.key = `tab:${encodeLocation(location)}:${tab.id}`;
  row.dataset.presence = "row";
  row.dataset.row = "tab";
  row.title = tab.url;
  setIndent(row, depth);
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  row.classList.toggle("is-selected", isSelected);
  row.classList.toggle("is-loaded", isLoaded);
  if (isSelected) {
    row.setAttribute("aria-current", "page");
  }

  row.append(createTabIconSlot(tab, runtimeInfo?.isLoading === true));
  // A site in Developer Mode: Arc outlines its tabs in dashed yellow and puts the host under the title (shot 5).
  const isDeveloper = isDeveloperModeOn(context.state, tab.url);
  row.classList.toggle("is-developer", isDeveloper);
  if (isDeveloper) {
    const textStack = createElement("span", "row-text-stack");
    textStack.append(createTabTitle(tab, context, !isToday), createElement("span", "row-subtitle", getDisplayHost(tab.url)));
    row.append(textStack);
  } else {
    row.append(createTabTitle(tab, context, !isToday));
  }
  if (tab.isUnread === true && !isSelected) {
    const unreadDot = createElement("span", "unread-dot");
    unreadDot.title = "Changed since you last looked";
    row.append(unreadDot);
  }

  const isAudible = runtimeInfo?.isAudible === true;
  if (isAudible || tab.isMuted) {
    const label = tab.isMuted ? "Unmute tab" : "Mute tab";
    const icon = tab.isMuted ? "speakerMuted" : "speaker";
    row.append(createActionButton(icon, label, "row-action row-speaker is-visible", "toggle-mute", { itemId: tab.id, isMuted: String(tab.isMuted) }));
  }

  if (isToday || isLoaded) {
    const closeLabel = isToday ? "Close tab (moves it to the Archive)" : "Close page (keeps the pinned tab)";
    row.append(createActionButton("close", closeLabel, "row-action row-close", "close-tab", { itemId: tab.id }));
  }

  markDraggable(row, tab.id);
  markDropTarget(row, location, index, null);
  return row;
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
  row.dataset.key = `folder:${encodeLocation(location)}:${folder.id}`;
  row.dataset.presence = "row";
  row.dataset.row = "folder";
  setIndent(row, depth);
  row.setAttribute("role", "button");
  row.setAttribute("aria-expanded", String(folder.isOpen));
  row.classList.toggle("is-open", folder.isOpen);
  row.tabIndex = 0;

  const iconSlot = createElement("span", "row-icon-slot folder-icon");
  iconSlot.append(createIcon(folder.isOpen ? "folderOpen" : "folderClosed"));
  row.append(iconSlot);

  const title = createElement("span", "row-title");
  if (context.renamingItemId === folder.id) {
    title.append(createRenameInput(folder.id, folder.title, context));
  } else {
    title.textContent = folder.title;
  }
  row.append(title);

  markDraggable(row, folder.id);
  markDropTarget(row, location, index, folder.id);

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
  row.dataset.key = `split:${encodeLocation(location)}:${split.id}`;
  row.dataset.presence = "row";
  row.dataset.row = "split";
  setIndent(row, depth, ROW_BASE_PADDING_PX / 2);
  const containsSelection = context.selectedTabId !== null && split.childIds.includes(context.selectedTabId);
  row.classList.toggle("is-selected", containsSelection);

  for (const tabId of split.childIds) {
    const tab = context.state.items[tabId];
    if (tab === undefined || tab.kind !== "tab") {
      continue;
    }
    const pane = createElement("span", "split-pane");
    pane.dataset.key = `pane:${tabId}`;
    pane.dataset.row = "split-pane";
    pane.dataset.tabId = tabId;
    pane.classList.toggle("is-focused", tabId === context.selectedTabId);
    pane.title = getTabDisplayName(tab);
    pane.append(createFavicon(tab.faviconUrl, tab.url));
    pane.append(createElement("span", "split-pane-title", getTabDisplayName(tab)));
    row.append(pane);
  }

  markDraggable(row, split.id);
  markDropTarget(row, location, index, null);
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
  tile.dataset.key = `favorite:${tab.id}`;
  tile.dataset.presence = "tile";
  tile.dataset.row = "favorite";
  tile.title = `${getTabDisplayName(tab)}\n${getDisplayHost(tab.url)}`;
  tile.setAttribute("role", "button");
  tile.setAttribute("aria-label", getTabDisplayName(tab));
  tile.tabIndex = 0;
  tile.classList.toggle("is-selected", tab.id === context.selectedTabId);
  tile.classList.toggle("is-loaded", context.runtime.tabs[tab.id] !== undefined);
  tile.append(createFavicon(tab.faviconUrl, tab.url, "favicon favicon-large"));

  const isAudible = context.runtime.tabs[tab.id]?.isAudible === true;
  const isUnread = tab.isUnread === true && tab.id !== context.selectedTabId;
  if (isAudible || isUnread) {
    tile.append(createElement("span", isUnread ? "tile-audio-dot tile-unread-dot" : "tile-audio-dot"));
  }

  markDraggable(tile, tab.id);
  markDropTarget(tile, location, index, null, true);
  return tile;
}
