/**
 * WHY this file exists:
 *   Bow's onboarding has a window of its own, like Arc's first start: about 70 % of the screen, centred, over the
 *   desktop at the first start (the browser window stays hidden until it ends) and over the browser when it is
 *   opened again from Help › Welcome to Bow…. This file opens and closes that window, sends its page what it shows
 *   (the active Space and its look, what this Mac can import from and how those imports went, the defaults), and
 *   answers its page's messages, from that page only.
 *
 * Data source:
 *   The state (browserCore.ts), the import sources (browserImportController.ts, arcImportController.ts), whether Bow
 *   is the default browser, the global shortcut's status, the screen's work area.
 *
 * Data flow:
 *   main.ts first start → openOnboarding(true) → the window → its page asks getData → "onboarding:data" on changes
 *   (refreshOnboarding, after every action) → the page closes it → finishWelcome → showMainWindows() (first start)
 *   Help › Welcome to Bow… / Command Bar → openOnboarding(false)
 */
import { app, BrowserWindow, ipcMain, nativeTheme, screen } from "electron";
import type { IpcMainInvokeEvent, Rectangle, WebContents } from "electron";
import * as path from "node:path";
import { ARC_IMPORT_SOURCE_ID, ONBOARDING_CHANNELS } from "../shared/onboarding";
import type { ImportSummary, WelcomeData, WelcomeImportSource, WelcomeImportState } from "../shared/onboarding";
import { GLOBAL_SHORTCUT_CHOICES, ONBOARDING_MIN_HEIGHT_PX, ONBOARDING_MIN_WIDTH_PX, ONBOARDING_SCREEN_SHARE } from "../shared/settings";
import { isThemeDark } from "../shared/themePalette";
import type { BrowserState } from "../shared/types";
import { isArcSidebarPresent } from "./arcImportController";
import { applyChange, getState, getWindow } from "./browserCore";
import { listImportSources } from "./browserImportController";
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

/** The open onboarding window, and whether it is the first start's (its end shows the browser window). */
let onboardingWindow: BrowserWindow | null = null;
let isFirstStartOnboarding = false;

/** Imports started from the onboarding, by source id: their cards show them running, then what arrived. */
const welcomeImports = new Map<string, WelcomeImportState>();

/** What this Mac has to import from, read once when the onboarding opens (it reads the disk). */
let welcomeSources: WelcomeImportSource[] = [];

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
function buildWelcomeData(state: BrowserState): WelcomeData {
  const space = getActiveSpace(state);
  const presets = THEME_PRESETS.map((preset) => ({ label: preset.label, colors: preset.colors, appearance: preset.appearance }));
  const shortcutAccelerator = state.settings.globalShortcut ?? WELCOME_GLOBAL_SHORTCUT.accelerator;
  const shortcutChoice = GLOBAL_SHORTCUT_CHOICES.find((choice) => choice.accelerator === shortcutAccelerator) ?? WELCOME_GLOBAL_SHORTCUT;
  return {
    spaceId: space.id,
    theme: space.theme,
    isSystemDark: nativeTheme.shouldUseDarkColors,
    importSources: welcomeSources,
    imports: Object.fromEntries(welcomeImports),
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
  const browserSources = listImportSources().map((source) => ({ id: source.id, label: source.label }));
  const arcSources = isArcSidebarPresent() ? [{ id: ARC_IMPORT_SOURCE_ID, label: "Arc" }] : [];
  welcomeSources = [...arcSources, ...browserSources];
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
 * Runs an import the onboarding started: its card shows it running, then what arrived; cancelled (the file picker,
 * Safari's Full Disk Access) brings the card back; an error shows it failed (the importer told the user why).
 */
export function runWelcomeImport(sourceId: string, runImport: () => Promise<ImportSummary | null>): void {
  welcomeImports.set(sourceId, { phase: "running", summary: null });
  refreshOnboarding();
  runImport()
    .then((summary) => {
      if (summary === null) {
        welcomeImports.delete(sourceId);
      } else {
        welcomeImports.set(sourceId, { phase: "done", summary: summary });
      }
    })
    .catch((error) => {
      console.error("Import from the onboarding failed:", error);
      welcomeImports.set(sourceId, { phase: "failed", summary: null });
    })
    .finally(() => refreshOnboarding());
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
}
