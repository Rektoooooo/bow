/**
 * WHY this file exists:
 *   People switching to Bow bring their passwords as the CSV file their old browser or password manager exports.
 *   These pure functions read that text (the file format has a few traps: quoted commas, newlines inside quotes,
 *   a byte order mark) and merge the logins into the vault without ever overwriting what Bow already holds.
 *
 * Data source:
 *   The text of a CSV file the user picked. Column names differ per program (see the alias lists below).
 *
 * Data flow:
 *   file text → parseCsv() → readLoginsFromCsv() → CsvLogin[] → mergeImportedLogins() → new vault + counts for the user
 */
import {
  findLoginForSiteAndUsername,
  MAX_LOGIN_FIELD_LENGTH,
  MAX_SAVED_LOGINS,
  normalizeLoginOrigin,
  type PasswordVault,
  type SavedLogin,
} from "./passwords";

/**
 * Header names (compared lower case) for the address column. Chrome, Arc, Dia, Brave, Edge, Vivaldi and Opera write
 * "url"; Safari and the macOS Passwords app "URL"; Firefox "url"; Bitwarden "login_uri"; others "website" and the rest.
 */
const URL_COLUMN_NAMES = ["url", "website", "login_uri", "login uri", "origin", "web site", "hostname"];

/** Header names for the username column: "username" (Chrome family, Safari, Firefox), "login_username" (Bitwarden), … */
const USERNAME_COLUMN_NAMES = ["username", "login_username", "login", "user", "email", "user name"];

/** Header names for the password column: "password" (all browsers) and "login_password" (Bitwarden). */
const PASSWORD_COLUMN_NAMES = ["password", "login_password"];

/** Some programs start the file with this invisible character (UTF-8 byte order mark). */
const BYTE_ORDER_MARK = "\uFEFF";

const QUOTE = '"';
const SEPARATOR = ",";
const LINE_FEED = "\n";
const CARRIAGE_RETURN = "\r";

interface CsvReaderState {
  rows: string[][];
  row: string[];
  field: string;
  isInsideQuotes: boolean;
  /** A quoted empty field ("") still counts as content, so its row is not a blank line. */
  rowHasQuotedField: boolean;
}

function finishField(state: CsvReaderState): void {
  state.row.push(state.field);
  state.field = "";
}

function finishRow(state: CsvReaderState): void {
  const isBlankLine = state.row.length === 0 && state.field === "" && !state.rowHasQuotedField;
  if (!isBlankLine) {
    finishField(state);
    state.rows.push(state.row);
  }
  state.row = [];
  state.field = "";
  state.rowHasQuotedField = false;
}

/** Reads one character inside quotes; returns the index of the last character used (a doubled quote uses two). */
function readQuotedCharacter(state: CsvReaderState, text: string, index: number): number {
  const character = text[index];
  if (character !== QUOTE) {
    state.field += character;
    return index;
  }
  if (text[index + 1] === QUOTE) {
    state.field += QUOTE;
    return index + 1;
  }
  state.isInsideQuotes = false;
  return index;
}

/** Reads one character outside quotes; returns the index of the last character used (CR LF uses two). */
function readPlainCharacter(state: CsvReaderState, text: string, index: number): number {
  const character = text[index];
  if (character === QUOTE) {
    state.isInsideQuotes = true;
    state.rowHasQuotedField = true;
    return index;
  }
  if (character === SEPARATOR) {
    finishField(state);
    return index;
  }
  if (character === CARRIAGE_RETURN) {
    finishRow(state);
    return text[index + 1] === LINE_FEED ? index + 1 : index;
  }
  if (character === LINE_FEED) {
    finishRow(state);
    return index;
  }
  state.field += character;
  return index;
}

/** RFC 4180: comma separated, quoted fields may hold commas, line breaks and doubled quotes. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const content = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
  const state: CsvReaderState = { rows: [], row: [], field: "", isInsideQuotes: false, rowHasQuotedField: false };
  for (let index = 0; index < content.length; index++) {
    index = state.isInsideQuotes
      ? readQuotedCharacter(state, content, index)
      : readPlainCharacter(state, content, index);
  }
  finishRow(state);
  return state.rows;
}

export interface CsvLogin {
  origin: string;
  username: string;
  password: string;
}

export interface CsvReadResult {
  isRecognized: boolean;
  logins: CsvLogin[];
  skippedCount: number;
}

/** The first column whose header matches a name; earlier names win. -1 when there is none. */
function findColumn(header: readonly string[], names: readonly string[]): number {
  for (const name of names) {
    const index = header.indexOf(name);
    if (index >= 0) {
      return index;
    }
  }
  return -1;
}

function readCell(row: readonly string[], columnIndex: number): string {
  return columnIndex < 0 ? "" : (row[columnIndex] ?? "");
}

/** Reads the logins out of an exported file. Rows without a web address or password are counted, not imported. */
export function readLoginsFromCsv(text: string): CsvReadResult {
  const unrecognized: CsvReadResult = { isRecognized: false, logins: [], skippedCount: 0 };
  const [headerRow, ...dataRows] = parseCsv(text);
  if (!headerRow) {
    return unrecognized;
  }
  const header = headerRow.map((name) => name.trim().toLowerCase());
  const urlColumn = findColumn(header, URL_COLUMN_NAMES);
  const usernameColumn = findColumn(header, USERNAME_COLUMN_NAMES);
  const passwordColumn = findColumn(header, PASSWORD_COLUMN_NAMES);
  if (urlColumn < 0 || passwordColumn < 0) {
    return unrecognized;
  }
  const logins: CsvLogin[] = [];
  let skippedCount = 0;
  for (const row of dataRows) {
    const origin = normalizeLoginOrigin(readCell(row, urlColumn).trim());
    const username = readCell(row, usernameColumn).trim();
    const password = readCell(row, passwordColumn);
    const isUsable =
      origin !== null &&
      password !== "" &&
      username.length <= MAX_LOGIN_FIELD_LENGTH &&
      password.length <= MAX_LOGIN_FIELD_LENGTH;
    if (!isUsable) {
      skippedCount++;
      continue;
    }
    logins.push({ origin, username, password });
  }
  return { isRecognized: true, logins, skippedCount };
}

export interface ImportMergeResult {
  vault: PasswordVault;
  addedCount: number;
  alreadySavedCount: number;
  keptDifferentCount: number;
  skippedCount: number;
}

/**
 * Adds imported logins. A login Bow already has for the same site and username is never changed: when the password
 * differs, the user signed in again in Bow later, so Bow's copy is the newer one. At the limit the rest are skipped,
 * because an import must not push out logins the user already has.
 */
export function mergeImportedLogins(
  vault: PasswordVault,
  logins: readonly CsvLogin[],
  makeId: () => string,
  now: number,
): ImportMergeResult {
  const mergedLogins: SavedLogin[] = [...vault.logins];
  let addedCount = 0;
  let alreadySavedCount = 0;
  let keptDifferentCount = 0;
  let skippedCount = 0;
  for (const login of logins) {
    const existing = findLoginForSiteAndUsername(mergedLogins, login.origin, login.username);
    if (existing) {
      const isSamePassword = existing.password === login.password;
      alreadySavedCount += isSamePassword ? 1 : 0;
      keptDifferentCount += isSamePassword ? 0 : 1;
      continue;
    }
    if (mergedLogins.length >= MAX_SAVED_LOGINS) {
      skippedCount++;
      continue;
    }
    mergedLogins.push({ id: makeId(), ...login, createdAt: now, changedAt: now });
    addedCount++;
  }
  const mergedVault = addedCount === 0 ? vault : { ...vault, logins: mergedLogins };
  return { vault: mergedVault, addedCount, alreadySavedCount, keptDifferentCount, skippedCount };
}
