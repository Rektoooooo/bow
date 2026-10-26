/**
 * WHY this file exists:
 *   The ways extensions arrive and stay current. Load Unpacked: a folder the user picks, loaded where it is (Chrome's
 *   developer mode). Import from Arc: Arc's Web Store extensions, copied into our data folder, because Arc's own
 *   folder goes away with Arc; each keeps the on/off it had in Arc. Add Extension on a Chrome Web Store page:
 *   downloaded, verified and unpacked like Chrome does (crx.ts, webStoreInstall.ts). Web Store extensions update
 *   from Google's update server a minute after startup and every 5 hours. Turning extensions on and off is plain
 *   state (extensionList.ts); extensionHost.ts then loads or unloads them. Open pages keep an updated extension's old
 *   content scripts until they reload, as in Chrome.
 *
 * Data source:
 *   A folder the user picks; Arc's profile folders (arcExtensionsImport.ts); Google's extension update server.
 *
 * Data flow:
 *   Library "Load Unpacked…" → loadUnpackedExtension() → loadExtensionNow() (learns the id) → addExtension
 *   Import from Arc → importArcExtensions() → copy each folder → addExtension → extensionHost.ts loads the enabled ones
 *   toolbar "Add Extension" → installFromWebStore(id) → download → unpackCrx() → addExtension
 *   timer / "Check for Updates" → updateExtensionsFromWebStore() → newer version? → unpackCrx() → updateExtensionFolder
 */
import { app, dialog, net } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { InstalledExtension } from "../shared/types";
import { findArcExtensions } from "./arcExtensionsImport";
import { applyChange, getState, getWindow } from "./browserCore";
import { loadExtensionNow } from "./extensionHost";
import { addExtension, findExtension, removeExtension, setExtensionEnabled, updateExtensionFolder } from "./extensionList";
import { readExtensionManifestInfo } from "./extensionManifest";
import { whenExtensionsSettled } from "./extensionHost";
import {
  buildDownloadUrl,
  buildUpdateCheckUrl,
  compareExtensionVersions,
  deleteExtensionCopyIfUnused,
  matchesSha256,
  MAX_CRX_BYTES,
  parseUpdateResponse,
  unpackCrx,
  WEB_STORE_UPDATE_URL,
} from "./webStoreInstall";
import { openLibrary } from "./overlayController";
import { getActiveSpace } from "./tree";

/** Our copies of imported extensions: <data folder>/Extensions/<extension id>/<version>/. */
const EXTENSIONS_FOLDER_NAME = "Extensions";

/** What an extension import did, for the import summary. */
export interface ArcExtensionsImportReport {
  imported: number;
  /** Of those, how many came in turned off (they were off in Arc). */
  importedTurnedOff: number;
  /** Already in that profile from an earlier import; left as they are. */
  alreadyAdded: number;
  /** Not from the Web Store, unreadable, or in an Arc profile that was not imported. */
  skipped: number;
}

/**
 * Asks for an unpacked extension folder and adds it to the active Space's profile.
 */
export async function loadUnpackedExtension(): Promise<void> {
  const window = getWindow();
  if (window === null) {
    return;
  }
  const choice = await dialog.showOpenDialog(window, {
    title: "Load Unpacked Extension",
    buttonLabel: "Load",
    properties: ["openDirectory"],
  });
  const folder = choice.filePaths[0];
  if (choice.canceled || folder === undefined) {
    return;
  }
  const info = readExtensionManifestInfo(folder);
  if (info === null) {
    dialog.showErrorBox("Load Unpacked Extension", "This folder has no readable manifest.json, so it is not an unpacked extension.");
    return;
  }
  const profileId = getActiveSpace(getState()).profileId;
  try {
    const loaded = await loadExtensionNow(profileId, folder);
    const extension: InstalledExtension = {
      id: loaded.id,
      profileId: profileId,
      name: info.name,
      version: info.version,
      path: folder,
      isEnabled: true,
      source: "unpacked",
    };
    applyChange((state) => addExtension(state, extension));
    openLibrary("extensions");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("Load Unpacked Extension", `The extension could not be loaded: ${message}`);
  }
}

/**
 * Copies Arc's Web Store extensions into our data folder and adds them to the matching profiles. Run after the
 * sidebar import, which creates those profiles. Safe to run twice: extensions already added are left alone.
 */
export function importArcExtensions(arcFolder: string): ArcExtensionsImportReport {
  const scan = findArcExtensions(arcFolder);
  const report: ArcExtensionsImportReport = {
    imported: 0,
    importedTurnedOff: 0,
    alreadyAdded: 0,
    skipped: scan.skippedNotFromWebStore + scan.skippedUnreadable,
  };
  const copiesFolder = path.join(app.getPath("userData"), EXTENSIONS_FOLDER_NAME);
  const state = getState();
  const additions: InstalledExtension[] = [];
  for (const found of scan.extensions) {
    if (!state.profiles.some((profile) => profile.id === found.profileId)) {
      report.skipped = report.skipped + 1;
      continue;
    }
    if (findExtension(state, found.profileId, found.extensionId) !== undefined) {
      report.alreadyAdded = report.alreadyAdded + 1;
      continue;
    }
    const copyFolder = path.join(copiesFolder, found.extensionId, found.version);
    try {
      if (!fs.existsSync(copyFolder)) {
        fs.cpSync(found.folderPath, copyFolder, { recursive: true });
      }
    } catch (error) {
      console.warn(`Could not copy the extension ${found.name}:`, error);
      report.skipped = report.skipped + 1;
      continue;
    }
    additions.push({
      id: found.extensionId,
      profileId: found.profileId,
      name: found.name,
      version: found.version,
      path: copyFolder,
      isEnabled: found.isEnabled,
      source: "arc",
    });
    report.imported = report.imported + 1;
    if (!found.isEnabled) {
      report.importedTurnedOff = report.importedTurnedOff + 1;
    }
  }
  if (additions.length > 0) {
    applyChange((current) => additions.reduce((next, extension) => addExtension(next, extension), current));
  }
  return report;
}

/** Extensions being added from the Web Store right now, so a second click does not download twice. */
const installingExtensionIds = new Set<string>();

/**
 * Where our copies of extensions live: <data folder>/Extensions.
 */
function getExtensionsFolder(): string {
  return path.join(app.getPath("userData"), EXTENSIONS_FOLDER_NAME);
}

/**
 * Downloads a file, refusing anything larger than an extension can be.
 */
async function downloadExtensionFile(url: string): Promise<Buffer> {
  const response = await net.fetch(url);
  if (!response.ok) {
    throw new Error(`the Web Store answered ${response.status}`);
  }
  if (Number(response.headers.get("content-length") ?? "0") > MAX_CRX_BYTES) {
    throw new Error("the extension file is too large");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_CRX_BYTES) {
    throw new Error("the extension file is too large");
  }
  return bytes;
}

/**
 * Adds a Chrome Web Store extension to the active Space's profile (toolbar "Add Extension" on its Web Store page).
 * Already added there: it is turned on.
 */
export async function installFromWebStore(extensionId: string): Promise<void> {
  const profileId = getActiveSpace(getState()).profileId;
  if (findExtension(getState(), profileId, extensionId) !== undefined) {
    applyChange((state) => setExtensionEnabled(state, profileId, extensionId, true));
    openLibrary("extensions");
    return;
  }
  if (installingExtensionIds.has(extensionId)) {
    return;
  }
  installingExtensionIds.add(extensionId);
  try {
    const crx = await downloadExtensionFile(buildDownloadUrl(extensionId, process.versions.chrome));
    const unpacked = await unpackCrx(crx, extensionId, getExtensionsFolder());
    const extension: InstalledExtension = {
      id: extensionId,
      profileId: profileId,
      name: unpacked.name,
      version: unpacked.version,
      path: unpacked.folder,
      isEnabled: true,
      source: "webstore",
    };
    applyChange((state) => addExtension(state, extension));
    openLibrary("extensions");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("Add Extension", `The extension could not be added: ${message}`);
  } finally {
    installingExtensionIds.delete(extensionId);
  }
}

/**
 * True for extensions that update from the Chrome Web Store: imported or installed from it (not unpacked), with no
 * update address of their own or Google's.
 */
function updatesFromWebStore(extension: InstalledExtension): boolean {
  if (extension.source === "unpacked") {
    return false;
  }
  const updateUrl = readExtensionManifestInfo(extension.path)?.updateUrl ?? null;
  return updateUrl === null || updateUrl.startsWith(WEB_STORE_UPDATE_URL);
}

/**
 * Deletes a copy we made once the sessions no longer use it and no extension points at it.
 */
async function deleteUnusedCopy(folder: string): Promise<void> {
  await whenExtensionsSettled();
  const usedFolders = (getState().extensions ?? []).map((extension) => extension.path);
  deleteExtensionCopyIfUnused(getExtensionsFolder(), folder, usedFolders);
}

/**
 * Asks Google's update server about every Web Store extension (once per extension, however many profiles have it)
 * and installs newer versions. Returns how many were updated; a failure skips that extension until the next check.
 */
export async function updateExtensionsFromWebStore(): Promise<number> {
  const extensionsById = new Map<string, InstalledExtension>();
  for (const extension of getState().extensions ?? []) {
    if (!extensionsById.has(extension.id) && updatesFromWebStore(extension)) {
      extensionsById.set(extension.id, extension);
    }
  }
  let updatedCount = 0;
  for (const extension of extensionsById.values()) {
    try {
      const response = await net.fetch(buildUpdateCheckUrl(extension.id, extension.version, process.versions.chrome));
      const update = response.ok ? parseUpdateResponse(await response.text(), extension.id) : null;
      if (update === null || compareExtensionVersions(update.version, extension.version) <= 0) {
        continue;
      }
      const crx = await downloadExtensionFile(update.codebase);
      if (update.sha256 !== null && !matchesSha256(crx, update.sha256)) {
        throw new Error("the download does not match the update's checksum");
      }
      const unpacked = await unpackCrx(crx, extension.id, getExtensionsFolder());
      applyChange((state) => updateExtensionFolder(state, extension.id, unpacked.name, unpacked.version, unpacked.folder));
      updatedCount = updatedCount + 1;
      if (unpacked.folder !== extension.path) {
        await deleteUnusedCopy(extension.path);
      }
    } catch (error) {
      console.warn(`Updating the extension ${extension.name} failed:`, error);
    }
  }
  return updatedCount;
}

/**
 * Library "Check for Updates": updates now and says what happened.
 */
export async function checkForExtensionUpdatesNow(): Promise<void> {
  const updatedCount = await updateExtensionsFromWebStore();
  const window = getWindow();
  const options = {
    type: "info" as const,
    message: updatedCount === 0 ? "Your extensions are up to date" : `Updated ${updatedCount} extension${updatedCount === 1 ? "" : "s"}`,
    detail: updatedCount === 0 ? "" : "Reload open pages to use the new versions.",
  };
  if (window === null) {
    await dialog.showMessageBox(options);
    return;
  }
  await dialog.showMessageBox(window, options);
}

/**
 * Library "Remove": takes the extension out of its profile and deletes our copy of it when no profile uses it.
 */
export async function removeExtensionAndCopy(profileId: string, extensionId: string): Promise<void> {
  const extension = findExtension(getState(), profileId, extensionId);
  if (extension === undefined) {
    return;
  }
  applyChange((state) => removeExtension(state, profileId, extensionId));
  await deleteUnusedCopy(extension.path);
}
