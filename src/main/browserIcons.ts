/**
 * WHY this file exists:
 *   The onboarding's "Bring your things." lists every browser Bow imports from with its real icon. Bow ships no
 *   browser logos: the icon is the installed app's own, drawn by macOS when the onboarding opens, so it is exactly what
 *   the user sees in their Dock. A browser that is not installed gets no icon (the page draws a neutral mark).
 *
 * Data source:
 *   The apps in /Applications and ~/Applications, or wherever Spotlight finds them by bundle id; macOS's Quick Look
 *   thumbnail of the app (its icon), else the icon Finder shows for it.
 *
 * Data flow:
 *   onboardingWindow.ts openOnboarding() → loadBrowserIcons() → findAppPath() → drawAppIcon() → the cache
 *   → getBrowserIcon() in buildWelcomeData() → the onboarding's browser tiles
 */
import { app, nativeImage } from "electron";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { getImportHomeFolder } from "./importHome";

const execFileAsync = promisify(execFile);

/**
 * Each browser's app: its bundle's file name and its bundle id (from the apps' Info.plist; Chrome's, Arc's and
 * Safari's checked on this Mac on 2026-10-29, the others are the ids their makers publish).
 */
const BROWSER_APPS: Record<string, { appName: string; bundleId: string }> = {
  arc: { appName: "Arc.app", bundleId: "company.thebrowser.Browser" },
  chrome: { appName: "Google Chrome.app", bundleId: "com.google.Chrome" },
  safari: { appName: "Safari.app", bundleId: "com.apple.Safari" },
  firefox: { appName: "Firefox.app", bundleId: "org.mozilla.firefox" },
  brave: { appName: "Brave Browser.app", bundleId: "com.brave.Browser" },
  edge: { appName: "Microsoft Edge.app", bundleId: "com.microsoft.edgemac" },
  vivaldi: { appName: "Vivaldi.app", bundleId: "com.vivaldi.Vivaldi" },
  chromium: { appName: "Chromium.app", bundleId: "org.chromium.Chromium" },
};

/** The icon's size in pixels: the tiles show it at 44 points, so 88 pixels on a Retina screen; our choice. */
const ICON_SIZE_PX = 128;

/** Spotlight answers in milliseconds; a Mac with Spotlight turned off must not hold the icons up. Our choice. */
const SPOTLIGHT_TIMEOUT_MS = 2000;
const SPOTLIGHT_COMMAND = "/usr/bin/mdfind";

/** The icons drawn so far, by browser id (null: the app is not on this Mac, or macOS could not draw it). */
const iconCache = new Map<string, string | null>();

/**
 * Where a browser's app is: the usual Applications folders first, then Spotlight by bundle id (an app kept elsewhere).
 * Null when it is not on this Mac.
 */
async function findAppPath(browserId: string): Promise<string | null> {
  const known = BROWSER_APPS[browserId];
  if (known === undefined) {
    return null;
  }
  const folders = ["/Applications", path.join(getImportHomeFolder(), "Applications")];
  for (const folder of folders) {
    const candidate = path.join(folder, known.appName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  try {
    const query = `kMDItemCFBundleIdentifier == "${known.bundleId}"`;
    const result = await execFileAsync(SPOTLIGHT_COMMAND, [query], { timeout: SPOTLIGHT_TIMEOUT_MS });
    const lines = result.stdout.split("\n");
    const firstApp = lines.find((line) => line.endsWith(".app"));
    return firstApp ?? null;
  } catch {
    return null;
  }
}

/**
 * The app's icon as a data: URL, or null when macOS cannot draw it.
 */
async function drawAppIcon(appPath: string): Promise<string | null> {
  // Safari in /Applications is a link into a system volume, and the link's thumbnail is a generic app icon.
  let realPath = appPath;
  try {
    realPath = await fs.promises.realpath(appPath);
  } catch {
    return null;
  }
  try {
    const thumbnail = await nativeImage.createThumbnailFromPath(realPath, { width: ICON_SIZE_PX, height: ICON_SIZE_PX });
    if (!thumbnail.isEmpty()) {
      return thumbnail.toDataURL();
    }
  } catch (error) {
    console.warn(`No thumbnail for ${realPath}; trying its file icon:`, error);
  }
  try {
    const fileIcon = await app.getFileIcon(realPath, { size: "large" });
    return fileIcon.isEmpty() ? null : fileIcon.toDataURL();
  } catch {
    return null;
  }
}

/**
 * Draws the icons of these browsers that are not drawn yet (once per run: an app's icon rarely changes).
 */
export async function loadBrowserIcons(browserIds: string[]): Promise<void> {
  const missingIds = browserIds.filter((browserId) => !iconCache.has(browserId));
  const drawings = missingIds.map(async (browserId) => {
    const appPath = await findAppPath(browserId);
    const icon = appPath === null ? null : await drawAppIcon(appPath);
    iconCache.set(browserId, icon);
  });
  await Promise.all(drawings);
}

/**
 * A browser's icon as drawn by loadBrowserIcons(), or null (not drawn yet, not installed, or not drawable).
 */
export function getBrowserIcon(browserId: string): string | null {
  return iconCache.get(browserId) ?? null;
}
