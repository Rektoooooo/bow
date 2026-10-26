/**
 * WHY this file exists:
 *   The sidebar page runs with Electron's security sandbox on, so it cannot reach Node or Electron.
 *   This preload script is the one safe bridge: it exposes exactly the BrowserApi functions, nothing more.
 *
 * Data source:
 *   Electron's contextBridge and ipcRenderer.
 *
 * Data flow:
 *   sidebar.ts calls window.browserApi.dispatch({ type: "selectTab", tabId }) → ipcRenderer.invoke("browser:dispatch") → ipc.ts
 *   main.ts sends "browser:state-changed" → onStateChanged listener → sidebar.ts redraws
 */
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { SidebarCommand } from "../shared/actions";
import type { IPC_CHANNELS } from "../shared/ipcChannels";
import type { BrowserApi, BrowserState, RuntimeState } from "../shared/types";

/**
 * Sandboxed preload scripts may load only Electron's own modules, not our files, so the channel
 * names are repeated here. "typeof IPC_CHANNELS" makes the build fail if any name differs from
 * shared/ipcChannels.ts, so the list there stays the single source of truth.
 */
const CHANNELS: typeof IPC_CHANNELS = {
  getState: "browser:get-state",
  getRuntimeState: "browser:get-runtime-state",
  stateChanged: "browser:state-changed",
  runtimeChanged: "browser:runtime-changed",
  dispatch: "browser:dispatch",
  sidebarCommand: "browser:sidebar-command",
  getSymbols: "browser:get-symbols",
  readNote: "browser:read-note",
  saveNote: "browser:save-note",
  readEasel: "browser:read-easel",
  saveEasel: "browser:save-easel",
  listCaptures: "browser:list-captures",
  readCapture: "browser:read-capture",
};

/**
 * Builds the BrowserApi object. Each function forwards to one IPC channel.
 */
function createBrowserApi(): BrowserApi {
  return {
    getState: () => ipcRenderer.invoke(CHANNELS.getState),
    getSymbols: () => ipcRenderer.invoke(CHANNELS.getSymbols),
    getRuntimeState: () => ipcRenderer.invoke(CHANNELS.getRuntimeState),
    onStateChanged: (listener) => {
      ipcRenderer.on(CHANNELS.stateChanged, (_event: IpcRendererEvent, state: BrowserState) => {
        listener(state);
      });
    },
    onRuntimeChanged: (listener) => {
      ipcRenderer.on(CHANNELS.runtimeChanged, (_event: IpcRendererEvent, runtimeState: RuntimeState) => {
        listener(runtimeState);
      });
    },
    dispatch: (action) => ipcRenderer.invoke(CHANNELS.dispatch, action),
    onSidebarCommand: (listener) => {
      ipcRenderer.on(CHANNELS.sidebarCommand, (_event: IpcRendererEvent, command: SidebarCommand) => {
        listener(command);
      });
    },
    readNote: (noteId) => ipcRenderer.invoke(CHANNELS.readNote, noteId),
    saveNote: (noteId, html, title) => ipcRenderer.invoke(CHANNELS.saveNote, noteId, html, title),
    readEasel: (easelId) => ipcRenderer.invoke(CHANNELS.readEasel, easelId),
    saveEasel: (easelId, json) => ipcRenderer.invoke(CHANNELS.saveEasel, easelId, json),
    listCaptures: () => ipcRenderer.invoke(CHANNELS.listCaptures),
    readCapture: (captureId) => ipcRenderer.invoke(CHANNELS.readCapture, captureId),
  };
}

/**
 * Publishes the API on the page as window.browserApi.
 */
function exposeBrowserApi(): void {
  contextBridge.exposeInMainWorld("browserApi", createBrowserApi());
}

exposeBrowserApi();
