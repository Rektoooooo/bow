/**
 * WHY this file exists:
 *   Arc is built on Chromium and keeps the pages you visited in a SQLite database per profile. Reading them lets
 *   the Command Bar and the Library know the user's old pages from the first day.
 *
 * Data source:
 *   The `History` database of every Chromium profile folder under Arc's "User Data" folder
 *   (~/Library/Application Support/Arc/User Data/Default, Profile 1, …), table `urls`.
 *
 * Data flow:
 *   arcImportController.ts → readArcHistory(arcFolder) → querySqliteCopy() (sqliteCopy.ts: a copy of History, read with
 *   /usr/bin/sqlite3) → convertChromiumHistoryRows() → mergeHistory() over all profiles → entries for historyStore.ts
 *
 * Rules: never throw; a profile that cannot be read is skipped with a warning. Arc may be running and holding its
 * database open, so only copies are opened, never the original.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { convertChromiumHistoryRows, HISTORY_LIMIT, mergeHistory } from "./history";
import type { HistoryEntry } from "./history";
import { SQLITE_COMMAND, querySqliteCopy } from "./sqliteCopy";

export const USER_DATA_FOLDER_NAME = "User Data";
const HISTORY_FILE_NAME = "History";
/** At most this many rows are read per profile: the newest ones, as many as our history can hold. */
const ROWS_PER_PROFILE_LIMIT = HISTORY_LIMIT;

/** `hidden = 0` leaves out addresses Chromium keeps for internal use (such as subframes). */
const HISTORY_QUERY = `SELECT url, title, visit_count, last_visit_time FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ${ROWS_PER_PROFILE_LIMIT};`;

/**
 * Returns the profile folders in "User Data" that have a History file. Empty when there are none or the folder
 * cannot be read.
 */
export function findProfileFolders(arcFolder: string): string[] {
  const userDataFolder = path.join(arcFolder, USER_DATA_FOLDER_NAME);
  if (!fs.existsSync(userDataFolder)) {
    return [];
  }
  try {
    const folderNames = fs.readdirSync(userDataFolder);
    const folderPaths = folderNames.map((folderName) => path.join(userDataFolder, folderName));
    return folderPaths.filter((folderPath) => fs.existsSync(path.join(folderPath, HISTORY_FILE_NAME)));
  } catch (error) {
    console.warn("Could not look for Arc's history profiles:", error);
    return [];
  }
}

/**
 * Reads the history of one profile through a copy of its database. Throws when the copy or the query fails.
 */
export async function readProfileHistory(profileFolder: string): Promise<HistoryEntry[]> {
  const rows = await querySqliteCopy(profileFolder, HISTORY_FILE_NAME, HISTORY_QUERY);
  return convertChromiumHistoryRows(rows);
}

/**
 * Reads the browsing history of every Arc profile and merges it into one list, newest first.
 * Returns an empty list when Arc has no history or sqlite3 is not available.
 */
export async function readArcHistory(arcFolder: string): Promise<HistoryEntry[]> {
  if (!fs.existsSync(SQLITE_COMMAND)) {
    console.warn("sqlite3 is not available; Arc's history was not imported.");
    return [];
  }
  let mergedEntries: HistoryEntry[] = [];
  for (const profileFolder of findProfileFolders(arcFolder)) {
    try {
      const profileEntries = await readProfileHistory(profileFolder);
      mergedEntries = mergeHistory(mergedEntries, profileEntries);
    } catch (error) {
      console.warn(`Could not read Arc's history in ${profileFolder}; skipping it:`, error);
    }
  }
  return mergedEntries;
}
