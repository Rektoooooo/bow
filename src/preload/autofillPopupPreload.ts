/**
 * WHY this file exists:
 *   The list under a form field is our own sandboxed page. This is its only bridge to the app: window.autofillApi, to
 *   hear what rows to draw and to say which one the user picked.
 *
 * Data source:
 *   Electron's contextBridge and ipcRenderer.
 *
 * Data flow:
 *   autofillPopup.ts → "autofill:show" → listener → popup.ts draws the rows
 *   popup.ts → window.autofillApi.choose(index) → "autofill:choose" → autofillPopup.ts
 */
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { AUTOFILL_CHANNELS, AutofillShowMessage } from "../shared/autofill";
import type { IPC_CHANNELS } from "../shared/ipcChannels";

/** Same names as AUTOFILL_CHANNELS: preloads cannot import our files, so the type check guards them. */
const CHANNELS: typeof AUTOFILL_CHANNELS = {
  show: "autofill:show",
  choose: "autofill:choose",
};

const SYMBOLS_CHANNEL: (typeof IPC_CHANNELS)["getSymbols"] = "browser:get-symbols";

contextBridge.exposeInMainWorld("autofillApi", {
  onShow: (listener: (message: AutofillShowMessage) => void) => {
    ipcRenderer.on(CHANNELS.show, (_event: IpcRendererEvent, message: AutofillShowMessage) => listener(message));
  },
  choose: (index: number) => ipcRenderer.invoke(CHANNELS.choose, index),
  getSymbols: () => ipcRenderer.invoke(SYMBOLS_CHANNEL),
});
