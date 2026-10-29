/**
 * WHY this file exists:
 *   The onboarding's window (main/onboardingWindow.ts) is sandboxed like every page of ours. This is its only bridge:
 *   window.onboardingApi for its own messages, and window.browserApi.dispatch so its buttons run the same actions as
 *   the sidebar (a theme, a switch).
 *
 * Data source:
 *   Electron's contextBridge and ipcRenderer.
 *
 * Data flow:
 *   onboarding.ts → window.onboardingApi.getData() → "onboarding:get-data" → onboardingWindow.ts
 *   onboardingWindow.ts → "onboarding:data" → onData listener → onboarding.ts updates in place
 *   onboarding.ts → readSource / bringOver → onboardingWindow.ts (the import is read, then brought over)
 */
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { BrowserAction } from "../shared/actions";
import type { IPC_CHANNELS } from "../shared/ipcChannels";
import type { ONBOARDING_CHANNELS, OnboardingApi, WelcomeData } from "../shared/onboarding";

/**
 * Sandboxed preload scripts may load only Electron's own modules, so the channel names are repeated here, typed
 * against the shared lists so the build fails if they drift apart.
 */
const CHANNELS: typeof ONBOARDING_CHANNELS = {
  getData: "onboarding:get-data",
  data: "onboarding:data",
  close: "onboarding:close",
  readSource: "onboarding:read-source",
  bringOver: "onboarding:bring-over",
  openFullDiskAccess: "onboarding:open-full-disk-access",
};

const DISPATCH_CHANNEL: (typeof IPC_CHANNELS)["dispatch"] = "browser:dispatch";
const SYMBOLS_CHANNEL: (typeof IPC_CHANNELS)["getSymbols"] = "browser:get-symbols";

/**
 * Builds the onboarding's API. Each function forwards to one IPC channel.
 */
function createOnboardingApi(): OnboardingApi {
  return {
    getData: () => ipcRenderer.invoke(CHANNELS.getData),
    onData: (listener) => {
      ipcRenderer.on(CHANNELS.data, (_event: IpcRendererEvent, data: WelcomeData) => listener(data));
    },
    close: () => ipcRenderer.invoke(CHANNELS.close),
    getSymbols: () => ipcRenderer.invoke(SYMBOLS_CHANNEL),
    readSource: (sourceId) => ipcRenderer.invoke(CHANNELS.readSource, sourceId),
    bringOver: (sourceId, parts) => ipcRenderer.invoke(CHANNELS.bringOver, sourceId, parts),
    openFullDiskAccess: () => ipcRenderer.invoke(CHANNELS.openFullDiskAccess),
  };
}

contextBridge.exposeInMainWorld("onboardingApi", createOnboardingApi());
contextBridge.exposeInMainWorld("browserApi", {
  dispatch: (action: BrowserAction) => ipcRenderer.invoke(DISPATCH_CHANNEL, action),
});
