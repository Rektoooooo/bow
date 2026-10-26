/**
 * WHY this file exists:
 *   Electron does nothing useful with downloads by default. This saves every download into ~/Downloads (with a
 *   unique name, like other browsers), tracks its progress for the Library, and bounces the Dock icon when done.
 *
 * Data source:
 *   Electron's "will-download" event on every profile session (profiles.ts tells us about new sessions).
 *
 * Data flow:
 *   page starts a download → handleDownload() → DownloadRecord updates → onChange() → main pushes runtime + Library
 */
import { app, shell } from "electron";
import type { DownloadItem, Session } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DownloadRecord } from "../shared/overlay";
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
 * Starts tracking one download: saves it into ~/Downloads and follows its progress.
 */
function handleDownload(item: DownloadItem): void {
  const downloadsFolder = app.getPath("downloads");
  // Only the last part of the suggested name is used, so a crafted name cannot point outside the folder.
  const safeFileName = path.basename(item.getFilename()) || "download";
  const savePath = findFreePath(downloadsFolder, safeFileName);
  item.setSavePath(savePath);

  downloadCounter = downloadCounter + 1;
  const downloadId = `download-${Date.now()}-${downloadCounter}`;
  const record: DownloadRecord = {
    id: downloadId,
    fileName: path.basename(savePath),
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
    updateRecord(downloadId, { receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes() });
  });
  item.once("done", (_event, state) => {
    updateRecord(downloadId, { receivedBytes: item.getReceivedBytes(), state: state });
    if (state === "completed") {
      app.dock?.downloadFinished(savePath);
    }
  });
}

/**
 * Starts handling downloads in every profile session, now and later.
 */
export function startTrackingDownloads(onChange: () => void): void {
  notifyChange = onChange;
  onProfileSessionCreated((profileSession: Session) => {
    profileSession.on("will-download", (_event, item) => handleDownload(item));
  });
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
