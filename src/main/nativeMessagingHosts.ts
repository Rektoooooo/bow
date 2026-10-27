/**
 * WHY this file exists:
 *   Password managers (Apple Passwords, 1Password, Bitwarden) and a few other apps talk to their browser extension
 *   through a "native messaging host": a small program the app registers with a JSON manifest in each browser's
 *   NativeMessagingHosts folder. The extension library reads Chrome's folders and ours; an app installed only for
 *   Arc, Brave, Edge, Vivaldi or Chromium would be missed. So at startup every manifest found in those browsers'
 *   folders is linked into ours (a symbolic link, so an update or removal by the app shows through). Links whose
 *   manifest is gone are cleared. Real files in our folder are never touched.
 *
 * Data source:
 *   The NativeMessagingHosts folders of the other Chromium browsers on this Mac (read only).
 *
 * Data flow:
 *   startup (main.ts) → linkNativeMessagingHosts(other browsers' folders, <userData>/NativeMessagingHosts)
 *   → electron-chrome-extensions finds the host when an extension calls chrome.runtime.connectNative
 */
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Where the other Chromium browsers keep their host manifests on macOS, under the home folder. Chrome's own folders
 * are not here: the extension library reads them itself.
 */
const OTHER_BROWSER_HOST_FOLDERS = [
  "Library/Application Support/Arc/User Data/NativeMessagingHosts",
  "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
  "Library/Application Support/Microsoft Edge/NativeMessagingHosts",
  "Library/Application Support/Vivaldi/NativeMessagingHosts",
  "Library/Application Support/Chromium/NativeMessagingHosts",
];

/** A host manifest's file name: the host's name (letters, digits, dots, underscores) and ".json", as Chrome requires. */
const MANIFEST_NAME_PATTERN = /^[A-Za-z0-9._]+\.json$/;

/** What a run did, for the log. */
export interface HostLinkReport {
  linked: string[];
  cleared: string[];
}

/**
 * The other browsers' host folders for a home folder.
 */
export function listOtherBrowserHostFolders(homeFolder: string): string[] {
  return OTHER_BROWSER_HOST_FOLDERS.map((relativeFolder) => path.join(homeFolder, relativeFolder));
}

/**
 * The manifest file names in a folder (none when it does not exist).
 */
function readManifestNames(folder: string): string[] {
  try {
    return fs.readdirSync(folder).filter((name) => MANIFEST_NAME_PATTERN.test(name));
  } catch {
    return [];
  }
}

/**
 * Removes our links whose manifest is gone (the app was uninstalled).
 */
function clearBrokenLinks(ourFolder: string): string[] {
  const cleared: string[] = [];
  for (const name of readManifestNames(ourFolder)) {
    const entryPath = path.join(ourFolder, name);
    const isLink = fs.lstatSync(entryPath).isSymbolicLink();
    if (isLink && !fs.existsSync(entryPath)) {
      fs.unlinkSync(entryPath);
      cleared.push(name);
    }
  }
  return cleared;
}

/**
 * Links every host manifest of the given folders into ours, unless ours already has one of that name (ours, or one
 * linked from an earlier folder, wins). Returns what it linked and cleared.
 */
export function linkNativeMessagingHosts(sourceFolders: string[], ourFolder: string): HostLinkReport {
  fs.mkdirSync(ourFolder, { recursive: true });
  const cleared = clearBrokenLinks(ourFolder);
  const linked: string[] = [];
  const presentNames = new Set(readManifestNames(ourFolder));
  for (const sourceFolder of sourceFolders) {
    for (const name of readManifestNames(sourceFolder)) {
      if (presentNames.has(name)) {
        continue;
      }
      fs.symlinkSync(path.join(sourceFolder, name), path.join(ourFolder, name));
      presentNames.add(name);
      linked.push(name);
    }
  }
  return { linked: linked, cleared: cleared };
}
