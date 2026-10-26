/**
 * WHY this file exists:
 *   The sidebar page cannot touch Electron directly (that would be a security hole).
 *   It sends named messages; this file listens for each one and calls the matching action in main.ts.
 *
 * Data source:
 *   Messages from sidebarPreload.ts on the channels in shared/ipcChannels.ts.
 *   Web pages in tabs have no preload script, so they cannot send these messages at all.
 *
 * Data flow:
 *   click in sidebar → preload sends "tabs:select" → handler here → actions.selectTab(tabId)
 */
import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../shared/ipcChannels";
import { ARCHIVE_THRESHOLD_OPTIONS } from "../shared/settings";
import type { BrowserState, SpaceId, TabId } from "../shared/types";

/** What main.ts must provide so the handlers have something to call. One entry per sidebar action. */
export interface SidebarActions {
  getState(): BrowserState;
  openTab(typedText: string): void;
  selectTab(tabId: TabId): void;
  closeTab(tabId: TabId): void;
  pinTab(tabId: TabId): void;
  unpinTab(tabId: TabId): void;
  clearTodayTabs(): void;
  switchSpace(spaceId: SpaceId): void;
  restoreArchivedTab(tabId: TabId): void;
  setArchiveAfter(archiveAfterMs: number | null): void;
}

/**
 * True when the value is one of the "Archive tabs after" choices (a number of milliseconds, or null for never).
 * Anything else is refused, so a bad message cannot set a 0 ms threshold and archive everything.
 */
function isAllowedArchiveAfter(value: unknown): value is number | null {
  for (const option of ARCHIVE_THRESHOLD_OPTIONS) {
    if (option.valueMs === value) {
      return true;
    }
  }
  return false;
}

/**
 * Registers a channel whose only argument is an id string.
 * Six channels work this way, so the "is it a string?" check lives here once.
 */
function handleIdMessage(channel: string, action: (id: string) => void): void {
  ipcMain.handle(channel, (_event, id: unknown) => {
    if (typeof id !== "string") {
      return;
    }
    action(id);
  });
}

/**
 * Registers one ipcMain.handle listener per channel. Each listener checks its arguments
 * before calling the action, because anything arriving over IPC is untrusted input.
 */
export function registerIpcHandlers(actions: SidebarActions): void {
  ipcMain.handle(IPC_CHANNELS.getState, () => {
    return actions.getState();
  });

  ipcMain.handle(IPC_CHANNELS.openTab, (_event, typedText: unknown) => {
    if (typeof typedText !== "string") {
      return;
    }
    actions.openTab(typedText);
  });

  ipcMain.handle(IPC_CHANNELS.clearTodayTabs, () => {
    actions.clearTodayTabs();
  });

  ipcMain.handle(IPC_CHANNELS.setArchiveAfter, (_event, archiveAfterMs: unknown) => {
    if (!isAllowedArchiveAfter(archiveAfterMs)) {
      return;
    }
    actions.setArchiveAfter(archiveAfterMs);
  });

  handleIdMessage(IPC_CHANNELS.selectTab, actions.selectTab);
  handleIdMessage(IPC_CHANNELS.closeTab, actions.closeTab);
  handleIdMessage(IPC_CHANNELS.pinTab, actions.pinTab);
  handleIdMessage(IPC_CHANNELS.unpinTab, actions.unpinTab);
  handleIdMessage(IPC_CHANNELS.switchSpace, actions.switchSpace);
  handleIdMessage(IPC_CHANNELS.restoreArchivedTab, actions.restoreArchivedTab);
}
