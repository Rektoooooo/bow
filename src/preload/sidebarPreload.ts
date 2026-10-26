/**
 * WHY this file exists:
 *   The sidebar page runs with Electron's security sandbox on, so it cannot reach Node or Electron.
 *   This preload script is the one safe bridge: it exposes exactly the BrowserApi functions, nothing more.
 *
 * Data source:
 *   Electron's contextBridge and ipcRenderer.
 *
 * Data flow:
 *   sidebar.ts calls window.browserApi.selectTab(id) → ipcRenderer.invoke("tabs:select", id) → ipc.ts
 *   main.ts sends "browser:state-changed" → onStateChanged listener → sidebar.ts redraws
 */
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { IPC_CHANNELS } from "../shared/ipcChannels";
import type { BrowserApi, BrowserState } from "../shared/types";

/**
 * Sandboxed preload scripts may load only Electron's own modules, not our files, so the channel
 * names are repeated here. "typeof IPC_CHANNELS" makes the build fail if any name differs from
 * shared/ipcChannels.ts, so the list there stays the single source of truth.
 */
const CHANNELS: typeof IPC_CHANNELS = {
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
};

/**
 * Builds the BrowserApi object. Each function forwards its arguments to one IPC channel.
 */
function createBrowserApi(): BrowserApi {
  return {
    getState: () => ipcRenderer.invoke(CHANNELS.getState),
    onStateChanged: (listener) => {
      ipcRenderer.on(CHANNELS.stateChanged, (_event: IpcRendererEvent, state: BrowserState) => {
        listener(state);
      });
    },
    openTab: (typedText) => ipcRenderer.invoke(CHANNELS.openTab, typedText),
    selectTab: (tabId) => ipcRenderer.invoke(CHANNELS.selectTab, tabId),
    closeTab: (tabId) => ipcRenderer.invoke(CHANNELS.closeTab, tabId),
    pinTab: (tabId) => ipcRenderer.invoke(CHANNELS.pinTab, tabId),
    unpinTab: (tabId) => ipcRenderer.invoke(CHANNELS.unpinTab, tabId),
    clearTodayTabs: () => ipcRenderer.invoke(CHANNELS.clearTodayTabs),
    switchSpace: (spaceId) => ipcRenderer.invoke(CHANNELS.switchSpace, spaceId),
    restoreArchivedTab: (tabId) => ipcRenderer.invoke(CHANNELS.restoreArchivedTab, tabId),
    setArchiveAfter: (archiveAfterMs) => ipcRenderer.invoke(CHANNELS.setArchiveAfter, archiveAfterMs),
  };
}

/**
 * Publishes the API on the page as window.browserApi.
 */
function exposeBrowserApi(): void {
  contextBridge.exposeInMainWorld("browserApi", createBrowserApi());
}

exposeBrowserApi();
