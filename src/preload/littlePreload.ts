/**
 * WHY this file exists:
 *   The bar at the top of a Little Window is our own sandboxed page. This is its only bridge to the app:
 *   window.littleApi, to show the page's address and to move the page into a Space.
 *
 * Data source:
 *   Electron's contextBridge and ipcRenderer.
 *
 * Data flow:
 *   littleWindow.ts → "little:info" → onInfo listener → little.ts shows the address
 *   little.ts → window.littleApi.moveToSpace() → "little:move-to-space" → littleWindow.ts
 */
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { LITTLE_CHANNELS } from "../main/littleWindow";

/** Same names as LITTLE_CHANNELS in littleWindow.ts: preloads cannot import our files, so the type check guards them. */
const CHANNELS: typeof LITTLE_CHANNELS = {
  info: "little:info",
  navigate: "little:navigate",
  moveToSpace: "little:move-to-space",
  copyLink: "little:copy-link",
  goBack: "little:go-back",
};

/** What the bar learns about its page. */
interface LittlePageInfo {
  url: string;
  title: string;
  canGoBack: boolean;
}

contextBridge.exposeInMainWorld("littleApi", {
  onInfo: (listener: (info: LittlePageInfo) => void) => {
    ipcRenderer.on(CHANNELS.info, (_event: IpcRendererEvent, info: LittlePageInfo) => listener(info));
  },
  navigate: (typedText: string) => ipcRenderer.invoke(CHANNELS.navigate, typedText),
  moveToSpace: () => ipcRenderer.invoke(CHANNELS.moveToSpace),
  copyLink: () => ipcRenderer.invoke(CHANNELS.copyLink),
  goBack: () => ipcRenderer.invoke(CHANNELS.goBack),
});
