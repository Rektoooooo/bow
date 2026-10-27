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
import { APP_ICON_VARIANTS } from "../shared/appIconDrawing";
import { BOOST_FONTS } from "../shared/boostFonts";
import { isNoteId } from "../shared/notes";
import { isCaptureSource, isEaselId } from "../shared/easels";
import type { CaptureSource } from "../shared/easels";
import { MAX_EASEL_LENGTH } from "./easelsStore";
import { MAX_NOTE_LENGTH } from "./notesStore";
import { MAX_HUE_SHIFT } from "./boosts";
import { ipcMain } from "electron";
import type { WebContents } from "electron";
import type { BrowserAction } from "../shared/actions";
import { BROWSER_ACTION_TYPES } from "../shared/actions";
import { IPC_CHANNELS } from "../shared/ipcChannels";
import { ARCHIVE_THRESHOLD_OPTIONS } from "../shared/settings";
import type { BrowserState, RuntimeState } from "../shared/types";

/** What main.ts must provide so the handlers have something to call. */
export interface IpcHandlers {
  /** True for our own pages (every main window's sidebar and the overlay). Messages from anything else are ignored. */
  isTrustedSender(sender: WebContents): boolean;
  /** The state as the sender's window shows it (each main window has its own Space and selection). */
  getState(sender: WebContents): BrowserState;
  getRuntimeState(sender: WebContents): RuntimeState;
  /** Runs an action; the sender tells which window it came from. */
  runAction(action: BrowserAction, sender: WebContents): void;
  readNote(noteId: string): string;
  saveNote(noteId: string, html: string, title: string): void;
  readEasel(easelId: string): string;
  saveEasel(easelId: string, json: string): void;
  listCaptures(): { id: string; title: string; url: string; thumbnailUrl: string | null; source: CaptureSource | null }[];
  readCapture(captureId: string): string | null;
  retakeCapture(source: CaptureSource): Promise<string | null>;
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
  return ["back", "forward", "reload", "stop", "hardReload", "emptyCacheAndReload"].includes(value as string);
}

function isDeveloperTool(value: unknown): boolean {
  return value === "console" || value === "network" || value === "inspect";
}

/** An import source id from browserImportController.ts: "safari" or "chromium:<browser>:<profile folder>". */
const IMPORT_SOURCE_PATTERN = /^(safari|chromium:[a-z]+:(Default|Profile \d+))$/;

function isImportSource(value: unknown): boolean {
  return typeof value === "string" && IMPORT_SOURCE_PATTERN.test(value);
}

function isHueShift(value: unknown): boolean {
  return isWholeNumber(value) && (value as number) >= 0 && (value as number) <= MAX_HUE_SHIFT;
}

/** A Boost font id, or "" for the site's own font. */
function isBoostFontId(value: unknown): boolean {
  return value === "" || BOOST_FONTS.some((font) => font.id === value);
}

function isAppIconVariant(value: unknown): boolean {
  return APP_ICON_VARIANTS.some((variant) => variant.id === value);
}

/** The GitHub lists a live folder can show (types.ts GitHubLiveList). */
function isGitHubLiveList(value: unknown): boolean {
  return value === "pullRequests" || value === "reviewRequests" || value === "assignedIssues";
}

function isToolbarSiteCommand(value: unknown): boolean {
  return value === "copyLink" || value === "capture" || value === "screenshot";
}

/** A site key such as "github.com": letters, digits, dots and dashes only. */
const SITE_PATTERN = /^[a-z0-9.-]{1,253}$/;

function isSite(value: unknown): boolean {
  return typeof value === "string" && SITE_PATTERN.test(value);
}

function isOptionalSite(value: unknown): boolean {
  return value === undefined || isSite(value);
}

/** Boost CSS may be longer than other text; boosts.ts refuses anything above its own limit too. */
const MAX_BOOST_CSS_MESSAGE_LENGTH = 20000;

function isBoostCss(value: unknown): boolean {
  return typeof value === "string" && value.length <= MAX_BOOST_CSS_MESSAGE_LENGTH;
}

function isRoutingMatchType(value: unknown): boolean {
  return value === "contains" || value === "is";
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
  const intensityOk = value.intensity === undefined || (typeof value.intensity === "number" && value.intensity >= 0 && value.intensity <= 1);
  return colorCountOk && colorsOk && appearanceOk && grainOk && intensityOk;
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
  return value.menu === "plus" || value.menu === "sidebar" || value.menu === "split" || value.menu === "reload" || value.menu === "import";
}

/**
 * True for a rectangle in window coordinates (where a toolbar button sits).
 */
function isAnchor(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return isWholeNumber(value.x) && isWholeNumber(value.y) && isWholeNumber(value.width) && isWholeNumber(value.height);
}

/** A Chrome extension id: 32 letters a–p. */
function isExtensionId(value: unknown): boolean {
  return typeof value === "string" && /^[a-p]{32}$/.test(value);
}

/** The permission kinds a site can be allowed or refused (types.ts SitePermissionKind). */
const SITE_PERMISSION_KINDS = ["camera", "microphone", "notifications", "location", "clipboard"];

function isSitePermissionKind(value: unknown): boolean {
  return typeof value === "string" && SITE_PERMISSION_KINDS.includes(value);
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
  addRoutingRule: { matchType: isRoutingMatchType, value: isText, spaceId: isText },
  removeRoutingRule: { ruleId: isText },
  setBoostCss: { site: isSite, css: isBoostCss },
  setBoostStyle: { site: isSite, hueShift: isHueShift, isInverted: isBoolean, fontId: isBoostFontId },
  setBoostJavaScript: { site: isSite, javascript: isBoostCss, isOn: isBoolean },
  setBoostEnabled: { site: isSite, isEnabled: isBoolean },
  deleteBoost: { site: isSite },
  openBoostEditor: { site: isOptionalSite },
  toggleMediaPlayback: {},
  dismissMedia: {},
  navigate: { command: isNavigationCommand },
  openCommandBar: { mode: isCommandBarMode },
  openLibrary: {},
  openSiteControls: {},
  openThemeEditor: { spaceId: isText },
  showMenu: { request: isMenuRequest },
  setExtensionEnabled: { profileId: isText, extensionId: isText, isEnabled: isBoolean },
  removeExtension: { profileId: isText, extensionId: isText },
  loadUnpackedExtension: {},
  importFromArc: {},
  showExtensionsMenu: { anchor: isAnchor },
  answerPermissionPrompt: { requestId: isText, isAllowed: isBoolean },
  removeSitePermission: { profileId: isText, origin: isText, kind: isSitePermissionKind },
  installWebStoreExtension: { extensionId: isExtensionId },
  checkExtensionUpdates: {},
  setDeveloperMode: { site: isSite, isOn: isBoolean },
  openDeveloperTool: { tool: isDeveloperTool },
  runSiteCommand: { command: isToolbarSiteCommand },
  importFromBrowser: { sourceId: isImportSource },
  setSoundEffects: { isOn: isBoolean },
  setAdBlock: { isOn: isBoolean },
  setAdBlockForSite: { site: isSite, isOn: isBoolean },
  setAppIcon: { variantId: isAppIconVariant },
  showTabPreview: { tabId: isText, anchor: isAnchor },
  hideTabPreview: {},
  setTidyTitles: { isOn: isBoolean },
  setShowFullUrls: { isOn: isBoolean },
  createNote: {},
  createEasel: {},
  finishWelcome: {},
  setAsDefaultBrowser: {},
  translatePage: {},
  createGitHubLiveFolder: { list: isGitHubLiveList },
  createFeedLiveFolder: {},
  refreshLiveFolder: { folderId: isText },
  openLiveFolderSource: { folderId: isText },
  showHiddenLiveFolderItems: { folderId: isText },
  moveTabToThisWindow: {},
  reportOpenEditor: { tabId: isText, isOpen: isBoolean },
  beginItemDrag: { itemId: isText },
  endItemDrag: {},
  takeItemFromOtherWindow: { itemId: isText },
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
    return handlers.isTrustedSender(event.sender) ? handlers.getState(event.sender) : null;
  });
  ipcMain.handle(IPC_CHANNELS.getRuntimeState, (event) => {
    return handlers.isTrustedSender(event.sender) ? handlers.getRuntimeState(event.sender) : null;
  });
  ipcMain.handle(IPC_CHANNELS.readNote, (event, noteId: unknown) => {
    if (!handlers.isTrustedSender(event.sender) || !isNoteId(noteId)) {
      return "";
    }
    return handlers.readNote(noteId);
  });
  ipcMain.handle(IPC_CHANNELS.saveNote, (event, noteId: unknown, html: unknown, title: unknown) => {
    const isNoteHtml = typeof html === "string" && html.length <= MAX_NOTE_LENGTH;
    if (!handlers.isTrustedSender(event.sender) || !isNoteId(noteId) || !isNoteHtml || !isText(title)) {
      return;
    }
    handlers.saveNote(noteId, html, title as string);
  });
  ipcMain.handle(IPC_CHANNELS.readEasel, (event, easelId: unknown) => {
    if (!handlers.isTrustedSender(event.sender) || !isEaselId(easelId)) {
      return "";
    }
    return handlers.readEasel(easelId);
  });
  ipcMain.handle(IPC_CHANNELS.saveEasel, (event, easelId: unknown, json: unknown) => {
    const isBoardJson = typeof json === "string" && json.length <= MAX_EASEL_LENGTH;
    if (!handlers.isTrustedSender(event.sender) || !isEaselId(easelId) || !isBoardJson) {
      return;
    }
    handlers.saveEasel(easelId, json);
  });
  ipcMain.handle(IPC_CHANNELS.listCaptures, (event) => {
    return handlers.isTrustedSender(event.sender) ? handlers.listCaptures() : [];
  });
  ipcMain.handle(IPC_CHANNELS.readCapture, (event, captureId: unknown) => {
    if (!handlers.isTrustedSender(event.sender) || !isText(captureId)) {
      return null;
    }
    return handlers.readCapture(captureId as string);
  });
  ipcMain.handle(IPC_CHANNELS.retakeCapture, (event, source: unknown) => {
    if (!handlers.isTrustedSender(event.sender) || !isCaptureSource(source)) {
      return null;
    }
    return handlers.retakeCapture(source);
  });
  ipcMain.handle(IPC_CHANNELS.dispatch, (event, value: unknown) => {
    if (!handlers.isTrustedSender(event.sender)) {
      return;
    }
    const action = parseAction(value);
    if (action === null) {
      return;
    }
    handlers.runAction(action, event.sender);
  });
}
