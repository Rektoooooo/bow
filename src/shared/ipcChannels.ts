/**
 * WHY this file exists:
 *   The sidebar page and the main process talk over named message channels.
 *   Keeping every name in one list stops a typo on one side from silently breaking a button.
 *
 * Data source:
 *   None. Constant names only.
 *
 * Data flow:
 *   sidebarPreload.ts sends on a channel → ipc.ts listens on the same channel
 */

/** "as const" makes each value a fixed string type, so TypeScript catches a misspelled channel. */
export const IPC_CHANNELS = {
  getState: "browser:get-state",
  stateChanged: "browser:state-changed",
  openTab: "tabs:open",
  selectTab: "tabs:select",
  closeTab: "tabs:close",
  pinTab: "tabs:pin",
  unpinTab: "tabs:unpin",
  clearTodayTabs: "tabs:clear-today",
  switchSpace: "spaces:switch",
  restoreArchivedTab: "archive:restore",
  setArchiveAfter: "settings:set-archive-after",
} as const;
