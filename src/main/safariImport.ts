/**
 * WHY this file exists:
 *   Safari keeps bookmarks in a property list and history in a SQLite file, both inside ~/Library/Safari, which
 *   macOS only opens for apps with Full Disk Access. This reads them and says clearly when access is missing.
 *
 * Data source:
 *   ~/Library/Safari/Bookmarks.plist (WebBookmarkTypeList / WebBookmarkTypeLeaf items, Reading List = list titled
 *   "com.apple.ReadingList") and ~/Library/Safari/History.db (history_items.url, history_visits.visit_time in
 *   seconds since 2001-01-01, history_visits.title).
 *
 * Data flow:
 *   readSafariBookmarks(home) → /usr/bin/plutil -convert xml1 → parseXmlPropertyList() → parseSafariBookmarks()
 *   readSafariHistory(home) → copy History.db → /usr/bin/sqlite3 -json → convertSafariHistoryRows()
 *
 * Why XML and not `plutil -convert json` (the obvious choice): JSON cannot hold the dates and binary data that
 * Reading List items contain, and plutil then fails for the whole file. XML keeps everything, and the small
 * reader below turns it into plain values.
 *
 * Rules: never throw. A blocked folder gives { ok: false, reason: "needsFullDiskAccess" }.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { HISTORY_LIMIT, isRecordableUrl } from "./history";
import type { HistoryEntry } from "./history";
import type { ImportedBookmark, ImportedBookmarkNode } from "./bookmarkImport";

const execFileAsync = promisify(execFile);

const PLUTIL_COMMAND = "/usr/bin/plutil";
const SQLITE_COMMAND = "/usr/bin/sqlite3";

const SAFARI_FOLDER_PATH = path.join("Library", "Safari");
const BOOKMARKS_FILE_NAME = "Bookmarks.plist";
const HISTORY_FILE_NAME = "History.db";
/** Files SQLite keeps next to the database; recent visits may only be in them. */
const HISTORY_COMPANION_FILE_NAMES = ["History.db-wal"];

/** Safari counts seconds from 2001-01-01; Unix time starts in 1970. Same offset Arc uses. */
const APPLE_EPOCH_OFFSET_SECONDS = 978307200;
const MILLISECONDS_PER_SECOND = 1000;

/** Room for the JSON of the history rows with a wide margin (same as the Arc history reader). */
const SQLITE_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const PLUTIL_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Each address once, with its newest visit and that visit's title. The column that links a visit to its address is
 * history_visits.history_item (unconfirmed on this Mac: macOS blocks the file; it is the name Safari's schema uses).
 */
const HISTORY_QUERY = `SELECT i.url AS url,
  (SELECT v.title FROM history_visits v WHERE v.history_item = i.id ORDER BY v.visit_time DESC LIMIT 1) AS title,
  (SELECT COUNT(*) FROM history_visits v WHERE v.history_item = i.id) AS visit_count,
  (SELECT MAX(v.visit_time) FROM history_visits v WHERE v.history_item = i.id) AS visit_time
  FROM history_items i WHERE visit_time IS NOT NULL ORDER BY visit_time DESC LIMIT ${HISTORY_LIMIT};`;

/** Safari's names for its built-in bookmark lists, and the names we show. */
const BUILT_IN_LIST_TITLES: Record<string, string> = {
  BookmarksBar: "Favorites",
  BookmarksMenu: "Bookmarks Menu",
};
const READING_LIST_TITLE = "com.apple.ReadingList";
const FALLBACK_FOLDER_TITLE = "Folder";

/** Only these addresses can be opened by our tabs. */
const WEB_URL_PATTERN = /^https?:\/\//i;

/** Error text that means "macOS refused access" when it comes from plutil or sqlite3 instead of Node. */
const PERMISSION_MESSAGE_PATTERN = /operation not permitted|don.t have permission|permission denied|not authorized/i;

export type SafariReadResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; reason: "needsFullDiskAccess" | "notFound" | "failed" };

export interface SafariBookmarks {
  /** Favorites, Bookmarks Menu and other folders, as a tree. */
  bookmarks: ImportedBookmarkNode[];
  /** The Reading List items, flat. */
  readingList: ImportedBookmark[];
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when an error from fs or from a child process means macOS blocked access (EPERM/EACCES or its message). */
export function isPermissionDenied(error: unknown): boolean {
  if (!isJsonObject(error) && !(error instanceof Error)) {
    return false;
  }
  const details = error as { code?: unknown; message?: unknown; stderr?: unknown };
  if (details.code === "EPERM" || details.code === "EACCES") {
    return true;
  }
  const message = typeof details.message === "string" ? details.message : "";
  const standardError = typeof details.stderr === "string" ? details.stderr : "";
  return PERMISSION_MESSAGE_PATTERN.test(message) || PERMISSION_MESSAGE_PATTERN.test(standardError);
}

function failureFromError(error: unknown): { ok: false; reason: "needsFullDiskAccess" | "notFound" | "failed" } {
  if (isPermissionDenied(error)) {
    return { ok: false, reason: "needsFullDiskAccess" };
  }
  const code = (error as { code?: unknown } | null)?.code;
  return { ok: false, reason: code === "ENOENT" ? "notFound" : "failed" };
}

// ---------------------------------------------------------------------------------------------------------------
// XML property list reader
// ---------------------------------------------------------------------------------------------------------------

/** One tag and the text right after it: "<key>Title" or "</dict>" or "<true/>". */
const PLIST_TOKEN_PATTERN = /<(\/?)([a-zA-Z]+)[^>]*?(\/?)>([^<]*)/g;

const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

function decodeXmlText(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity);
}

/** A dictionary or array being filled, and the key waiting for its value (dictionaries only). */
interface PlistFrame {
  container: JsonObject | unknown[];
  pendingKey: string | null;
}

function attachValue(frames: PlistFrame[], value: unknown): void {
  const frame = frames[frames.length - 1];
  if (frame === undefined) {
    return;
  }
  if (Array.isArray(frame.container)) {
    frame.container.push(value);
    return;
  }
  if (frame.pendingKey !== null) {
    frame.container[frame.pendingKey] = value;
    frame.pendingKey = null;
  }
}

function readScalar(tagName: string, text: string): unknown {
  const decodedText = decodeXmlText(text);
  if (tagName === "integer" || tagName === "real") {
    return Number(decodedText);
  }
  if (tagName === "true") {
    return true;
  }
  if (tagName === "false") {
    return false;
  }
  // Dates stay text; binary data is not needed by anything here, so it is dropped.
  return tagName === "data" ? null : decodedText;
}

/**
 * Reads an XML property list (what `plutil -convert xml1` prints) into plain values: dict → object, array → array,
 * string/date → string, integer/real → number, true/false → boolean, data → null. Returns null for unreadable text.
 */
export function parseXmlPropertyList(xmlText: string): unknown {
  const frames: PlistFrame[] = [];
  let result: unknown = null;
  for (const match of xmlText.matchAll(PLIST_TOKEN_PATTERN)) {
    const isClosing = match[1] === "/";
    const tagName = match[2] ?? "";
    const isSelfClosing = match[3] === "/";
    const textAfterTag = match[4] ?? "";
    if (tagName === "key" && !isClosing) {
      const frame = frames[frames.length - 1];
      if (frame !== undefined) {
        frame.pendingKey = decodeXmlText(textAfterTag);
      }
      continue;
    }
    const isContainer = tagName === "dict" || tagName === "array";
    if (isContainer && isClosing) {
      const finished = frames.pop();
      if (frames.length === 0 && finished !== undefined) {
        result = finished.container;
      }
      continue;
    }
    if (isContainer) {
      const container = tagName === "dict" ? {} : [];
      attachValue(frames, container);
      if (isSelfClosing) {
        result = frames.length === 0 ? container : result;
      } else {
        frames.push({ container: container, pendingKey: null });
      }
      continue;
    }
    const isValueTag = !isClosing && ["string", "integer", "real", "date", "data", "true", "false"].includes(tagName);
    if (isValueTag) {
      attachValue(frames, readScalar(tagName, textAfterTag));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------------------------------------------

function readTitle(item: JsonObject): string {
  const uriDictionary = item["URIDictionary"];
  if (isJsonObject(uriDictionary) && typeof uriDictionary["title"] === "string") {
    return uriDictionary["title"];
  }
  const folderTitle = item["Title"];
  return typeof folderTitle === "string" ? folderTitle : "";
}

function parseLeaf(item: JsonObject): ImportedBookmark | null {
  const url = item["URLString"];
  if (typeof url !== "string" || !WEB_URL_PATTERN.test(url)) {
    return null;
  }
  return { kind: "bookmark", title: readTitle(item), url: url };
}

function parseList(item: JsonObject, readingList: ImportedBookmark[]): ImportedBookmarkNode[] {
  const children = item["Children"];
  if (!Array.isArray(children)) {
    return [];
  }
  const nodes: ImportedBookmarkNode[] = [];
  for (const child of children) {
    const node = parseItem(child, readingList);
    if (node !== null) {
      nodes.push(node);
    }
  }
  return nodes;
}

function parseItem(rawItem: unknown, readingList: ImportedBookmark[]): ImportedBookmarkNode | null {
  if (!isJsonObject(rawItem)) {
    return null;
  }
  if (rawItem["WebBookmarkType"] === "WebBookmarkTypeLeaf") {
    return parseLeaf(rawItem);
  }
  if (rawItem["WebBookmarkType"] !== "WebBookmarkTypeList") {
    return null;
  }
  const rawTitle = typeof rawItem["Title"] === "string" ? rawItem["Title"] : "";
  const childNodes = parseList(rawItem, readingList);
  if (rawTitle === READING_LIST_TITLE) {
    for (const node of childNodes) {
      if (node.kind === "bookmark") {
        readingList.push(node);
      }
    }
    return null;
  }
  const displayTitle = BUILT_IN_LIST_TITLES[rawTitle] ?? (rawTitle.trim() === "" ? FALLBACK_FOLDER_TITLE : rawTitle);
  return { kind: "folder", title: displayTitle, children: childNodes };
}

/**
 * Turns Safari's Bookmarks.plist (as plain values) into a bookmark tree plus the Reading List. Non-web addresses
 * are dropped and unknown shapes give empty results.
 */
export function parseSafariBookmarks(plistJson: unknown): SafariBookmarks {
  const readingList: ImportedBookmark[] = [];
  if (!isJsonObject(plistJson)) {
    return { bookmarks: [], readingList: readingList };
  }
  const bookmarks = parseList(plistJson, readingList);
  return { bookmarks: bookmarks, readingList: readingList };
}

/** Reads ~/Library/Safari/Bookmarks.plist. */
export async function readSafariBookmarks(homeFolder: string): Promise<SafariReadResult<SafariBookmarks>> {
  const bookmarksPath = path.join(homeFolder, SAFARI_FOLDER_PATH, BOOKMARKS_FILE_NAME);
  try {
    const converted = await execFileAsync(PLUTIL_COMMAND, ["-convert", "xml1", "-o", "-", bookmarksPath], {
      maxBuffer: PLUTIL_MAX_OUTPUT_BYTES,
    });
    return { ok: true, value: parseSafariBookmarks(parseXmlPropertyList(converted.stdout)) };
  } catch (error) {
    if (!isPermissionDenied(error) && !fs.existsSync(bookmarksPath)) {
      return { ok: false, reason: "notFound" };
    }
    return failureFromError(error);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------------------------

/**
 * Converts rows { url, title, visit_count, visit_time } from History.db. Rows that are malformed or not web
 * pages are left out.
 */
export function convertSafariHistoryRows(rows: unknown): HistoryEntry[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  const entries: HistoryEntry[] = [];
  for (const row of rows) {
    if (!isJsonObject(row)) {
      continue;
    }
    const { url, title, visit_count: visitCount, visit_time: visitTime } = row;
    const hasValidFields =
      typeof url === "string" &&
      typeof visitCount === "number" &&
      Number.isFinite(visitCount) &&
      typeof visitTime === "number" &&
      Number.isFinite(visitTime);
    if (!hasValidFields || !isRecordableUrl(url)) {
      continue;
    }
    entries.push({
      url: url,
      title: typeof title === "string" ? title : "",
      visitCount: Math.max(1, visitCount),
      lastVisitAt: (visitTime + APPLE_EPOCH_OFFSET_SECONDS) * MILLISECONDS_PER_SECOND,
    });
  }
  return entries;
}

/** Reads ~/Library/Safari/History.db through a temporary copy (Safari may be running). */
export async function readSafariHistory(homeFolder: string): Promise<SafariReadResult<HistoryEntry[]>> {
  const safariFolder = path.join(homeFolder, SAFARI_FOLDER_PATH);
  const temporaryFolder = fs.mkdtempSync(path.join(os.tmpdir(), "safari-history-"));
  try {
    fs.copyFileSync(path.join(safariFolder, HISTORY_FILE_NAME), path.join(temporaryFolder, HISTORY_FILE_NAME));
    for (const companionName of HISTORY_COMPANION_FILE_NAMES) {
      const companionPath = path.join(safariFolder, companionName);
      if (fs.existsSync(companionPath)) {
        fs.copyFileSync(companionPath, path.join(temporaryFolder, companionName));
      }
    }
    const queryResult = await execFileAsync(
      SQLITE_COMMAND,
      ["-readonly", "-json", path.join(temporaryFolder, HISTORY_FILE_NAME), HISTORY_QUERY],
      { maxBuffer: SQLITE_MAX_OUTPUT_BYTES },
    );
    // sqlite3 prints nothing at all (not "[]") when the query finds no rows.
    const outputText = queryResult.stdout.trim();
    const rows: unknown = outputText === "" ? [] : JSON.parse(outputText);
    return { ok: true, value: convertSafariHistoryRows(rows) };
  } catch (error) {
    return failureFromError(error);
  } finally {
    fs.rmSync(temporaryFolder, { recursive: true, force: true });
  }
}
