/**
 * WHY this file exists:
 *   File › Import From Browser brings bookmarks and history from Chrome, Brave, Edge, Vivaldi, Chromium or Safari,
 *   like Arc's own importer. The readers (chromiumImport.ts, safariImport.ts) and the state change
 *   (bookmarkImport.ts) are separate; this file finds what can be imported, runs one import and reports it.
 *
 * Data source:
 *   The browsers' profile folders under ~/Library/Application Support, and ~/Library/Safari (macOS only lets us read
 *   Safari's files with Full Disk Access).
 *
 * Data flow:
 *   menu / Library → listImportSources() → importFromBrowser(sourceId) → read bookmarks → addImportedBookmarks()
 *   → applyChange() → read history → importHistoryEntries() → summary dialog
 */
import { app, dialog, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { applyChange, getState, getWindow } from "./browserCore";
import { addImportedBookmarks, countBookmarks } from "./bookmarkImport";
import type { ImportedBookmarkNode } from "./bookmarkImport";
import { findChromiumProfiles, readChromiumBookmarks, readChromiumHistory } from "./chromiumImport";
import type { ChromiumProfile } from "./chromiumImport";
import { importHistoryEntries } from "./historyStore";
import { readSafariBookmarks, readSafariHistory } from "./safariImport";
import { getActiveSpace } from "./tree";

/** Something the user can import from, as the menus list it. */
export interface ImportSource {
  /** "safari", or "chromium:<browser>:<profile folder>". */
  id: string;
  label: string;
}

const SAFARI_SOURCE_ID = "safari";
const CHROMIUM_SOURCE_PREFIX = "chromium:";

/** Where macOS keeps Safari's files. */
const SAFARI_FOLDER = path.join("Library", "Safari");

/** System Settings › Privacy & Security › Full Disk Access. */
const FULL_DISK_ACCESS_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

/**
 * The browsers and profiles on this Mac that have bookmarks or history to import.
 */
export function listImportSources(): ImportSource[] {
  const homeFolder = app.getPath("home");
  const sources: ImportSource[] = findChromiumProfiles(homeFolder).map((profile) => ({
    id: `${CHROMIUM_SOURCE_PREFIX}${profile.browserId}:${profile.folderName}`,
    label: profile.displayName === profile.folderName ? profile.browserName : `${profile.browserName} — ${profile.displayName}`,
  }));
  if (fs.existsSync(path.join(homeFolder, SAFARI_FOLDER))) {
    sources.push({ id: SAFARI_SOURCE_ID, label: "Safari" });
  }
  return sources;
}

/**
 * Adds the bookmarks as one folder in the active Space, and returns how many arrived.
 */
function addBookmarksToActiveSpace(folderTitle: string, tree: ImportedBookmarkNode[]): number {
  const bookmarkCount = countBookmarks(tree);
  if (bookmarkCount === 0) {
    return 0;
  }
  applyChange((state) => addImportedBookmarks(state, getActiveSpace(state).id, folderTitle, tree, Date.now()));
  return bookmarkCount;
}

/**
 * Tells the user what arrived.
 */
async function showSummary(browserName: string, bookmarkCount: number, historyCount: number): Promise<void> {
  const window = getWindow();
  if (window === null) {
    return;
  }
  const spaceName = getActiveSpace(getState()).name;
  const nothingNew = bookmarkCount === 0 && historyCount === 0;
  await dialog.showMessageBox(window, {
    type: "info",
    message: nothingNew ? `Nothing to import from ${browserName}` : `Imported from ${browserName}`,
    detail: nothingNew
      ? "No bookmarks, and no pages that are not in your history already."
      : `Bookmarks: ${bookmarkCount}, in the folder "${browserName} Bookmarks" in ${spaceName}.\nHistory: ${historyCount} pages.`,
  });
}

/**
 * Imports one Chromium-family profile.
 */
async function importChromiumProfile(profile: ChromiumProfile): Promise<void> {
  const bookmarkCount = addBookmarksToActiveSpace(`${profile.browserName} Bookmarks`, readChromiumBookmarks(profile));
  const historyCount = importHistoryEntries(await readChromiumHistory(profile));
  await showSummary(profile.browserName, bookmarkCount, historyCount);
}

/**
 * Explains that macOS keeps Safari's files private, and offers to open the right settings pane.
 */
async function explainFullDiskAccess(): Promise<void> {
  const window = getWindow();
  if (window === null) {
    return;
  }
  const answer = await dialog.showMessageBox(window, {
    type: "info",
    message: "Safari's bookmarks need your permission",
    detail:
      "macOS keeps Safari's files private. Turn on Sidebar Browser in System Settings › Privacy & Security › Full Disk Access, then import again.",
    buttons: ["Open System Settings", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
  if (answer.response === 0) {
    await shell.openExternal(FULL_DISK_ACCESS_SETTINGS_URL);
  }
}

/**
 * Imports Safari's bookmarks (with the Reading List as a folder of its own) and history.
 */
async function importSafari(): Promise<void> {
  const homeFolder = app.getPath("home");
  const bookmarks = await readSafariBookmarks(homeFolder);
  if (!bookmarks.ok && bookmarks.reason === "needsFullDiskAccess") {
    await explainFullDiskAccess();
    return;
  }
  const tree: ImportedBookmarkNode[] = [];
  if (bookmarks.ok) {
    tree.push(...bookmarks.value.bookmarks);
    if (bookmarks.value.readingList.length > 0) {
      tree.push({ kind: "folder", title: "Reading List", children: bookmarks.value.readingList });
    }
  }
  const bookmarkCount = addBookmarksToActiveSpace("Safari Bookmarks", tree);
  const history = await readSafariHistory(homeFolder);
  const historyCount = history.ok ? importHistoryEntries(history.value) : 0;
  await showSummary("Safari", bookmarkCount, historyCount);
}

/**
 * Runs the import of one source from listImportSources().
 */
export async function importFromBrowser(sourceId: string): Promise<void> {
  if (sourceId === SAFARI_SOURCE_ID) {
    await importSafari();
    return;
  }
  const profile = findChromiumProfiles(app.getPath("home")).find((candidate) => `${CHROMIUM_SOURCE_PREFIX}${candidate.browserId}:${candidate.folderName}` === sourceId);
  if (profile !== undefined) {
    await importChromiumProfile(profile);
  }
}
