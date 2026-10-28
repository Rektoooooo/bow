/**
 * WHY this file exists:
 *   Electron does nothing useful with downloads by default. This saves every download into the chosen folder
 *   (~/Downloads unless Library › Settings says otherwise) with a unique name, like other browsers, or asks where to
 *   save it when the user wants that, tracks its progress for the Library, and bounces the Dock icon when done.
 *
 * Data source:
 *   Electron's "will-download" event on every profile session (profiles.ts tells us about new sessions), and the
 *   download settings (BrowserState.settings.downloadFolder / asksWhereToSave, read through startTrackingDownloads).
 *
 * Data flow:
 *   page starts a download → handleDownload() → DownloadRecord updates → onChange() → main pushes runtime + Library
 */
import { app, dialog, shell } from "electron";
import type { BrowserWindow, DownloadItem, OpenDialogOptions, Session } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DownloadRecord } from "../shared/overlay";
import type { BrowserSettings } from "../shared/types";
import { onProfileSessionCreated } from "./profiles";

/** Downloads remembered in this run, newest first. Older ones drop off. Our choice. */
const DOWNLOADS_LIMIT = 100;

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
 * Starts tracking one download: saves it into the download folder, or lets macOS's save dialog ask where (starting
 * in that folder), and follows its progress.
 */
function handleDownload(item: DownloadItem): void {
  const downloadsFolder = getDownloadFolder();
  // Only the last part of the suggested name is used, so a crafted name cannot point outside the folder.
  const safeFileName = path.basename(item.getFilename()) || "download";
  const suggestedPath = findFreePath(downloadsFolder, safeFileName);
  const asksWhereToSave = readSettings()?.asksWhereToSave === true;
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
  notifyChange();

  item.on("updated", () => {
    const chosenPath = item.getSavePath();
    updateRecord(downloadId, { receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes(), savePath: chosenPath, fileName: path.basename(chosenPath) || record.fileName });
  });
  item.once("done", (_event, state) => {
    const finalPath = item.getSavePath();
    updateRecord(downloadId, { receivedBytes: item.getReceivedBytes(), state: state, savePath: finalPath, fileName: path.basename(finalPath) || record.fileName });
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
    profileSession.on("will-download", (_event, item) => handleDownload(item));
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
