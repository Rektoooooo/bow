/**
 * WHY this file exists:
 *   Arc's Command Bar also runs browser actions ("New Space", "Toggle Sidebar", "Copy URL", …): its main menu
 *   doubles as the action list. This file is our action list: titles and search words for ranking, and what each
 *   one does when chosen. Some entries are made per Space, per archive setting and per theme.
 *
 * Data source:
 *   The menu commands (appMenu.ts), the state (Spaces, current theme, command chains), ARCHIVE_THRESHOLD_OPTIONS and
 *   THEME_PRESETS.
 *
 * Data flow:
 *   overlayController.ts query → list() → commandBar.ts ranks them → user picks one → run(actionId)
 *   "Run <chain>" → runChain() → each step: run(actionId) or open the page, COMMAND_CHAIN_STEP_DELAY_MS apart
 */
import type { BrowserAction } from "../shared/actions";
import { ARCHIVE_THRESHOLD_OPTIONS, COMMAND_CHAIN_STEP_DELAY_MS } from "../shared/settings";
import type { BrowserState, CommandChainStep } from "../shared/types";
import { isChainableActionId, toChainActionId } from "./commandChains";
import type { AppMenuCommands } from "./appMenu";
import type { CommandBarAction } from "./commandBar";
import { applyPreset, THEME_PRESETS } from "./themePresets";
import { findSpace } from "./tree";
import { describeSpaceIconAsText } from "../shared/spaceIcons";

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
    { entry: { id: "new-note", title: "New Note", keywords: ["note", "write", "text"] }, run: () => commands.newNote() },
    { entry: { id: "new-easel", title: "New Easel", keywords: ["easel", "board", "canvas", "draw"] }, run: () => commands.newEasel() },
    { entry: { id: "translate-page", title: "Translate Page (Google Translate)", keywords: ["translate", "language"] }, run: () => host.runAction({ type: "translatePage" }) },
    { entry: { id: "edit-theme", title: "Edit Theme", keywords: ["space color", "gradient", "appearance"] }, run: () => host.runAction({ type: "openThemeEditor", spaceId: host.getState().activeSpaceId }) },
    { entry: { id: "toggle-sidebar", title: "Toggle Sidebar", keywords: ["hide sidebar", "show sidebar"] }, run: () => commands.toggleSidebar() },
    { entry: { id: "toggle-full-urls", title: "Toggle Full URLs", keywords: ["show full url", "full address", "hide full url"] }, run: () => commands.toggleFullUrls() },
    { entry: { id: "copy-url", title: "Copy URL", keywords: ["copy link", "copy address"] }, run: () => commands.copySelectedUrl("plain") },
    { entry: { id: "copy-markdown", title: "Copy URL as Markdown", keywords: ["markdown link"] }, run: () => commands.copySelectedUrl("markdown") },
    { entry: { id: "toggle-pin", title: "Pin / Unpin Tab", keywords: ["pin tab", "unpin tab"] }, run: () => commands.togglePinSelected() },
    { entry: { id: "close-tab", title: "Close Tab", keywords: ["archive tab"] }, run: () => commands.closeSelectedTab() },
    { entry: { id: "clear-today", title: "Clear Today Tabs", keywords: ["archive today", "clean up"] }, run: () => commands.clearTodayTabs() },
    { entry: { id: "close-duplicates", title: "Close Duplicate Tabs", keywords: ["duplicates", "same page twice", "clean up"] }, run: () => commands.closeDuplicateTabs() },
    { entry: { id: "reopen", title: "Reopen Closed Tab", keywords: ["restore tab", "undo close"] }, run: () => commands.reopenClosedTab() },
    { entry: { id: "duplicate", title: "Duplicate Tab", keywords: ["copy tab"] }, run: () => commands.duplicateSelected() },
    { entry: { id: "split", title: "Add Split View", keywords: ["split screen", "side by side"] }, run: () => commands.addSplitPane() },
    { entry: { id: "library", title: "Open Library", keywords: ["archive", "archived tabs"] }, run: () => commands.openLibrary() },
    { entry: { id: "save-page", title: "Save Page As…", keywords: ["download page", "html"] }, run: () => commands.savePageAs() },
    { entry: { id: "export-pdf", title: "Export as PDF…", keywords: ["pdf", "print"] }, run: () => commands.exportPdf() },
    { entry: { id: "search-tabs", title: "Search Tabs", keywords: ["find tab", "all tabs", "tab list"] }, run: () => commands.openCommandBar("tabs") },
    { entry: { id: "settings", title: "Settings", keywords: ["preferences", "options"] }, run: () => commands.openSettings() },
    { entry: { id: "shortcuts", title: "Keyboard Shortcuts", keywords: ["keys", "hotkeys", "help"] }, run: () => commands.openShortcutSheet() },
    { entry: { id: "task-manager", title: "Task Manager", keywords: ["memory", "cpu", "activity", "slow"] }, run: () => commands.openTaskManager() },
    { entry: { id: "sleep-other-tabs", title: "Sleep Other Tabs", keywords: ["free memory", "discard tabs", "unload"] }, run: () => commands.sleepOtherTabs() },
    { entry: { id: "find", title: "Find in Page", keywords: ["search page"] }, run: () => commands.openFind() },
    { entry: { id: "edit-boost", title: "Edit Boost for This Site", keywords: ["boost", "custom css", "style"] }, run: () => host.runAction({ type: "openBoostEditor" }) },
    { entry: { id: "zap", title: "Zap Elements", keywords: ["boost", "hide element", "remove element"] }, run: () => commands.zapElements() },
    { entry: { id: "devtools", title: "Developer Tools", keywords: ["inspect", "console"] }, run: () => commands.toggleDevTools() },
    { entry: { id: "zoom-in", title: "Zoom In", keywords: ["bigger"] }, run: () => commands.zoom("in") },
    { entry: { id: "zoom-out", title: "Zoom Out", keywords: ["smaller"] }, run: () => commands.zoom("out") },
    { entry: { id: "zoom-reset", title: "Actual Size", keywords: ["reset zoom"] }, run: () => commands.zoom("reset") },
    { entry: { id: "next-space", title: "Next Space", keywords: ["switch space"] }, run: () => commands.switchSpaceByOffset(1) },
    { entry: { id: "previous-space", title: "Previous Space", keywords: ["switch space"] }, run: () => commands.switchSpaceByOffset(-1) },
    { entry: { id: "new-window", title: "New Window", keywords: ["window", "another window"] }, run: () => commands.openNewWindow() },
    { entry: { id: "little-window", title: "New Little Window", keywords: ["little arc", "small window"] }, run: () => commands.openLittleWindow() },
    { entry: { id: "private-window", title: "New Private Window", keywords: ["incognito", "private browsing"] }, run: () => commands.openPrivateWindow() },
    { entry: { id: "import-arc", title: "Import from Arc", keywords: ["arc", "migrate"] }, run: () => commands.importFromArc() },
    { entry: { id: "export-backup", title: "Export Bow Backup", keywords: ["backup", "export", "save setup"] }, run: () => commands.exportBackup() },
    { entry: { id: "restore-backup", title: "Restore from Backup", keywords: ["backup", "restore", "import backup"] }, run: () => commands.restoreBackup() },
    { entry: { id: "default-browser", title: "Set as Default Browser", keywords: ["default browser", "open links"] }, run: () => commands.setAsDefaultBrowser() },
    { entry: { id: "check-updates", title: "Check for Updates", keywords: ["update", "new version", "upgrade"] }, run: () => commands.checkForUpdates() },
  ];
}

/** The Command Bar entry that appears once a new version has downloaded. */
export const RESTART_TO_UPDATE_ID = "restart-to-update";

/**
 * Builds the registry. list() is rebuilt on each query, so per-Space and per-theme entries are always current.
 */
export function createCommandActionRegistry(host: CommandActionHost): CommandActionRegistry {
  const fixedActions = buildFixedActions(host);

  const list = (): CommandBarAction[] => {
    const state = host.getState();
    const entries = fixedActions.map((action) => action.entry);
    for (const space of state.spaces) {
      entries.push({ id: `space:${space.id}`, title: `Switch to ${describeSpaceIconAsText(space.icon)} ${space.name}`, keywords: ["space", space.name] });
    }
    for (const option of ARCHIVE_THRESHOLD_OPTIONS) {
      entries.push({ id: `archive-after:${String(option.valueMs)}`, title: `Archive Tabs After ${option.label}`, keywords: ["auto archive", "archive setting"] });
    }
    for (const preset of THEME_PRESETS) {
      entries.push({ id: `theme:${preset.label}`, title: `Theme: ${preset.label}`, keywords: ["color", "space theme"] });
    }
    for (const template of state.spaceTemplates ?? []) {
      entries.push({ id: `template:${template.id}`, title: `New Space from Template: ${template.name}`, keywords: ["template", "new space", template.name] });
    }
    for (const chain of state.commandChains ?? []) {
      entries.push({ id: toChainActionId(chain.id), title: `Run ${chain.name}`, keywords: ["chain", chain.name] });
    }
    const readyVersion = host.commands.readyUpdateVersion();
    if (readyVersion !== null) {
      entries.push({ id: RESTART_TO_UPDATE_ID, title: `Restart to Update to Bow ${readyVersion}`, keywords: ["update", "relaunch", "new version"] });
    }
    return entries;
  };

  const run = (actionId: string): void => {
    const fixedAction = fixedActions.find((action) => action.entry.id === actionId);
    if (fixedAction !== undefined) {
      fixedAction.run();
      return;
    }
    if (actionId === RESTART_TO_UPDATE_ID) {
      host.commands.restartToUpdate();
      return;
    }
    if (!isChainableActionId(actionId)) {
      const chainId = actionId.slice(toChainActionId("").length);
      runChain(host, chainId, run).catch((error) => console.error("Running a command chain failed:", error));
      return;
    }
    runGeneratedAction(host, actionId);
  };

  return { list: list, run: run };
}

/** Chains running now: starting one again before it finished does nothing. */
const runningChainIds = new Set<string>();

/**
 * Waits between two steps of a chain.
 */
function waitForNextStep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, COMMAND_CHAIN_STEP_DELAY_MS));
}

/**
 * One step: a page opens in a new tab (as if typed in the Command Bar); an action runs, unless it is a chain.
 */
function runChainStep(host: CommandActionHost, step: CommandChainStep, run: (actionId: string) => void): void {
  if (step.kind === "open") {
    host.runAction({ type: "openTab", typedText: step.url });
    return;
  }
  if (isChainableActionId(step.actionId)) {
    run(step.actionId);
  }
}

/**
 * Runs a chain's steps in order, a short pause apart. A step whose action is gone (a deleted Space) does nothing.
 */
async function runChain(host: CommandActionHost, chainId: string, run: (actionId: string) => void): Promise<void> {
  const chain = (host.getState().commandChains ?? []).find((candidate) => candidate.id === chainId);
  if (chain === undefined || runningChainIds.has(chainId)) {
    return;
  }
  runningChainIds.add(chainId);
  try {
    for (const step of chain.steps) {
      runChainStep(host, step, run);
      await waitForNextStep();
    }
  } finally {
    runningChainIds.delete(chainId);
  }
}

/**
 * Runs an entry made from data: "space:<id>", "template:<id>", "archive-after:<ms|null>" or "theme:<label>".
 */
function runGeneratedAction(host: CommandActionHost, actionId: string): void {
  const separatorIndex = actionId.indexOf(":");
  const prefix = actionId.slice(0, separatorIndex);
  const value = actionId.slice(separatorIndex + 1);

  if (prefix === "space") {
    host.runAction({ type: "switchSpace", spaceId: value });
    return;
  }
  if (prefix === "template") {
    host.runAction({ type: "createSpaceFromTemplate", templateId: value });
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
