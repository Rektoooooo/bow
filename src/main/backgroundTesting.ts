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
import { app, BrowserWindow, globalShortcut } from "electron";

/** The environment variable e2e/background.mjs sets. */
const BACKGROUND_VARIABLE = "BOW_E2E_BACKGROUND";

/** Chromium's switches against slowing down hidden or covered pages (the ones automated Chrome runs use). */
const FULL_SPEED_SWITCHES = ["disable-renderer-backgrounding", "disable-background-timer-throttling", "disable-backgrounding-occluded-windows"];

/** The window the app treats as focused while running in the background. */
let pretendFocusedWindow: BrowserWindow | null = null;

/**
 * True while the app runs for the e2e checks in the background.
 */
export function isBackgroundTestRun(): boolean {
  return process.env[BACKGROUND_VARIABLE] === "1";
}

/**
 * Marks a window focused for the app (events and isFocused) without asking macOS to bring it forward.
 */
function pretendFocus(window: BrowserWindow): void {
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
  const windowPrototype = BrowserWindow.prototype;
  const showWithoutActivating = windowPrototype.showInactive;
  windowPrototype.show = function show(this: BrowserWindow): void {
    showWithoutActivating.call(this);
    pretendFocus(this);
  };
  windowPrototype.focus = function focus(this: BrowserWindow): void {
    showWithoutActivating.call(this);
    pretendFocus(this);
  };
  windowPrototype.blur = function blur(this: BrowserWindow): void {
    if (pretendFocusedWindow === this) {
      pretendFocusedWindow = null;
      this.emit("blur");
    }
  };
  windowPrototype.isFocused = function isFocused(this: BrowserWindow): boolean {
    return this === pretendFocusedWindow;
  };
  BrowserWindow.getFocusedWindow = () => (pretendFocusedWindow !== null && !pretendFocusedWindow.isDestroyed() ? pretendFocusedWindow : null);
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
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
    // Never the key window: focusing a page or the overlay could otherwise make an invisible window take the
    // keyboard, and the user's typing in another app would land in the checks (seen 2026-10-28).
    window.setFocusable(false);
    window.on("closed", () => {
      if (pretendFocusedWindow === window) {
        pretendFocusedWindow = null;
      }
    });
  });
}
