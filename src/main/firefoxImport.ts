/**
 * WHY this file exists:
 *   People coming from Firefox bring their bookmarks and history, like Chrome and Safari users can. Firefox keeps both
 *   in one SQLite file per profile; profiles.ini says which profiles exist.
 *
 * Data source:
 *   ~/Library/Application Support/Firefox/profiles.ini ([Profile…] sections with Name, Path, IsRelative, Default;
 *   [Install…] sections whose Default is the profile Firefox opens) and each profile's places.sqlite: moz_bookmarks
 *   (type 1 bookmark, 2 folder; parent, position, title, fk → moz_places) and moz_places (url, title, visit_count,
 *   last_visit_date in microseconds since 1970, hidden for redirects and framed pages).
 *
 * Data flow:
 *   findFirefoxProfiles(home) → parseProfilesIni() → profiles with a places.sqlite
 *   readFirefoxProfile(profile) → one copy of places.sqlite → /usr/bin/sqlite3 -json twice →
 *   convertFirefoxBookmarkRows() and convertFirefoxHistoryRows()
 *
 * Rules: never throw. A profile that cannot be read gives no bookmarks and no history.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { HISTORY_LIMIT, isRecordableUrl } from "./history";
import type { HistoryEntry } from "./history";
import type { ImportedBookmarkNode } from "./bookmarkImport";

const execFileAsync = promisify(execFile);

const SQLITE_COMMAND = "/usr/bin/sqlite3";

/** Large histories print a lot of JSON. */
const SQLITE_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

const FIREFOX_FOLDER_PATH = path.join("Library", "Application Support", "Firefox");
const PROFILES_FILE_NAME = "profiles.ini";
const PLACES_FILE_NAME = "places.sqlite";
/** The write-ahead log next to the database: recent bookmarks and visits may only be in it while Firefox runs. */
const PLACES_COMPANION_FILE_NAMES = ["places.sqlite-wal"];

/** moz_bookmarks.type values. */
const BOOKMARK_TYPE = 1;
const FOLDER_TYPE = 2;

/** Firefox dates are microseconds; ours are milliseconds. */
const MICROSECONDS_PER_MILLISECOND = 1000;

/** Firefox's built-in folders (by guid) in the order we add them, with the names Firefox shows. Tags are left out. */
const ROOT_FOLDERS = [
  { guid: "toolbar_____", title: "Bookmarks Toolbar" },
  { guid: "menu________", title: "Bookmarks Menu" },
  { guid: "unfiled_____", title: "Other Bookmarks" },
  { guid: "mobile______", title: "Mobile Bookmarks" },
];

/** Name of a folder that has none in Firefox. */
const FALLBACK_FOLDER_TITLE = "Folder";

/** Bookmark folders nest at most this deep; anything deeper (or a broken loop in the file) is cut off. */
const MAX_FOLDER_DEPTH = 32;

/**
 * Every bookmark and folder with its address; a folder's children are ordered by position. A bookmark saved without
 * a name shows its page's title, as Firefox does.
 */
const BOOKMARKS_QUERY = `SELECT b.id AS id, b.parent AS parent, b.type AS type, b.position AS position,
  COALESCE(b.title, p.title) AS title, b.guid AS guid, p.url AS url
  FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position;`;

/** Pages with a visit, newest first; hidden ones are redirects and pages inside frames. */
const HISTORY_QUERY = `SELECT url, title, visit_count, last_visit_date FROM moz_places
  WHERE last_visit_date IS NOT NULL AND hidden = 0 ORDER BY last_visit_date DESC LIMIT ${HISTORY_LIMIT};`;

/** One Firefox profile that has a places.sqlite. */
export interface FirefoxProfile {
  /** The profile's folder name ("abcd1234.default-release"), which names it in import source ids. */
  folderName: string;
  /** Its name in Firefox ("default-release"). */
  displayName: string;
  profileFolder: string;
  /** True for the profile Firefox opens. */
  isDefault: boolean;
}

/** One [section] of profiles.ini. */
interface IniSection {
  name: string;
  values: Record<string, string>;
}

/**
 * Splits an .ini file into its sections and their key=value lines.
 */
function parseIniSections(text: string): IniSection[] {
  const sections: IniSection[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header !== null) {
      sections.push({ name: header[1] ?? "", values: {} });
      continue;
    }
    const separatorIndex = line.indexOf("=");
    const currentSection = sections.at(-1);
    if (separatorIndex <= 0 || currentSection === undefined) {
      continue;
    }
    currentSection.values[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1);
  }
  return sections;
}

/**
 * Reads profiles.ini: every [Profile…] section, its folder (relative paths start in Firefox's folder), and whether
 * Firefox opens it (an [Install…] section names it, or older files mark it Default=1).
 */
export function parseProfilesIni(text: string, firefoxFolder: string): FirefoxProfile[] {
  const sections = parseIniSections(text);
  const installDefaults = sections.filter((section) => section.name.startsWith("Install")).map((section) => section.values["Default"]);
  const profiles: FirefoxProfile[] = [];
  for (const section of sections) {
    const profilePath = section.values["Path"];
    if (!section.name.startsWith("Profile") || profilePath === undefined || profilePath === "") {
      continue;
    }
    const isRelative = section.values["IsRelative"] !== "0";
    const isDefault = installDefaults.includes(profilePath) || section.values["Default"] === "1";
    profiles.push({
      folderName: path.basename(profilePath),
      displayName: section.values["Name"] ?? path.basename(profilePath),
      profileFolder: isRelative ? path.join(firefoxFolder, profilePath) : profilePath,
      isDefault: isDefault,
    });
  }
  return profiles;
}

/**
 * The Firefox profiles on this Mac that have bookmarks and history (a places.sqlite), the one Firefox opens first.
 */
export function findFirefoxProfiles(homeFolder: string): FirefoxProfile[] {
  const firefoxFolder = path.join(homeFolder, FIREFOX_FOLDER_PATH);
  let text: string;
  try {
    text = fs.readFileSync(path.join(firefoxFolder, PROFILES_FILE_NAME), "utf8");
  } catch {
    return [];
  }
  const profiles = parseProfilesIni(text, firefoxFolder).filter((profile) => fs.existsSync(path.join(profile.profileFolder, PLACES_FILE_NAME)));
  return profiles.sort((first, second) => Number(second.isDefault) - Number(first.isDefault));
}

/** True for a plain object (JSON rows are objects). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A moz_bookmarks row as the query prints it. */
interface BookmarkRow {
  id: number;
  parent: number;
  type: number;
  title: string;
  guid: string;
  url: string | null;
}

/**
 * Keeps the rows that have the fields a bookmark or folder needs.
 */
function readBookmarkRows(rows: unknown): BookmarkRow[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  const bookmarkRows: BookmarkRow[] = [];
  for (const row of rows) {
    if (!isJsonObject(row) || typeof row["id"] !== "number" || typeof row["parent"] !== "number" || typeof row["type"] !== "number") {
      continue;
    }
    const title = typeof row["title"] === "string" ? row["title"] : "";
    const guid = typeof row["guid"] === "string" ? row["guid"] : "";
    const url = typeof row["url"] === "string" ? row["url"] : null;
    bookmarkRows.push({ id: row["id"], parent: row["parent"], type: row["type"], title: title, guid: guid, url: url });
  }
  return bookmarkRows;
}

/**
 * Turns one folder's rows into nodes, in Firefox's order (the query sorts by position). Separators and non-web
 * addresses (place: queries, javascript:, file:) are left out.
 */
function buildChildren(folderId: number, childrenByParent: Map<number, BookmarkRow[]>, depth: number): ImportedBookmarkNode[] {
  if (depth > MAX_FOLDER_DEPTH) {
    return [];
  }
  const children = childrenByParent.get(folderId) ?? [];
  const nodes: ImportedBookmarkNode[] = [];
  for (const row of children) {
    if (row.type === BOOKMARK_TYPE && row.url !== null && isRecordableUrl(row.url)) {
      nodes.push({ kind: "bookmark", title: row.title, url: row.url });
      continue;
    }
    if (row.type === FOLDER_TYPE) {
      const title = row.title.trim() === "" ? FALLBACK_FOLDER_TITLE : row.title;
      nodes.push({ kind: "folder", title: title, children: buildChildren(row.id, childrenByParent, depth + 1) });
    }
  }
  return nodes;
}

/**
 * Turns moz_bookmarks rows into a tree: one folder per built-in folder (toolbar, menu, other, mobile) that holds
 * anything, named as Firefox names them. Tags are left out: they repeat bookmarks that are already in a folder.
 */
export function convertFirefoxBookmarkRows(rows: unknown): ImportedBookmarkNode[] {
  const bookmarkRows = readBookmarkRows(rows);
  const childrenByParent = new Map<number, BookmarkRow[]>();
  for (const row of bookmarkRows) {
    const siblings = childrenByParent.get(row.parent) ?? [];
    siblings.push(row);
    childrenByParent.set(row.parent, siblings);
  }
  const tree: ImportedBookmarkNode[] = [];
  for (const rootFolder of ROOT_FOLDERS) {
    const rootRow = bookmarkRows.find((row) => row.guid === rootFolder.guid);
    const children = rootRow === undefined ? [] : buildChildren(rootRow.id, childrenByParent, 1);
    if (children.length > 0) {
      tree.push({ kind: "folder", title: rootFolder.title, children: children });
    }
  }
  return tree;
}

/**
 * Turns moz_places rows { url, title, visit_count, last_visit_date } into history entries. Malformed rows and pages
 * that are not on the web are left out.
 */
export function convertFirefoxHistoryRows(rows: unknown): HistoryEntry[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  const entries: HistoryEntry[] = [];
  for (const row of rows) {
    if (!isJsonObject(row)) {
      continue;
    }
    const { url, title, visit_count: visitCount, last_visit_date: lastVisitDate } = row;
    const hasValidFields = typeof url === "string" && typeof lastVisitDate === "number" && Number.isFinite(lastVisitDate);
    if (!hasValidFields || !isRecordableUrl(url)) {
      continue;
    }
    const knownVisitCount = typeof visitCount === "number" && Number.isFinite(visitCount) ? visitCount : 1;
    entries.push({
      url: url,
      title: typeof title === "string" ? title : "",
      visitCount: Math.max(1, knownVisitCount),
      lastVisitAt: Math.round(lastVisitDate / MICROSECONDS_PER_MILLISECOND),
    });
  }
  return entries;
}

/** What one Firefox profile has to import. */
export interface FirefoxProfileData {
  bookmarks: ImportedBookmarkNode[];
  history: HistoryEntry[];
}

/**
 * Runs a query on the copied database and returns its rows.
 */
async function queryRows(databasePath: string, query: string): Promise<unknown> {
  const queryResult = await execFileAsync(SQLITE_COMMAND, ["-readonly", "-json", databasePath, query], { maxBuffer: SQLITE_MAX_OUTPUT_BYTES });
  // sqlite3 prints nothing at all (not "[]") when the query finds no rows.
  const outputText = queryResult.stdout.trim();
  return outputText === "" ? [] : JSON.parse(outputText);
}

/**
 * Reads a profile's bookmarks (as a tree) and history (newest first) from one temporary copy of its places.sqlite:
 * Firefox may be running and holds the file, and the copy is made without blocking the window (the file can be large).
 * Nothing when it cannot be read.
 */
export async function readFirefoxProfile(profile: FirefoxProfile): Promise<FirefoxProfileData> {
  const temporaryFolder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "firefox-places-"));
  const databasePath = path.join(temporaryFolder, PLACES_FILE_NAME);
  try {
    await fs.promises.copyFile(path.join(profile.profileFolder, PLACES_FILE_NAME), databasePath);
    for (const companionName of PLACES_COMPANION_FILE_NAMES) {
      const companionPath = path.join(profile.profileFolder, companionName);
      if (fs.existsSync(companionPath)) {
        await fs.promises.copyFile(companionPath, path.join(temporaryFolder, companionName));
      }
    }
    const bookmarkRows = await queryRows(databasePath, BOOKMARKS_QUERY);
    const historyRows = await queryRows(databasePath, HISTORY_QUERY);
    return { bookmarks: convertFirefoxBookmarkRows(bookmarkRows), history: convertFirefoxHistoryRows(historyRows) };
  } catch (error) {
    console.warn(`Could not read Firefox's ${profile.displayName} profile:`, error);
    return { bookmarks: [], history: [] };
  } finally {
    await fs.promises.rm(temporaryFolder, { recursive: true, force: true });
  }
}
