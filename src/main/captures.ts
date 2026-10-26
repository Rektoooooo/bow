/**
 * WHY this file exists:
 *   Arc keeps screenshots and captures in its Library (Media) instead of scattering them in Downloads. So do we:
 *   each one is a PNG in the app's data folder with a small JPEG thumbnail and a line in an index, newest first.
 *   The Library lists them; from there they can be copied, shown in Finder, saved to Downloads or deleted.
 *
 * Data source:
 *   Pictures from overlayController.ts (Screenshot and Capture), and <userData>/Captures/captures.json.
 *
 * Data flow:
 *   Screenshot / Capture → saveCapture(image, title, url) → PNG + thumbnail + index
 *   Library › Media → listCaptures() (thumbnails as data: URLs) → a button → runCaptureCommand(id, command)
 */
import { clipboard, ClipboardItem, shell } from "electron";
import type { NativeImage } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

/** One kept picture, as the index stores it. */
export interface CaptureRecord {
  id: string;
  fileName: string;
  thumbnailFileName: string;
  /** The page's name and address when the picture was taken. */
  title: string;
  url: string;
  createdAt: number;
  width: number;
  height: number;
}

/** What the Library's buttons can do with a picture. */
export type CaptureCommand = "copy" | "reveal" | "save" | "delete";

const CAPTURES_FOLDER_NAME = "Captures";
const INDEX_FILE_NAME = "captures.json";

/** Pictures kept; the oldest go first. Our choice: plenty for a Library, bounded on disk. */
const CAPTURES_LIMIT = 500;

/** Thumbnail width in pixels and JPEG quality: sharp in the Library's 2-column grid on 2× screens. Our choice. */
const THUMBNAIL_WIDTH_PX = 480;
const THUMBNAIL_JPEG_QUALITY = 75;

let capturesFolder: string | null = null;
let captures: CaptureRecord[] = [];

/** Thumbnails already read from disk, as data: URLs, by capture id. */
const thumbnailCache = new Map<string, string>();

/**
 * Puts a PNG on the clipboard. Electron 44's clipboard follows the web's async Clipboard API: an item per MIME type,
 * and Blob wants a plain Uint8Array view, not Node's Buffer type.
 */
export async function copyPngToClipboard(pngBytes: Buffer): Promise<void> {
  const pngView = new Uint8Array(pngBytes.buffer as ArrayBuffer, pngBytes.byteOffset, pngBytes.byteLength);
  await clipboard.write([new ClipboardItem({ "image/png": new Blob([pngView], { type: "image/png" }) })]);
}

/**
 * Reads the index. Runs once at startup; a missing or broken index starts empty.
 */
export function loadCaptures(userDataFolder: string): void {
  capturesFolder = path.join(userDataFolder, CAPTURES_FOLDER_NAME);
  try {
    const saved: unknown = JSON.parse(fs.readFileSync(path.join(capturesFolder, INDEX_FILE_NAME), "utf8"));
    captures = Array.isArray(saved) ? (saved as CaptureRecord[]).filter((record) => typeof record?.id === "string" && typeof record.fileName === "string") : [];
  } catch {
    captures = [];
  }
}

function writeIndex(): void {
  if (capturesFolder === null) {
    return;
  }
  fs.mkdirSync(capturesFolder, { recursive: true });
  fs.writeFileSync(path.join(capturesFolder, INDEX_FILE_NAME), JSON.stringify(captures));
}

/**
 * Removes a picture's files (the index is the caller's).
 */
function removeFiles(record: CaptureRecord): void {
  if (capturesFolder === null) {
    return;
  }
  fs.rmSync(path.join(capturesFolder, record.fileName), { force: true });
  fs.rmSync(path.join(capturesFolder, record.thumbnailFileName), { force: true });
  thumbnailCache.delete(record.id);
}

/**
 * Keeps a picture: the PNG, its thumbnail and a line in the index. Returns the PNG's path.
 */
export function saveCapture(image: NativeImage, title: string, url: string, now: number): string | null {
  if (capturesFolder === null || image.isEmpty()) {
    return null;
  }
  fs.mkdirSync(capturesFolder, { recursive: true });
  const id = `capture-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const size = image.getSize();
  const record: CaptureRecord = { id: id, fileName: `${id}.png`, thumbnailFileName: `${id}-thumbnail.jpg`, title: title, url: url, createdAt: now, width: size.width, height: size.height };
  const thumbnail = image.resize({ width: Math.min(THUMBNAIL_WIDTH_PX, size.width), quality: "good" });
  fs.writeFileSync(path.join(capturesFolder, record.fileName), image.toPNG());
  fs.writeFileSync(path.join(capturesFolder, record.thumbnailFileName), thumbnail.toJPEG(THUMBNAIL_JPEG_QUALITY));
  captures = [record, ...captures];
  while (captures.length > CAPTURES_LIMIT) {
    const oldest = captures.pop();
    if (oldest !== undefined) {
      removeFiles(oldest);
    }
  }
  writeIndex();
  return path.join(capturesFolder, record.fileName);
}

/**
 * The newest pictures with their thumbnails as data: URLs, for the Library.
 */
export function listCaptures(limit: number): (CaptureRecord & { thumbnailUrl: string | null })[] {
  const folder = capturesFolder;
  if (folder === null) {
    return [];
  }
  return captures.slice(0, limit).map((record) => {
    let thumbnailUrl = thumbnailCache.get(record.id) ?? null;
    if (thumbnailUrl === null) {
      try {
        thumbnailUrl = `data:image/jpeg;base64,${fs.readFileSync(path.join(folder, record.thumbnailFileName)).toString("base64")}`;
        thumbnailCache.set(record.id, thumbnailUrl);
      } catch {
        thumbnailUrl = null;
      }
    }
    return { ...record, thumbnailUrl: thumbnailUrl };
  });
}

/**
 * One picture as a PNG data: URL (an easel places it), or null when it is gone.
 */
export function readCaptureAsDataUrl(id: string): string | null {
  const record = captures.find((candidate) => candidate.id === id);
  if (record === undefined || capturesFolder === null) {
    return null;
  }
  try {
    return `data:image/png;base64,${fs.readFileSync(path.join(capturesFolder, record.fileName)).toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * A file name for a copy in Downloads: the page's name and the time, without characters Finder dislikes.
 */
function buildExportName(record: CaptureRecord): string {
  const timestamp = new Date(record.createdAt).toISOString().slice(0, 19).replaceAll(":", "-");
  const safeTitle = record.title.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 60) || "Capture";
  return `${safeTitle} ${timestamp}.png`;
}

/**
 * Runs a Library button on a picture. Returns true when the list changed (deleted), so the Library redraws.
 */
export function runCaptureCommand(id: string, command: CaptureCommand, downloadsFolder: string): boolean {
  const record = captures.find((candidate) => candidate.id === id);
  if (record === undefined || capturesFolder === null) {
    return false;
  }
  const filePath = path.join(capturesFolder, record.fileName);
  if (command === "copy") {
    copyPngToClipboard(fs.readFileSync(filePath)).catch((error) => console.error("Copying the picture failed:", error));
    return false;
  }
  if (command === "reveal") {
    shell.showItemInFolder(filePath);
    return false;
  }
  if (command === "save") {
    const exportPath = path.join(downloadsFolder, buildExportName(record));
    fs.copyFileSync(filePath, exportPath);
    shell.showItemInFolder(exportPath);
    return false;
  }
  removeFiles(record);
  captures = captures.filter((candidate) => candidate.id !== id);
  writeIndex();
  return true;
}
