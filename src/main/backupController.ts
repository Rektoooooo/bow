/**
 * WHY this file exists:
 *   File › Export Bow Backup… and Restore from Backup…: the parts of backups that need the Mac (dialogs and files).
 *   backup.ts builds and checks backups; this file reads the Notes and Easels the tabs use, asks where to save or
 *   which file to restore, asks whether to replace the setup or add the backup's Spaces, keeps a copy of the current
 *   setup before replacing it, and writes the restored Notes and Easels.
 *
 * Data source:
 *   The state (browserCore.ts), the Notes and Easels files (notesStore.ts, easelsStore.ts), the file the user picks.
 *
 * Data flow:
 *   Export → buildBackupNow() → save dialog → file
 *   Restore → open dialog (Bow's Backups folder) → parseBackup() → question → saveSnapshot("Before Restore") →
 *   Notes/Easels written → applyChange(replaceFromBackup | addSpacesFromBackup)
 *   Every SNAPSHOT_INTERVAL_MS with changes since the last copy → saveSnapshot("Snapshot") → old copies pruned
 *   (chooseSnapshotsToDelete in backup.ts)
 */
import { app, dialog, shell } from "electron";
import type { MessageBoxOptions, OpenDialogOptions, SaveDialogOptions } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { addSpacesFromBackup, chooseSnapshotsToDelete, collectNoteAndEaselIds, createBackup, parseBackup, replaceFromBackup } from "./backup";
import type { BackupReport, BowBackup, CheckedBackup, SnapshotFile } from "./backup";
import { applyChange, getState, getWindow, onStateChanged } from "./browserCore";
import { SNAPSHOT_INTERVAL_MS } from "../shared/settings";
import { readEasel, writeEasel } from "./easelsStore";
import { readNote, writeNote } from "./notesStore";

/** A backup file's extension. Its content is JSON (docs/backup-format.md). */
export const BACKUP_FILE_EXTENSION = "bowbackup";

/** Where Bow keeps its own backups (the copy before a restore, and the automatic snapshots). */
const BACKUPS_FOLDER_NAME = "Backups";

/** Largest backup file Bow reads. Our choice: Easels with many pictures stay far below it; bounds a crafted file. */
const MAX_BACKUP_FILE_BYTES = 500 * 1024 * 1024;

/** How Bow's own copies are named: "Snapshot 2026-10-28 14.05.09.bowbackup", "Before Restore …". */
const SNAPSHOT_LABEL = "Snapshot";
const BEFORE_RESTORE_LABEL = "Before Restore";

/**
 * Tests take snapshots every few seconds: `--snapshot-interval-ms=2000`. Like --skip-welcome, only whoever starts
 * the app can pass it.
 */
const SNAPSHOT_INTERVAL_FLAG = "--snapshot-interval-ms=";
const MIN_SNAPSHOT_INTERVAL_MS = 1000;

/** True when the state, a Note or an Easel changed since the last automatic copy. */
let hasChangesSinceSnapshot = false;

/** The buttons of the restore question, in order. */
const REPLACE_BUTTON_INDEX = 0;
const ADD_BUTTON_INDEX = 1;
const CANCEL_BUTTON_INDEX = 2;

/**
 * A backup of everything now: the state and the Notes and Easels its tabs use.
 */
export function buildBackupNow(now: number): BowBackup {
  const state = getState();
  const used = collectNoteAndEaselIds(state);
  const notes: Record<string, string> = {};
  for (const noteId of used.noteIds) {
    const html = readNote(noteId);
    if (html !== "") {
      notes[noteId] = html;
    }
  }
  const easels: Record<string, string> = {};
  for (const easelId of used.easelIds) {
    const json = readEasel(easelId);
    if (json !== "") {
      easels[easelId] = json;
    }
  }
  return createBackup(state, notes, easels, now, app.getVersion());
}

/**
 * Writes a backup to a file: first to a temporary file next to it, then renamed, so a crash never leaves half a file.
 */
export function writeBackupFile(filePath: string, backup: BowBackup): void {
  const temporaryPath = `${filePath}.writing`;
  fs.writeFileSync(temporaryPath, JSON.stringify(backup, null, 1));
  fs.renameSync(temporaryPath, filePath);
}

/**
 * The folder of Bow's own backups.
 */
export function getBackupsFolder(): string {
  return path.join(app.getPath("userData"), BACKUPS_FOLDER_NAME);
}

/**
 * A date and time for file names: 2026-10-28 14.05.09 (no colons, which Finder shows as slashes).
 */
function formatFileTime(now: number): string {
  const iso = new Date(now).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19).replaceAll(":", ".")}`;
}

/**
 * Keeps a copy of the setup now in Bow's Backups folder, named after why it was taken. Returns its path, or null when
 * it could not be written (a full disk): a restore then does not go ahead.
 */
export function saveSnapshot(label: string, now: number): string | null {
  try {
    const folder = getBackupsFolder();
    fs.mkdirSync(folder, { recursive: true });
    const filePath = path.join(folder, `${label} ${formatFileTime(now)}.${BACKUP_FILE_EXTENSION}`);
    writeBackupFile(filePath, buildBackupNow(now));
    return filePath;
  } catch (error) {
    console.error("Could not keep a backup of the current setup:", error);
    return null;
  }
}

/**
 * Shows a save dialog over the focused window (or on its own without one).
 */
async function askWhereToSave(options: SaveDialogOptions): Promise<string | null> {
  const window = getWindow();
  const result = window === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(window, options);
  return result.canceled || result.filePath === undefined ? null : result.filePath;
}

/**
 * Shows an open dialog over the focused window (or on its own without one).
 */
async function askWhichFile(options: OpenDialogOptions): Promise<string | null> {
  const window = getWindow();
  const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/**
 * Shows a message over the focused window and returns the button chosen.
 */
async function ask(options: MessageBoxOptions): Promise<number> {
  const window = getWindow();
  const result = window === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(window, options);
  return result.response;
}

/**
 * File › Export Bow Backup…: everything to one file the user names (Documents by default).
 */
export async function exportBackup(): Promise<void> {
  const now = Date.now();
  const filePath = await askWhereToSave({
    title: "Export Bow Backup",
    defaultPath: path.join(app.getPath("documents"), `Bow Backup ${formatFileTime(now).slice(0, 10)}.${BACKUP_FILE_EXTENSION}`),
    filters: [{ name: "Bow Backup", extensions: [BACKUP_FILE_EXTENSION] }],
  });
  if (filePath === null) {
    return;
  }
  writeBackupFile(filePath, buildBackupNow(now));
}

/**
 * A count with its word, singular or plural: count(1, "Note") → "1 Note", count(3, "Note") → "3 Notes".
 */
function count(amount: number, word: string): string {
  return `${amount} ${amount === 1 ? word : `${word}s`}`;
}

/**
 * What a backup holds and what will change, in words for the restore question.
 */
export function describeBackup(report: BackupReport): string {
  const madeOn = report.createdAt === "" ? "" : ` from ${new Date(report.createdAt).toLocaleString()}`;
  const tabs = `${report.pinnedTabs} pinned and ${count(report.todayTabs, "Today tab")}`;
  const extras = [count(report.favorites, "Favorite"), count(report.notes, "Note"), count(report.easels, "Easel"), count(report.boosts, "Boost")];
  const lines = [
    `This backup${madeOn} has ${count(report.spaces, "Space")} with ${tabs}, ${extras.slice(0, -1).join(", ")} and ${extras.at(-1)}.`,
    "Replace My Setup puts it in place of your Spaces and tabs (Bow keeps a copy of them first, in its Backups folder). Add Its Spaces puts its Spaces next to yours.",
  ];
  if (report.scriptsTurnedOff > 0) {
    const verb = report.scriptsTurnedOff === 1 ? "arrives" : "arrive";
    lines.push(`${count(report.scriptsTurnedOff, "Boost")} with JavaScript ${verb} switched off. Turn it on in Library › Boosts once you trust it.`);
  }
  if (report.extensionNames.length > 0) {
    lines.push(`Extensions are not in a backup. Install these again if this Mac doesn't have them: ${report.extensionNames.join(", ")}.`);
  }
  if (report.leftOut > 0) {
    lines.push(`${report.leftOut === 1 ? "1 damaged or unsafe entry" : `${report.leftOut} damaged or unsafe entries`} will be left out.`);
  }
  return lines.join("\n\n");
}

/**
 * Writes the restored Notes and Easels (under the ids the restored tabs use).
 */
function writeRestoredFiles(backup: CheckedBackup, noteIds: Record<string, string>, easelIds: Record<string, string>): void {
  for (const [backupNoteId, html] of Object.entries(backup.notes)) {
    writeNote(noteIds[backupNoteId] ?? backupNoteId, html);
  }
  for (const [backupEaselId, json] of Object.entries(backup.easels)) {
    writeEasel(easelIds[backupEaselId] ?? backupEaselId, json);
  }
}

/**
 * Restores a checked backup: replacing the setup (after keeping a copy of it) or adding the backup's Spaces. The Notes
 * and Easels are written before the tabs that show them appear, so an editor never opens an empty one.
 */
export function applyBackup(backup: CheckedBackup, mode: "replace" | "add", now: number): boolean {
  if (mode === "replace") {
    if (saveSnapshot(BEFORE_RESTORE_LABEL, now) === null) {
      return false;
    }
    pruneSnapshots();
    writeRestoredFiles(backup, {}, {});
    applyChange((state) => replaceFromBackup(state, backup.state));
    return true;
  }
  const added = addSpacesFromBackup(getState(), backup.state, now);
  writeRestoredFiles(backup, added.noteIds, added.easelIds);
  applyChange(() => added.state);
  return true;
}

/**
 * Reads and checks a backup file. Returns the backup, or the reason it cannot be restored.
 */
export function readBackupFile(filePath: string): { backup: CheckedBackup } | { error: string } {
  try {
    const size = fs.statSync(filePath).size;
    if (size > MAX_BACKUP_FILE_BYTES) {
      return { error: "This file is too large to be a Bow backup." };
    }
    const result = parseBackup(fs.readFileSync(filePath, "utf8"));
    return result.isValid ? { backup: result.backup } : { error: result.error };
  } catch {
    return { error: "This file could not be read." };
  }
}

/**
 * File › Restore from Backup…: pick a file, see what it holds, then replace the setup or add its Spaces.
 */
export async function restoreBackup(): Promise<void> {
  const backupsFolder = getBackupsFolder();
  const filePath = await askWhichFile({
    title: "Restore from Backup",
    // Bow's own copies are the most likely ones to restore.
    defaultPath: fs.existsSync(backupsFolder) ? backupsFolder : app.getPath("documents"),
    properties: ["openFile"],
    filters: [{ name: "Bow Backup", extensions: [BACKUP_FILE_EXTENSION, "json"] }],
  });
  if (filePath === null) {
    return;
  }
  const read = readBackupFile(filePath);
  if ("error" in read) {
    await ask({ type: "warning", message: "This backup can't be restored", detail: read.error });
    return;
  }
  const choice = await ask({
    type: "question",
    message: "Restore this backup?",
    detail: describeBackup(read.backup.report),
    buttons: ["Replace My Setup", "Add Its Spaces", "Cancel"],
    defaultId: ADD_BUTTON_INDEX,
    cancelId: CANCEL_BUTTON_INDEX,
  });
  if (choice !== REPLACE_BUTTON_INDEX && choice !== ADD_BUTTON_INDEX) {
    return;
  }
  const isRestored = applyBackup(read.backup, choice === REPLACE_BUTTON_INDEX ? "replace" : "add", Date.now());
  if (!isRestored) {
    await ask({ type: "warning", message: "Nothing was restored", detail: "Bow could not keep a copy of your current setup first (is the disk full?), so it left everything as it was." });
  }
}

// ---------- Automatic snapshots ----------

/**
 * Notes and Easels are saved to files, not to the state: their saves say so here (main.ts).
 */
export function markSnapshotNeeded(): void {
  hasChangesSinceSnapshot = true;
}

/**
 * How often to take automatic copies: SNAPSHOT_INTERVAL_MS, or the test flag's value.
 */
function readSnapshotInterval(): number {
  const flag = process.argv.find((argument) => argument.startsWith(SNAPSHOT_INTERVAL_FLAG));
  const fromFlag = flag === undefined ? Number.NaN : Number(flag.slice(SNAPSHOT_INTERVAL_FLAG.length));
  return Number.isFinite(fromFlag) ? Math.max(fromFlag, MIN_SNAPSHOT_INTERVAL_MS) : SNAPSHOT_INTERVAL_MS;
}

/**
 * Bow's own copies in its Backups folder, with when each was written.
 */
function listSnapshotFiles(): SnapshotFile[] {
  const folder = getBackupsFolder();
  if (!fs.existsSync(folder)) {
    return [];
  }
  const files: SnapshotFile[] = [];
  for (const name of fs.readdirSync(folder)) {
    if (!name.endsWith(`.${BACKUP_FILE_EXTENSION}`)) {
      continue;
    }
    const takenAt = fs.statSync(path.join(folder, name)).mtimeMs;
    if (name.startsWith(BEFORE_RESTORE_LABEL)) {
      files.push({ name: name, kind: "beforeRestore", takenAt: takenAt });
    }
    if (name.startsWith(SNAPSHOT_LABEL)) {
      files.push({ name: name, kind: "snapshot", takenAt: takenAt });
    }
  }
  return files;
}

/**
 * Deletes the copies chooseSnapshotsToDelete says are no longer needed.
 */
function pruneSnapshots(): void {
  for (const name of chooseSnapshotsToDelete(listSnapshotFiles())) {
    fs.rmSync(path.join(getBackupsFolder(), name), { force: true });
  }
}

/**
 * Takes an automatic copy when something changed since the last one and the setting is on.
 */
function takeAutomaticSnapshot(): void {
  if (!hasChangesSinceSnapshot || getState().settings.areSnapshotsOn === false) {
    return;
  }
  hasChangesSinceSnapshot = false;
  if (saveSnapshot(SNAPSHOT_LABEL, Date.now()) !== null) {
    pruneSnapshots();
  }
}

/**
 * Starts the automatic copies (once, at startup).
 */
export function startAutomaticSnapshots(): void {
  onStateChanged(() => markSnapshotNeeded());
  setInterval(takeAutomaticSnapshot, readSnapshotInterval());
}

/**
 * Library › Settings › Show Backups: the Backups folder in Finder.
 */
export function revealBackupsFolder(): void {
  const folder = getBackupsFolder();
  fs.mkdirSync(folder, { recursive: true });
  shell.openPath(folder).catch(() => undefined);
}
