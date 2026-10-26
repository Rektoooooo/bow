/**
 * WHY this file exists:
 *   Browsing history must survive restarts, but it changes on every page load and can hold thousands of entries,
 *   so it lives in its own file (history.json) and is written at most every few seconds instead of on every visit.
 *
 * Data source:
 *   history.json in Electron's user data folder, and visits reported by main.ts.
 *
 * Data flow:
 *   app start → loadHistory() → entries in memory
 *   page navigates → addVisit() → history.ts recordVisit() → saveSoon() → history.json
 */
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { recordVisit, updateHistoryTitle } from "./history";
import type { HistoryEntry } from "./history";

const HISTORY_FILE_NAME = "history.json";

/** Wait this long after a visit before writing, so a burst of navigations is written once. Our choice. */
const SAVE_DELAY_MS = 3000;

let entries: HistoryEntry[] = [];
let historyFilePath = "";
let saveTimer: NodeJS.Timeout | null = null;

/**
 * True when a parsed value looks like a list of history entries.
 */
function looksLikeHistory(value: unknown): value is HistoryEntry[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((entry) => typeof entry === "object" && entry !== null && typeof entry.url === "string" && typeof entry.lastVisitAt === "number");
}

/**
 * Reads history.json. A missing or unreadable file means an empty history.
 */
export function loadHistory(): void {
  historyFilePath = path.join(app.getPath("userData"), HISTORY_FILE_NAME);
  if (!fs.existsSync(historyFilePath)) {
    return;
  }
  try {
    const parsedValue: unknown = JSON.parse(fs.readFileSync(historyFilePath, "utf8"));
    entries = looksLikeHistory(parsedValue) ? parsedValue : [];
  } catch (error) {
    console.warn("Could not read history; starting with an empty one:", error);
    entries = [];
  }
}

/**
 * Writes history.json now, through a temporary file so a crash never leaves half a file.
 */
export function saveHistoryNow(): void {
  if (historyFilePath === "") {
    return;
  }
  const temporaryPath = `${historyFilePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(entries), "utf8");
  fs.renameSync(temporaryPath, historyFilePath);
}

/**
 * Schedules a write a few seconds from now, unless one is already scheduled.
 */
function saveSoon(): void {
  if (saveTimer !== null) {
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveHistoryNow();
  }, SAVE_DELAY_MS);
}

/**
 * Records a page visit.
 */
export function addVisit(url: string, title: string, now: number): void {
  const updatedEntries = recordVisit(entries, url, title, now);
  if (updatedEntries === entries) {
    return;
  }
  entries = updatedEntries;
  saveSoon();
}

/**
 * Records a page's title once it is known.
 */
export function setVisitTitle(url: string, title: string): void {
  const updatedEntries = updateHistoryTitle(entries, url, title);
  if (updatedEntries === entries) {
    return;
  }
  entries = updatedEntries;
  saveSoon();
}

export function getHistory(): HistoryEntry[] {
  return entries;
}

/**
 * Deletes all history, in memory and on disk.
 */
export function clearHistory(): void {
  entries = [];
  saveHistoryNow();
}
