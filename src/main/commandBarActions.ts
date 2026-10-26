/**
 * WHY this file exists:
 *   Arc's Command Bar also runs browser actions ("New Space", "Toggle Sidebar", "Copy URL", …): its main menu
 *   doubles as the action list. This file is our action list: titles and search words for ranking, and what each
 *   one does when chosen. Some entries are made per Space, per archive setting and per theme.
 *
 * Data source:
 *   The menu commands (appMenu.ts), the state (Spaces, current theme), ARCHIVE_THRESHOLD_OPTIONS and THEME_PRESETS.
 *
 * Data flow:
 *   overlayController.ts query → list() → commandBar.ts ranks them → user picks one → run(actionId)
 */
import type { BrowserAction } from "../shared/actions";
import { ARCHIVE_THRESHOLD_OPTIONS } from "../shared/settings";
import type { BrowserState } from "../shared/types";
import type { AppMenuCommands } from "./appMenu";
import type { CommandBarAction } from "./commandBar";
import { applyPreset, THEME_PRESETS } from "./themePresets";
import { findSpace } from "./tree";

/** What the actions need to do their work. */
export interface CommandActionHost {
  commands: AppMenuCommands;
  runAction(action: BrowserAction): void;
  getState(): BrowserState;
}

/** The action list and how to run an entry. */
export interface CommandActionRegistry {
  list(): CommandBarAction[];
  run(actionId: string): void;
}

/** A fixed action: its Command Bar entry and what it does. */
interface FixedAction {
  entry: CommandBarAction;
  run: () => void;
}

/**
 * The actions that are always there.
 */
function buildFixedActions(host: CommandActionHost): FixedAction[] {
  const commands = host.commands;
  return [
    { entry: { id: "new-space", title: "New Space", keywords: ["create space", "add space"] }, run: () => commands.newSpace() },
    { entry: { id: "new-folder", title: "New Folder", keywords: ["create folder"] }, run: () => commands.newFolder() },
    { entry: { id: "toggle-sidebar", title: "Toggle Sidebar", keywords: ["hide sidebar", "show sidebar"] }, run: () => commands.toggleSidebar() },
    { entry: { id: "copy-url", title: "Copy URL", keywords: ["copy link", "copy address"] }, run: () => commands.copySelectedUrl("plain") },
    { entry: { id: "copy-markdown", title: "Copy URL as Markdown", keywords: ["markdown link"] }, run: () => commands.copySelectedUrl("markdown") },
    { entry: { id: "toggle-pin", title: "Pin / Unpin Tab", keywords: ["pin tab", "unpin tab"] }, run: () => commands.togglePinSelected() },
    { entry: { id: "close-tab", title: "Close Tab", keywords: ["archive tab"] }, run: () => commands.closeSelectedTab() },
    { entry: { id: "clear-today", title: "Clear Today Tabs", keywords: ["archive today", "clean up"] }, run: () => commands.clearTodayTabs() },
    { entry: { id: "reopen", title: "Reopen Closed Tab", keywords: ["restore tab", "undo close"] }, run: () => commands.reopenClosedTab() },
    { entry: { id: "duplicate", title: "Duplicate Tab", keywords: ["copy tab"] }, run: () => commands.duplicateSelected() },
    { entry: { id: "split", title: "Add Split View", keywords: ["split screen", "side by side"] }, run: () => commands.addSplitPane() },
    { entry: { id: "library", title: "Open Library", keywords: ["archive", "archived tabs"] }, run: () => commands.openLibrary() },
    { entry: { id: "find", title: "Find in Page", keywords: ["search page"] }, run: () => commands.openFind() },
    { entry: { id: "devtools", title: "Developer Tools", keywords: ["inspect", "console"] }, run: () => commands.toggleDevTools() },
    { entry: { id: "zoom-in", title: "Zoom In", keywords: ["bigger"] }, run: () => commands.zoom("in") },
    { entry: { id: "zoom-out", title: "Zoom Out", keywords: ["smaller"] }, run: () => commands.zoom("out") },
    { entry: { id: "zoom-reset", title: "Actual Size", keywords: ["reset zoom"] }, run: () => commands.zoom("reset") },
    { entry: { id: "next-space", title: "Next Space", keywords: ["switch space"] }, run: () => commands.switchSpaceByOffset(1) },
    { entry: { id: "previous-space", title: "Previous Space", keywords: ["switch space"] }, run: () => commands.switchSpaceByOffset(-1) },
    { entry: { id: "little-window", title: "New Little Window", keywords: ["little arc", "small window"] }, run: () => commands.openLittleWindow() },
    { entry: { id: "private-window", title: "New Private Window", keywords: ["incognito", "private browsing"] }, run: () => commands.openPrivateWindow() },
    { entry: { id: "import-arc", title: "Import from Arc", keywords: ["arc", "migrate"] }, run: () => commands.importFromArc() },
  ];
}

/**
 * Builds the registry. list() is rebuilt on each query, so per-Space and per-theme entries are always current.
 */
export function createCommandActionRegistry(host: CommandActionHost): CommandActionRegistry {
  const fixedActions = buildFixedActions(host);

  const list = (): CommandBarAction[] => {
    const state = host.getState();
    const entries = fixedActions.map((action) => action.entry);
    for (const space of state.spaces) {
      entries.push({ id: `space:${space.id}`, title: `Switch to ${space.icon} ${space.name}`, keywords: ["space", space.name] });
    }
    for (const option of ARCHIVE_THRESHOLD_OPTIONS) {
      entries.push({ id: `archive-after:${String(option.valueMs)}`, title: `Archive Tabs After ${option.label}`, keywords: ["auto archive", "archive setting"] });
    }
    for (const preset of THEME_PRESETS) {
      entries.push({ id: `theme:${preset.label}`, title: `Theme: ${preset.label}`, keywords: ["color", "space theme"] });
    }
    return entries;
  };

  const run = (actionId: string): void => {
    const fixedAction = fixedActions.find((action) => action.entry.id === actionId);
    if (fixedAction !== undefined) {
      fixedAction.run();
      return;
    }
    runGeneratedAction(host, actionId);
  };

  return { list: list, run: run };
}

/**
 * Runs an entry made from data: "space:<id>", "archive-after:<ms|null>" or "theme:<label>".
 */
function runGeneratedAction(host: CommandActionHost, actionId: string): void {
  const separatorIndex = actionId.indexOf(":");
  const prefix = actionId.slice(0, separatorIndex);
  const value = actionId.slice(separatorIndex + 1);

  if (prefix === "space") {
    host.runAction({ type: "switchSpace", spaceId: value });
    return;
  }
  if (prefix === "archive-after") {
    const option = ARCHIVE_THRESHOLD_OPTIONS.find((candidate) => String(candidate.valueMs) === value);
    if (option !== undefined) {
      host.runAction({ type: "setArchiveAfter", archiveAfterMs: option.valueMs });
    }
    return;
  }
  if (prefix === "theme") {
    const state = host.getState();
    const preset = THEME_PRESETS.find((candidate) => candidate.label === value);
    const activeSpace = findSpace(state, state.activeSpaceId);
    if (preset !== undefined && activeSpace !== undefined) {
      host.runAction({ type: "setSpaceTheme", spaceId: activeSpace.id, theme: applyPreset(activeSpace.theme, preset) });
    }
  }
}
