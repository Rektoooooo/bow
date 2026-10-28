/**
 * WHY this file exists:
 *   "Set as Default Browser…" (app menu and Command Bar). Once we are the default, links clicked in other apps reach
 *   us through the "open-url" event and open in a Little Window, or in the Space an Air Traffic Control rule names.
 *
 * Data source:
 *   macOS Launch Services, through Electron's app.isDefaultProtocolClient / app.setAsDefaultProtocolClient. The
 *   packaged app declares http, https and HTML files in its Info.plist (build/extend-info.plist); that is what makes
 *   macOS list it as a web browser at all (also in System Settings › Desktop & Dock).
 *
 * Data flow:
 *   menu → setAsDefaultBrowser() → macOS asks the user to confirm → links arrive as "open-url" (main.ts)
 */
import { app, dialog } from "electron";
import { getWindow } from "./browserCore";

/** The address schemes a web browser handles. */
const WEB_SCHEMES = ["http", "https"];

/**
 * True when macOS sends web links to this app.
 */
export function isDefaultBrowser(): boolean {
  return WEB_SCHEMES.every((scheme) => app.isDefaultProtocolClient(scheme));
}

/**
 * Shows a short message on top of the main window.
 */
async function showMessage(message: string, detail: string): Promise<void> {
  const window = getWindow();
  const options = { type: "info" as const, message: message, detail: detail };
  if (window === null) {
    await dialog.showMessageBox(options);
    return;
  }
  await dialog.showMessageBox(window, options);
}

/**
 * Asks macOS to make this app the default browser. macOS shows its own confirmation ("keep using …?").
 * A development run (`npm start`) is the generic Electron app, so it refuses instead of registering that.
 */
export async function setAsDefaultBrowser(): Promise<void> {
  if (!app.isPackaged) {
    await showMessage(
      "Only the packaged app can be the default browser",
      "Build it with `npm run package`, move release/Bow-darwin-arm64/Bow.app to Applications, open it from there and choose this again.",
    );
    return;
  }
  if (isDefaultBrowser()) {
    await showMessage("Bow is already your default browser", "Links from other apps open here.");
    return;
  }
  for (const scheme of WEB_SCHEMES) {
    app.setAsDefaultProtocolClient(scheme);
  }
}
