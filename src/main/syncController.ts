/**
 * WHY this file exists:
 *   Library › Settings › Sync: the parts of folder sync that need the Mac. sync.ts decides what changed and how two
 *   Macs' setups merge; this file keeps this Mac's id, its sync bookkeeping and the chosen folder, writes this Mac's
 *   file there a moment after a synced part changes, reads the other Macs' files when the folder changes (and every
 *   minute, for folders whose changes macOS does not report), and applies what wins. All file work on the sync folder
 *   is asynchronous with a time limit, so a slow or missing network drive never freezes the window.
 *
 * Data source:
 *   The state (browserCore.ts), the Notes and Easels files (notesStore.ts, easelsStore.ts), `Sync.json` in Bow's
 *   own folder (device id, folder, bookkeeping), and the files in the sync folder.
 *
 * Data flow:
 *   state / Note / Easel change → scheduleWrite() → stampLocalChanges → buildSyncPayload → <folder>/<deviceId>.json
 *   folder changes or the poll → readPeers() → parseSyncPayload → stamp local changes first → mergePeer →
 *   Notes/Easels written → applyChange → open editors of changed Notes/Easels reload
 *   Choose Folder… → the other Macs' files read → (if any) question → "Before Sync" backup → join → merge → write
 */
import { app, dialog, shell } from "electron";
import type { MessageBoxOptions, OpenDialogOptions } from "electron";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { saveSnapshot } from "./backupController";
import { applyChange, getState, getWindow, onStateChanged, sendSidebarCommandToAllWindows } from "./browserCore";
import { readEasel, writeEasel } from "./easelsStore";
import { readNote, writeNote } from "./notesStore";
import { DEVICE_ID_PATTERN, buildSyncPayload, collectSyncedItemIds, collectUnits, createSyncMeta, mergePeer, parseSyncPayload, stampLocalChanges } from "./sync";
import type { SyncMeta, SyncPayload } from "./sync";
import { getEaselId } from "../shared/easels";
import { getNoteId } from "../shared/notes";
import type { SyncStatusData } from "../shared/overlay";
import { SYNC_FILE_TIMEOUT_MS, SYNC_POLL_MS, SYNC_READ_DELAY_MS, SYNC_WRITE_DELAY_MS } from "../shared/settings";

/** Where this Mac keeps its sync settings and bookkeeping, in Bow's own folder. */
const SYNC_SETTINGS_FILE_NAME = "Sync.json";

/** The folder Bow makes inside the folder the user picks (unless they pick one with this name). */
const SYNC_FOLDER_NAME = "Bow Sync";

/** The label of the copy kept before joining other Macs (backupController.ts names the file). */
const BEFORE_SYNC_LABEL = "Before Sync";

/** Largest sync file Bow reads. Our choice, like backups: Easels with pictures stay far below it. */
const MAX_SYNC_FILE_BYTES = 500 * 1024 * 1024;

/** iCloud Drive leaves ".name.json.icloud" in place of a file it has not downloaded yet. */
const ICLOUD_PLACEHOLDER_SUFFIX = ".icloud";

/** macOS's iCloud Drive tool; `brctl download <path>` asks for a file to be downloaded. */
const ICLOUD_TOOL_PATH = "/usr/bin/brctl";

/** macOS's settings tool; `scutil --get ComputerName` prints the name System Settings › General › About shows. */
const SETTINGS_TOOL_PATH = "/usr/sbin/scutil";

/**
 * Tests read the folder every half second: `--sync-poll-ms=500`. Like --skip-welcome, only whoever starts the app
 * can pass it.
 */
const SYNC_POLL_FLAG = "--sync-poll-ms=";
const MIN_SYNC_POLL_MS = 200;

/** The buttons of the join question, in order. */
const JOIN_BUTTON_INDEX = 0;
const CANCEL_JOIN_BUTTON_INDEX = 1;

/** What Sync.json holds. */
interface SyncSettingsFile {
  deviceId: string;
  folderPath: string | null;
  meta: SyncMeta | null;
}

/** This Mac's id, chosen once. */
let deviceId = "";

/** This Mac's name as people know it, read once. */
let deviceName: string | null = null;

/** The sync folder, or null when sync is off. */
let folderPath: string | null = null;

/** The bookkeeping (sync.ts). */
let meta: SyncMeta | null = null;

/**
 * The stamps and deletions this Mac's file was last written with. The same objects mean it has nothing new to say:
 * merging a peer that brought nothing keeps them (sync.ts), so two Macs never answer each other forever.
 */
let writtenStamps: SyncMeta["stamps"] | null = null;
let writtenTombstones: SyncMeta["tombstones"] | null = null;

/** Notes and Easels as last read or saved, so a change check doesn't read every file again. */
const noteTexts = new Map<string, string>();
const easelTexts = new Map<string, string>();

/** Each peer file's modification time when last read, so an unchanged file is not read again. */
const peerFileTimes = new Map<string, number>();

/** The other Macs whose files were read: their names, by device id. */
const peerNames = new Map<string, string>();

/** What the Library shows. */
let lastSyncAt: number | null = null;
let conflictCount = 0;

/** What went wrong, by cause: the folder could not be read, this Mac's file could not be written, peer files. */
let folderProblem: string | null = null;
let writeProblem: string | null = null;
const unreadableFiles = new Set<string>();

/** The problem the Library was last told about. */
let reportedProblem: string | null = null;

/** Timers and guards: one write and one read at a time; a request during one runs once it ends. */
let writeTimer: NodeJS.Timeout | null = null;
let readTimer: NodeJS.Timeout | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let folderWatcher: fs.FSWatcher | null = null;
let isWriting = false;
let isWriteRequested = false;
let isReading = false;
let isReadRequested = false;

/** Tells the Library the status changed (main.ts passes refreshOpenPanel). */
let reportStatusChanged: () => void = () => undefined;

// ---------- Settings file ----------

function getSettingsFilePath(): string {
  return path.join(app.getPath("userData"), SYNC_SETTINGS_FILE_NAME);
}

/**
 * Reads Sync.json, or starts fresh with a new device id when there is none or it can't be read.
 */
function loadSettings(): void {
  try {
    const parsed = JSON.parse(fs.readFileSync(getSettingsFilePath(), "utf8")) as Partial<SyncSettingsFile>;
    const isDeviceIdValid = typeof parsed.deviceId === "string" && DEVICE_ID_PATTERN.test(parsed.deviceId);
    deviceId = isDeviceIdValid ? (parsed.deviceId as string) : randomUUID();
    folderPath = typeof parsed.folderPath === "string" ? parsed.folderPath : null;
    const hasMeta = parsed.meta !== null && typeof parsed.meta === "object" && parsed.meta.deviceId === deviceId;
    meta = hasMeta ? (parsed.meta as SyncMeta) : null;
  } catch {
    deviceId = randomUUID();
    folderPath = null;
    meta = null;
  }
}

/**
 * Writes Sync.json (to a temporary file first, then renamed, so a crash never leaves half a file).
 */
function saveSettings(): void {
  const contents: SyncSettingsFile = { deviceId: deviceId, folderPath: folderPath, meta: meta };
  const filePath = getSettingsFilePath();
  try {
    fs.writeFileSync(`${filePath}.writing`, JSON.stringify(contents));
    fs.renameSync(`${filePath}.writing`, filePath);
  } catch (error) {
    console.error("Could not save the sync settings:", error);
  }
}

// ---------- Helpers ----------

/**
 * This Mac's name as other Macs show it: the Computer Name from System Settings ("Alex's MacBook Pro"), or its
 * network name when that can't be read.
 */
function getDeviceName(): string {
  if (deviceName !== null) {
    return deviceName;
  }
  try {
    deviceName = execFileSync(SETTINGS_TOOL_PATH, ["--get", "ComputerName"], { encoding: "utf8", timeout: 2000 }).trim();
  } catch {
    deviceName = "";
  }
  if (deviceName === "") {
    deviceName = os.hostname().replace(/\.local$/, "");
  }
  return deviceName;
}

function getOwnFilePath(folder: string): string {
  return path.join(folder, `${deviceId}.json`);
}

/**
 * Gives up on a file operation that takes longer than SYNC_FILE_TIMEOUT_MS (a network drive that stopped answering).
 */
function withTimeout<Result>(work: Promise<Result>): Promise<Result> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("The sync folder did not answer in time.")), SYNC_FILE_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== null) {
      clearTimeout(timer);
    }
  });
}

/**
 * The Notes and Easels the synced tabs use, from the cache or their files.
 */
function readSyncedFiles(): { notes: Record<string, string>; easels: Record<string, string> } {
  const state = getState();
  const notes: Record<string, string> = {};
  const easels: Record<string, string> = {};
  for (const itemId of collectSyncedItemIds(state)) {
    const item = state.items[itemId];
    if (item === undefined || item.kind !== "tab") {
      continue;
    }
    const noteId = getNoteId(item.url);
    if (noteId !== null) {
      const html = noteTexts.get(noteId) ?? readNote(noteId);
      noteTexts.set(noteId, html);
      notes[noteId] = html;
    }
    const easelId = getEaselId(item.url);
    if (easelId !== null) {
      const json = easelTexts.get(easelId) ?? readEasel(easelId);
      easelTexts.set(easelId, json);
      easels[easelId] = json;
    }
  }
  return { notes: notes, easels: easels };
}

/**
 * Records the synced parts that changed here since the last look. `changedAt` 0 when joining (sync.ts).
 */
function stampNow(now: number, changedAt: number = now): void {
  if (meta === null) {
    return;
  }
  const files = readSyncedFiles();
  const units = collectUnits(getState(), files.notes, files.easels);
  const stamped = stampLocalChanges(meta, units, now, changedAt);
  if (stamped !== meta) {
    meta = stamped;
    saveSettings();
  }
}

/**
 * The problem to show: the folder first, then writing, then files of other Macs that could not be read (until they
 * are fixed or removed).
 */
function describeProblem(): string | null {
  if (folderProblem !== null) {
    return folderProblem;
  }
  if (writeProblem !== null) {
    return writeProblem;
  }
  if (unreadableFiles.size > 0) {
    return `Bow can't read ${[...unreadableFiles].join(", ")} in the sync folder (damaged, or from a newer Bow).`;
  }
  return null;
}

/**
 * Tells the Library when the problem it shows changed.
 */
function reportProblemIfChanged(): void {
  const problem = describeProblem();
  if (problem !== reportedProblem) {
    reportedProblem = problem;
    reportStatusChanged();
  }
}

// ---------- Writing this Mac's file ----------

/**
 * Writes this Mac's file a moment after the last change (changes come in bursts).
 */
function scheduleWrite(): void {
  if (folderPath === null) {
    return;
  }
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
  }
  writeTimer = setTimeout(() => {
    writeTimer = null;
    writeOwnFile().catch(() => undefined);
  }, SYNC_WRITE_DELAY_MS);
}

/**
 * Writes this Mac's file when a synced part changed (or after a merge, so a third Mac sees what was adopted).
 */
async function writeOwnFile(): Promise<void> {
  if (isWriting) {
    isWriteRequested = true;
    return;
  }
  const folder = folderPath;
  if (folder === null || meta === null) {
    return;
  }
  const now = Date.now();
  stampNow(now);
  if (meta.stamps === writtenStamps && meta.tombstones === writtenTombstones) {
    return;
  }
  const files = readSyncedFiles();
  const payload = buildSyncPayload(getState(), meta, files.notes, files.easels, getDeviceName(), now);
  const stampsBeingWritten = meta.stamps;
  const tombstonesBeingWritten = meta.tombstones;
  isWriting = true;
  try {
    const filePath = getOwnFilePath(folder);
    await withTimeout(fs.promises.writeFile(`${filePath}.writing`, JSON.stringify(payload)));
    await withTimeout(fs.promises.rename(`${filePath}.writing`, filePath));
    writtenStamps = stampsBeingWritten;
    writtenTombstones = tombstonesBeingWritten;
    lastSyncAt = now;
    writeProblem = null;
  } catch {
    writeProblem = "Bow can't write to the sync folder. Is the drive connected?";
  } finally {
    isWriting = false;
  }
  reportProblemIfChanged();
  if (isWriteRequested) {
    isWriteRequested = false;
    await writeOwnFile();
  }
}

// ---------- Reading the other Macs' files ----------

/**
 * Reads the folder a moment after it changed (a file is often written in several steps).
 */
function scheduleRead(): void {
  if (readTimer !== null) {
    clearTimeout(readTimer);
  }
  readTimer = setTimeout(() => {
    readTimer = null;
    readPeers().catch(() => undefined);
  }, SYNC_READ_DELAY_MS);
}

/**
 * Asks iCloud Drive to download a peer's file it has only as a placeholder; the folder changes once it arrives.
 */
function requestDownload(placeholderPath: string): void {
  const folder = path.dirname(placeholderPath);
  const realName = path.basename(placeholderPath).slice(1, -ICLOUD_PLACEHOLDER_SUFFIX.length);
  execFile(ICLOUD_TOOL_PATH, ["download", path.join(folder, realName)], () => undefined);
}

/**
 * Reads the other Macs' files in a folder and returns the valid ones; the names of those that could not be read go to
 * unreadableFiles until they change and read well, or are removed. `onlyChanged` skips files unchanged since they
 * were last read.
 */
async function readPeerFiles(folder: string, onlyChanged: boolean): Promise<SyncPayload[]> {
  const payloads: SyncPayload[] = [];
  const names = await withTimeout(fs.promises.readdir(folder));
  for (const name of [...unreadableFiles]) {
    if (!names.includes(name)) {
      unreadableFiles.delete(name);
    }
  }
  for (const name of names) {
    const filePath = path.join(folder, name);
    if (name.startsWith(".") && name.endsWith(`.json${ICLOUD_PLACEHOLDER_SUFFIX}`)) {
      requestDownload(filePath);
      continue;
    }
    if (!name.endsWith(".json") || name === `${deviceId}.json`) {
      continue;
    }
    const stats = await withTimeout(fs.promises.stat(filePath));
    if (onlyChanged && peerFileTimes.get(name) === stats.mtimeMs) {
      continue;
    }
    peerFileTimes.set(name, stats.mtimeMs);
    const text = stats.size > MAX_SYNC_FILE_BYTES ? "" : await withTimeout(fs.promises.readFile(filePath, "utf8"));
    const payload = parseSyncPayload(text);
    if (payload === null || payload.deviceId === deviceId) {
      unreadableFiles.add(name);
      continue;
    }
    unreadableFiles.delete(name);
    peerNames.set(payload.deviceId, payload.deviceName);
    payloads.push(payload);
  }
  return payloads;
}

/**
 * Merges one peer's file: this Mac's latest changes are recorded first (so a fresh edit here is never older than
 * the peer's), then the Notes and Easels that won are written before the tabs that show them change.
 */
function mergeOne(payload: SyncPayload): void {
  if (meta === null) {
    return;
  }
  const now = Date.now();
  stampNow(now);
  const before = getState();
  const files = readSyncedFiles();
  const result = mergePeer(before, meta, payload, files.notes, now);
  if (result.meta === meta) {
    return;
  }
  meta = result.meta;
  saveSettings();
  for (const [noteId, html] of Object.entries(result.notes)) {
    writeNote(noteId, html);
    noteTexts.set(noteId, html);
  }
  for (const [easelId, json] of Object.entries(result.easels)) {
    writeEasel(easelId, json);
    easelTexts.set(easelId, json);
  }
  if (result.state !== before) {
    applyChange(() => result.state);
  }
  const changedNoteIds = Object.keys(result.notes);
  const changedEaselIds = Object.keys(result.easels);
  if (changedNoteIds.length > 0 || changedEaselIds.length > 0) {
    sendSidebarCommandToAllWindows({ kind: "reloadFiles", noteIds: changedNoteIds, easelIds: changedEaselIds });
  }
  conflictCount += result.conflicts;
  lastSyncAt = now;
  scheduleWrite();
}

/**
 * Reads the other Macs' changed files and merges them.
 */
async function readPeers(): Promise<void> {
  if (isReading) {
    isReadRequested = true;
    return;
  }
  const folder = folderPath;
  if (folder === null) {
    return;
  }
  isReading = true;
  try {
    const payloads = await readPeerFiles(folder, true);
    // Sync may have stopped, or moved to another folder, while the files were read.
    if (folderPath !== folder) {
      return;
    }
    for (const payload of payloads) {
      mergeOne(payload);
    }
    lastSyncAt = Date.now();
    folderProblem = null;
    if (payloads.length > 0) {
      reportStatusChanged();
    }
  } catch {
    folderProblem = "Bow can't read the sync folder. Is the drive connected?";
  } finally {
    isReading = false;
  }
  reportProblemIfChanged();
  if (isReadRequested) {
    isReadRequested = false;
    await readPeers();
  }
}

// ---------- Starting and stopping ----------

/**
 * How often to read the folder without being told it changed: SYNC_POLL_MS, or the test flag's value.
 */
function readPollInterval(): number {
  const flag = process.argv.find((argument) => argument.startsWith(SYNC_POLL_FLAG));
  const fromFlag = flag === undefined ? Number.NaN : Number(flag.slice(SYNC_POLL_FLAG.length));
  return Number.isFinite(fromFlag) ? Math.max(fromFlag, MIN_SYNC_POLL_MS) : SYNC_POLL_MS;
}

/**
 * Watches the sync folder (macOS reports changes to local and iCloud folders) and reads it on a timer too (network
 * drives often don't report).
 */
function startWatching(folder: string): void {
  stopWatching();
  try {
    folderWatcher = fs.watch(folder, () => scheduleRead());
    folderWatcher.on("error", () => stopFolderWatcher());
  } catch {
    folderWatcher = null;
  }
  // Straight to reading (not through scheduleRead's delay, which a short test interval could keep pushing back).
  pollTimer = setInterval(() => {
    readPeers().catch(() => undefined);
  }, readPollInterval());
}

function stopFolderWatcher(): void {
  folderWatcher?.close();
  folderWatcher = null;
}

function stopWatching(): void {
  stopFolderWatcher();
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Starts sync at launch when a folder was chosen before, and listens for changes to write (once, at startup).
 */
export function startSync(onStatusChanged: () => void): void {
  reportStatusChanged = onStatusChanged;
  loadSettings();
  onStateChanged(() => scheduleWrite());
  if (folderPath === null) {
    return;
  }
  if (meta === null) {
    // The bookkeeping was lost: like joining again, the folder's versions win where they differ.
    meta = createSyncMeta(deviceId);
    stampNow(Date.now(), 0);
  }
  startWatching(folderPath);
  scheduleRead();
  scheduleWrite();
}

/**
 * A Note or an Easel was saved here (main.ts): its cache is updated and this Mac's file is written soon.
 */
export function markNoteSaved(noteId: string, html: string): void {
  noteTexts.set(noteId, html);
  scheduleWrite();
}

export function markEaselSaved(easelId: string, json: string): void {
  easelTexts.set(easelId, json);
  scheduleWrite();
}

/**
 * Shows an open dialog over the focused window (or on its own without one).
 */
async function askWhichFolder(options: OpenDialogOptions): Promise<string | null> {
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
 * Library › Settings › Sync › Choose Folder…: picks the folder, joins the Macs already syncing there (after asking and
 * keeping a copy of this setup), merges them and writes this Mac's file.
 */
export async function chooseSyncFolder(): Promise<void> {
  const picked = await askWhichFolder({
    title: "Choose a Folder to Sync Through",
    message: "Pick a folder all your Macs can reach, like iCloud Drive or Dropbox. Bow keeps its files in a “Bow Sync” folder inside it.",
    buttonLabel: "Sync Here",
    defaultPath: app.getPath("home"),
    properties: ["openDirectory", "createDirectory"],
  });
  if (picked === null) {
    return;
  }
  const folder = path.basename(picked) === SYNC_FOLDER_NAME ? picked : path.join(picked, SYNC_FOLDER_NAME);
  let peers: SyncPayload[];
  try {
    await withTimeout(fs.promises.mkdir(folder, { recursive: true }));
    peers = await readPeerFiles(folder, false);
  } catch {
    await ask({ type: "warning", message: "Bow can't use this folder", detail: "It could not be read or written. Pick a folder on this Mac, iCloud Drive or a connected drive." });
    return;
  }

  const now = Date.now();
  if (peers.length > 0) {
    const names = [...new Set(peers.map((peer) => peer.deviceName))].join(", ");
    const choice = await ask({
      type: "question",
      message: "Join the Macs syncing in this folder?",
      detail: `Bow found ${names} here. Where their setup and this Mac's differ, theirs is used; Spaces and tabs only this Mac has are added for them. Bow keeps a copy of this Mac's setup first, in its Backups folder.`,
      buttons: ["Join", "Cancel"],
      defaultId: JOIN_BUTTON_INDEX,
      cancelId: CANCEL_JOIN_BUTTON_INDEX,
    });
    if (choice !== JOIN_BUTTON_INDEX) {
      return;
    }
    if (saveSnapshot(BEFORE_SYNC_LABEL, now) === null) {
      await ask({ type: "warning", message: "Sync didn't start", detail: "Bow could not keep a copy of this Mac's setup first (is the disk full?), so it left everything as it was." });
      return;
    }
  }
  // Joining starts fresh bookkeeping: with other Macs here, everything on this Mac counts as older than theirs.
  stopWatching();
  meta = createSyncMeta(deviceId);
  writtenStamps = null;
  writtenTombstones = null;
  conflictCount = 0;
  folderProblem = null;
  writeProblem = null;
  folderPath = folder;
  stampNow(now, peers.length === 0 ? now : 0);
  saveSettings();
  for (const peer of peers) {
    mergeOne(peer);
  }
  lastSyncAt = now;
  startWatching(folder);
  await writeOwnFile();
  reportStatusChanged();
}

/**
 * Library › Settings › Sync › Stop Syncing: this Mac stops writing and reading; its last file stays in the folder
 * (the other Macs already have what it holds).
 */
export function stopSyncing(): void {
  stopWatching();
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  folderPath = null;
  meta = null;
  writtenStamps = null;
  writtenTombstones = null;
  lastSyncAt = null;
  conflictCount = 0;
  peerFileTimes.clear();
  peerNames.clear();
  unreadableFiles.clear();
  folderProblem = null;
  writeProblem = null;
  reportedProblem = null;
  saveSettings();
  reportStatusChanged();
}

/**
 * Library › Settings › Sync › Show in Finder.
 */
export function revealSyncFolder(): void {
  if (folderPath !== null) {
    shell.openPath(folderPath).catch(() => undefined);
  }
}

/**
 * Writes this Mac's file right away when a write is waiting (at quit).
 */
export function flushSyncNow(): void {
  if (writeTimer === null || folderPath === null || meta === null) {
    return;
  }
  clearTimeout(writeTimer);
  writeTimer = null;
  try {
    const now = Date.now();
    stampNow(now);
    const files = readSyncedFiles();
    const payload = buildSyncPayload(getState(), meta, files.notes, files.easels, getDeviceName(), now);
    const filePath = getOwnFilePath(folderPath);
    fs.writeFileSync(`${filePath}.writing`, JSON.stringify(payload));
    fs.renameSync(`${filePath}.writing`, filePath);
  } catch {
    // The next launch writes it.
  }
}

/**
 * What Library › Settings › Sync shows.
 */
export function getSyncStatus(): SyncStatusData {
  return {
    folderPath: folderPath,
    deviceName: getDeviceName(),
    peerNames: [...new Set(peerNames.values())],
    lastSyncAt: lastSyncAt,
    conflicts: conflictCount,
    problem: describeProblem(),
  };
}
