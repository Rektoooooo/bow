/**
 * WHY this file exists:
 *   Runs the Chrome extensions the state lists. Electron itself runs an extension's content scripts and service
 *   worker. What a browser has to supply on top (which tab is active, opening tabs and windows, the toolbar action
 *   with its popup, extension items in the page menu) comes from electron-chrome-extensions (MIT, pinned version).
 *   A profile's session gets that library only once the profile has an extension, so pages in profiles without
 *   extensions keep running with no preload script at all.
 *
 * Data source:
 *   BrowserState.extensions (extensionList.ts), the tab views (tabViews.ts), the main window (browserCore.ts).
 *   Tested against Electron 44: MV3 service workers and content scripts run; popups need the library's tab APIs.
 *   Known limit: loadExtension resolves before Chromium has read the content-script files, and Electron has no
 *   "scripts ready" signal (Chrome holds navigations until then; Electron does not). Under heavy disk load the page
 *   restored at startup can therefore miss a content script; reloading it fixes that.
 *
 * Data flow:
 *   startup → prepareExtensions() (before any page loads) → loadExtension for each enabled extension
 *   state changed (onStateChanged) or new page views shown (after-sync hook) → syncExtensions(): load / unload to
 *   match, register new tab pages with the library, tell it which tab is selected
 *   toolbar puzzle button → showExtensionsMenu(anchor) → native menu → the extension's popup (or its click event)
 */
import { Menu, nativeImage } from "electron";
import type { BaseWindow, ContextMenuParams, MenuItem, MenuItemConstructorOptions, NativeImage, Session, WebContents } from "electron";
import { ElectronChromeExtensions } from "electron-chrome-extensions";
import * as path from "node:path";
import { DEFAULT_PROFILE_ID } from "../shared/settings";
import type { BrowserState, InstalledExtension, ItemId, ProfileId } from "../shared/types";
import { addAfterSyncHook, applyChange, findMainWindowShowingTab, getState, getWindow, onStateChanged } from "./browserCore";
import { getProfileExtensions } from "./extensionList";
import { readExtensionManifestInfo } from "./extensionManifest";
import { openLibrary } from "./overlayController";
import { getProfileSession } from "./profiles";
import { switchSpace } from "./spaces";
import { getSelectedTabId, openTab, selectTab } from "./state";
import { isRecordableUrl } from "./history";
import { closeTabByUser, openLinkInNewTab } from "./tabActions";
import { createTabView, getTabContents, getTabViews } from "./tabViews";
import type { TabViewEvents } from "./tabViews";
import { createId, findProfileIdOfItem, findTab, getActiveSpace } from "./tree";

/** Startup waits at most this long for extensions to load, so one broken extension cannot hold the window back. */
const STARTUP_LOAD_TIMEOUT_MS = 5000;

/** Size of an extension's icon in the extensions menu. */
const MENU_ICON_SIZE_PX = 16;

/** Size of an extension's icon in the Library (drawn at 16 CSS px, sharp on Retina screens). */
const LIBRARY_ICON_SIZE_PX = 32;

/** Icons read from extension folders, by "folder|size". An extension's files do not change while it is added. */
const iconCache = new Map<string, NativeImage | null>();

/** Where a toolbar button sits, in the main window's content coordinates. The popup opens below it. */
export interface ExtensionMenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The library's toolbar-action API. Not in its public typings, so this names the one method we call. */
interface BrowserActionApi {
  activateClick(details: { eventType: "click"; extensionId: string; tabId: number; anchorRect: ExtensionMenuAnchor }): void;
}

/** One profile session with extensions. */
interface ProfileExtensionHost {
  profileId: ProfileId;
  session: Session;
  library: ElectronChromeExtensions;
  /** Extension id → the folder it was loaded from. */
  loadedPaths: Map<string, string>;
  /** The enabled extensions last asked for ("id=path" lines), so an unchanged list costs nothing. */
  wantedSignature: string;
  /** Load and unload steps run one after another per session. */
  pendingWork: Promise<void>;
  /** Tab pages already registered with the library. */
  registeredContents: WeakSet<WebContents>;
}

/** Hosts by profile, created the first time a profile has an enabled extension. */
const hostsByProfile = new Map<ProfileId, ProfileExtensionHost>();

/** Why an extension failed to load, by "profileId/extensionId". Shown in the Library. */
const loadErrors = new Map<string, string>();

/** The tab page the library was last told is selected. */
let lastSelectedContents: WebContents | null = null;

/** Page events for tabs that extensions open in the background. Set once by main.ts. */
let tabViewEvents: TabViewEvents | null = null;

/**
 * Connects the host to state changes. Runs once at startup.
 */
export function initializeExtensionHost(events: TabViewEvents): void {
  tabViewEvents = events;
  onStateChanged((state) => syncExtensions(state));
  // Page views are also made outside state changes (a window resize, a Peek becoming a tab); register those too.
  addAfterSyncHook(() => syncExtensions(getState()));
}

/**
 * Loads every enabled extension before the first page opens, so content scripts reach the pages restored at startup.
 */
export async function prepareExtensions(): Promise<void> {
  syncExtensions(getState());
  const allWork = Promise.all(Array.from(hostsByProfile.values()).map((host) => host.pendingWork));
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, STARTUP_LOAD_TIMEOUT_MS));
  await Promise.race([allWork, timeout]);
}

/**
 * Resolves once every queued load and unload has run (before deleting an old copy's files, say).
 */
export async function whenExtensionsSettled(): Promise<void> {
  await Promise.all(Array.from(hostsByProfile.values()).map((host) => host.pendingWork));
}

/**
 * Returns why an extension failed to load, or null.
 */
export function getExtensionLoadError(profileId: ProfileId, extensionId: string): string | null {
  return loadErrors.get(`${profileId}/${extensionId}`) ?? null;
}

/**
 * Makes the sessions match the state: loads what is enabled, unloads what was turned off or removed, registers new
 * tab pages and reports the selected tab.
 */
export function syncExtensions(state: BrowserState): void {
  for (const profile of state.profiles) {
    const enabled = getProfileExtensions(state, profile.id).filter((extension) => extension.isEnabled);
    const host = enabled.length === 0 ? hostsByProfile.get(profile.id) : ensureHost(profile.id);
    if (host !== undefined) {
      reconcileHost(host, enabled);
    }
  }
  registerTabPages(state);
}

/**
 * Returns the host of a profile, creating it (and with it the library for the profile's session) on first use.
 */
function ensureHost(profileId: ProfileId): ProfileExtensionHost {
  const existing = hostsByProfile.get(profileId);
  if (existing !== undefined) {
    return existing;
  }
  const profileSession = getProfileSession(profileId);
  const library = new ElectronChromeExtensions({
    session: profileSession,
    createTab: (details) => createTabForExtension(profileId, details),
    selectTab: (contents) => selectTabOfContents(contents),
    removeTab: (contents) => closeTabOfContents(contents),
  });
  // Links an extension's popup opens (target=_blank, window.open) become tabs, as in Chrome, not bare windows.
  library.on("browser-action-popup-created", (popup: { browserWindow?: Electron.BrowserWindow }) => {
    popup.browserWindow?.webContents.setWindowOpenHandler((details) => {
      if (isRecordableUrl(details.url)) {
        openLinkInNewTab(details.url, "foreground");
      }
      return { action: "deny" };
    });
  });
  const host: ProfileExtensionHost = {
    profileId: profileId,
    session: profileSession,
    library: library,
    loadedPaths: new Map(),
    wantedSignature: "",
    pendingWork: Promise.resolve(),
    registeredContents: new WeakSet(),
  };
  hostsByProfile.set(profileId, host);
  return host;
}

/**
 * Queues the loads and unloads that make one session match its enabled extensions.
 */
function reconcileHost(host: ProfileExtensionHost, enabled: InstalledExtension[]): void {
  const wantedPaths = new Map(enabled.map((extension) => [extension.id, extension.path]));
  const signature = Array.from(wantedPaths, ([id, folder]) => `${id}=${folder}`).sort().join("\n");
  if (signature === host.wantedSignature) {
    return;
  }
  host.wantedSignature = signature;
  host.pendingWork = host.pendingWork.then(async () => {
    for (const [extensionId, loadedPath] of Array.from(host.loadedPaths)) {
      if (wantedPaths.get(extensionId) !== loadedPath) {
        host.session.extensions.removeExtension(extensionId);
        host.loadedPaths.delete(extensionId);
      }
    }
    for (const [extensionId, folder] of wantedPaths) {
      if (host.loadedPaths.has(extensionId)) {
        continue;
      }
      const errorKey = `${host.profileId}/${extensionId}`;
      try {
        const loaded = await host.session.extensions.loadExtension(folder);
        host.loadedPaths.set(loaded.id, folder);
        loadErrors.delete(errorKey);
      } catch (error) {
        loadErrors.set(errorKey, error instanceof Error ? error.message : String(error));
      }
    }
  });
}

/**
 * Loads a folder into a profile's session right away and resolves to the loaded extension (Load Unpacked needs its
 * id before the extension goes into the state). Runs in the profile's queue, after any load or unload before it.
 */
export function loadExtensionNow(profileId: ProfileId, folder: string): Promise<Electron.Extension> {
  const host = ensureHost(profileId);
  const load = host.pendingWork.then(() => host.session.extensions.loadExtension(folder));
  host.pendingWork = load.then(
    (loaded) => {
      host.loadedPaths.set(loaded.id, folder);
    },
    () => undefined,
  );
  return load;
}

/**
 * Registers every tab page in a session with extensions (so chrome.tabs sees it), and reports the selected one. A
 * page belongs to the window it is first seen in (the library cannot move a tab between windows without closing it).
 */
function registerTabPages(state: BrowserState): void {
  const focusedWindow = getWindow();
  if (focusedWindow === null) {
    return;
  }
  for (const [tabId, view] of getTabViews()) {
    const window = findMainWindowShowingTab(tabId) ?? focusedWindow;
    const host = hostsByProfile.get(findProfileIdOfItem(state, tabId) ?? DEFAULT_PROFILE_ID);
    const contents = view.webContents;
    if (host === undefined || contents.isDestroyed() || contents.session !== host.session || host.registeredContents.has(contents)) {
      continue;
    }
    host.library.addTab(contents, window);
    host.registeredContents.add(contents);
  }

  const selectedTabId = getSelectedTabId(state);
  const selectedContents = selectedTabId === null ? null : getTabContents(selectedTabId);
  if (selectedContents === null || selectedContents === lastSelectedContents) {
    return;
  }
  const selectedHost = Array.from(hostsByProfile.values()).find((host) => host.registeredContents.has(selectedContents));
  if (selectedHost !== undefined) {
    selectedHost.library.selectTab(selectedContents);
    lastSelectedContents = selectedContents;
  }
}

/**
 * Finds the tab a page belongs to, or null.
 */
function findTabIdOfContents(contents: WebContents): ItemId | null {
  for (const [tabId, view] of getTabViews()) {
    if (view.webContents === contents) {
      return tabId;
    }
  }
  return null;
}

/**
 * chrome.tabs.create: opens a Today tab in a Space of the extension's profile (the active Space when it fits).
 */
async function createTabForExtension(profileId: ProfileId, details: chrome.tabs.CreateProperties): Promise<[WebContents, BaseWindow]> {
  const window = getWindow();
  if (window === null || tabViewEvents === null) {
    throw new Error("The browser window is not open.");
  }
  const now = Date.now();
  const url = typeof details.url === "string" && details.url !== "" ? details.url : "about:blank";
  const isActive = details.active !== false;
  const tabId = createId("tab", now);
  applyChange((state) => {
    const activeSpace = getActiveSpace(state);
    const space = activeSpace.profileId === profileId ? activeSpace : state.spaces.find((candidate) => candidate.profileId === profileId);
    const inSpace = space === undefined ? state : switchSpace(state, space.id, now);
    return openTab(inSpace, url, now, { id: tabId, select: isActive });
  });
  // A background tab has no page yet (pages are made when a tab is shown); the extension needs one now.
  const tab = findTab(getState(), tabId);
  if (tab === undefined) {
    throw new Error("The tab could not be opened.");
  }
  const contents = getTabContents(tabId) ?? createTabView(getState(), tab, tabViewEvents).webContents;
  return [contents, window];
}

/**
 * chrome.tabs.update({ active: true }): selects the tab of that page.
 */
function selectTabOfContents(contents: WebContents): void {
  const tabId = findTabIdOfContents(contents);
  if (tabId !== null) {
    applyChange((state) => selectTab(state, tabId, Date.now()));
  }
}

/**
 * chrome.tabs.remove: closes the tab of that page like ⌘W. The library also calls this when a page closes on its
 * own; that page's tab is already gone from tabViews by then, so nothing happens.
 */
function closeTabOfContents(contents: WebContents): void {
  const tabId = findTabIdOfContents(contents);
  if (tabId !== null) {
    closeTabByUser(tabId);
  }
}

/**
 * Returns the extension's icon at a size, or null when it has none that loads.
 */
function loadExtensionIcon(extension: InstalledExtension, size: number): NativeImage | null {
  const cacheKey = `${extension.path}|${size}`;
  const cached = iconCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const info = readExtensionManifestInfo(extension.path);
  const image = info === null || info.iconPath === null ? null : nativeImage.createFromPath(path.join(extension.path, info.iconPath));
  const icon = image === null || image.isEmpty() ? null : image.resize({ width: size, height: size, quality: "best" });
  iconCache.set(cacheKey, icon);
  return icon;
}

/**
 * Returns the extension's icon for the Library as a data: URL, or null.
 */
export function getExtensionIconUrl(extension: InstalledExtension): string | null {
  return loadExtensionIcon(extension, LIBRARY_ICON_SIZE_PX)?.toDataURL() ?? null;
}

/**
 * Opens an extension's popup below the anchor, or sends its click event when it has no popup.
 */
function activateExtension(host: ProfileExtensionHost, extensionId: string, anchor: ExtensionMenuAnchor): void {
  const selectedTabId = getSelectedTabId(getState());
  const selectedContents = selectedTabId === null ? null : getTabContents(selectedTabId);
  const tabId = selectedContents !== null && host.registeredContents.has(selectedContents) ? selectedContents.id : -1;
  const browserAction = (host.library as unknown as { api: { browserAction: BrowserActionApi } }).api.browserAction;
  try {
    browserAction.activateClick({ eventType: "click", extensionId: extensionId, tabId: tabId, anchorRect: anchor });
  } catch (error) {
    console.error("Opening the extension failed:", error);
  }
}

/**
 * The Control Center's extension tiles: the profile's turned-on extensions with their icons.
 */
export function listExtensionTiles(state: BrowserState, profileId: ProfileId): { id: string; name: string; iconUrl: string | null }[] {
  const enabled = getProfileExtensions(state, profileId).filter((extension) => extension.isEnabled);
  return enabled.map((extension) => ({ id: extension.id, name: extension.name, iconUrl: getExtensionIconUrl(extension) }));
}

/**
 * A Control Center tile was clicked: opens that extension of the active profile under the tile.
 */
export function activateExtensionOfActiveProfile(extensionId: string, anchor: ExtensionMenuAnchor): void {
  const profileId = getActiveSpace(getState()).profileId;
  const host = hostsByProfile.get(profileId);
  if (host !== undefined && host.loadedPaths.has(extensionId)) {
    activateExtension(host, extensionId, anchor);
  }
}

/**
 * The toolbar's extensions menu: the active profile's extensions (click opens the popup), then Manage Extensions.
 */
export function showExtensionsMenu(anchor: ExtensionMenuAnchor): void {
  const window = getWindow();
  if (window === null) {
    return;
  }
  const state = getState();
  const profileId = getActiveSpace(state).profileId;
  const host = hostsByProfile.get(profileId);
  const enabled = getProfileExtensions(state, profileId).filter((extension) => extension.isEnabled);
  const template: MenuItemConstructorOptions[] = enabled.map((extension) => ({
    label: extension.name,
    icon: loadExtensionIcon(extension, MENU_ICON_SIZE_PX) ?? undefined,
    enabled: host !== undefined && host.loadedPaths.has(extension.id),
    click: () => {
      if (host !== undefined) {
        activateExtension(host, extension.id, anchor);
      }
    },
  }));
  if (template.length === 0) {
    template.push({ label: "No extensions in this profile", enabled: false });
  }
  template.push({ type: "separator" }, { label: "Manage Extensions…", click: () => openLibrary("extensions") });
  Menu.buildFromTemplate(template).popup({ window: window, x: Math.round(anchor.x), y: Math.round(anchor.y + anchor.height) });
}

/**
 * Extension items (chrome.contextMenus) for a page's right-click menu. Empty for pages without extensions.
 */
export function getExtensionMenuItems(contents: WebContents, params: ContextMenuParams): MenuItem[] {
  const host = Array.from(hostsByProfile.values()).find((candidate) => candidate.registeredContents.has(contents));
  if (host === undefined) {
    return [];
  }
  return host.library.getContextMenuItems(contents, params);
}
