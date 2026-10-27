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
import { getFaviconAddress } from "../shared/faviconColor.js";
import type { BrowserState, FolderItem, ItemId, ItemLocation, LiveFolderSource, LiveFolderStatus, RuntimeState, SidebarItem, SplitItem, TabItem } from "../shared/types";
import { createActionButton, createElement, createFavicon, dispatch, getDisplayHost } from "./dom.js";
import { createIcon } from "./icons.js";
import { encodeLocation, markDraggable, markDropTarget } from "./dragDrop.js";
import { createKeepPlaceholder } from "./morph.js";
import { isDeveloperModeOn } from "../shared/developerMode.js";
import { tidyTitle } from "../shared/tidyTitles.js";
import { isNoteUrl } from "../shared/notes.js";
import { isEaselUrl } from "../shared/easels.js";

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

/** Bars in a Favorite's equaliser (sound playing in the background). Our choice. */
const EQUALIZER_BAR_COUNT = 4;

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
  if (isNoteUrl(tab.url)) {
    slot.append(createIcon("note", "icon note-icon"));
    return slot;
  }
  if (isEaselUrl(tab.url)) {
    slot.append(createIcon("easel", "icon note-icon"));
    return slot;
  }
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

/** What a tab row was built from, as text, and its key: the same text means the same row. */
interface TabRowInputs {
  key: string;
  text: string;
}

/**
 * The tab rows of the previous redraw and of this one, by key: what each was built from. A row built from the same
 * inputs as last time is not built again; it comes as a placeholder and morph.ts keeps its element as it is. Rows
 * not drawn in a redraw are forgotten, so a row that comes back is always built fresh.
 */
let previousTabRowInputs = new Map<string, string>();
let currentTabRowInputs = new Map<string, string>();

/**
 * Starts a redraw of the rows (sidebar.ts calls it before drawing them).
 */
export function startRowRedraw(): void {
  previousTabRowInputs = currentTabRowInputs;
  currentTabRowInputs = new Map();
}

/**
 * True when a list belongs to a live folder: its source decides what it holds, so its rows take no drops.
 */
function isLiveFolderList(location: ItemLocation, state: BrowserState): boolean {
  if (location.kind !== "folder") {
    return false;
  }
  const folder = state.items[location.folderId];
  return folder !== undefined && folder.kind === "folder" && folder.live !== undefined;
}

/**
 * Everything a tab row shows depends on, as one text: the tab, where it sits, its runtime facts, whether it is
 * selected or in Developer Mode, and the tidy-titles setting.
 */
function describeTabRowInputs(tab: TabItem, location: ItemLocation, index: number, depth: number, context: RowContext): TabRowInputs {
  const encodedLocation = encodeLocation(location);
  const facts = [
    tab,
    encodedLocation,
    index,
    depth,
    context.runtime.tabs[tab.id] ?? null,
    tab.id === context.selectedTabId,
    isDeveloperModeOn(context.state, tab.url),
    context.state.settings.areTitlesTidy !== false,
    isLiveFolderList(location, context.state),
  ];
  return { key: `tab:${encodedLocation}:${tab.id}`, text: JSON.stringify(facts) };
}

/**
 * One tab row: built, or a placeholder when nothing it shows changed since the last redraw. A row being renamed is
 * always built (its field holds what the user types).
 */
export function renderTabRow(tab: TabItem, location: ItemLocation, index: number, depth: number, context: RowContext): HTMLElement {
  const isRenaming = context.renamingItemId === tab.id;
  const inputs = describeTabRowInputs(tab, location, index, depth, context);
  const build = (): HTMLElement => buildTabRow(tab, location, index, depth, context, inputs.key);
  if (isRenaming) {
    return build();
  }
  currentTabRowInputs.set(inputs.key, inputs.text);
  if (previousTabRowInputs.get(inputs.key) === inputs.text) {
    return createKeepPlaceholder(inputs.key, build);
  }
  return build();
}

/**
 * Builds one tab row: icon, title, a speaker when it plays or is muted, and a close button on hover.
 * Pinned tabs only show the close button while their page is loaded, because closing puts the page away.
 */
function buildTabRow(tab: TabItem, location: ItemLocation, index: number, depth: number, context: RowContext, key: string): HTMLElement {
  const runtimeInfo = context.runtime.tabs[tab.id];
  const isLoaded = runtimeInfo !== undefined;
  const isSelected = tab.id === context.selectedTabId;
  const isToday = location.kind === "today" || location.kind === "split";

  const row = createElement("div", "row tab-row");
  row.dataset.key = key;
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
  if (!isLiveFolderList(location, context.state)) {
    markDropTarget(row, location, index, null);
  }
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

/** GitHub's address, for the icon of a GitHub live folder (the site's own icon, as any tab of it would show). */
const GITHUB_SITE_URL = "https://github.com";

/** What an empty live folder says, by source. */
const EMPTY_LIVE_FOLDER_TEXTS = {
  pullRequests: "No open pull requests",
  reviewRequests: "No reviews requested",
  assignedIssues: "No issues assigned to you",
  feed: "No posts in this feed",
} as const;

/** What a live folder's status line says and what clicking it does ("" = nothing). */
interface LiveStatusLine {
  text: string;
  action: "sign-in" | "retry" | "";
  icon: "person" | "warning" | null;
}

/**
 * The small mark inside a live folder's folder drawing, like Arc's (a GitHub folder shows GitHub's mark on the
 * folder): GitHub's own icon as a one-color silhouette, or a feed symbol.
 */
function createLiveSourceGlyph(source: LiveFolderSource): Element {
  if (source.kind === "github") {
    return createFavicon(null, GITHUB_SITE_URL, "live-folder-glyph");
  }
  return createIcon("feed", "icon live-folder-glyph");
}

/**
 * A live folder's status line: why it is empty, or what went wrong with its last refresh. Null when the folder shows
 * its items and the last refresh went well (or a refresh of a filled folder is running).
 */
function describeLiveStatus(folder: FolderItem, source: LiveFolderSource, status: LiveFolderStatus | undefined): LiveStatusLine | null {
  const isEmpty = folder.childIds.length === 0;
  if (status === undefined || status.state === "loading") {
    return isEmpty ? { text: "Loading…", action: "", icon: null } : null;
  }
  if (status.state === "signedOut") {
    return { text: "Sign in to GitHub", action: "sign-in", icon: "person" };
  }
  if (status.state === "failed") {
    return { text: "Couldn’t refresh. Try again", action: "retry", icon: "warning" };
  }
  if (!isEmpty) {
    return null;
  }
  const emptyText = source.kind === "github" ? EMPTY_LIVE_FOLDER_TEXTS[source.list] : EMPTY_LIVE_FOLDER_TEXTS.feed;
  return { text: emptyText, action: "", icon: null };
}

/**
 * Builds a live folder's status line, one level inside the folder.
 */
function renderLiveStatusRow(folder: FolderItem, line: LiveStatusLine, depth: number): HTMLElement {
  const row = createElement("div", "row live-status-row");
  row.dataset.key = `live-status:${folder.id}`;
  row.dataset.presence = "row";
  row.dataset.row = "live-status";
  row.dataset.itemId = folder.id;
  row.dataset.liveAction = line.action;
  row.classList.toggle("is-actionable", line.action !== "");
  setIndent(row, depth);
  const iconSlot = createElement("span", "row-icon-slot");
  if (line.icon !== null) {
    iconSlot.append(createIcon(line.icon));
  }
  row.append(iconSlot, createElement("span", "row-title", line.text));
  return row;
}

/**
 * The number of a live folder's items that arrived since you last looked (the selected one does not count).
 */
function countUnreadChildren(folder: FolderItem, context: RowContext): number {
  let count = 0;
  for (const childId of folder.childIds) {
    const child = context.state.items[childId];
    if (child !== undefined && child.kind === "tab" && child.isUnread === true && child.id !== context.selectedTabId) {
      count = count + 1;
    }
  }
  return count;
}

/**
 * Builds a folder row and, when it is open, its children one level deeper. A closed folder still shows the
 * selected tab beneath it, like Arc, so you never lose sight of the page you are on. A live folder shows its source's
 * icon, how many items are new, and a status line when it is empty or its refresh failed; nothing can be dropped
 * into it (its source decides what it holds).
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

  const live = folder.live;
  row.classList.toggle("is-live", live !== undefined);
  const iconSlot = createElement("span", "row-icon-slot folder-icon");
  iconSlot.append(createIcon(folder.isOpen ? "folderOpen" : "folderClosed"));
  if (live !== undefined) {
    iconSlot.append(createLiveSourceGlyph(live.source));
  }
  row.append(iconSlot);

  const title = createElement("span", "row-title");
  if (context.renamingItemId === folder.id) {
    title.append(createRenameInput(folder.id, folder.title, context));
  } else {
    title.textContent = folder.title;
  }
  row.append(title);
  const unreadCount = live === undefined ? 0 : countUnreadChildren(folder, context);
  if (unreadCount > 0) {
    const badge = createElement("span", "live-unread-count", String(unreadCount));
    badge.title = unreadCount === 1 ? "1 new item" : `${unreadCount} new items`;
    row.append(badge);
  }

  markDraggable(row, folder.id);
  markDropTarget(row, location, index, live === undefined ? folder.id : null);

  const rows: HTMLElement[] = [row];
  const childLocation: ItemLocation = { kind: "folder", folderId: folder.id };
  if (folder.isOpen && live === undefined) {
    rows.push(...renderItemRows(folder.childIds, childLocation, depth + 1, context));
    return rows;
  }
  if (folder.isOpen && live !== undefined) {
    const childRows = renderItemRows(folder.childIds, childLocation, depth + 1, context);
    const statusLine = describeLiveStatus(folder, live.source, context.runtime.liveFolders[folder.id]);
    if (statusLine !== null) {
      childRows.push(renderLiveStatusRow(folder, statusLine, depth + 1));
    }
    rows.push(...childRows);
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
 * The bouncing bars under the logo of a Favorite whose page plays sound in the background, in the site's colour when
 * it is known (white otherwise). Keyed, so redraws keep the same element and its bars keep moving.
 */
function createEqualizer(accent: string | undefined): HTMLElement {
  const equalizer = createElement("span", "tile-equalizer");
  equalizer.dataset.key = "equalizer";
  equalizer.setAttribute("aria-label", "Playing sound");
  if (accent !== undefined) {
    equalizer.style.setProperty("--equalizer-color", accent);
  }
  for (let barIndex = 0; barIndex < EQUALIZER_BAR_COUNT; barIndex += 1) {
    equalizer.append(createElement("span", "tile-equalizer-bar"));
  }
  return equalizer;
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
  const isSelected = tab.id === context.selectedTabId;
  tile.classList.toggle("is-selected", isSelected);
  tile.classList.toggle("is-loaded", context.runtime.tabs[tab.id] !== undefined);
  // Arc borders the selected Favorite in its icon's colour (main/faviconAccents.ts finds it).
  const iconAddress = getFaviconAddress(tab.faviconUrl, tab.url);
  const iconColor = iconAddress === null ? undefined : context.runtime.faviconAccents[iconAddress];
  const accent = isSelected ? iconColor : undefined;
  tile.classList.toggle("has-accent", accent !== undefined);
  if (accent !== undefined) {
    tile.style.setProperty("--tile-accent", accent);
  } else {
    tile.style.removeProperty("--tile-accent");
  }
  tile.append(isNoteUrl(tab.url) ? createIcon("note", "icon note-icon") : createFavicon(tab.faviconUrl, tab.url, "favicon favicon-large"));

  // Sound playing somewhere else shows a small equaliser; on the tab you are looking at it would only distract (the
  // user's choice, 2026-10-27). The dot is only for a page that changed while you were elsewhere.
  const isPlayingElsewhere = context.runtime.tabs[tab.id]?.isAudible === true && !isSelected;
  const isUnread = tab.isUnread === true && !isSelected;
  if (isPlayingElsewhere) {
    tile.append(createEqualizer(iconColor));
  } else if (isUnread) {
    tile.append(createElement("span", "tile-unread-dot"));
  }

  markDraggable(tile, tab.id);
  markDropTarget(tile, location, index, null, true);
  return tile;
}
