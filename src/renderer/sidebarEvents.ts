/**
 * WHY this file exists:
 *   The sidebar keeps its elements across redraws (morph.ts), so its rows and buttons carry no click handlers of
 *   their own: a handler would remember the data from when the element was built. Instead, a few listeners on the
 *   sidebar and toolbar read what an element means from its data attributes at the moment it is clicked.
 *
 * Data source:
 *   Data attributes set by rows.ts, sidebar.ts and toolbar.ts:
 *   - `data-action` on buttons ("close-tab", "switch-space", "navigate", …) with `data-item-id`, `data-space-id`, …
 *   - `data-row` on rows and tiles ("tab", "favorite", "folder", "split-pane", "space-title", "new-tab",
 *     "live-status" with `data-live-action`)
 *
 * Data flow:
 *   click / double-click / right-click / middle-click / Enter → find the element → dispatch(action), or tell
 *   sidebar.ts to start an inline rename
 */
import type { DeveloperTool, NavigationCommand, ToolbarSiteCommand } from "../shared/actions.js";
import { dispatch } from "./dom.js";
import { getMultiSelection } from "./multiSelect.js";

/** What only sidebar.ts can do: inline editing lives in its page state. */
export interface SidebarEventCallbacks {
  beginRename(itemId: string): void;
  beginSpaceRename(spaceId: string): void;
  /** ⌘-click (toggle) or ⇧-click (range) on a tab row picks it (multiSelect.ts). */
  pickTab(tabId: string, isRange: boolean): void;
  /** A plain click forgets the picked tabs. */
  clearPickedTabs(): void;
}

/** Mouse button number of the middle button (auxclick). */
const MIDDLE_BUTTON = 1;

/**
 * Returns the closest element with an attribute under an event, inside the root.
 */
function findClosest(event: Event, selector: string): HTMLElement | null {
  return event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;
}

/**
 * Runs what an action button stands for.
 */
function runButtonAction(button: HTMLElement): void {
  const data = button.dataset;
  const itemId = data.itemId ?? "";
  const spaceId = data.spaceId ?? "";
  switch (data.action) {
    case "close-tab":
      return dispatch({ type: "closeTab", tabId: itemId });
    case "close-split":
      return dispatch({ type: "closeSplit", splitId: itemId });
    case "toggle-mute":
      return dispatch({ type: "setTabMuted", tabId: itemId, isMuted: data.isMuted !== "true" });
    case "reset-tab":
      return dispatch({ type: "resetTab", tabId: itemId });
    case "space-menu":
      return dispatch({ type: "showMenu", request: { menu: "space", spaceId: spaceId } });
    case "clear-today":
      return dispatch({ type: "clearTodayTabs" });
    case "hide-sidebar":
      return dispatch({ type: "setSidebarVisible", isVisible: false });
    case "show-sidebar":
      return dispatch({ type: "setSidebarVisible", isVisible: true });
    case "open-library":
      return dispatch({ type: "openLibrary" });
    case "plus-menu":
      return dispatch({ type: "showMenu", request: { menu: "plus" } });
    case "switch-space":
      return dispatch({ type: "switchSpace", spaceId: spaceId });
    case "media-select":
      return dispatch({ type: "selectTab", tabId: itemId });
    case "media-toggle":
      return dispatch({ type: "toggleMediaPlayback" });
    case "media-dismiss":
      return dispatch({ type: "dismissMedia" });
    case "restart-to-update":
      return dispatch({ type: "restartToUpdate" });
    case "notice-action":
      return dispatch({ type: "runNoticeAction" });
    case "notice-dismiss":
      return dispatch({ type: "dismissNotice" });
    case "navigate":
      return dispatch({ type: "navigate", command: (data.command ?? "reload") as NavigationCommand });
    case "open-command-bar":
      return dispatch({ type: "openCommandBar", mode: data.mode === "editUrl" ? "editUrl" : "newTab" });
    case "site-controls":
      return dispatch({ type: "openSiteControls" });
    case "split-menu":
      return dispatch({ type: "showMenu", request: { menu: "split" } });
    case "reload-menu":
      return dispatch({ type: "showMenu", request: { menu: "reload" } });
    case "site-command":
      return dispatch({ type: "runSiteCommand", command: (data.command ?? "copyLink") as ToolbarSiteCommand });
    case "developer-tool":
      return dispatch({ type: "openDeveloperTool", tool: (data.tool ?? "console") as DeveloperTool });
    case "extensions-menu":
      return dispatchExtensionsMenu(button);
    case "add-extension":
      return dispatchAddExtension(button);
  }
}

/**
 * The toolbar's extensions menu opens below its button, so it sends where the button sits.
 */
function dispatchExtensionsMenu(button: HTMLElement): void {
  const box = button.getBoundingClientRect();
  const anchor = { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) };
  dispatch({ type: "showExtensionsMenu", anchor: anchor });
}

/**
 * "Add Extension" on a Chrome Web Store page asks the main process to install. The pill then says "Adding…" from
 * the runtime facts main sends (toolbar.ts), not from a change made here, which the next redraw would undo.
 */
function dispatchAddExtension(button: HTMLElement): void {
  const extensionId = button.dataset.extensionId ?? "";
  if (extensionId === "" || button.hasAttribute("disabled")) {
    return;
  }
  dispatch({ type: "installWebStoreExtension", extensionId: extensionId });
}

/**
 * A plain click on a row or tile: select the tab, open or close the folder, collapse Pinned, open a new tab.
 */
function runRowClick(row: HTMLElement): void {
  const data = row.dataset;
  switch (data.row) {
    case "tab":
    case "favorite":
      return dispatch({ type: "selectTab", tabId: data.itemId ?? "" });
    case "folder":
      return dispatch({ type: "toggleFolder", folderId: data.itemId ?? "" });
    case "split-pane":
      return dispatch({ type: "selectTab", tabId: data.tabId ?? "" });
    case "space-title":
      return dispatch({ type: "setPinnedSectionOpen", spaceId: data.spaceId ?? "", isOpen: data.pinnedOpen !== "true" });
    case "new-tab":
      return dispatch({ type: "openCommandBar", mode: "newTab" });
    case "live-status":
      return runLiveStatusClick(data.itemId ?? "", data.liveAction ?? "");
  }
}

/**
 * A live folder's status line: "Sign in to GitHub" opens the folder's list page (GitHub asks to sign in there),
 * "Try again" refreshes. Other lines do nothing.
 */
function runLiveStatusClick(folderId: string, liveAction: string): void {
  if (liveAction === "sign-in") {
    dispatch({ type: "openLiveFolderSource", folderId: folderId });
  }
  if (liveAction === "retry") {
    dispatch({ type: "refreshLiveFolder", folderId: folderId });
  }
}

/**
 * A right-click: the item's menu, the Space menu, or a split pane's tab menu.
 */
function runContextMenu(event: MouseEvent): boolean {
  const spaceButton = findClosest(event, "[data-action='switch-space']");
  if (spaceButton !== null) {
    dispatch({ type: "showMenu", request: { menu: "space", spaceId: spaceButton.dataset.spaceId ?? "" } });
    return true;
  }
  const row = findClosest(event, "[data-row]");
  if (row === null) {
    return false;
  }
  const data = row.dataset;
  if (data.row === "space-title") {
    dispatch({ type: "showMenu", request: { menu: "space", spaceId: data.spaceId ?? "" } });
    return true;
  }
  if (data.row === "split-pane") {
    dispatch({ type: "showMenu", request: { menu: "item", itemId: data.tabId ?? "" } });
    return true;
  }
  // Right-clicking one of several picked tabs acts on all of them (multiSelect.ts).
  const pickedTabIds = getMultiSelection();
  if (data.row === "tab" && pickedTabIds.includes(data.itemId ?? "")) {
    dispatch({ type: "showMenu", request: { menu: "tabs", tabIds: pickedTabIds } });
    return true;
  }
  if (data.row === "tab" || data.row === "favorite" || data.row === "folder" || data.row === "split") {
    dispatch({ type: "showMenu", request: { menu: "item", itemId: data.itemId ?? "" } });
    return true;
  }
  return false;
}

/**
 * Wires the delegated listeners on one root (the sidebar, or the toolbar).
 */
export function installSidebarEvents(root: HTMLElement, callbacks: SidebarEventCallbacks): void {
  root.addEventListener("click", (event) => {
    const button = findClosest(event, "[data-action]");
    if (button !== null && root.contains(button)) {
      event.stopPropagation();
      runButtonAction(button);
      return;
    }
    const row = findClosest(event, "[data-row]");
    if (row === null || !root.contains(row)) {
      return;
    }
    const isPickingTabs = row.dataset.row === "tab" && (event.metaKey || event.shiftKey);
    if (isPickingTabs) {
      callbacks.pickTab(row.dataset.itemId ?? "", event.shiftKey);
      return;
    }
    callbacks.clearPickedTabs();
    runRowClick(row);
  });
  root.addEventListener("dblclick", (event) => {
    if (findClosest(event, "[data-action]") !== null) {
      return;
    }
    const row = findClosest(event, "[data-row]");
    const kind = row?.dataset.row;
    if (row === null || kind === undefined) {
      return;
    }
    if (kind === "tab" || kind === "favorite" || kind === "folder") {
      event.preventDefault();
      callbacks.beginRename(row.dataset.itemId ?? "");
    }
    if (kind === "space-title") {
      event.preventDefault();
      callbacks.beginSpaceRename(row.dataset.spaceId ?? "");
    }
  });
  root.addEventListener("auxclick", (event) => {
    if (event.button !== MIDDLE_BUTTON) {
      return;
    }
    const row = findClosest(event, "[data-row='tab'], [data-row='favorite'], [data-row='split']");
    if (row === null) {
      return;
    }
    // A split view's row closes like its ×.
    if (row.dataset.row === "split") {
      dispatch({ type: "closeSplit", splitId: row.dataset.itemId ?? "" });
      return;
    }
    dispatch({ type: "closeTab", tabId: row.dataset.itemId ?? "" });
  });
  root.addEventListener("contextmenu", (event) => {
    if (runContextMenu(event)) {
      event.preventDefault();
    }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !(event.target instanceof HTMLElement) || event.target.dataset.row === undefined) {
      return;
    }
    runRowClick(event.target);
  });
}
