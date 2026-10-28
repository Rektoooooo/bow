/**
 * WHY this file exists:
 *   Library › Shortcuts' main side (the rules are in shortcutOverrides.ts): it records the keys you press for a
 *   command, refuses keys that are already in use, saves your keys, and puts the menu bar back with them. While it
 *   records, the menu bar's keys are shown but not registered, so a press reaches the Library page (which sends it
 *   here) instead of running a command: ⌘T can be recorded without opening a tab.
 *
 * Data source:
 *   settings.shortcutOverrides, the app menu's commands (appMenu.ts), the overlay page's key presses.
 *
 * Data flow:
 *   a row's keys clicked → beginShortcutRecording(path) → menu keys unregistered → the page's next key press →
 *   recordShortcutKeys() → toAccelerator → findShortcutConflict → applyChange(setShortcutOverride) → menu rebuilt
 */
import type { LibraryData } from "../shared/overlay";
import { formatAccelerator } from "../shared/shortcuts";
import type { BrowserState } from "../shared/types";
import type { AppMenuCommands } from "./appMenu";
import { buildDefaultMenuTemplate, buildMenuTemplate, installAppMenu } from "./appMenu";
import { applyChange, getState, onStateChanged } from "./browserCore";
import { findShortcutConflict, isValidAccelerator, listShortcutCommands, toAccelerator } from "./shortcutOverrides";
import type { KeyPress } from "./shortcutOverrides";
import { resetShortcutOverrides, setShortcutOverride } from "./state";

/** The menu's commands, given at the start (main.ts). */
let menuCommands: AppMenuCommands | null = null;

/** The command whose keys are being recorded, and why the last keys were refused. */
let recordingPath: string | null = null;
let problem: string | null = null;

/** The overrides the menu bar was last built with, as text, to rebuild it only when they change. */
let installedOverrides = "";

/** Called when what the Library shows changed (overlayController.ts refreshOpenPanel). */
let notifyChanged: () => void = () => undefined;

/**
 * Your keys now.
 */
function readOverrides(state: BrowserState): Record<string, string> {
  return state.settings.shortcutOverrides ?? {};
}

/**
 * Who already uses some keys, with your keys applied, apart from the command being changed; null when free.
 */
function describeConflict(accelerator: string, path: string): string | null {
  if (menuCommands === null) {
    return null;
  }
  const template = buildMenuTemplate(menuCommands, readOverrides(getState()));
  const conflict = findShortcutConflict(template, accelerator, path);
  if (conflict === null) {
    return null;
  }
  const keys = formatAccelerator(accelerator);
  return conflict === "macOS" ? `${keys} belongs to macOS.` : `${keys} is already ${conflict}.`;
}

/**
 * Saves keys for a command: your own ("" for none), or its default (null), unless the keys are in use.
 */
export function setShortcut(path: string, accelerator: string | null): void {
  const defaults = menuCommands === null ? [] : listShortcutCommands(buildDefaultMenuTemplate(menuCommands));
  const command = defaults.find((candidate) => candidate.path === path);
  const keysAfter = accelerator === null ? (command?.defaultAccelerator ?? null) : accelerator;
  const conflict = keysAfter === null || keysAfter === "" ? null : describeConflict(keysAfter, path);
  problem = conflict;
  if (conflict === null && command !== undefined) {
    applyChange((state) => setShortcutOverride(state, path, accelerator));
  }
  notifyChanged();
}

/**
 * Every command back to its default keys.
 */
export function resetAllShortcuts(): void {
  problem = null;
  if (recordingPath !== null) {
    recordingPath = null;
    installMenu();
  }
  applyChange((state) => resetShortcutOverrides(state));
  notifyChanged();
}

/**
 * Rebuilds the menu bar with your keys, its keys unregistered while recording.
 */
function installMenu(): void {
  if (menuCommands !== null) {
    installAppMenu(menuCommands, readOverrides(getState()), recordingPath !== null);
  }
}

/**
 * A key press the Library page recorded: a modifier alone waits; keys without a modifier or in use are refused (the
 * recording goes on); anything else is saved.
 */
export function recordShortcutKeys(press: KeyPress): void {
  if (recordingPath === null) {
    return;
  }
  const accelerator = toAccelerator(press);
  if (accelerator === null) {
    return;
  }
  if (!isValidAccelerator(accelerator)) {
    problem = "Add ⌘, ⌃ or ⌥ to the key, or use a function key.";
    notifyChanged();
    return;
  }
  // Keys in use are refused and recording goes on, so another press can try again (Escape stops).
  const conflict = describeConflict(accelerator, recordingPath);
  if (conflict !== null) {
    problem = conflict;
    notifyChanged();
    return;
  }
  const path = recordingPath;
  recordingPath = null;
  installMenu();
  setShortcut(path, accelerator);
}

/**
 * Starts recording keys for a command; the next key press on the Library sets them.
 */
export function beginShortcutRecording(path: string): void {
  recordingPath = path;
  problem = null;
  installMenu();
  notifyChanged();
}

/**
 * Stops recording without changing anything.
 */
export function cancelShortcutRecording(): void {
  const hadNothing = recordingPath === null && problem === null;
  if (hadNothing) {
    return;
  }
  const wasRecording = recordingPath !== null;
  recordingPath = null;
  problem = null;
  if (wasRecording) {
    installMenu();
  }
  notifyChanged();
}

/**
 * What Library › Shortcuts shows: each menu's commands with their keys now, whether you changed them, the command
 * being recorded and why keys were refused.
 */
export function buildShortcutEditorData(state: BrowserState): LibraryData["shortcuts"] {
  const overrides = readOverrides(state);
  const commands = menuCommands === null ? [] : listShortcutCommands(buildDefaultMenuTemplate(menuCommands));
  const groups: LibraryData["shortcuts"]["groups"] = [];
  for (const command of commands) {
    const isChanged = Object.hasOwn(overrides, command.path);
    const accelerator = isChanged ? overrides[command.path] : command.defaultAccelerator;
    const keys = accelerator === null || accelerator === undefined || accelerator === "" ? "" : formatAccelerator(accelerator);
    let group = groups.find((candidate) => candidate.title === command.menu);
    if (group === undefined) {
      group = { title: command.menu, items: [] };
      groups.push(group);
    }
    group.items.push({ path: command.path, label: command.label, keys: keys, isChanged: isChanged });
  }
  return { groups: groups, recordingPath: recordingPath, problem: problem };
}

/**
 * Builds the menu bar with your keys now, and again whenever they change.
 */
export function startShortcutEditing(commands: AppMenuCommands, onChanged: () => void): void {
  menuCommands = commands;
  notifyChanged = onChanged;
  const install = (state: BrowserState): void => {
    const overrides = readOverrides(state);
    const text = JSON.stringify(overrides);
    if (text === installedOverrides) {
      return;
    }
    installedOverrides = text;
    installAppMenu(commands, overrides, recordingPath !== null);
  };
  installedOverrides = JSON.stringify(readOverrides(getState()));
  installAppMenu(commands, readOverrides(getState()));
  onStateChanged(install);
}

/**
 * Builds the menu bar again with your keys (an update has downloaded: the app menu offers the restart).
 */
export function reinstallAppMenu(): void {
  installMenu();
}
