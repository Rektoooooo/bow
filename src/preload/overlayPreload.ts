/**
 * WHY this file exists:
 *   The overlay page (Command Bar, Library, site controls, Find) is sandboxed like the sidebar. This is its only
 *   bridge: window.overlayApi for the overlay's own messages, and window.browserApi.dispatch so it can run the same
 *   actions as the sidebar (restore a tab, change a setting).
 *
 * Data source:
 *   Electron's contextBridge and ipcRenderer.
 *
 * Data flow:
 *   overlay.ts → window.overlayApi.query(text) → "overlay:query" → overlayController.ts
 *   overlayController.ts → "overlay:show" → onShow listener → overlay.ts draws the panel
 */
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { BrowserAction } from "../shared/actions";
import type { IPC_CHANNELS } from "../shared/ipcChannels";
import type { CommandBarLine, FindProgress, LibraryData, OVERLAY_CHANNELS, OverlayApi, OverlayShowMessage } from "../shared/overlay";

/**
 * Sandboxed preload scripts may load only Electron's own modules, so the channel names are repeated here, typed
 * against the shared lists so the build fails if they drift apart.
 */
const CHANNELS: typeof OVERLAY_CHANNELS = {
  show: "overlay:show",
  results: "overlay:results",
  libraryUpdate: "overlay:library-update",
  findProgress: "overlay:find-progress",
  query: "overlay:query",
  choose: "overlay:choose",
  close: "overlay:close",
  siteCommand: "overlay:site-command",
  find: "overlay:find",
  searchHistory: "overlay:search-history",
  clearHistory: "overlay:clear-history",
  showDownload: "overlay:show-download",
  openUrl: "overlay:open-url",
};

const DISPATCH_CHANNEL: (typeof IPC_CHANNELS)["dispatch"] = "browser:dispatch";

/**
 * Builds the overlay API. Each function forwards to one IPC channel.
 */
function createOverlayApi(): OverlayApi {
  return {
    onShow: (listener) => {
      ipcRenderer.on(CHANNELS.show, (_event: IpcRendererEvent, message: OverlayShowMessage) => listener(message));
    },
    onResults: (listener) => {
      ipcRenderer.on(CHANNELS.results, (_event: IpcRendererEvent, query: string, lines: CommandBarLine[]) => listener(query, lines));
    },
    onLibraryUpdate: (listener) => {
      ipcRenderer.on(CHANNELS.libraryUpdate, (_event: IpcRendererEvent, library: LibraryData) => listener(library));
    },
    onFindProgress: (listener) => {
      ipcRenderer.on(CHANNELS.findProgress, (_event: IpcRendererEvent, progress: FindProgress) => listener(progress));
    },
    query: (text, mode) => ipcRenderer.invoke(CHANNELS.query, text, mode),
    choose: (resultId, typedText, mode) => ipcRenderer.invoke(CHANNELS.choose, resultId, typedText, mode),
    close: () => ipcRenderer.invoke(CHANNELS.close),
    siteCommand: (command) => ipcRenderer.invoke(CHANNELS.siteCommand, command),
    find: (text, forward, isNewSearch) => ipcRenderer.invoke(CHANNELS.find, text, forward, isNewSearch),
    searchHistory: (query) => ipcRenderer.invoke(CHANNELS.searchHistory, query),
    clearHistory: () => ipcRenderer.invoke(CHANNELS.clearHistory),
    showDownload: (downloadId) => ipcRenderer.invoke(CHANNELS.showDownload, downloadId),
    openUrl: (url) => ipcRenderer.invoke(CHANNELS.openUrl, url),
  };
}

contextBridge.exposeInMainWorld("overlayApi", createOverlayApi());
contextBridge.exposeInMainWorld("browserApi", {
  dispatch: (action: BrowserAction) => ipcRenderer.invoke(DISPATCH_CHANNEL, action),
});
