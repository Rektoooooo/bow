/**
 * WHY this file exists:
 *   Chromium browsers keep history and saved logins in SQLite databases that the browser may hold open while Bow reads
 *   them. Both importers need the same careful read: open only a copy (with the files SQLite keeps next to it), through
 *   the sqlite3 tool that ships with macOS, and always clean the copy up.
 *
 * Data source:
 *   A database file inside a folder, for example Arc's `User Data/Default/History` or a profile's `Login Data`.
 *
 * Data flow:
 *   arcHistoryImport.ts / chromiumPasswords.ts → querySqliteCopy(folder, fileName, sql) → copy to a temporary folder
 *   → /usr/bin/sqlite3 -readonly -json → the parsed rows
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The sqlite3 command line tool that ships with macOS. */
export const SQLITE_COMMAND = "/usr/bin/sqlite3";

/** Files SQLite keeps next to a database (named after it); recent changes may only be in them. */
const COMPANION_FILE_SUFFIXES = ["-wal", "-journal"];

/** Room for the JSON of the rows (a few MB) with a wide margin. */
const SQLITE_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

const TEMPORARY_FOLDER_PREFIX = "bow-sqlite-";

/**
 * Runs one query on a copy of `folder/fileName` and returns its rows (an empty list when there are none). Throws when
 * the copy or the query fails. The original is never opened, and the copy is deleted afterwards.
 */
export async function querySqliteCopy(folder: string, fileName: string, sql: string): Promise<unknown[]> {
  const temporaryFolder = fs.mkdtempSync(path.join(os.tmpdir(), TEMPORARY_FOLDER_PREFIX));
  try {
    const fileNames = [fileName, ...COMPANION_FILE_SUFFIXES.map((suffix) => `${fileName}${suffix}`)];
    for (const name of fileNames) {
      const sourcePath = path.join(folder, name);
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, path.join(temporaryFolder, name));
      }
    }
    const copiedPath = path.join(temporaryFolder, fileName);
    const queryResult = await execFileAsync(SQLITE_COMMAND, ["-readonly", "-json", copiedPath, sql], {
      maxBuffer: SQLITE_MAX_OUTPUT_BYTES,
    });
    // sqlite3 prints nothing at all (not "[]") when the query finds no rows.
    const outputText = queryResult.stdout.trim();
    if (outputText === "") {
      return [];
    }
    const rows: unknown = JSON.parse(outputText);
    return Array.isArray(rows) ? rows : [];
  } finally {
    fs.rmSync(temporaryFolder, { recursive: true, force: true });
  }
}
