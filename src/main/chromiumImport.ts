/**
 * WHY this file exists:
 *   Chrome, Brave, Edge, Vivaldi and Chromium share one on-disk format. One importer covers all of them: it finds
 *   their profiles, turns the `Bookmarks` file into a bookmark tree and reads the `History` database.
 *
 * Data source:
 *   ~/Library/Application Support/<browser folder>/<profile folder>/{Bookmarks, History} and the browser's
 *   `Local State` file (profile display names). The home folder is a parameter so tests can use a temporary one.
 *
 * Data flow:
 *   findChromiumProfiles(home) → user picks one → readChromiumBookmarks(profile) → parseChromiumBookmarks()
 *   → bookmarkImport.addImportedBookmarks();  readChromiumHistory(profile) → arcHistoryImport.readProfileHistory()
 *
 * Rules: never throw; unreadable or unexpected files give an empty result (and a warning for real read errors).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { HistoryEntry } from "./history";
import { readProfileHistory } from "./arcHistoryImport";
import type { ImportedBookmarkNode } from "./bookmarkImport";

export interface ChromiumBrowser {
  id: string;
  name: string;
  /** The browser's data folder, relative to ~/Library/Application Support. */
  dataFolder: string;
}

/** The Chromium-family browsers we know on macOS. Folder names are the browsers' own standard locations. */
export const CHROMIUM_BROWSERS: ChromiumBrowser[] = [
  { id: "chrome", name: "Google Chrome", dataFolder: "Google/Chrome" },
  { id: "brave", name: "Brave", dataFolder: "BraveSoftware/Brave-Browser" },
  { id: "edge", name: "Microsoft Edge", dataFolder: "Microsoft Edge" },
  { id: "vivaldi", name: "Vivaldi", dataFolder: "Vivaldi" },
  { id: "chromium", name: "Chromium", dataFolder: "Chromium" },
];

export interface ChromiumProfile {
  browserId: string;
  browserName: string;
  /** Absolute path of the profile folder. */
  profileFolder: string;
  /** The folder's name, for example "Default" or "Profile 1". */
  folderName: string;
  /** The name the user gave the profile in the browser, or the folder name when unknown. */
  displayName: string;
  hasBookmarks: boolean;
  hasHistory: boolean;
}

const APPLICATION_SUPPORT_PATH = path.join("Library", "Application Support");
const BOOKMARKS_FILE_NAME = "Bookmarks";
const HISTORY_FILE_NAME = "History";
const LOCAL_STATE_FILE_NAME = "Local State";

/** Chromium's profile folders: "Default" and "Profile 1", "Profile 2", … Other folders (Crashpad, …) are not profiles. */
const PROFILE_FOLDER_PATTERN = /^(Default|Profile \d+)$/;

/** Only these addresses can be opened by our tabs. */
const WEB_URL_PATTERN = /^https?:\/\//i;

const FALLBACK_FOLDER_TITLE = "Folder";

/** The three top-level lists in a Chromium `Bookmarks` file, in the order we show them. */
const BOOKMARK_ROOT_KEYS = ["bookmark_bar", "other", "synced"];

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return null;
  }
}

/** Looks up profile.info_cache[folderName].name in the parsed `Local State` file. */
function readProfileDisplayName(localState: unknown, folderName: string): string | null {
  if (!isJsonObject(localState) || !isJsonObject(localState["profile"])) {
    return null;
  }
  const infoCache = localState["profile"]["info_cache"];
  if (!isJsonObject(infoCache) || !isJsonObject(infoCache[folderName])) {
    return null;
  }
  const name = infoCache[folderName]["name"];
  return typeof name === "string" && name.trim().length > 0 ? name : null;
}

function listProfilesOfBrowser(homeFolder: string, browser: ChromiumBrowser): ChromiumProfile[] {
  const browserFolder = path.join(homeFolder, APPLICATION_SUPPORT_PATH, browser.dataFolder);
  let folderNames: string[] = [];
  try {
    folderNames = fs.readdirSync(browserFolder);
  } catch (error) {
    return [];
  }
  const localState = readJsonFile(path.join(browserFolder, LOCAL_STATE_FILE_NAME));
  const profiles: ChromiumProfile[] = [];
  for (const folderName of folderNames.filter((name) => PROFILE_FOLDER_PATTERN.test(name))) {
    const profileFolder = path.join(browserFolder, folderName);
    const hasBookmarks = fs.existsSync(path.join(profileFolder, BOOKMARKS_FILE_NAME));
    const hasHistory = fs.existsSync(path.join(profileFolder, HISTORY_FILE_NAME));
    if (!hasBookmarks && !hasHistory) {
      continue;
    }
    profiles.push({
      browserId: browser.id,
      browserName: browser.name,
      profileFolder: profileFolder,
      folderName: folderName,
      displayName: readProfileDisplayName(localState, folderName) ?? folderName,
      hasBookmarks: hasBookmarks,
      hasHistory: hasHistory,
    });
  }
  return profiles;
}

/** Finds every profile with bookmarks or history, browser by browser. Empty when none is installed. */
export function findChromiumProfiles(homeFolder: string): ChromiumProfile[] {
  const profiles: ChromiumProfile[] = [];
  for (const browser of CHROMIUM_BROWSERS) {
    profiles.push(...listProfilesOfBrowser(homeFolder, browser));
  }
  return profiles;
}

function parseBookmarkNode(rawNode: unknown): ImportedBookmarkNode | null {
  if (!isJsonObject(rawNode)) {
    return null;
  }
  const rawTitle = rawNode["name"];
  const title = typeof rawTitle === "string" ? rawTitle : "";
  const url = rawNode["url"];
  if (rawNode["type"] === "url") {
    const isWebUrl = typeof url === "string" && WEB_URL_PATTERN.test(url);
    return isWebUrl ? { kind: "bookmark", title: title, url: url } : null;
  }
  if (rawNode["type"] === "folder") {
    return { kind: "folder", title: title.trim() === "" ? FALLBACK_FOLDER_TITLE : title, children: parseBookmarkList(rawNode["children"]) };
  }
  return null;
}

function parseBookmarkList(rawChildren: unknown): ImportedBookmarkNode[] {
  if (!Array.isArray(rawChildren)) {
    return [];
  }
  const nodes: ImportedBookmarkNode[] = [];
  for (const rawChild of rawChildren) {
    const node = parseBookmarkNode(rawChild);
    if (node !== null) {
      nodes.push(node);
    }
  }
  return nodes;
}

/** A root has no "type" field in the file; it is a folder. Null when it holds no bookmark. */
function parseRoot(rawRoot: unknown): ImportedBookmarkNode | null {
  if (!isJsonObject(rawRoot)) {
    return null;
  }
  const children = parseBookmarkList(rawRoot["children"]);
  if (children.length === 0) {
    return null;
  }
  const rawTitle = rawRoot["name"];
  const hasTitle = typeof rawTitle === "string" && rawTitle.trim() !== "";
  return { kind: "folder", title: hasTitle ? rawTitle : FALLBACK_FOLDER_TITLE, children: children };
}

/**
 * Turns the parsed `Bookmarks` file into a tree: one folder per root (bookmark bar, other, synced) that holds
 * at least one bookmark. Non-web addresses (javascript:, chrome://, file:) are dropped. Anything unexpected gives
 * an empty tree.
 */
export function parseChromiumBookmarks(json: unknown): ImportedBookmarkNode[] {
  if (!isJsonObject(json) || !isJsonObject(json["roots"])) {
    return [];
  }
  const roots = json["roots"];
  const tree: ImportedBookmarkNode[] = [];
  for (const rootKey of BOOKMARK_ROOT_KEYS) {
    const rootNode = parseRoot(roots[rootKey]);
    if (rootNode !== null) {
      tree.push(rootNode);
    }
  }
  return tree;
}

/** Reads and parses the profile's `Bookmarks` file. Empty tree when it is missing or damaged. */
export function readChromiumBookmarks(profile: ChromiumProfile): ImportedBookmarkNode[] {
  const parsedFile = readJsonFile(path.join(profile.profileFolder, BOOKMARKS_FILE_NAME));
  return parseChromiumBookmarks(parsedFile);
}

/**
 * Reads the profile's browsing history through a copy of its database (the browser may be running).
 * Empty list when the profile has no history or the database cannot be read.
 */
export async function readChromiumHistory(profile: ChromiumProfile): Promise<HistoryEntry[]> {
  if (!profile.hasHistory) {
    return [];
  }
  try {
    return await readProfileHistory(profile.profileFolder);
  } catch (error) {
    console.warn(`Could not read the history in ${profile.profileFolder}:`, error);
    return [];
  }
}
