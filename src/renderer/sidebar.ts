/**
 * WHY this file exists:
 *   Draws the window's own page: the sidebar (Favorites, Space title, Pinned, the divider with Clear, New Tab, Today,
 *   and the bottom bar with Library, Space switcher and +) and the toolbar above the page. It holds almost no data
 *   of its own; it redraws from each new state.
 *
 * Data source:
 *   BrowserState and RuntimeState from window.browserApi (fetched on load, pushed after every change), plus two
 *   pieces of page-only state: which row is being renamed, and whether a drag is in progress.
 *
 * Data flow:
 *   state arrives → renderAll() → favorites / space content / bottom bar / toolbar → clicks → dispatch(action)
 *
 * Pattern: "render from state". We never patch one row by hand; we describe the whole sidebar from the newest state
 * and morph.ts folds that description into the elements already on the page, so hover states and transitions
 * survive, new rows grow in and removed rows shrink away. Clicks are handled by sidebarEvents.ts and dragDrop.ts
 * from data attributes, never by handlers on the rows.
 */
import type { SidebarCommand } from "../shared/actions.js";
import { SIDEBAR_MAX_WIDTH_PX, SIDEBAR_MIN_WIDTH_PX, SIDEBAR_WIDTH_PX } from "../shared/settings.js";
import type { BrowserState, ItemId, ItemLocation, RuntimeState, Space, SpaceId, TabItem } from "../shared/types";
import { createActionButton, createElement, createFavicon, dispatch } from "./dom.js";
import { installDragAndDrop, markListDropZone, onDragStateChanged, setItemDraggedInOtherWindow } from "./dragDrop.js";
import { morphChildren } from "./morph.js";
import type { MorphOptions } from "./morph.js";
import { renderFavoriteTile, renderItemRows, startRowRedraw } from "./rows.js";
import type { RowContext } from "./rows.js";
import { installSidebarEvents } from "./sidebarEvents.js";
import { createIcon, installSymbols } from "./icons.js";
import { applySpaceTheme, onSystemAppearanceChange } from "./theme.js";
import { createNavigationButtons, renderToolbar } from "./toolbar.js";
import { playSound } from "./sounds.js";
import { installTabTooltipHover } from "./tabTooltipHover.js";
import { showNoteEditor } from "./noteEditor.js";
import { createSpaceIcon } from "./spaceIcon.js";
import { showEaselEditor } from "./easelEditor.js";
import { getEaselId } from "../shared/easels.js";
import { getNoteId } from "../shared/notes.js";
import { isDeveloperModeOn } from "../shared/developerMode.js";

/** Horizontal scroll distance (in wheel delta units) that counts as a swipe to the next Space. Our choice. */
const SWIPE_THRESHOLD = 60;

/** After a swipe, ignore further wheel events for this long, so one gesture moves one Space. */
const SWIPE_COOLDOWN_MS = 450;

/** The newest state and runtime facts received. */
let currentState: BrowserState | null = null;
let currentRuntime: RuntimeState = {
  tabs: {},
  activeDownloadCount: 0,
  isSidebarPeeking: false,
  media: null,
  isNewTabPending: false,
  liveFolders: {},
  tabIdsInOtherWindows: [],
  editorTabIdsHere: [],
  itemDraggedInOtherWindow: null,
  extensionsBeingAdded: [],
  isWindowActive: true,
};

/** The Note or Easel tab whose editor this page last told main it has open, or null. */
let reportedEditorTabId: ItemId | null = null;

/** The sidebar item, Space name or Space icon being edited inline, or null. */
let renamingItemId: ItemId | null = null;
let renamingSpaceId: SpaceId | null = null;

/** True while a row is being dragged: redraws wait until the drop, so the dragged row is not replaced mid-drag. */
let isDragging = false;
let hasPendingRedraw = false;

/** The Space shown in the last redraw, to slide the content when it changes. */
let lastRenderedSpaceId: SpaceId | null = null;

/** False until the first draw: the first state just appears, later changes animate. */
let hasRenderedOnce = false;

/** How long the pointer may be away from a peeking sidebar before it hides again. Our choice: avoids flicker. */
const PEEK_HIDE_DELAY_MS = 250;

/** The width being dragged right now, or null. While dragging, the page shows this instead of the saved width. */
let draggedSidebarWidth: number | null = null;

/** A pending "hide the peeking sidebar", cancelled when the pointer comes back in time. */
let peekHideTimer: number | null = null;

/** Accumulated horizontal wheel distance of the current swipe, and when the last swipe fired. */
let swipeDistance = 0;
let lastSwipeAt = 0;

/**
 * Returns the selected tab of the active Space, or null.
 */
function getSelectedTabId(state: BrowserState): ItemId | null {
  // "?? null" turns a missing entry (undefined) into null, so both mean "nothing selected".
  return state.selectedTabIdBySpace[state.activeSpaceId] ?? null;
}

/**
 * Returns the active Space. The main process guarantees it exists.
 */
function getActiveSpace(state: BrowserState): Space | undefined {
  return state.spaces.find((space) => space.id === state.activeSpaceId);
}

/**
 * Builds the shared context every row needs.
 */
function createRowContext(state: BrowserState): RowContext {
  return {
    state: state,
    runtime: currentRuntime,
    // While the Command Bar makes a new tab, "New Tab" carries the highlight instead (Arc's shot 3).
    selectedTabId: currentRuntime.isNewTabPending ? null : getSelectedTabId(state),
    renamingItemId: renamingItemId,
    onRenameFinished: () => {
      renamingItemId = null;
      renderAll();
    },
  };
}

/**
 * Draws the sidebar header buttons next to the traffic lights.
 */
function renderHeader(state: BrowserState): void {
  const header = document.getElementById("sidebar-header-buttons");
  if (header === null) {
    return;
  }
  const hideButton = createActionButton("sidebar", "Hide sidebar (⌘S)", "header-button", "hide-sidebar");
  hideButton.dataset.key = "hide-sidebar";
  const buttons: HTMLElement[] = [hideButton];
  // A site in Developer Mode: back, forward and reload ▾ move up here, right-aligned (Arc's shot 5).
  const selectedTabId = getSelectedTabId(state);
  const selectedItem = selectedTabId === null ? undefined : state.items[selectedTabId];
  const selectedTab = selectedItem !== undefined && selectedItem.kind === "tab" ? selectedItem : null;
  if (selectedTab !== null && isDeveloperModeOn(state, selectedTab.url)) {
    const navigation = createElement("div", "header-navigation");
    navigation.dataset.key = "navigation";
    navigation.append(...createNavigationButtons(selectedTab, currentRuntime.tabs[selectedTab.id], "header-button", true));
    buttons.push(navigation);
  }
  morphChildren(header, buttons, { animate: false });
}

/**
 * Draws the Favorites tiles of the active Space's profile, and a drop zone for adding more.
 */
function renderFavorites(state: BrowserState, space: Space, context: RowContext, motion: MorphOptions): void {
  const container = document.getElementById("favorites");
  if (container === null) {
    return;
  }
  const profile = state.profiles.find((candidate) => candidate.id === space.profileId);
  const favoriteIds = profile === undefined ? [] : profile.favoriteIds;
  const location: ItemLocation = { kind: "favorites", profileId: space.profileId };

  const tiles: HTMLElement[] = [];
  favoriteIds.forEach((tabId, index) => {
    const tab = state.items[tabId];
    if (tab !== undefined && tab.kind === "tab") {
      tiles.push(renderFavoriteTile(tab, location, index, context));
    }
  });
  // The end zone's drop location follows the active Space's profile on every redraw.
  const endZone = createElement("div", "favorites-end-zone");
  endZone.dataset.key = "favorites-end";
  endZone.title = "Drop a tab here to make it a Favorite";
  markListDropZone(endZone, location, "end");
  morphChildren(container, [...tiles, endZone], motion);
  container.classList.toggle("is-empty", tiles.length === 0);
}

/**
 * Builds the inline field used to rename a Space.
 */
function createSpaceNameInput(space: Space): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "rename-input";
  input.value = space.name;
  input.setAttribute("aria-label", "Space name");
  let isFinished = false;

  const finish = (shouldSave: boolean): void => {
    if (isFinished) {
      return;
    }
    isFinished = true;
    if (shouldSave) {
      dispatch({ type: "renameSpace", spaceId: space.id, name: input.value });
    }
    renamingSpaceId = null;
    renderAll();
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      finish(true);
    }
    if (event.key === "Escape") {
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
  // Only the field that made it into the page (morphing may keep an older one) takes the focus.
  requestAnimationFrame(() => {
    if (input.isConnected) {
      input.focus();
      input.select();
    }
  });
  return input;
}

/**
 * Builds the Space title row: emoji and name. Clicking collapses or expands Pinned; double-click renames;
 * right-click opens the Space menu. It is also a drop zone for the top of Pinned.
 */
function renderSpaceTitle(space: Space): HTMLElement {
  const row = createElement("div", "space-title");
  row.dataset.key = "space-title";
  row.dataset.row = "space-title";
  row.dataset.spaceId = space.id;
  row.dataset.pinnedOpen = String(space.isPinnedOpen);
  row.setAttribute("role", "button");
  row.setAttribute("aria-expanded", String(space.isPinnedOpen));
  row.tabIndex = 0;

  const icon = createSpaceIcon(space.icon, "space-title-icon");
  const name = createElement("span", "space-title-name", space.name);
  if (renamingSpaceId === space.id) {
    name.replaceChildren(createSpaceNameInput(space));
  }
  const moreButton = createActionButton("more", "Space menu", "row-action space-more", "space-menu", { spaceId: space.id });
  row.append(icon, name, moreButton);
  markListDropZone(row, { kind: "pinned", spaceId: space.id }, "start");
  return row;
}

/**
 * Builds the divider between Pinned and Today, with Arc's "Clear" button that archives every Today tab. Like Arc's,
 * it is only there while Today has tabs (shot 4: with Today empty, New Tab follows Pinned directly).
 */
function renderDivider(space: Space): HTMLElement {
  const divider = createElement("div", "today-divider");
  divider.dataset.key = "divider";
  divider.dataset.presence = "row";
  divider.append(createElement("span", "divider-line"));
  const clearButton = createElement("button", "divider-clear", "↓ Clear") as HTMLButtonElement;
  clearButton.type = "button";
  clearButton.dataset.action = "clear-today";
  clearButton.title = "Move all Today tabs to the Archive (⇧⌘K)";
  divider.append(clearButton);
  // Dropping on the divider puts an item at the end of Pinned.
  markListDropZone(divider, { kind: "pinned", spaceId: space.id }, "end");
  return divider;
}

/**
 * Builds the "+ New Tab" row. It opens the Command Bar, like ⌘T. Dropping on it puts an item at the top of Today.
 */
function renderNewTabRow(space: Space): HTMLElement {
  const row = createElement("div", "row new-tab-row");
  row.classList.toggle("is-selected", currentRuntime.isNewTabPending);
  row.dataset.key = "new-tab";
  row.dataset.row = "new-tab";
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  const iconSlot = createElement("span", "row-icon-slot");
  iconSlot.append(createIcon("plus"));
  row.append(iconSlot, createElement("span", "row-title", "New Tab"));
  markListDropZone(row, { kind: "today", spaceId: space.id }, "start");
  return row;
}

/**
 * Draws the active Space: title, Pinned (when open), divider, New Tab and Today.
 */
function renderSpaceContent(state: BrowserState, space: Space, context: RowContext, motion: MorphOptions): void {
  const content = document.getElementById("space-content");
  if (content === null) {
    return;
  }

  const pinnedLocation: ItemLocation = { kind: "pinned", spaceId: space.id };
  const todayLocation: ItemLocation = { kind: "today", spaceId: space.id };
  const children: HTMLElement[] = [renderSpaceTitle(space)];
  startRowRedraw();

  if (space.isPinnedOpen) {
    const pinnedSection = createElement("div", "item-list pinned-list");
    pinnedSection.dataset.key = "pinned-list";
    pinnedSection.append(...renderItemRows(space.pinnedIds, pinnedLocation, 0, context));
    children.push(pinnedSection);
  }
  if (space.todayIds.length > 0) {
    children.push(renderDivider(space));
  }
  children.push(renderNewTabRow(space));

  const todaySection = createElement("div", "item-list today-list");
  todaySection.dataset.key = "today-list";
  todaySection.append(...renderItemRows(space.todayIds, todayLocation, 0, context));
  const todayEnd = createElement("div", "list-end-zone");
  todayEnd.dataset.key = "today-end";
  markListDropZone(todayEnd, todayLocation, "end");
  todaySection.append(todayEnd);
  children.push(todaySection);

  morphChildren(content, children, motion);
}

/**
 * Plays a short slide when the active Space changes, in the direction of the new Space, like Arc's swipe.
 */
function slideIfSpaceChanged(state: BrowserState, content: HTMLElement): void {
  const previousSpaceId = lastRenderedSpaceId;
  lastRenderedSpaceId = state.activeSpaceId;
  if (previousSpaceId === null || previousSpaceId === state.activeSpaceId) {
    return;
  }
  const previousIndex = state.spaces.findIndex((space) => space.id === previousSpaceId);
  const newIndex = state.spaces.findIndex((space) => space.id === state.activeSpaceId);
  const slideClass = newIndex > previousIndex ? "slide-from-right" : "slide-from-left";
  content.classList.remove("slide-from-right", "slide-from-left");
  // Reading offsetWidth restarts the CSS animation when the same class is added again.
  void content.offsetWidth;
  content.classList.add(slideClass);
}

/**
 * Builds one Space switcher button: the active Space shows its emoji, the others a dot (their emoji on hover).
 * Dropping a sidebar item on it moves the item to that Space.
 */
function renderSpaceButton(space: Space, isActive: boolean): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = isActive ? "space-button is-active" : "space-button";
  button.dataset.key = `space:${space.id}`;
  button.dataset.action = "switch-space";
  button.dataset.spaceId = space.id;
  // Dropping a sidebar item on a Space button moves it to that Space (dragDrop.ts).
  button.dataset.drop = "space";
  button.title = space.name;
  button.setAttribute("aria-label", space.name);
  button.setAttribute("aria-pressed", String(isActive));
  button.append(createSpaceIcon(space.icon, "space-button-icon"));
  button.append(createElement("span", "space-button-dot"));
  return button;
}

/**
 * Draws the bottom bar: Library on the left, the Space switcher in the middle, the + menu on the right.
 */
function renderBottomBar(state: BrowserState): void {
  const bar = document.getElementById("bottom-bar");
  if (bar === null) {
    return;
  }
  const libraryButton = createActionButton("archive", "Library and Archive (⇧⌘L)", "bottom-button", "open-library");
  libraryButton.classList.toggle("has-activity", currentRuntime.activeDownloadCount > 0);
  const switcher = createElement("nav", "space-switcher");
  switcher.setAttribute("aria-label", "Spaces");
  for (const space of state.spaces) {
    switcher.append(renderSpaceButton(space, space.id === state.activeSpaceId));
  }
  const plusButton = createActionButton("plus", "New Space, folder or tab", "bottom-button", "plus-menu");
  morphChildren(bar, [libraryButton, switcher, plusButton], { animate: false });
}

/**
 * Draws the small media player for a tab playing in the background: its icon and title (click to go there),
 * play / pause, and × (pause and hide).
 */
function renderMediaPlayer(state: BrowserState): void {
  const player = document.getElementById("media-player");
  if (player === null) {
    return;
  }
  const media = currentRuntime.media;
  const mediaItem = media === null ? undefined : state.items[media.tabId];
  if (media === null || mediaItem === undefined || mediaItem.kind !== "tab") {
    player.hidden = true;
    morphChildren(player, [], { animate: false });
    return;
  }
  const titleButton = document.createElement("button");
  titleButton.type = "button";
  titleButton.className = "media-title";
  titleButton.title = "Go to the tab";
  titleButton.dataset.action = "media-select";
  titleButton.dataset.itemId = media.tabId;
  titleButton.append(createFavicon(mediaItem.faviconUrl, mediaItem.url), createElement("span", "media-title-text", mediaItem.customTitle ?? mediaItem.title));
  const playLabel = media.isPlaying ? "Pause" : "Play";
  const playButton = createActionButton(media.isPlaying ? "pause" : "play", playLabel, "media-button", "media-toggle");
  const closeButton = createActionButton("close", "Stop and hide", "media-button", "media-dismiss");
  morphChildren(player, [titleButton, playButton, closeButton], { animate: false });
  player.hidden = false;
}

/** Brightness (0…1) above which the toolbar's text and icons turn dark. */
const LIGHT_TOOLBAR_LUMINANCE = 0.55;

/**
 * A page whose top is nearly black gets a grey toolbar instead, like Arc's: GitHub's #010409 header shows a #424242
 * toolbar in the user's screenshots (shots 3 and 4, window in the background) and #3a3a3a in their recording of the
 * active window, while Google's #202124 is matched as is (shot 1). One sample each side, so the threshold sits
 * between them.
 */
const NEAR_BLACK_LUMINANCE = 0.06;
const NEAR_BLACK_TOOLBAR_COLOR = "#424242";
const NEAR_BLACK_TOOLBAR_COLOR_ACTIVE = "#3a3a3a";

/**
 * Returns a "#rrggbb" color's perceived brightness, 0 (black) to 1 (white).
 */
function getLuminance(hex: string): number {
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.299 * red + 0.587 * green + 0.114 * blue;
}

/**
 * Tints the card's toolbar with the selected page's color, like Arc, with text and icons that stay readable on it.
 * Without a known color the card takes the theme's default.
 */
function applyToolbarTint(selectedTabId: ItemId | null): void {
  const card = document.getElementById("card");
  if (card === null) {
    return;
  }
  const color = selectedTabId === null ? null : currentRuntime.tabs[selectedTabId]?.toolbarColor ?? null;
  if (color === null || !/^#[0-9a-f]{6}$/.test(color)) {
    card.style.removeProperty("--card-bg");
    card.dataset.toolbarTone = document.documentElement.dataset.appearance === "light" ? "light" : "dark";
    return;
  }
  const nearBlackColor = currentRuntime.isWindowActive ? NEAR_BLACK_TOOLBAR_COLOR_ACTIVE : NEAR_BLACK_TOOLBAR_COLOR;
  const shownColor = getLuminance(color) < NEAR_BLACK_LUMINANCE ? nearBlackColor : color;
  card.style.setProperty("--card-bg", shownColor);
  card.dataset.toolbarTone = getLuminance(shownColor) > LIGHT_TOOLBAR_LUMINANCE ? "light" : "dark";
}

/**
 * Shows the "No tab open" message only while the active Space has no selected tab, and "Open in another window"
 * while another window has the selected tab's page on screen.
 */
function updateEmptyCard(selectedTabId: ItemId | null): void {
  const emptyCard = document.getElementById("empty-card");
  if (emptyCard !== null) {
    emptyCard.hidden = selectedTabId !== null;
  }
  const elsewhereCard = document.getElementById("elsewhere-card");
  if (elsewhereCard !== null) {
    elsewhereCard.hidden = selectedTabId === null || !currentRuntime.tabIdsInOtherWindows.includes(selectedTabId);
  }
}

/**
 * Updates the window title (shown in Mission Control and the Window menu) to the selected page's name.
 */
function updateDocumentTitle(state: BrowserState, selectedTabId: ItemId | null): void {
  const selectedItem = selectedTabId === null ? undefined : state.items[selectedTabId];
  const selectedTab = selectedItem !== undefined && selectedItem.kind === "tab" ? (selectedItem as TabItem) : null;
  document.title = selectedTab === null ? "Sidebar Browser" : selectedTab.customTitle ?? selectedTab.title;
}

/**
 * Redraws everything from the newest state. While a drag is in progress, waits until it ends.
 */
function renderAll(): void {
  const state = currentState;
  if (state === null) {
    return;
  }
  if (isDragging) {
    hasPendingRedraw = true;
    return;
  }
  const space = getActiveSpace(state);
  if (space === undefined) {
    return;
  }

  const context = createRowContext(state);
  document.body.classList.toggle("sidebar-hidden", !state.settings.isSidebarVisible);
  document.body.classList.toggle("sidebar-peeking", currentRuntime.isSidebarPeeking);
  // An item dragged in another window shows this sidebar's drop places too (the Favorites end zone).
  document.body.classList.toggle("is-dragging", currentRuntime.itemDraggedInOtherWindow !== null);
  applySidebarWidth(draggedSidebarWidth ?? state.settings.sidebarWidth ?? SIDEBAR_WIDTH_PX);
  applySpaceTheme(space.theme, currentRuntime.isWindowActive);
  // A Space switch replaces the whole list: it slides in instead of every row growing in one by one.
  const isSpaceSwitch = lastRenderedSpaceId !== null && lastRenderedSpaceId !== state.activeSpaceId;
  const motion: MorphOptions = { animate: hasRenderedOnce && !isSpaceSwitch };
  renderHeader(state);
  renderFavorites(state, space, context, motion);
  renderSpaceContent(state, space, context, motion);
  const content = document.getElementById("space-content");
  if (content !== null) {
    slideIfSpaceChanged(state, content);
  }
  hasRenderedOnce = true;
  renderMediaPlayer(state);
  renderBottomBar(state);
  // The page area follows the real selection even while "New Tab" carries the highlight (Arc's shot 3).
  const selectedTabId = getSelectedTabId(state);
  const selectedItem = selectedTabId === null ? undefined : state.items[selectedTabId];
  const selectedUrl = selectedItem !== undefined && selectedItem.kind === "tab" ? selectedItem.url : "";
  const noteId = getNoteId(selectedUrl);
  const easelId = getEaselId(selectedUrl);
  renderToolbar(state, currentRuntime, selectedTabId);
  applyToolbarTint(selectedTabId);
  updateEmptyCard(selectedTabId);
  const cardSlot = document.getElementById("card-slot");
  if (cardSlot !== null) {
    showEditors(cardSlot, selectedTabId, noteId, easelId);
  }
  updateDocumentTitle(state, selectedTabId);
}

/**
 * Draws the selected Note's or Easel's editor when main says this window may (one window at a time has it, like a
 * page), and tells main which editor is open. A closing editor saves first, so the report reaches main after the save.
 */
function showEditors(cardSlot: HTMLElement, selectedTabId: ItemId | null, noteId: string | null, easelId: string | null): void {
  const mayDrawEditor = selectedTabId !== null && currentRuntime.editorTabIdsHere.includes(selectedTabId);
  showNoteEditor(cardSlot, mayDrawEditor ? noteId : null);
  showEaselEditor(cardSlot, mayDrawEditor ? easelId : null);
  const hasEditor = mayDrawEditor && (noteId !== null || easelId !== null);
  const openEditorTabId = hasEditor ? selectedTabId : null;
  if (openEditorTabId === reportedEditorTabId) {
    return;
  }
  if (reportedEditorTabId !== null) {
    dispatch({ type: "reportOpenEditor", tabId: reportedEditorTabId, isOpen: false });
  }
  if (openEditorTabId !== null) {
    dispatch({ type: "reportOpenEditor", tabId: openEditorTabId, isOpen: true });
  }
  reportedEditorTabId = openEditorTabId;
}

/**
 * Turns a two-finger horizontal swipe on the sidebar into "next / previous Space", like Arc.
 */
function handleSidebarWheel(event: WheelEvent): void {
  const isHorizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
  if (!isHorizontal) {
    swipeDistance = 0;
    return;
  }
  const now = Date.now();
  if (now - lastSwipeAt < SWIPE_COOLDOWN_MS) {
    return;
  }
  swipeDistance = swipeDistance + event.deltaX;
  if (Math.abs(swipeDistance) < SWIPE_THRESHOLD) {
    return;
  }
  const offset = swipeDistance > 0 ? 1 : -1;
  swipeDistance = 0;
  lastSwipeAt = now;
  dispatch({ type: "switchSpaceByOffset", offset: offset });
}

/**
 * With the sidebar hidden: touching the left edge shows it (the page slides aside); leaving it hides it again
 * after a short delay, so a brief slip of the pointer does not make it flicker.
 */
function setUpSidebarPeek(): void {
  const edge = document.getElementById("reveal-edge");
  const sidebar = document.getElementById("sidebar");
  if (edge === null || sidebar === null) {
    return;
  }
  const cancelHide = (): void => {
    if (peekHideTimer !== null) {
      window.clearTimeout(peekHideTimer);
      peekHideTimer = null;
    }
  };
  edge.addEventListener("mouseenter", () => {
    cancelHide();
    dispatch({ type: "setSidebarPeek", isPeeking: true });
  });
  const scheduleHide = (): void => {
    if (!currentRuntime.isSidebarPeeking || peekHideTimer !== null) {
      return;
    }
    peekHideTimer = window.setTimeout(() => {
      peekHideTimer = null;
      dispatch({ type: "setSidebarPeek", isPeeking: false });
    }, PEEK_HIDE_DELAY_MS);
  };
  // The pointer's place decides, not enter/leave events: the sidebar appears under a pointer that is already there,
  // and the browser does not report entering it then. Over the sidebar keeps it; anywhere right of it hides it.
  document.addEventListener("mousemove", (event) => {
    if (!currentRuntime.isSidebarPeeking) {
      return;
    }
    if (event.clientX <= sidebar.getBoundingClientRect().right) {
      cancelHide();
      return;
    }
    scheduleHide();
  });
  // Moving onto the web page leaves this page altogether.
  document.documentElement.addEventListener("mouseleave", scheduleHide);
}

/**
 * Sets the sidebar's width on the page. main.ts places the page card with the same number.
 */
function applySidebarWidth(width: number): void {
  document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
}

/**
 * Dragging the sidebar's right edge resizes it. The page card follows live (a preview in main.ts); the width is
 * saved when the button is released, and letting go far to the left hides the sidebar, like Arc.
 */
function setUpSidebarResizer(): void {
  const resizer = document.getElementById("sidebar-resizer");
  if (resizer === null) {
    return;
  }
  let animationFrame: number | null = null;
  resizer.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing");
  });
  resizer.addEventListener("pointermove", (event) => {
    if (!resizer.hasPointerCapture(event.pointerId)) {
      return;
    }
    draggedSidebarWidth = Math.max(0, Math.round(event.clientX));
    const shownWidth = Math.max(SIDEBAR_MIN_WIDTH_PX, Math.min(draggedSidebarWidth, SIDEBAR_MAX_WIDTH_PX));
    applySidebarWidth(shownWidth);
    if (animationFrame !== null) {
      return;
    }
    // One preview per frame is enough; pointer events can come much faster.
    animationFrame = requestAnimationFrame(() => {
      animationFrame = null;
      if (draggedSidebarWidth !== null) {
        dispatch({ type: "setSidebarWidth", width: draggedSidebarWidth, isFinal: false });
      }
    });
  });
  resizer.addEventListener("pointerup", (event) => {
    if (!resizer.hasPointerCapture(event.pointerId)) {
      return;
    }
    resizer.releasePointerCapture(event.pointerId);
    document.body.classList.remove("is-resizing");
    const finalWidth = draggedSidebarWidth;
    draggedSidebarWidth = null;
    if (finalWidth !== null) {
      dispatch({ type: "setSidebarWidth", width: finalWidth, isFinal: true });
    }
  });
}

/**
 * Handles requests from the main process that only this page can carry out (inline editing).
 */
function handleSidebarCommand(command: SidebarCommand): void {
  if (command.kind === "playSound") {
    if (currentState?.settings.areSoundEffectsOn !== false) {
      playSound(command.sound);
    }
    return;
  }
  if (command.kind === "beginRename") {
    renamingItemId = command.itemId;
  }
  if (command.kind === "beginSpaceRename") {
    renamingSpaceId = command.spaceId;
  }
  if (command.kind === "beginSpaceIconEdit") {
    openSpaceIconPicker(command.spaceId);
    return;
  }
  renderAll();
}

/**
 * Opens the icon picker above the Space's button in the bottom bar (or, when the switcher is not drawn, the Space
 * title), like Arc's popover pointing at the Space.
 */
function openSpaceIconPicker(spaceId: SpaceId): void {
  const spaceButton = document.querySelector<HTMLElement>(`.space-button[data-space-id="${CSS.escape(spaceId)}"]`);
  const anchorElement = spaceButton ?? document.querySelector<HTMLElement>(".space-title-icon");
  const box = anchorElement?.getBoundingClientRect();
  const anchor = box === undefined ? { x: 0, y: window.innerHeight, width: 0, height: 0 } : { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) };
  dispatch({ type: "openSpaceIconPicker", spaceId: spaceId, anchor: anchor });
}

/**
 * Counts the split views in a state.
 */
function countSplits(state: BrowserState): number {
  return Object.values(state.items).filter((item) => item.kind === "split").length;
}

/**
 * Plays Arc-like sounds for what just changed: a Space switch, Today cleared, a tab closed (archived by hand), a new
 * split view. Off when the user turned sound effects off.
 */
function playSoundForChange(previous: BrowserState, next: BrowserState): void {
  if (next.settings.areSoundEffectsOn === false) {
    return;
  }
  if (previous.activeSpaceId !== next.activeSpaceId) {
    playSound("switchSpace");
    return;
  }
  const newestArchived = next.archive[0];
  const isArchiveGrown = next.archive.length > previous.archive.length && newestArchived !== previous.archive[0];
  if (isArchiveGrown && newestArchived?.reason === "clear-button") {
    playSound("clearToday");
    return;
  }
  if (isArchiveGrown && newestArchived?.reason === "manual") {
    playSound("closeTab");
    return;
  }
  if (countSplits(next) > countSplits(previous)) {
    playSound("split");
  }
}

/**
 * Entry point: subscribes to state and runtime pushes, wires page-wide events, and draws the first state.
 */
async function startSidebar(): Promise<void> {
  window.browserApi.onStateChanged((state) => {
    const previousState = currentState;
    currentState = state;
    renderAll();
    if (previousState !== null) {
      playSoundForChange(previousState, state);
    }
  });
  window.browserApi.onRuntimeChanged((runtime) => {
    currentRuntime = runtime;
    setItemDraggedInOtherWindow(runtime.itemDraggedInOtherWindow);
    renderAll();
  });
  window.browserApi.onSidebarCommand(handleSidebarCommand);
  onDragStateChanged((dragging) => {
    isDragging = dragging;
    document.body.classList.toggle("is-dragging", dragging);
    if (!dragging && hasPendingRedraw) {
      hasPendingRedraw = false;
      renderAll();
    }
  });
  const callbacks = {
    beginRename: (itemId: ItemId) => {
      renamingItemId = itemId;
      renderAll();
    },
    beginSpaceRename: (spaceId: SpaceId) => {
      renamingSpaceId = spaceId;
      renderAll();
    },
  };
  const sidebar = document.getElementById("sidebar");
  const toolbar = document.getElementById("toolbar");
  if (sidebar !== null) {
    installSidebarEvents(sidebar, callbacks);
    installTabTooltipHover(sidebar);
    installDragAndDrop(sidebar);
    sidebar.addEventListener("wheel", handleSidebarWheel, { passive: true });
  }
  if (toolbar !== null) {
    installSidebarEvents(toolbar, callbacks);
  }
  setUpSidebarPeek();
  setUpSidebarResizer();
  document.getElementById("move-here-button")?.addEventListener("click", () => dispatch({ type: "moveTabToThisWindow" }));

  window.browserApi.getSymbols().then(installSymbols).catch(() => undefined);
  // Themes set to "auto" follow macOS between light and dark.
  onSystemAppearanceChange(() => renderAll());
  currentRuntime = await window.browserApi.getRuntimeState();
  currentState = await window.browserApi.getState();
  renderAll();
}

startSidebar();
