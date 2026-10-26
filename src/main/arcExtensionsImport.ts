/**
 * WHY this file exists:
 *   Arc is built on Chromium, so the Chrome extensions a user installed live in Arc's profile folders. Finding them
 *   lets us offer to copy them into our browser.
 *
 * Data source:
 *   ~/Library/Application Support/Arc/User Data/<Default | Profile N>/Extensions/<id>/<version>/manifest.json and
 *   the profile's `Secure Preferences` file (extensions.settings[<id>]: install location and disable reasons).
 *
 * Data flow:
 *   arcImportController.ts → findArcExtensions(arcFolder) → ArcExtensionScan → the extension copy step
 *
 * Rules: read-only, never throws; anything unreadable is counted and skipped.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_PROFILE_ID } from "../shared/settings";
import type { ProfileId } from "../shared/types";
import { findProfileFolders } from "./arcHistoryImport";
import { readExtensionManifestInfo } from "./extensionManifest";

export interface ArcExtensionFound {
  /** "Default", "Profile 2" */
  arcProfileFolder: string;
  /** Our profile id for that Arc profile. */
  profileId: ProfileId;
  /** The folder name under Extensions/ (the Chrome Web Store id). */
  extensionId: string;
  version: string;
  /** Absolute path of the chosen version folder. */
  folderPath: string;
  name: string;
  isEnabled: boolean;
}

export interface ArcExtensionScan {
  extensions: ArcExtensionFound[];
  skippedNotFromWebStore: number;
  /** No settings entry, no or invalid manifest, or an unreadable folder. */
  skippedUnreadable: number;
}

/** Prefix that keeps imported profile ids apart from ids this browser creates itself. */
const PROFILE_ID_PREFIX = "arc-profile-";
const ARC_DEFAULT_PROFILE_FOLDER = "Default";
const EXTENSIONS_FOLDER_NAME = "Extensions";
const SECURE_PREFERENCES_FILE_NAME = "Secure Preferences";
/** Chromium's ManifestLocation value for "installed from the Chrome Web Store". */
const CHROME_WEB_STORE_LOCATION = 1;

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Maps an Arc profile folder name to our profile id: "Default" is our default profile, "Profile 2" is "arc-profile-profile-2". */
export function arcProfileFolderToProfileId(folderName: string): ProfileId {
  if (folderName === ARC_DEFAULT_PROFILE_FOLDER) {
    return DEFAULT_PROFILE_ID;
  }
  const lowercaseName = folderName.toLowerCase();
  const dashedName = lowercaseName.replaceAll(" ", "-");
  return PROFILE_ID_PREFIX + dashedName;
}

/** Reads extensions.settings from a profile's Secure Preferences. Null when the file is missing or malformed. */
function readExtensionSettings(profileFolder: string): JsonObject | null {
  try {
    const text = fs.readFileSync(path.join(profileFolder, SECURE_PREFERENCES_FILE_NAME), "utf8");
    const preferences: unknown = JSON.parse(text);
    if (!isJsonObject(preferences)) {
      return null;
    }
    const extensionsSection = preferences["extensions"];
    if (!isJsonObject(extensionsSection)) {
      return null;
    }
    const settings = extensionsSection["settings"];
    return isJsonObject(settings) ? settings : null;
  } catch {
    return null;
  }
}

/** Newer Chromium stores disable reasons as a list of numbers, older versions as one number. */
function hasDisableReasons(disableReasons: unknown): boolean {
  if (Array.isArray(disableReasons)) {
    return disableReasons.length > 0;
  }
  return typeof disableReasons === "number" && disableReasons !== 0;
}

/** Splits "4.9.133_0" into [4, 9, 133, 0]. Parts that are not numbers count as 0. */
function parseVersionFolderName(folderName: string): number[] {
  return folderName.split(/[._]/).map((part) => {
    const partNumber = Number(part);
    return Number.isFinite(partNumber) ? partNumber : 0;
  });
}

function compareVersionFolderNames(left: string, right: string): number {
  const leftParts = parseVersionFolderName(left);
  const rightParts = parseVersionFolderName(right);
  const partCount = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < partCount; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/** Returns the name of the highest version folder inside one extension folder, or null when there is none. */
function findHighestVersionFolderName(extensionFolder: string): string | null {
  try {
    const entries = fs.readdirSync(extensionFolder, { withFileTypes: true });
    const versionFolderNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    versionFolderNames.sort(compareVersionFolderNames);
    return versionFolderNames[versionFolderNames.length - 1] ?? null;
  } catch {
    return null;
  }
}

/** Reads one extension of one profile and adds it to the scan, or counts why it was skipped. */
function scanExtension(
  profileFolder: string,
  extensionId: string,
  extensionSettings: unknown,
  scan: ArcExtensionScan,
): void {
  if (!isJsonObject(extensionSettings)) {
    scan.skippedUnreadable += 1;
    return;
  }
  if (extensionSettings["location"] !== CHROME_WEB_STORE_LOCATION) {
    scan.skippedNotFromWebStore += 1;
    return;
  }
  const extensionFolder = path.join(profileFolder, EXTENSIONS_FOLDER_NAME, extensionId);
  const versionFolderName = findHighestVersionFolderName(extensionFolder);
  if (versionFolderName === null) {
    scan.skippedUnreadable += 1;
    return;
  }
  const versionFolder = path.join(extensionFolder, versionFolderName);
  const manifestInfo = readExtensionManifestInfo(versionFolder);
  if (manifestInfo === null) {
    scan.skippedUnreadable += 1;
    return;
  }
  const arcProfileFolder = path.basename(profileFolder);
  scan.extensions.push({
    arcProfileFolder: arcProfileFolder,
    profileId: arcProfileFolderToProfileId(arcProfileFolder),
    extensionId: extensionId,
    version: manifestInfo.version,
    folderPath: versionFolder,
    name: manifestInfo.name,
    isEnabled: !hasDisableReasons(extensionSettings["disable_reasons"]),
  });
}

/** Scans one Arc profile folder and adds what it finds to the scan. */
function scanProfileFolder(profileFolder: string, scan: ArcExtensionScan): void {
  const extensionsFolder = path.join(profileFolder, EXTENSIONS_FOLDER_NAME);
  if (!fs.existsSync(extensionsFolder)) {
    return;
  }
  let extensionIds: string[];
  try {
    // Only folders are extensions; Finder's .DS_Store and similar files are not.
    const entries = fs.readdirSync(extensionsFolder, { withFileTypes: true });
    extensionIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    scan.skippedUnreadable += 1;
    return;
  }
  const settings = readExtensionSettings(profileFolder);
  for (const extensionId of extensionIds) {
    const extensionSettings = settings === null ? undefined : settings[extensionId];
    scanExtension(profileFolder, extensionId, extensionSettings, scan);
  }
}

/**
 * Finds the Chrome Web Store extensions installed in every Arc profile. Returns an empty scan when Arc's folder
 * is missing. Results are sorted by profile folder, then name.
 */
export function findArcExtensions(arcFolder: string): ArcExtensionScan {
  const scan: ArcExtensionScan = { extensions: [], skippedNotFromWebStore: 0, skippedUnreadable: 0 };
  for (const profileFolder of findProfileFolders(arcFolder)) {
    scanProfileFolder(profileFolder, scan);
  }
  scan.extensions.sort((left, right) => {
    const byProfile = left.arcProfileFolder.localeCompare(right.arcProfileFolder);
    return byProfile !== 0 ? byProfile : left.name.localeCompare(right.name);
  });
  return scan;
}
