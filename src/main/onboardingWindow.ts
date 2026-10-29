/**
 * WHY this file exists:
 *   Bow's onboarding has a window of its own, like Arc's first start: about 70 % of the screen, centred, over the
 *   desktop at the first start (the browser window stays hidden until it ends) and over the browser when it is
 *   opened again from Help › Welcome to Bow…. This file opens and closes that window, sends its page what it shows
 *   (the active Space and its look, every browser Bow imports from and how those imports went, a preview of the
 *   sidebar, the defaults), runs its imports (read and count first, then the parts the user chose), and answers its
 *   page's messages, from that page only.
 *
 * Data source:
 *   The state (browserCore.ts), the import sources (browserImportController.ts, arcImportController.ts), the browsers'
 *   app icons (browserIcons.ts), whether Bow is the default browser, the global shortcut's status, the screen's work
 *   area.
 *
 * Data flow:
 *   main.ts first start → openOnboarding(true) → the window → its page asks getData → "onboarding:data" on changes
 *   (refreshOnboarding, after every action) → the page closes it → finishWelcome → showMainWindows() (first start)
 *   Help › Welcome to Bow… / Command Bar → openOnboarding(false)
 *   the page → readSource → prepare…Import() → "found" → bringOver(parts) → apply…Import() → each part done → "done"
 */
import { app, BrowserWindow, ipcMain, nativeTheme, screen } from "electron";
import type { IpcMainInvokeEvent, Rectangle, WebContents } from "electron";
import * as path from "node:path";
import { ARC_IMPORT_SOURCE_ID, IMPORT_PART_ORDER, ONBOARDING_CHANNELS, SUPPORTED_BROWSERS, orderBrowsers } from "../shared/onboarding";
import type { ImportPart, WelcomeBrowser, WelcomeData, WelcomeImport, WelcomeSidebar } from "../shared/onboarding";
import { GLOBAL_SHORTCUT_CHOICES, ONBOARDING_MIN_HEIGHT_PX, ONBOARDING_MIN_WIDTH_PX, ONBOARDING_SCREEN_SHARE } from "../shared/settings";
import { isThemeDark } from "../shared/themePalette";
import type { BrowserState, SidebarItem, TabItem } from "../shared/types";
import { applyArcImport, findArcSidebarFile, prepareArcImport } from "./arcImportController";
import type { PreparedArcImport } from "./arcImportController";
import { applyChange, getState, getWindow } from "./browserCore";
import { getBrowserIcon, loadBrowserIcons } from "./browserIcons";
import { applyBrowserImport, listImportSources, openFullDiskAccessSettings, prepareBrowserImport } from "./browserImportController";
import type { PreparedBrowserImport } from "./browserImportController";
import { isDefaultBrowser } from "./defaultBrowser";
import { getGlobalShortcutStatus } from "./globalShortcutController";
import { showMainWindows } from "./mainWindows";
import { finishWelcome } from "./state";
import { THEME_PRESETS } from "./themePresets";
import { getActiveSpace } from "./tree";

/** The page's colour before it paints (onboarding.css --onb-base), so the window never flashes another colour. */
const LIGHT_BASE_COLOR = "#f5f4f8";
const DARK_BASE_COLOR = "#0c0c11";

/** Where macOS draws the close/minimize/zoom buttons: as in the browser window (mainWindows.ts). */
const TRAFFIC_LIGHT_POSITION = { x: 18, y: 18 };

/** The shortcut from any app the onboarding offers when none is set: ⌥⌘Space (⌥Space is Raycast's and Alfred's). */
const WELCOME_GLOBAL_SHORTCUT = GLOBAL_SHORTCUT_CHOICES[1];

/** The sidebar preview shows at most this many Favorites (a row's worth) and Pinned items. Our choice. */
const PREVIEW_FAVORITES_LIMIT = 8;
const PREVIEW_PINNED_LIMIT = 7;

/** The open onboarding window, and whether it is the first start's (its end shows the browser window). */
let onboardingWindow: BrowserWindow | null = null;
let isFirstStartOnboarding = false;

/** A source the onboarding read: Arc's import or a browser profile's, ready to bring over. */
type PreparedSource = { arc: PreparedArcImport } | { browser: PreparedBrowserImport };

/** Imports read or started from the onboarding, by source id: what the page shows, and what was read. */
const welcomeImports = new Map<string, WelcomeImport>();
const preparedSources = new Map<string, PreparedSource>();

/**
 * Every browser Bow imports from and its profiles on this Mac, read once when the onboarding opens (it reads the
 * disk); the icons arrive a moment later (browserIcons.ts).
 */
let welcomeBrowsers: WelcomeBrowser[] = [];

/**
 * The onboarding page's webContents while it is open (main.ts lets it dispatch actions, like our other pages).
 */
export function getOnboardingContents(): WebContents | null {
  if (onboardingWindow === null || onboardingWindow.isDestroyed()) {
    return null;
  }
  return onboardingWindow.webContents;
}

/**
 * Everything the onboarding shows that can change while it is open: the active Space and its look, what this Mac
 * has to import from and how those imports went, and the defaults it offers.
 */
/**
 * The browsers the onboarding lists, with their profiles on this Mac that have something to import (Arc when its
 * sidebar file is here). Those found come first.
 */
function listWelcomeBrowsers(): WelcomeBrowser[] {
  const sources = listImportSources();
  const browsers = SUPPORTED_BROWSERS.map((browser) => {
    const browserSources = sources.filter((source) => source.browserId === browser.id);
    const sourceList = browserSources.map((source) => ({ id: source.id, profileName: source.profileName }));
    if (browser.id === ARC_IMPORT_SOURCE_ID && findArcSidebarFile() !== null) {
      sourceList.push({ id: ARC_IMPORT_SOURCE_ID, profileName: null });
    }
    return { id: browser.id, name: browser.name, iconUrl: null, sources: sourceList };
  });
  return orderBrowsers(browsers);
}

/**
 * A tab's title as the sidebar shows it (the name the user gave it, else the page's).
 */
function previewTitle(tab: TabItem): string {
  return tab.customTitle ?? tab.title;
}

/**
 * One Pinned item as the preview draws it: a tab with its icon, or a folder. Split views show their first tab.
 */
function previewPinnedItem(state: BrowserState, item: SidebarItem): WelcomeSidebar["pinned"][number] | null {
  if (item.kind === "folder") {
    return { title: item.title, iconUrl: null, isFolder: true };
  }
  if (item.kind === "tab") {
    return { title: previewTitle(item), iconUrl: item.faviconUrl, isFolder: false };
  }
  const firstTab = state.items[item.childIds[0] ?? ""];
  if (firstTab === undefined || firstTab.kind !== "tab") {
    return null;
  }
  return { title: previewTitle(firstTab), iconUrl: firstTab.faviconUrl, isFolder: false };
}

/**
 * The sidebar preview beside the import: the active Space's name, its profile's Favorites and its first Pinned items,
 * as they are now (it fills in as an import lands).
 */
function buildSidebarPreview(state: BrowserState): WelcomeSidebar {
  const space = getActiveSpace(state);
  const profile = state.profiles.find((candidate) => candidate.id === space.profileId);
  const favoriteTabs: TabItem[] = [];
  for (const itemId of profile?.favoriteIds ?? []) {
    const item = state.items[itemId];
    if (item !== undefined && item.kind === "tab") {
      favoriteTabs.push(item);
    }
  }
  const favorites = favoriteTabs.slice(0, PREVIEW_FAVORITES_LIMIT).map((tab) => ({ title: previewTitle(tab), iconUrl: tab.faviconUrl }));
  const pinned: WelcomeSidebar["pinned"] = [];
  for (const itemId of space.pinnedIds.slice(0, PREVIEW_PINNED_LIMIT)) {
    const item = state.items[itemId];
    const previewItem = item === undefined ? null : previewPinnedItem(state, item);
    if (previewItem !== null) {
      pinned.push(previewItem);
    }
  }
  return { spaceName: space.name, favorites: favorites, pinned: pinned };
}

function buildWelcomeData(state: BrowserState): WelcomeData {
  const space = getActiveSpace(state);
  const presets = THEME_PRESETS.map((preset) => ({ label: preset.label, colors: preset.colors, appearance: preset.appearance }));
  const shortcutAccelerator = state.settings.globalShortcut ?? WELCOME_GLOBAL_SHORTCUT.accelerator;
  const shortcutChoice = GLOBAL_SHORTCUT_CHOICES.find((choice) => choice.accelerator === shortcutAccelerator) ?? WELCOME_GLOBAL_SHORTCUT;
  return {
    spaceId: space.id,
    theme: space.theme,
    isSystemDark: nativeTheme.shouldUseDarkColors,
    browsers: welcomeBrowsers.map((browser) => ({ ...browser, iconUrl: getBrowserIcon(browser.id) })),
    imports: Object.fromEntries(welcomeImports),
    sidebar: buildSidebarPreview(state),
    presets: presets,
    isPackaged: app.isPackaged,
    isDefaultBrowser: app.isPackaged && isDefaultBrowser(),
    isAdBlockOn: state.settings.isAdBlockOn === true,
    globalShortcut: {
      accelerator: shortcutChoice.accelerator,
      label: shortcutChoice.label,
      status: state.settings.globalShortcut === undefined ? "off" : getGlobalShortcutStatus(),
    },
  };
}

/**
 * The onboarding window's place: this share of the work area of the screen the browser is on, centred, never
 * smaller than the minimum (nor bigger than the screen).
 */
function computeOnboardingBounds(): Rectangle {
  const browserWindow = getWindow();
  const display = browserWindow === null ? screen.getPrimaryDisplay() : screen.getDisplayMatching(browserWindow.getBounds());
  const area = display.workArea;
  const width = Math.min(area.width, Math.max(ONBOARDING_MIN_WIDTH_PX, Math.round(area.width * ONBOARDING_SCREEN_SHARE)));
  const height = Math.min(area.height, Math.max(ONBOARDING_MIN_HEIGHT_PX, Math.round(area.height * ONBOARDING_SCREEN_SHARE)));
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width: width,
    height: height,
  };
}

/**
 * The onboarding ended (its button, Skip, Escape, or its window closed): it is done, and at the first start the
 * browser window shows now.
 */
function handleOnboardingClosed(): void {
  onboardingWindow = null;
  welcomeImports.clear();
  preparedSources.clear();
  applyChange((state) => finishWelcome(state));
  if (isFirstStartOnboarding) {
    isFirstStartOnboarding = false;
    showMainWindows();
  }
}

/**
 * Opens the onboarding window (or brings the open one forward). `isFirstStart`: the browser window is hidden and
 * shows when the onboarding ends.
 */
export function openOnboarding(isFirstStart: boolean): void {
  if (onboardingWindow !== null && !onboardingWindow.isDestroyed()) {
    onboardingWindow.show();
    return;
  }
  isFirstStartOnboarding = isFirstStart;
  welcomeImports.clear();
  preparedSources.clear();
  welcomeBrowsers = listWelcomeBrowsers();
  const browserIds = welcomeBrowsers.map((browser) => browser.id);
  loadBrowserIcons(browserIds)
    .then(() => refreshOnboarding())
    .catch((error) => console.error("The browsers' icons could not be drawn:", error));
  const theme = getActiveSpace(getState()).theme;
  const isDark = isThemeDark(theme, nativeTheme.shouldUseDarkColors);
  const bounds = computeOnboardingBounds();
  // __dirname is dist/node/main when running, so these paths point into the build output.
  const preloadPath = path.join(__dirname, "..", "preload", "onboardingPreload.js");
  const pagePath = path.join(__dirname, "..", "..", "web", "onboarding", "onboarding.html");
  const window = new BrowserWindow({
    ...bounds,
    minWidth: ONBOARDING_MIN_WIDTH_PX,
    minHeight: ONBOARDING_MIN_HEIGHT_PX,
    show: false,
    title: "Welcome to Bow",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: TRAFFIC_LIGHT_POSITION,
    backgroundColor: isDark ? DARK_BASE_COLOR : LIGHT_BASE_COLOR,
    fullscreenable: false,
    webPreferences: { preload: preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  onboardingWindow = window;
  // Our own page with a bridge: it never navigates away and opens no windows.
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => handleOnboardingClosed());
  window.loadFile(pagePath).catch((error) => console.error("The onboarding could not load:", error));
}

/**
 * Sends the onboarding what it shows now, when it is open: it updates in place (a full redraw would restart its
 * animations). After every action (main.ts), and when macOS's default-browser question was answered.
 */
export function refreshOnboarding(): void {
  const contents = getOnboardingContents();
  if (contents === null) {
    return;
  }
  contents.send(ONBOARDING_CHANNELS.data, buildWelcomeData(getState()));
}

/**
 * Records what the page shows for a source and sends it.
 */
function setWelcomeImport(sourceId: string, welcomeImport: WelcomeImport): void {
  welcomeImports.set(sourceId, welcomeImport);
  refreshOnboarding();
}

/**
 * True when the onboarding lists this source (a browser profile, or Arc): the page may only read those.
 */
function isListedSource(sourceId: unknown): sourceId is string {
  return welcomeBrowsers.some((browser) => browser.sources.some((source) => source.id === sourceId));
}

/**
 * Reads one source and counts what it holds. Its card shows it reading, then what it found (every part chosen), or
 * that Safari needs Full Disk Access, or that it failed. A source being read or brought over is left alone.
 */
async function readWelcomeSource(sourceId: string): Promise<void> {
  const phase = welcomeImports.get(sourceId)?.phase;
  if (phase === "reading" || phase === "importing" || phase === "done") {
    return;
  }
  setWelcomeImport(sourceId, { phase: "reading", found: null, parts: [], doneParts: [] });
  try {
    if (sourceId === ARC_IMPORT_SOURCE_ID) {
      const sidebarFile = findArcSidebarFile();
      const preparation = sidebarFile === null ? { error: "Arc is not on this Mac." } : await prepareArcImport(sidebarFile);
      if ("error" in preparation) {
        console.warn("The onboarding could not read Arc:", preparation.error);
        setWelcomeImport(sourceId, { phase: "failed", found: null, parts: [], doneParts: [] });
        return;
      }
      preparedSources.set(sourceId, { arc: preparation.prepared });
      const found = preparation.prepared.found;
      setWelcomeImport(sourceId, { phase: "found", found: found, parts: found.parts, doneParts: [] });
      return;
    }
    const preparation = await prepareBrowserImport(sourceId);
    if ("needsFullDiskAccess" in preparation) {
      setWelcomeImport(sourceId, { phase: "needsAccess", found: null, parts: [], doneParts: [] });
      return;
    }
    if ("isMissing" in preparation) {
      setWelcomeImport(sourceId, { phase: "failed", found: null, parts: [], doneParts: [] });
      return;
    }
    preparedSources.set(sourceId, { browser: preparation.prepared });
    const found = preparation.prepared.found;
    setWelcomeImport(sourceId, { phase: "found", found: found, parts: found.parts, doneParts: [] });
  } catch (error) {
    console.error("The onboarding could not read an import source:", error);
    setWelcomeImport(sourceId, { phase: "failed", found: null, parts: [], doneParts: [] });
  }
}

/**
 * Brings the chosen parts of a source that was read over; its card ticks each part as it lands, then shows it done.
 * Only parts it found count; none chosen does nothing.
 */
async function bringWelcomeSourceOver(sourceId: string, chosenParts: ImportPart[]): Promise<void> {
  const welcomeImport = welcomeImports.get(sourceId);
  const prepared = preparedSources.get(sourceId);
  if (welcomeImport === undefined || welcomeImport.phase !== "found" || welcomeImport.found === null || prepared === undefined) {
    return;
  }
  const foundParts = welcomeImport.found.parts;
  const parts = IMPORT_PART_ORDER.filter((part) => foundParts.includes(part) && chosenParts.includes(part));
  if (parts.length === 0) {
    return;
  }
  const doneParts: ImportPart[] = [];
  const showProgress = (phase: WelcomeImport["phase"]): void => {
    setWelcomeImport(sourceId, { phase: phase, found: welcomeImport.found, parts: parts, doneParts: [...doneParts] });
  };
  const markDone = (part: ImportPart): void => {
    doneParts.push(part);
    showProgress("importing");
  };
  showProgress("importing");
  try {
    if ("arc" in prepared) {
      await applyArcImport(prepared.arc, parts, markDone);
    } else {
      applyBrowserImport(prepared.browser, parts, markDone);
    }
    preparedSources.delete(sourceId);
    showProgress("done");
  } catch (error) {
    console.error("The onboarding's import failed:", error);
    showProgress("failed");
  }
}

/**
 * The parts a page asked for, when the message holds only known part names.
 */
function readPartList(value: unknown): ImportPart[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value.filter((part): part is ImportPart => IMPORT_PART_ORDER.some((known) => known === part));
  return parts.length === value.length ? parts : null;
}

/**
 * True when a message comes from the onboarding's own page.
 */
function isFromOnboarding(event: IpcMainInvokeEvent): boolean {
  return getOnboardingContents() !== null && event.sender === getOnboardingContents();
}

/**
 * Answers the onboarding page's messages, each only from that page.
 */
export function registerOnboardingIpc(): void {
  ipcMain.handle(ONBOARDING_CHANNELS.getData, (event) => (isFromOnboarding(event) ? buildWelcomeData(getState()) : null));
  ipcMain.handle(ONBOARDING_CHANNELS.close, (event) => {
    if (isFromOnboarding(event)) {
      onboardingWindow?.close();
    }
  });
  ipcMain.handle(ONBOARDING_CHANNELS.readSource, async (event, sourceId: unknown) => {
    if (isFromOnboarding(event) && isListedSource(sourceId)) {
      await readWelcomeSource(sourceId);
    }
  });
  ipcMain.handle(ONBOARDING_CHANNELS.bringOver, async (event, sourceId: unknown, parts: unknown) => {
    const partList = readPartList(parts);
    if (isFromOnboarding(event) && isListedSource(sourceId) && partList !== null) {
      await bringWelcomeSourceOver(sourceId, partList);
    }
  });
  ipcMain.handle(ONBOARDING_CHANNELS.openFullDiskAccess, async (event) => {
    if (isFromOnboarding(event)) {
      await openFullDiskAccessSettings();
    }
  });
}
