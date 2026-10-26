/**
 * WHY this file exists:
 *   Right-click menus are native macOS menus, built in the main process because only it can call Electron's Menu.
 *   This file builds them: the tab / folder menu, the Space menu, the + menu, the split-view menu, and the menu
 *   inside web pages (Electron shows none by default, so links could not be opened in a new tab).
 *
 * Data source:
 *   BrowserState (through MenuHost.getState), whether a tab's page is loaded, and Electron's context-menu params.
 *
 * Data flow:
 *   sidebar right-click → action showMenu → showMenuRequest() → Menu.popup → click → host.runAction(action)
 *   page right-click → tabViews.ts onContextMenu → showPageContextMenu() → Menu.popup
 */
import { app, clipboard, dialog, Menu } from "electron";
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions, WebContents } from "electron";
import type { BrowserAction, MenuRequest, SidebarCommand } from "../shared/actions";
import type { BrowserState, ItemId, Space, TabItem } from "../shared/types";
import { getSelectedTabId, listVisibleTabIds } from "./state";
import { applyPreset, GRAIN_CHOICES, THEME_PRESETS } from "./themePresets";
import { findLocation, findRootLocation, findSpace, findSplitOfTab, findTab } from "./tree";
import { SEARCH_URL_PREFIX } from "./urls";

/** What the menus need from main.ts. */
export interface MenuHost {
  getState(): BrowserState;
  getWindow(): BrowserWindow | null;
  runAction(action: BrowserAction): void;
  sendSidebarCommand(command: SidebarCommand): void;
  openInNewTab(url: string, inBackground: boolean): void;
  isTabLoaded(tabId: ItemId): boolean;
}

/** Most tabs listed in a "Split View with" submenu; more would make the menu taller than the screen. */
const SPLIT_CANDIDATES_LIMIT = 15;

/** Longest selected text quoted in "Search for …". */
const SEARCH_LABEL_MAX_LENGTH = 30;

/**
 * Shows a menu at the mouse position in the main window.
 */
function popUp(host: MenuHost, template: MenuItemConstructorOptions[]): void {
  const window = host.getWindow();
  if (window === null || template.length === 0) {
    return;
  }
  Menu.buildFromTemplate(template).popup({ window: window });
}

/**
 * The name a tab shows in menus: the user's rename or the page title, shortened.
 */
function getMenuLabel(tab: TabItem): string {
  const name = tab.customTitle ?? tab.title;
  const maximumLength = 48;
  return name.length > maximumLength ? `${name.slice(0, maximumLength - 1)}…` : name;
}

/**
 * Builds "Move to Space ▸": every Space except the one the item is in.
 */
function buildMoveToSpaceMenu(host: MenuHost, itemId: ItemId): MenuItemConstructorOptions {
  const state = host.getState();
  const root = findRootLocation(state, itemId);
  const currentSpaceId = root !== null && (root.kind === "pinned" || root.kind === "today") ? root.spaceId : null;
  const otherSpaces = state.spaces.filter((space) => space.id !== currentSpaceId);
  const submenu: MenuItemConstructorOptions[] = otherSpaces.map((space) => ({
    label: `${space.icon}  ${space.name}`,
    click: () => host.runAction({ type: "moveItemToSpace", itemId: itemId, spaceId: space.id }),
  }));
  return { label: "Move to Space", submenu: submenu, enabled: submenu.length > 0 };
}

/**
 * Builds "Split View with ▸": the other tabs of the active Space, in sidebar order.
 */
function buildSplitWithMenu(host: MenuHost, tabId: ItemId): MenuItemConstructorOptions {
  const state = host.getState();
  const candidateIds = listVisibleTabIds(state).filter((candidateId) => candidateId !== tabId);
  const submenu: MenuItemConstructorOptions[] = [];
  for (const candidateId of candidateIds.slice(0, SPLIT_CANDIDATES_LIMIT)) {
    const candidate = findTab(state, candidateId);
    if (candidate === undefined || findLocation(state, candidateId)?.kind === "favorites") {
      continue;
    }
    submenu.push({ label: getMenuLabel(candidate), click: () => host.runAction({ type: "splitTabs", firstTabId: tabId, secondTabId: candidateId }) });
  }
  return { label: "Split View with", submenu: submenu, enabled: submenu.length > 0 };
}

/**
 * Builds the split-view part of a tab menu: separate, unsplit and orientation for a tab in a split, or "Split with".
 */
function buildSplitItems(host: MenuHost, tabId: ItemId): MenuItemConstructorOptions[] {
  const state = host.getState();
  const splitId = findSplitOfTab(state, tabId);
  if (splitId === null) {
    return [buildSplitWithMenu(host, tabId)];
  }
  const split = state.items[splitId];
  const orientation = split !== undefined && split.kind === "split" ? split.orientation : "horizontal";
  return [
    buildSplitWithMenu(host, tabId),
    { label: "Separate from Split View", click: () => host.runAction({ type: "separateTabFromSplit", tabId: tabId }) },
    { label: "Separate All Tabs", click: () => host.runAction({ type: "unsplit", splitId: splitId }) },
    {
      label: "Side by Side",
      type: "radio",
      checked: orientation === "horizontal",
      click: () => host.runAction({ type: "setSplitOrientation", splitId: splitId, orientation: "horizontal" }),
    },
    {
      label: "Stacked",
      type: "radio",
      checked: orientation === "vertical",
      click: () => host.runAction({ type: "setSplitOrientation", splitId: splitId, orientation: "vertical" }),
    },
  ];
}

/**
 * Builds the pin / Favorites part of a tab menu, which depends on where the tab lives.
 */
function buildPlacementItems(host: MenuHost, tab: TabItem): MenuItemConstructorOptions[] {
  const state = host.getState();
  const root = findRootLocation(state, tab.id);
  const isToday = root !== null && root.kind === "today";
  const isFavorite = findLocation(state, tab.id)?.kind === "favorites";
  const items: MenuItemConstructorOptions[] = [];

  if (isToday) {
    items.push({ label: "Pin Tab", accelerator: "CommandOrControl+D", click: () => host.runAction({ type: "pinTab", tabId: tab.id }) });
  } else if (!isFavorite) {
    items.push({ label: "Unpin Tab", accelerator: "CommandOrControl+D", click: () => host.runAction({ type: "unpinTab", tabId: tab.id }) });
  }
  if (isFavorite) {
    items.push({ label: "Move to Pinned", click: () => host.runAction({ type: "pinTab", tabId: tab.id }) });
    items.push({ label: "Remove from Favorites", click: () => host.runAction({ type: "unpinTab", tabId: tab.id }) });
  } else {
    items.push({ label: "Add to Favorites", click: () => host.runAction({ type: "addToFavorites", tabId: tab.id }) });
  }
  if (tab.homeUrl !== null && tab.url !== tab.homeUrl) {
    items.push({ label: "Back to Pinned URL", click: () => host.runAction({ type: "resetTab", tabId: tab.id }) });
  }
  return items;
}

/**
 * Builds the closing part of a tab menu: Today tabs close into the Archive; Pinned tabs and Favorites can have
 * their page put away, or be deleted (moved to the Archive).
 */
function buildCloseItems(host: MenuHost, tab: TabItem): MenuItemConstructorOptions[] {
  const state = host.getState();
  const root = findRootLocation(state, tab.id);
  const isToday = root !== null && root.kind === "today";
  if (isToday) {
    return [{ label: "Close Tab", accelerator: "CommandOrControl+W", click: () => host.runAction({ type: "closeTab", tabId: tab.id }) }];
  }
  return [
    { label: "Close Page", enabled: host.isTabLoaded(tab.id), click: () => host.runAction({ type: "closeTab", tabId: tab.id }) },
    { label: "Delete (Move to Archive)", click: () => host.runAction({ type: "deleteItem", itemId: tab.id }) },
  ];
}

/**
 * The menu for a tab row or Favorite tile.
 */
function buildTabMenu(host: MenuHost, tab: TabItem): MenuItemConstructorOptions[] {
  const isFavorite = findLocation(host.getState(), tab.id)?.kind === "favorites";
  const muteLabel = tab.isMuted ? "Unmute Tab" : "Mute Tab";
  const template: MenuItemConstructorOptions[] = [
    { label: "Rename…", click: () => host.sendSidebarCommand({ kind: "beginRename", itemId: tab.id }), enabled: !isFavorite },
    { label: "Copy Link", click: () => clipboard.writeText(tab.url) },
    { label: "Duplicate", click: () => host.runAction({ type: "duplicateTab", tabId: tab.id }) },
    { type: "separator" },
    ...buildPlacementItems(host, tab),
    buildMoveToSpaceMenu(host, tab.id),
  ];
  if (!isFavorite) {
    template.push(...buildSplitItems(host, tab.id));
  }
  template.push({ label: muteLabel, click: () => host.runAction({ type: "setTabMuted", tabId: tab.id, isMuted: !tab.isMuted }) });
  template.push({ type: "separator" });
  template.push(...buildCloseItems(host, tab));
  return template;
}

/**
 * The menu for a folder row.
 */
function buildFolderMenu(host: MenuHost, folderId: ItemId, isOpen: boolean): MenuItemConstructorOptions[] {
  return [
    { label: "Rename…", click: () => host.sendSidebarCommand({ kind: "beginRename", itemId: folderId }) },
    { label: isOpen ? "Collapse Folder" : "Expand Folder", click: () => host.runAction({ type: "toggleFolder", folderId: folderId }) },
    buildMoveToSpaceMenu(host, folderId),
    { type: "separator" },
    { label: "Delete Folder (Tabs Move to Archive)", click: () => host.runAction({ type: "deleteItem", itemId: folderId }) },
  ];
}

/**
 * Asks before deleting a Space that still has tabs, because all of them move to the Archive.
 */
function confirmDeleteSpace(host: MenuHost, space: Space): void {
  const window = host.getWindow();
  const hasItems = space.pinnedIds.length > 0 || space.todayIds.length > 0;
  if (window !== null && hasItems) {
    const deleteButtonIndex = 0;
    const answer = dialog.showMessageBoxSync(window, {
      type: "warning",
      buttons: ["Delete Space", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: `Delete the Space "${space.name}"?`,
      detail: "Its pinned and Today tabs move to the Archive, where you can restore them.",
    });
    if (answer !== deleteButtonIndex) {
      return;
    }
  }
  host.runAction({ type: "deleteSpace", spaceId: space.id });
}

/**
 * The menu for a Space: rename, icon, theme, order, delete.
 */
function buildSpaceMenu(host: MenuHost, space: Space): MenuItemConstructorOptions[] {
  const state = host.getState();
  const spaceIndex = state.spaces.findIndex((candidate) => candidate.id === space.id);
  const themeMenu: MenuItemConstructorOptions[] = THEME_PRESETS.map((preset) => ({
    label: preset.label,
    click: () => host.runAction({ type: "setSpaceTheme", spaceId: space.id, theme: applyPreset(space.theme, preset) }),
  }));
  const appearanceMenu: MenuItemConstructorOptions[] = (["light", "dark", "auto"] as const).map((appearance) => ({
    label: appearance === "auto" ? "Automatic" : appearance === "light" ? "Light" : "Dark",
    type: "radio",
    checked: space.theme.appearance === appearance,
    click: () => host.runAction({ type: "setSpaceTheme", spaceId: space.id, theme: { ...space.theme, appearance: appearance } }),
  }));
  const grainMenu: MenuItemConstructorOptions[] = GRAIN_CHOICES.map((choice) => ({
    label: choice.label,
    type: "radio",
    checked: Math.abs(space.theme.grain - choice.grain) < 0.01,
    click: () => host.runAction({ type: "setSpaceTheme", spaceId: space.id, theme: { ...space.theme, grain: choice.grain } }),
  }));

  return [
    { label: "Rename Space…", click: () => host.sendSidebarCommand({ kind: "beginSpaceRename", spaceId: space.id }) },
    {
      label: "Change Icon…",
      click: () => {
        host.sendSidebarCommand({ kind: "beginSpaceIconEdit", spaceId: space.id });
        app.showEmojiPanel();
      },
    },
    { label: "Theme", submenu: themeMenu },
    { label: "Appearance", submenu: appearanceMenu },
    { label: "Grain", submenu: grainMenu },
    { type: "separator" },
    { label: "Move Left", enabled: spaceIndex > 0, click: () => host.runAction({ type: "moveSpace", spaceId: space.id, index: spaceIndex - 1 }) },
    {
      label: "Move Right",
      enabled: spaceIndex < state.spaces.length - 1,
      click: () => host.runAction({ type: "moveSpace", spaceId: space.id, index: spaceIndex + 1 }),
    },
    { type: "separator" },
    { label: "Delete Space…", enabled: state.spaces.length > 1, click: () => confirmDeleteSpace(host, space) },
  ];
}

/**
 * The + menu at the bottom of the sidebar.
 */
function buildPlusMenu(host: MenuHost): MenuItemConstructorOptions[] {
  const state = host.getState();
  const activeSpace = findSpace(state, state.activeSpaceId);
  const nextPreset = THEME_PRESETS[state.spaces.length % THEME_PRESETS.length] ?? THEME_PRESETS[0];
  const newTheme = { colors: nextPreset?.colors ?? ["#d9d4e9"], appearance: nextPreset?.appearance ?? "auto", grain: 0 };
  return [
    { label: "New Tab", accelerator: "CommandOrControl+T", click: () => host.runAction({ type: "openCommandBar", mode: "newTab" }) },
    { label: "New Folder", click: () => host.runAction({ type: "createFolder", title: "New Folder" }) },
    {
      label: "New Space",
      click: () => host.runAction({ type: "createSpace", name: "New Space", icon: "✦", theme: newTheme }),
    },
    { type: "separator" },
    { label: activeSpace === undefined ? "Space" : `${activeSpace.icon}  ${activeSpace.name}`, enabled: false },
    ...(activeSpace === undefined ? [] : buildSpaceMenu(host, activeSpace)),
  ];
}

/**
 * The toolbar's split-view menu, for the selected tab.
 */
function buildToolbarSplitMenu(host: MenuHost): MenuItemConstructorOptions[] {
  const state = host.getState();
  const selectedTabId = getSelectedTabId(state);
  if (selectedTabId === null) {
    return [];
  }
  return buildSplitItems(host, selectedTabId);
}

/**
 * Shows the menu a sidebar request asks for.
 */
export function showMenuRequest(host: MenuHost, request: MenuRequest): void {
  const state = host.getState();
  if (request.menu === "plus") {
    popUp(host, buildPlusMenu(host));
    return;
  }
  if (request.menu === "split") {
    popUp(host, buildToolbarSplitMenu(host));
    return;
  }
  if (request.menu === "space") {
    const space = findSpace(state, request.spaceId);
    if (space !== undefined) {
      popUp(host, buildSpaceMenu(host, space));
    }
    return;
  }
  if (request.menu === "item") {
    const item = state.items[request.itemId];
    if (item?.kind === "tab") {
      popUp(host, buildTabMenu(host, item));
    }
    if (item?.kind === "folder") {
      popUp(host, buildFolderMenu(host, item.id, item.isOpen));
    }
  }
}

/**
 * Builds the link part of the page menu.
 */
function buildLinkItems(host: MenuHost, params: ContextMenuParams): MenuItemConstructorOptions[] {
  if (params.linkURL === "") {
    return [];
  }
  return [
    { label: "Open Link in New Tab", click: () => host.openInNewTab(params.linkURL, false) },
    { label: "Open Link in Background Tab", click: () => host.openInNewTab(params.linkURL, true) },
    { label: "Copy Link Address", click: () => clipboard.writeText(params.linkURL) },
    { type: "separator" },
  ];
}

/**
 * Builds the image part of the page menu.
 */
function buildImageItems(host: MenuHost, contents: WebContents, params: ContextMenuParams): MenuItemConstructorOptions[] {
  if (params.mediaType !== "image" || params.srcURL === "") {
    return [];
  }
  return [
    { label: "Open Image in New Tab", click: () => host.openInNewTab(params.srcURL, false) },
    { label: "Copy Image", click: () => contents.copyImageAt(params.x, params.y) },
    { label: "Copy Image Address", click: () => clipboard.writeText(params.srcURL) },
    { type: "separator" },
  ];
}

/**
 * Builds the text part of the page menu: editing commands in fields, Copy and Search for selected text.
 */
function buildTextItems(host: MenuHost, params: ContextMenuParams): MenuItemConstructorOptions[] {
  if (params.isEditable) {
    return [
      { role: "undo", enabled: params.editFlags.canUndo },
      { role: "redo", enabled: params.editFlags.canRedo },
      { type: "separator" },
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
      { type: "separator" },
    ];
  }
  const selectedText = params.selectionText.trim();
  if (selectedText === "") {
    return [];
  }
  const shortText = selectedText.length > SEARCH_LABEL_MAX_LENGTH ? `${selectedText.slice(0, SEARCH_LABEL_MAX_LENGTH - 1)}…` : selectedText;
  return [
    { role: "copy" },
    { label: `Search for “${shortText}”`, click: () => host.openInNewTab(SEARCH_URL_PREFIX + encodeURIComponent(selectedText), false) },
    { type: "separator" },
  ];
}

/**
 * Shows the right-click menu inside a web page: link, image and text commands, then navigation and Inspect.
 */
export function showPageContextMenu(host: MenuHost, contents: WebContents, params: ContextMenuParams): void {
  const history = contents.navigationHistory;
  const template: MenuItemConstructorOptions[] = [
    ...buildLinkItems(host, params),
    ...buildImageItems(host, contents, params),
    ...buildTextItems(host, params),
    { label: "Back", enabled: history.canGoBack(), click: () => history.goBack() },
    { label: "Forward", enabled: history.canGoForward(), click: () => history.goForward() },
    { label: "Reload", click: () => contents.reload() },
    { type: "separator" },
    { label: "Inspect Element", click: () => contents.inspectElement(params.x, params.y) },
  ];
  popUp(host, template);
}
