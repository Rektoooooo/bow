/**
 * WHY this file exists:
 *   `npm run e2e` drives the real app for many minutes. Its windows used to come to the front and take the keyboard
 *   and mouse, so nobody could use the Mac meanwhile, and their typing and clicks landed in the checks (the user,
 *   2026-10-28). With BOW_E2E_BACKGROUND=1 (set by e2e/background.mjs) the app stays out of the way: no Dock icon,
 *   windows never come forward and can never take the keyboard, they are invisible, and clicks pass through them.
 *   The checks drive the pages through Chromium's DevTools protocol, which needs none of that.
 *
 *   The app's own focus bookkeeping still runs: asking a window for the focus marks it focused (isFocused, the
 *   "focus" and "blur" events) without asking macOS, so which window is "in front" behaves as in normal use.
 *
 * Data source:
 *   The BOW_E2E_BACKGROUND environment variable. Only whoever starts the app can set it, like the test flags.
 *
 * Data flow:
 *   main.ts startApp() → keepTestRunInBackground() → BrowserWindow's show / focus / blur / isFocused act without macOS
 *   → every new window is see-through and lets clicks pass
 */
import { app, BaseWindow, BrowserWindow, dialog, globalShortcut, session } from "electron";
import type { OpenDevToolsOptions, Session, WebContents } from "electron";

/** The environment variable e2e/background.mjs sets. */
const BACKGROUND_VARIABLE = "BOW_E2E_BACKGROUND";

/** Chromium's switches against slowing down hidden or covered pages (the ones automated Chrome runs use). */
const FULL_SPEED_SWITCHES = ["disable-renderer-backgrounding", "disable-background-timer-throttling", "disable-backgrounding-occluded-windows"];

/** The window the app treats as focused while running in the background. */
let pretendFocusedWindow: BaseWindow | null = null;

/**
 * True while the app runs for the e2e checks in the background.
 */
export function isBackgroundTestRun(): boolean {
  return process.env[BACKGROUND_VARIABLE] === "1";
}

/**
 * Marks a window focused for the app (events and isFocused) without asking macOS to bring it forward.
 */
function pretendFocus(window: BaseWindow): void {
  const previous = pretendFocusedWindow;
  if (previous === window) {
    return;
  }
  pretendFocusedWindow = window;
  if (previous !== null && !previous.isDestroyed()) {
    previous.emit("blur");
  }
  window.emit("focus");
}

/**
 * Makes a window invisible, lets clicks pass through it, and keeps it from ever being the key window: focusing a page
 * or the overlay could otherwise make it take the keyboard, and the user's typing in another app would land in the
 * checks (seen 2026-10-28).
 */
function keepOutOfTheWay(window: BaseWindow): void {
  window.setOpacity(0);
  window.setIgnoreMouseEvents(true);
  window.setFocusable(false);
}

/**
 * Keeps an e2e run out of the user's way (see the header). Does nothing outside e2e runs.
 */
export function keepTestRunInBackground(): void {
  if (!isBackgroundTestRun()) {
    return;
  }
  // Chromium slows the timers and painting of windows nobody can see; invisible windows count, so the checks' timing
  // would differ from normal use. These switches keep every page running at full speed (as in automated Chrome).
  for (const chromiumSwitch of FULL_SPEED_SWITCHES) {
    app.commandLine.appendSwitch(chromiumSwitch);
  }
  app.on("web-contents-created", (_event, contents) => contents.setBackgroundThrottling(false));
  // No Dock icon, and never the active app.
  app.setActivationPolicy("accessory");
  app.focus = () => undefined;
  // Every window, BrowserWindow or plain BaseWindow (picture in picture): invisible, clicks pass through, never the
  // key window, and shown without activating the app. A window must be made with show: false for this to hold
  // (made showing, macOS activates the app before any of this runs; littleWindow.ts and the others do).
  const showWithoutActivating = BaseWindow.prototype.showInactive;
  for (const windowPrototype of [BaseWindow.prototype, BrowserWindow.prototype]) {
    windowPrototype.showInactive = function showInactive(this: BaseWindow): void {
      keepOutOfTheWay(this);
      showWithoutActivating.call(this);
    };
    windowPrototype.show = function show(this: BaseWindow): void {
      keepOutOfTheWay(this);
      showWithoutActivating.call(this);
      pretendFocus(this);
    };
    windowPrototype.focus = function focus(this: BaseWindow): void {
      keepOutOfTheWay(this);
      showWithoutActivating.call(this);
      pretendFocus(this);
    };
    windowPrototype.blur = function blur(this: BaseWindow): void {
      if (pretendFocusedWindow === this) {
        pretendFocusedWindow = null;
        this.emit("blur");
      }
    };
    windowPrototype.isFocused = function isFocused(this: BaseWindow): boolean {
      return this === pretendFocusedWindow;
    };
  }
  BrowserWindow.getFocusedWindow = () => {
    const isUsable = pretendFocusedWindow instanceof BrowserWindow && !pretendFocusedWindow.isDestroyed();
    return isUsable ? (pretendFocusedWindow as BrowserWindow) : null;
  };
  // On macOS Electron's webContents.focus() also focuses its window natively, which activates the app: every panel
  // that takes the keyboard (the Command Bar, the Library) pulled the user's typing away (seen 2026-10-28). Here the
  // windows can never be the key window, so that focus could not reach the page anyway: it does nothing.
  let isFocusPatched = false;
  app.on("web-contents-created", (_event, contents) => {
    if (isFocusPatched) {
      return;
    }
    isFocusPatched = true;
    const contentsPrototype = Object.getPrototypeOf(contents) as WebContents;
    contentsPrototype.focus = function focus(): void {
      return undefined;
    };
  });
  // Developer tools in their own window come to the front, and ask to again when they show a panel. Here they load
  // into a hidden window of ours instead, so they still run and the checks can read them, but nothing shows.
  app.on("web-contents-created", (_event, contents) => {
    const openDevTools = contents.openDevTools.bind(contents);
    contents.openDevTools = (options?: OpenDevToolsOptions): void => {
      if (contents.isDevToolsOpened()) {
        return;
      }
      const host = new BrowserWindow({ show: false });
      contents.setDevToolsWebContents(host.webContents);
      contents.once("devtools-closed", () => host.destroy());
      openDevTools({ mode: "detach", ...options, activate: false });
    };
  });
  // A macOS dialog would take the keyboard: a check that expects one replaces these itself; any other answers as if
  // cancelled, without showing anything.
  dialog.showMessageBox = (async (...parts: unknown[]) => {
    const options = parts.at(-1) as Electron.MessageBoxOptions;
    return { response: options.cancelId ?? 0, checkboxChecked: false };
  }) as typeof dialog.showMessageBox;
  dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog;
  dialog.showSaveDialog = (async () => ({ canceled: true, filePath: "" })) as typeof dialog.showSaveDialog;
  // macOS's screen-sharing picker is a window of its own that takes the keyboard: a stand-in waits the way it does
  // (nothing is shared until someone picks), without showing anything. BOW_E2E_FOREGROUND=1 runs the real one.
  app.whenReady().then(() => {
    const sessionPrototype = Object.getPrototypeOf(session.defaultSession) as Session;
    const setHandler = sessionPrototype.setDisplayMediaRequestHandler;
    sessionPrototype.setDisplayMediaRequestHandler = function setDisplayMediaRequestHandler(this: Session, handler, options): void {
      if (options?.useSystemPicker === true) {
        setHandler.call(this, () => undefined, { ...options, useSystemPicker: false });
        return;
      }
      setHandler.call(this, handler, options);
    };
  });
  // A shortcut registered system-wide would take the keys of whoever is using the Mac: the checks press it through
  // this list instead (globalShortcutController.ts).
  const testShortcuts = new Map<string, () => void>();
  (globalThis as Record<string, unknown>).bowTestShortcuts = testShortcuts;
  globalShortcut.register = (accelerator: string, callback: () => void): boolean => {
    testShortcuts.set(accelerator, callback);
    return true;
  };
  globalShortcut.unregister = (accelerator: string): void => {
    testShortcuts.delete(accelerator);
  };
  globalShortcut.isRegistered = (accelerator: string): boolean => testShortcuts.has(accelerator);
  globalShortcut.unregisterAll = (): void => testShortcuts.clear();
  app.on("browser-window-created", (_event, window) => {
    keepOutOfTheWay(window);
    window.on("closed", () => {
      if (pretendFocusedWindow === window) {
        pretendFocusedWindow = null;
      }
    });
  });
}
