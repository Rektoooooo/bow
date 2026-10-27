/**
 * WHY this file exists:
 *   The controls on top of the picture-in-picture video are our own sandboxed page. This is its only bridge to the
 *   app: window.pipApi, to hear what the video does and to press the buttons.
 *
 * Data source:
 *   Electron's contextBridge and ipcRenderer.
 *
 * Data flow:
 *   pictureInPicture.ts → "pip:status" / "pip:hover" → listeners → pip.ts draws the controls
 *   pip.ts → window.pipApi.command() / seek() → "pip:command" / "pip:seek" → pictureInPicture.ts
 */
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { IPC_CHANNELS } from "../shared/ipcChannels";
import type { PIP_CHANNELS, PictureInPictureStatus } from "../shared/pictureInPicture";

/** Same names as PIP_CHANNELS: preloads cannot import our files, so the type check guards them. */
const CHANNELS: typeof PIP_CHANNELS = {
  status: "pip:status",
  hover: "pip:hover",
  command: "pip:command",
  seek: "pip:seek",
};

const SYMBOLS_CHANNEL: (typeof IPC_CHANNELS)["getSymbols"] = "browser:get-symbols";

contextBridge.exposeInMainWorld("pipApi", {
  onStatus: (listener: (status: PictureInPictureStatus) => void) => {
    ipcRenderer.on(CHANNELS.status, (_event: IpcRendererEvent, status: PictureInPictureStatus) => listener(status));
  },
  onHover: (listener: (isHovered: boolean) => void) => {
    ipcRenderer.on(CHANNELS.hover, (_event: IpcRendererEvent, isHovered: boolean) => listener(isHovered));
  },
  command: (command: string) => ipcRenderer.invoke(CHANNELS.command, command),
  seek: (fraction: number) => ipcRenderer.invoke(CHANNELS.seek, fraction),
  getSymbols: () => ipcRenderer.invoke(SYMBOLS_CHANNEL),
});
