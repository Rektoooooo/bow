/**
 * WHY this file exists:
 *   Carries out what a bow:// address asks for (bowUrls.ts): Bow comes forward, then opens the address (in the named
 *   Space), switches Spaces, opens tab search or the Command Bar with the text typed, or a Little Window.
 *
 * Data source:
 *   The parsed command and the state (Spaces, the active Space's search engine).
 *
 * Data flow:
 *   main.ts open-url "bow://…" → handleBowUrl() → applyChange / openCommandBar / openLittleWindow
 */
import { app } from "electron";
import { findSpaceSearchEngine } from "../shared/searchEngines";
import { applyChange, getState, getWindow } from "./browserCore";
import { findSpaceByNameOrNumber, parseBowUrl } from "./bowUrls";
import type { BowCommand } from "./bowUrls";
import { openLittleWindow } from "./littleWindow";
import { openCommandBar } from "./overlayController";
import { switchSpace } from "./spaces";
import { openOrSwitchToTab } from "./tabActions";
import { normalizeTypedInput } from "./urls";

/**
 * Switches to the Space a name or number means; false when there is none.
 */
function switchToNamedSpace(nameOrNumber: string): boolean {
  const space = findSpaceByNameOrNumber(getState(), nameOrNumber);
  if (space === null) {
    return false;
  }
  applyChange((state) => switchSpace(state, space.id, Date.now()));
  return true;
}

/**
 * Typed text as an address: itself, or a search with the active Space's engine (urls.ts: always http or https).
 */
function toAddress(text: string): string {
  const state = getState();
  return normalizeTypedInput(text, findSpaceSearchEngine(state, state.activeSpaceId), state.searchKeywords);
}

/**
 * Runs one command, Bow already in front.
 */
function runCommand(command: BowCommand): void {
  if (command.kind === "switchSpace") {
    switchToNamedSpace(command.spaceName);
    return;
  }
  if (command.kind === "open") {
    if (command.spaceName !== null) {
      switchToNamedSpace(command.spaceName);
    }
    openOrSwitchToTab(toAddress(command.text));
    return;
  }
  if (command.kind === "searchTabs") {
    openCommandBar("tabs", command.query);
    return;
  }
  if (command.kind === "commandBar") {
    openCommandBar("newTab", command.text);
    return;
  }
  openLittleWindow(command.text === null ? null : toAddress(command.text));
}

/**
 * A bow:// address arrived from another app: Bow comes forward and does what it asks. Anything else is ignored.
 */
export function handleBowUrl(url: string): void {
  const command = parseBowUrl(url);
  if (command === null) {
    return;
  }
  app.focus({ steal: true });
  // A Little Window comes forward by itself; the others act in the last window used.
  if (command.kind !== "little") {
    const window = getWindow();
    window?.show();
    window?.focus();
  }
  runCommand(command);
}
