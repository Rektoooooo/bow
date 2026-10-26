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
 *   arcImportController.ts → readArcHistory(arcFolder) → copy History to a temporary folder → /usr/bin/sqlite3 -json
 *   → convertChromiumHistoryRows() → mergeHistory() over all profiles → entries for historyStore.ts
 *
 * Rules: never throw; a profile that cannot be read is skipped with a warning. Arc may be running and holding its
 * database open, so only copies are opened, never the original.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { convertChromiumHistoryRows, HISTORY_LIMIT, mergeHistory } from "./history";
import type { HistoryEntry } from "./history";

const execFileAsync = promisify(execFile);

/** The sqlite3 command line tool that ships with macOS. */
const SQLITE_COMMAND = "/usr/bin/sqlite3";

export const USER_DATA_FOLDER_NAME = "User Data";
const HISTORY_FILE_NAME = "History";
/** Files SQLite keeps next to the database; recent visits may only be in them. */
const HISTORY_COMPANION_FILE_NAMES = ["History-wal", "History-journal"];

/** At most this many rows are read per profile: the newest ones, as many as our history can hold. */
const ROWS_PER_PROFILE_LIMIT = HISTORY_LIMIT;

/** `hidden = 0` leaves out addresses Chromium keeps for internal use (such as subframes). */
const HISTORY_QUERY = `SELECT url, title, visit_count, last_visit_time FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ${ROWS_PER_PROFILE_LIMIT};`;

/** Room for the JSON of the rows above (a few MB) with a wide margin. */
const SQLITE_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

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
async function readProfileHistory(profileFolder: string): Promise<HistoryEntry[]> {
  const temporaryFolder = fs.mkdtempSync(path.join(os.tmpdir(), "arc-history-"));
  try {
    for (const fileName of [HISTORY_FILE_NAME, ...HISTORY_COMPANION_FILE_NAMES]) {
      const sourcePath = path.join(profileFolder, fileName);
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, path.join(temporaryFolder, fileName));
      }
    }
    const copiedHistoryPath = path.join(temporaryFolder, HISTORY_FILE_NAME);
    const queryResult = await execFileAsync(SQLITE_COMMAND, ["-readonly", "-json", copiedHistoryPath, HISTORY_QUERY], {
      maxBuffer: SQLITE_MAX_OUTPUT_BYTES,
    });
    // sqlite3 prints nothing at all (not "[]") when the query finds no rows.
    const outputText = queryResult.stdout.trim();
    if (outputText === "") {
      return [];
    }
    const rows: unknown = JSON.parse(outputText);
    return convertChromiumHistoryRows(rows);
  } finally {
    fs.rmSync(temporaryFolder, { recursive: true, force: true });
  }
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
