/**
 * WHY this file exists:
 *   Arc, Chrome, Dia, Brave, Edge, Vivaldi, Opera and Chromium keep their saved logins in a SQLite file per profile.
 *   Counting them (for the import's summary) needs no secret; reading them needs the browser's key. This file does
 *   both, and hands back the same shape the CSV import uses, so one merge (passwordCsv.ts) serves every way in.
 *
 * Data source:
 *   `<profile folder>/Login Data` and, in newer Chrome, `Login Data For Account` (same table `logins`: origin_url,
 *   username_value, password_value, blacklisted_by_user). The browser may be running, so only copies are read.
 *
 * Data flow:
 *   chromiumPasswordsImport.ts → countChromiumLogins(profileFolder) → numbers for the summary
 *   chromiumPasswordsImport.ts → readChromiumLogins(profileFolder, key) → querySqliteCopy() → decryptChromiumPassword()
 *   → CsvLogin[] + never-save sites → mergeImportedLogins()
 *
 * Rules: never throws (a file that cannot be read is skipped with a warning that holds no login data). Passwords stay
 * in memory; nothing here logs a site, a name or a password.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { decryptChromiumPassword } from "./chromiumPasswordCrypto";
import { MAX_LOGIN_FIELD_LENGTH, normalizeLoginOrigin, siteKeyFor } from "./passwords";
import type { CsvLogin } from "./passwordCsv";
import { SQLITE_COMMAND, querySqliteCopy } from "./sqliteCopy";

/** The logins of the profile, and (Chrome with a signed-in account) the ones that belong to the account. */
export const LOGIN_DATA_FILE_NAMES = ["Login Data", "Login Data For Account"];

/** `blacklisted_by_user = 1` is Chromium's "Never save for this site"; those rows hold no password. */
const COUNT_QUERY = "SELECT origin_url, username_value FROM logins WHERE blacklisted_by_user = 0 AND length(password_value) > 0;";

/** The blob comes out as hex, because sqlite3's JSON cannot hold raw bytes. */
const READ_QUERY = "SELECT origin_url, username_value, hex(password_value) AS password_hex, blacklisted_by_user FROM logins;";

/** What readChromiumLogins found in a profile. */
export interface ChromiumLoginsRead {
  logins: CsvLogin[];
  /** Sites the user told the browser never to save passwords for. */
  neverSaveOrigins: string[];
  /** Logins that could not be decrypted (another key, another encryption); counted, never imported. */
  unreadableCount: number;
}

interface LoginRow {
  originUrl: string;
  username: string;
  passwordHex: string;
  isNeverSave: boolean;
}

/** Sites and names are told apart the way the vault tells them apart (www ignored, stray spaces ignored). */
function loginKey(origin: string, username: string): string {
  return `${siteKeyFor(origin)}\n${username.trim()}`;
}

function toLoginRow(rawRow: unknown): LoginRow | null {
  if (typeof rawRow !== "object" || rawRow === null) {
    return null;
  }
  const fields = rawRow as Record<string, unknown>;
  const originUrl = fields["origin_url"];
  const username = fields["username_value"];
  const passwordHex = fields["password_hex"];
  const neverSaveFlag = fields["blacklisted_by_user"];
  if (typeof originUrl !== "string" || typeof username !== "string") {
    return null;
  }
  return {
    originUrl: originUrl,
    username: username,
    passwordHex: typeof passwordHex === "string" ? passwordHex : "",
    isNeverSave: neverSaveFlag === 1,
  };
}

/**
 * Runs a query on each login file a profile has. A file that cannot be read is skipped.
 */
async function queryLoginFiles(profileFolder: string, sql: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (const fileName of LOGIN_DATA_FILE_NAMES) {
    if (!fs.existsSync(path.join(profileFolder, fileName))) {
      continue;
    }
    try {
      rows.push(...(await querySqliteCopy(profileFolder, fileName, sql)));
    } catch {
      // No details: the error text could hold a path or part of a query result.
      console.warn(`Could not read ${fileName} in a browser profile; skipping it.`);
    }
  }
  return rows;
}

/**
 * How many different logins (site and username) a profile has saved, for the import's summary. Needs no secret.
 * Zero when sqlite3 is missing or the files cannot be read.
 */
export async function countChromiumLogins(profileFolder: string): Promise<number> {
  if (!fs.existsSync(SQLITE_COMMAND)) {
    return 0;
  }
  const rows = await queryLoginFiles(profileFolder, COUNT_QUERY);
  const distinctKeys = new Set<string>();
  for (const rawRow of rows) {
    const row = toLoginRow(rawRow);
    const origin = row === null ? null : normalizeLoginOrigin(row.originUrl);
    if (row !== null && origin !== null) {
      distinctKeys.add(loginKey(origin, row.username));
    }
  }
  return distinctKeys.size;
}

/**
 * Reads and decrypts a profile's logins with the browser's key. Where two files hold the same site and username, the
 * first wins (the profile's own file before the account's).
 */
export async function readChromiumLogins(profileFolder: string, key: Buffer): Promise<ChromiumLoginsRead> {
  const result: ChromiumLoginsRead = { logins: [], neverSaveOrigins: [], unreadableCount: 0 };
  if (!fs.existsSync(SQLITE_COMMAND)) {
    return result;
  }
  const rows = await queryLoginFiles(profileFolder, READ_QUERY);
  const seenKeys = new Set<string>();
  for (const rawRow of rows) {
    const row = toLoginRow(rawRow);
    const origin = row === null ? null : normalizeLoginOrigin(row.originUrl);
    if (row === null || origin === null) {
      continue;
    }
    if (row.isNeverSave) {
      result.neverSaveOrigins.push(origin);
      continue;
    }
    // Federated logins ("Sign in with ...") are saved without a password.
    if (row.passwordHex === "") {
      continue;
    }
    const password = decryptChromiumPassword(Buffer.from(row.passwordHex, "hex"), key);
    if (password === null) {
      result.unreadableCount++;
      continue;
    }
    const username = row.username.trim();
    const isUsable = password !== "" && username.length <= MAX_LOGIN_FIELD_LENGTH && password.length <= MAX_LOGIN_FIELD_LENGTH;
    const rowKey = loginKey(origin, username);
    if (!isUsable || seenKeys.has(rowKey)) {
      continue;
    }
    seenKeys.add(rowKey);
    result.logins.push({ origin: origin, username: username, password: password });
  }
  return result;
}
