/**
 * WHY this file exists:
 *   Electron does nothing useful with downloads by default. This saves every download into the chosen folder
 *   (~/Downloads unless Library › Settings says otherwise) with a unique name, like other browsers, or asks where to
 *   save it when the user wants that, tracks its progress for the Library and the sidebar's downloads card, and
 *   bounces the Dock icon when done. It also tells main which page started each download, so a view that was only
 *   opened to fetch a file can go away (linkDownloads.ts).
 *
 * Data source:
 *   Electron's "will-download" event on every profile session (profiles.ts tells us about new sessions), and the
 *   download settings (BrowserState.settings.downloadFolder / asksWhereToSave, read through startTrackingDownloads).
 *
 * Data flow:
 *   page starts a download → handleDownload() → DownloadRecord updates → onChange() → main pushes runtime + Library
 *   page starts a download → the listeners of onDownloadStarted() (the empty view goes, a toast may show)
 */
import { app, dialog, shell } from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { BrowserWindow, DownloadItem, OpenDialogOptions, Session, WebContents } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DownloadRecord } from "../shared/overlay";
import { DOWNLOAD_CARD_SHOWN_MS } from "../shared/settings";
import type { BrowserSettings, DownloadCardInfo } from "../shared/types";
import { onProfileSessionCreated } from "./profiles";

/** Downloads remembered in this run, newest first. Older ones drop off. Our choice. */
const DOWNLOADS_LIMIT = 100;

/**
 * macOS's quarantine mark on a downloaded file: "flags;time in hex seconds;downloading app;id". Flags 0083 are what
 * Safari writes for a download from the web. Electron does not add the mark itself (measured: a finished download has
 * no com.apple.quarantine), and without it Gatekeeper never checks a downloaded app or installer.
 */
const QUARANTINE_ATTRIBUTE = "com.apple.quarantine";
const QUARANTINE_FLAGS = "0083";
const QUARANTINE_AGENT_NAME = "Bow";

/** Highest "(n)" suffix tried before giving up on a unique name. */
const MAX_NAME_SUFFIX = 999;

/** The downloads of this run, newest first. */
let downloads: DownloadRecord[] = [];

/** Counts downloads, for ids. */
let downloadCounter = 0;

/** Called after any download changes. Set by startTrackingDownloads. */
let notifyChange: () => void = () => undefined;

/** Reads the download settings. Set by startTrackingDownloads (browserCore imports this file, so not the other way). */
let readSettings: () => BrowserSettings | null = () => null;

/** Called with the page that started a download and the file's name, once its record exists. */
type DownloadStartedListener = (contents: WebContents, fileName: string) => void;

const downloadStartedListeners: DownloadStartedListener[] = [];

/** Addresses the user asked to save with a dialog ("Save Link As…"), taken when their download starts. */
const urlsToAskWhereToSave = new Set<string>();

/** True after the card's × until the next download starts. */
let isDownloadCardDismissed = false;

/** When the last download ended (ms since 1970), for the card's time on screen. */
let lastDownloadEndedAt = 0;

/**
 * Lets main hear that a page started a download.
 */
export function onDownloadStarted(listener: DownloadStartedListener): void {
  downloadStartedListeners.push(listener);
}

/**
 * Downloads an address the user picked from a page's menu ("Download Linked File", "Save Image As…"). With
 * `asksWhereToSave` the save dialog opens for this one download, whatever the setting says.
 */
export function downloadAddress(contents: WebContents, url: string, asksWhereToSave: boolean): void {
  if (asksWhereToSave) {
    urlsToAskWhereToSave.add(url);
  }
  contents.downloadURL(url);
}

/**
 * Takes the "ask where to save" request for a download, looking at the address it began with and the redirects.
 */
function takeAskWhereToSaveRequest(item: DownloadItem): boolean {
  const addresses = [item.getURL(), ...item.getURLChain()];
  const requestedAddress = addresses.find((address) => urlsToAskWhereToSave.has(address));
  if (requestedAddress === undefined) {
    return false;
  }
  urlsToAskWhereToSave.delete(requestedAddress);
  return true;
}

/**
 * The folder downloads go to: the chosen one while it exists, else the Mac's Downloads folder.
 */
export function getDownloadFolder(): string {
  const chosenFolder = readSettings()?.downloadFolder;
  if (chosenFolder !== undefined && fs.existsSync(chosenFolder)) {
    return chosenFolder;
  }
  return app.getPath("downloads");
}

/**
 * Returns a path in the folder that does not exist yet: "report.pdf", then "report (1).pdf", "report (2).pdf", …
 */
export function findFreePath(folder: string, fileName: string): string {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  let candidate = path.join(folder, fileName);
  for (let suffix = 1; fs.existsSync(candidate) && suffix <= MAX_NAME_SUFFIX; suffix++) {
    candidate = path.join(folder, `${baseName} (${suffix})${extension}`);
  }
  return candidate;
}

/**
 * Replaces one record in the list.
 */
function updateRecord(downloadId: string, changes: Partial<DownloadRecord>): void {
  downloads = downloads.map((record) => (record.id === downloadId ? { ...record, ...changes } : record));
  notifyChange();
}

/**
 * Tells the listeners which page started a download. After this turn of the event loop, so the download has its
 * save path and a view the listener closes does not interrupt Electron's own handling of the event.
 */
function announceDownloadStarted(startingContents: WebContents, fileName: string): void {
  setImmediate(() => {
    for (const listener of downloadStartedListeners) {
      listener(startingContents, fileName);
    }
  });
}

/**
 * Gives a finished download macOS's quarantine mark, like every browser does. Resolves when the mark is set (or could
 * not be: the file is then still downloaded, just unmarked).
 */
function quarantineFile(filePath: string): Promise<void> {
  const seconds = Math.floor(Date.now() / 1000).toString(16);
  const markValue = `${QUARANTINE_FLAGS};${seconds};${QUARANTINE_AGENT_NAME};${randomUUID().toUpperCase()}`;
  return new Promise((resolve) => {
    execFile("/usr/bin/xattr", ["-w", QUARANTINE_ATTRIBUTE, markValue, filePath], () => resolve());
  });
}

/**
 * Starts tracking one download: saves it into the download folder, or lets macOS's save dialog ask where (starting
 * in that folder), and follows its progress.
 */
function handleDownload(item: DownloadItem, startingContents: WebContents | null): void {
  const downloadsFolder = getDownloadFolder();
  // Only the last part of the suggested name is used, so a crafted name cannot point outside the folder.
  const safeFileName = path.basename(item.getFilename()) || "download";
  const suggestedPath = findFreePath(downloadsFolder, safeFileName);
  const asksWhereToSave = takeAskWhereToSaveRequest(item) || readSettings()?.asksWhereToSave === true;
  if (asksWhereToSave) {
    // Without a save path Electron shows the save dialog; the chosen path is known once the download runs.
    item.setSaveDialogOptions({ defaultPath: suggestedPath });
  } else {
    item.setSavePath(suggestedPath);
  }
  const savePath = asksWhereToSave ? "" : suggestedPath;

  downloadCounter = downloadCounter + 1;
  const downloadId = `download-${Date.now()}-${downloadCounter}`;
  const record: DownloadRecord = {
    id: downloadId,
    fileName: path.basename(suggestedPath),
    url: item.getURL(),
    savePath: savePath,
    receivedBytes: 0,
    totalBytes: item.getTotalBytes(),
    state: "progressing",
    startedAt: Date.now(),
  };
  downloads = [record, ...downloads].slice(0, DOWNLOADS_LIMIT);
  isDownloadCardDismissed = false;
  notifyChange();
  if (startingContents !== null) {
    announceDownloadStarted(startingContents, record.fileName);
  }

  item.on("updated", () => {
    const chosenPath = item.getSavePath();
    updateRecord(downloadId, { receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes(), savePath: chosenPath, fileName: path.basename(chosenPath) || record.fileName });
  });
  item.once("done", async (_event, state) => {
    const finalPath = item.getSavePath();
    const receivedBytes = item.getReceivedBytes();
    if (state === "completed") {
      await quarantineFile(finalPath);
    }
    lastDownloadEndedAt = Date.now();
    updateRecord(downloadId, { receivedBytes: receivedBytes, state: state, savePath: finalPath, fileName: path.basename(finalPath) || record.fileName });
    // The card leaves on its own; main hears about it once the time is up.
    setTimeout(notifyChange, DOWNLOAD_CARD_SHOWN_MS + 1);
    if (state === "completed") {
      app.dock?.downloadFinished(finalPath);
    }
  });
}

/**
 * Starts handling downloads in every profile session, now and later.
 */
export function startTrackingDownloads(onChange: () => void, settingsReader: () => BrowserSettings): void {
  notifyChange = onChange;
  readSettings = settingsReader;
  onProfileSessionCreated((profileSession: Session) => {
    profileSession.on("will-download", (_event, item, startingContents) => handleDownload(item, startingContents));
  });
}

/**
 * Library › Settings › Downloads › Change…: asks for the folder downloads go to. Null when the user cancels.
 */
export async function askForDownloadFolder(window: BrowserWindow | null): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: "Choose a Folder for Downloads",
    buttonLabel: "Save Downloads Here",
    defaultPath: getDownloadFolder(),
    properties: ["openDirectory", "createDirectory"],
  };
  const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

export function getDownloads(): DownloadRecord[] {
  return downloads;
}

/**
 * How many downloads are still running.
 */
export function getActiveDownloadCount(): number {
  return downloads.filter((record) => record.state === "progressing").length;
}

/**
 * Shows a downloaded file in Finder.
 */
export function showDownloadInFolder(downloadId: string): void {
  const record = downloads.find((candidate) => candidate.id === downloadId);
  if (record !== undefined) {
    shell.showItemInFolder(record.savePath);
  }
}

/**
 * What the sidebar's downloads card shows, or null when it has nothing to show: the newest running download (and how
 * many run), or for DOWNLOAD_CARD_SHOWN_MS after the last one ended, the newest download's result.
 */
export function getDownloadCard(now: number): DownloadCardInfo | null {
  if (isDownloadCardDismissed) {
    return null;
  }
  const runningDownloads = downloads.filter((record) => record.state === "progressing");
  const newestRunning = runningDownloads[0];
  const newestDownload = downloads[0];
  if (newestRunning === undefined && (newestDownload === undefined || now - lastDownloadEndedAt >= DOWNLOAD_CARD_SHOWN_MS)) {
    return null;
  }
  const shown = newestRunning ?? newestDownload;
  if (shown === undefined) {
    return null;
  }
  return {
    downloadId: shown.id,
    fileName: shown.fileName,
    receivedBytes: shown.receivedBytes,
    totalBytes: shown.totalBytes,
    state: shown.state,
    runningCount: runningDownloads.length,
  };
}

/**
 * The card's ×.
 */
export function dismissDownloadCard(): void {
  isDownloadCardDismissed = true;
  notifyChange();
}

/**
 * The card's click: a finished file opens in its app, anything else goes to Library › Downloads (the caller opens
 * that when this returns false).
 */
export function openDownloadedFile(downloadId: string): boolean {
  const record = downloads.find((candidate) => candidate.id === downloadId);
  if (record === undefined || record.state !== "completed") {
    return false;
  }
  shell.openPath(record.savePath).catch(() => undefined);
  return true;
}
