/**
 * WHY this file exists:
 *   The sidebar page cannot touch Electron directly (that would be a security hole). It sends action objects on one
 *   channel; this file checks every field of each one and passes only well-formed actions to main.ts.
 *
 * Data source:
 *   Messages from sidebarPreload.ts on the channels in shared/ipcChannels.ts.
 *   Web pages in tabs have no preload script, so they cannot send these messages at all.
 *
 * Data flow:
 *   click in sidebar → preload sends "browser:dispatch" { type: "selectTab", tabId } → parseAction() → handlers.runAction()
 */
import { ipcMain } from "electron";
import type { WebContents } from "electron";
import type { BrowserAction } from "../shared/actions";
import { BROWSER_ACTION_TYPES } from "../shared/actions";
import { IPC_CHANNELS } from "../shared/ipcChannels";
import { ARCHIVE_THRESHOLD_OPTIONS } from "../shared/settings";
import type { BrowserState, RuntimeState } from "../shared/types";

/** What main.ts must provide so the handlers have something to call. */
export interface IpcHandlers {
  /** True for our own pages (the sidebar and the overlay). Messages from anything else are ignored. */
  isTrustedSender(sender: WebContents): boolean;
  getState(): BrowserState;
  getRuntimeState(): RuntimeState;
  runAction(action: BrowserAction): void;
}

/** Longest text we accept from the sidebar (typed addresses, names). Longer input is refused. */
const MAX_TEXT_LENGTH = 8192;

/** A field check: true when the field has the expected shape. */
type FieldCheck = (value: unknown) => boolean;

function isText(value: unknown): boolean {
  return typeof value === "string" && value.length <= MAX_TEXT_LENGTH;
}

function isWholeNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && Math.abs(value) < 1_000_000;
}

function isBoolean(value: unknown): boolean {
  return typeof value === "boolean";
}

/**
 * True when the value is one of the "Archive tabs after" choices (a number of milliseconds, or null for never).
 * Anything else is refused, so a bad message cannot set a 0 ms threshold and archive everything.
 */
function isAllowedArchiveAfter(value: unknown): boolean {
  return ARCHIVE_THRESHOLD_OPTIONS.some((option) => option.valueMs === value);
}

function isOrientation(value: unknown): boolean {
  return value === "horizontal" || value === "vertical";
}

function isNavigationCommand(value: unknown): boolean {
  return value === "back" || value === "forward" || value === "reload" || value === "stop";
}

function isCommandBarMode(value: unknown): boolean {
  return value === "newTab" || value === "editUrl";
}

/** True for an object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for a list location such as { kind: "today", spaceId: "space-work" }.
 */
function isLocation(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === "favorites") {
    return isText(value.profileId);
  }
  if (value.kind === "pinned" || value.kind === "today") {
    return isText(value.spaceId);
  }
  if (value.kind === "folder") {
    return isText(value.folderId);
  }
  if (value.kind === "split") {
    return isText(value.splitId);
  }
  return false;
}

/** Most colors a theme may have, like Arc's gradient editor. */
const MAX_THEME_COLORS = 3;

/** A CSS hex color such as "#e9d8d4". Only this form is accepted, because the value ends up in CSS. */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * True for a Space theme with one to three hex colors, a known appearance and a grain between 0 and 1.
 */
function isTheme(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.colors)) {
    return false;
  }
  const colorCountOk = value.colors.length >= 1 && value.colors.length <= MAX_THEME_COLORS;
  const colorsOk = value.colors.every((color) => typeof color === "string" && HEX_COLOR_PATTERN.test(color));
  const appearanceOk = value.appearance === "light" || value.appearance === "dark" || value.appearance === "auto";
  const grainOk = typeof value.grain === "number" && value.grain >= 0 && value.grain <= 1;
  return colorCountOk && colorsOk && appearanceOk && grainOk;
}

/**
 * True for a native-menu request such as { menu: "item", itemId: "tab-1" }.
 */
function isMenuRequest(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.menu === "item") {
    return isText(value.itemId);
  }
  if (value.menu === "space") {
    return isText(value.spaceId);
  }
  return value.menu === "plus" || value.menu === "sidebar" || value.menu === "split";
}

/** The fields each action type must carry, and how to check them. */
const ACTION_FIELDS: Record<BrowserAction["type"], Record<string, FieldCheck>> = {
  openTab: { typedText: isText },
  selectTab: { tabId: isText },
  closeTab: { tabId: isText },
  deleteItem: { itemId: isText },
  pinTab: { tabId: isText },
  unpinTab: { tabId: isText },
  addToFavorites: { tabId: isText },
  moveItem: { itemId: isText, target: isLocation, index: isWholeNumber },
  createFolder: { title: isText },
  renameItem: { itemId: isText, name: isText },
  toggleFolder: { folderId: isText },
  setPinnedSectionOpen: { spaceId: isText, isOpen: isBoolean },
  clearTodayTabs: {},
  restoreArchivedTab: { tabId: isText },
  duplicateTab: { tabId: isText },
  resetTab: { tabId: isText },
  setTabMuted: { tabId: isText, isMuted: isBoolean },
  splitTabs: { firstTabId: isText, secondTabId: isText },
  separateTabFromSplit: { tabId: isText },
  unsplit: { splitId: isText },
  setSplitOrientation: { splitId: isText, orientation: isOrientation },
  switchSpace: { spaceId: isText },
  switchSpaceByOffset: { offset: isWholeNumber },
  createSpace: { name: isText, icon: isText, theme: isTheme },
  renameSpace: { spaceId: isText, name: isText },
  setSpaceIcon: { spaceId: isText, icon: isText },
  setSpaceTheme: { spaceId: isText, theme: isTheme },
  deleteSpace: { spaceId: isText },
  moveSpace: { spaceId: isText, index: isWholeNumber },
  moveItemToSpace: { itemId: isText, spaceId: isText },
  setArchiveAfter: { archiveAfterMs: isAllowedArchiveAfter },
  setSidebarVisible: { isVisible: isBoolean },
  setSidebarPeek: { isPeeking: isBoolean },
  setSidebarWidth: { width: isWholeNumber, isFinal: isBoolean },
  setSpaceProfile: { spaceId: isText, profileId: isText },
  createProfileForSpace: { spaceId: isText },
  toggleMediaPlayback: {},
  dismissMedia: {},
  navigate: { command: isNavigationCommand },
  openCommandBar: { mode: isCommandBarMode },
  openLibrary: {},
  openSiteControls: {},
  showMenu: { request: isMenuRequest },
};

/**
 * Returns the value as a BrowserAction when its type is known and every field passes its check, otherwise null.
 * Example: parseAction({ type: "selectTab", tabId: "tab-1" }) → the same object; parseAction({ type: "selectTab" }) → null
 */
export function parseAction(value: unknown): BrowserAction | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  const actionType = value.type as BrowserAction["type"];
  if (!BROWSER_ACTION_TYPES.includes(actionType)) {
    return null;
  }

  const fieldChecks = ACTION_FIELDS[actionType];
  for (const [fieldName, check] of Object.entries(fieldChecks)) {
    if (!check(value[fieldName])) {
      return null;
    }
  }
  return value as unknown as BrowserAction;
}

/**
 * Registers the three IPC handlers: read the state, read the runtime facts, and run an action. Each one first checks
 * that the message comes from one of our own pages.
 */
export function registerIpcHandlers(handlers: IpcHandlers): void {
  ipcMain.handle(IPC_CHANNELS.getState, (event) => {
    return handlers.isTrustedSender(event.sender) ? handlers.getState() : null;
  });
  ipcMain.handle(IPC_CHANNELS.getRuntimeState, (event) => {
    return handlers.isTrustedSender(event.sender) ? handlers.getRuntimeState() : null;
  });
  ipcMain.handle(IPC_CHANNELS.dispatch, (event, value: unknown) => {
    if (!handlers.isTrustedSender(event.sender)) {
      return;
    }
    const action = parseAction(value);
    if (action === null) {
      return;
    }
    handlers.runAction(action);
  });
}
