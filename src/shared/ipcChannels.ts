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
 *   main.ts pushes on stateChanged / runtimeChanged → sidebarPreload.ts listeners → sidebar.ts redraws
 */

/** "as const" makes each value a fixed string type, so TypeScript catches a misspelled channel. */
export const IPC_CHANNELS = {
  getState: "browser:get-state",
  getRuntimeState: "browser:get-runtime-state",
  stateChanged: "browser:state-changed",
  runtimeChanged: "browser:runtime-changed",
  dispatch: "browser:dispatch",
  sidebarCommand: "browser:sidebar-command",
  getSymbols: "browser:get-symbols",
} as const;
