/**
 * WHY this file exists:
 *   The shortcut from any app (Library › Settings): ⌥Space, or another choice, brings Bow up with the Command Bar
 *   ready, or opens a Little Window, without switching to Bow first. Off until the user picks one: launchers such as
 *   Alfred and Raycast use some of the same keys. When another app holds the keys, the Library says so.
 *
 * Data source:
 *   settings.globalShortcut and globalShortcutOpens.
 *
 * Data flow:
 *   start, and every state change → applyGlobalShortcut() → Electron's globalShortcut (system-wide)
 *   the keys pressed anywhere → openFromAnyApp() → the Command Bar in the last window used, or a Little Window
 */
import { app, globalShortcut } from "electron";
import type { BrowserState } from "../shared/types";
import { getState, getWindow, onStateChanged } from "./browserCore";
import { openLittleWindow } from "./littleWindow";
import { openCommandBar } from "./overlayController";

/** How the shortcut stands: off, working, or held by another app. */
export type GlobalShortcutStatus = "off" | "on" | "taken";

/** The shortcut asked for last, and whether registering it worked. */
let wantedAccelerator: string | null = null;
let registeredAccelerator: string | null = null;

/**
 * The shortcut's state, for the Library.
 */
export function getGlobalShortcutStatus(): GlobalShortcutStatus {
  if (wantedAccelerator === null) {
    return "off";
  }
  return registeredAccelerator === wantedAccelerator ? "on" : "taken";
}

/**
 * The shortcut was pressed in any app: Bow comes forward with what the setting says.
 */
function openFromAnyApp(): void {
  app.focus({ steal: true });
  if (getState().settings.globalShortcutOpens === "littleWindow") {
    openLittleWindow(null);
    return;
  }
  // While Bow runs it has a main window: it quits with the last one (mainWindows.ts).
  const window = getWindow();
  window?.show();
  window?.focus();
  openCommandBar("newTab");
}

/**
 * Registers the shortcut the settings name (and lets go of the one before), when it changed.
 */
function applyGlobalShortcut(state: BrowserState): void {
  const wanted = state.settings.globalShortcut ?? null;
  if (wanted === wantedAccelerator) {
    return;
  }
  wantedAccelerator = wanted;
  if (registeredAccelerator !== null) {
    globalShortcut.unregister(registeredAccelerator);
    registeredAccelerator = null;
  }
  if (wanted !== null && globalShortcut.register(wanted, openFromAnyApp)) {
    registeredAccelerator = wanted;
  }
}

/**
 * Starts following the setting, and lets go of the keys when Bow quits.
 */
export function startGlobalShortcut(): void {
  applyGlobalShortcut(getState());
  onStateChanged(applyGlobalShortcut);
  app.on("will-quit", () => globalShortcut.unregisterAll());
}
