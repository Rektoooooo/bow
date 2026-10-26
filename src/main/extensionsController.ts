/**
 * WHY this file exists:
 *   The two ways extensions arrive. Load Unpacked: a folder the user picks, loaded where it is (Chrome's developer
 *   mode). Import from Arc: Arc's Web Store extensions, copied into our data folder, because Arc's own folder goes
 *   away with Arc; each keeps the on/off it had in Arc. Turning extensions on and off and removing them is plain
 *   state (extensionList.ts); extensionHost.ts then loads or unloads them.
 *
 * Data source:
 *   A folder the user picks; Arc's profile folders (arcExtensionsImport.ts).
 *
 * Data flow:
 *   Library "Load Unpacked…" → loadUnpackedExtension() → loadExtensionNow() (learns the id) → addExtension
 *   Import from Arc → importArcExtensions() → copy each folder → addExtension → extensionHost.ts loads the enabled ones
 */
import { app, dialog } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { InstalledExtension } from "../shared/types";
import { findArcExtensions } from "./arcExtensionsImport";
import { applyChange, getState, getWindow } from "./browserCore";
import { loadExtensionNow } from "./extensionHost";
import { addExtension, findExtension } from "./extensionList";
import { readExtensionManifestInfo } from "./extensionManifest";
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
