/**
 * WHY this file exists:
 *   File › Import From Browser and the onboarding bring bookmarks and history from Chrome, Dia, Brave, Edge, Vivaldi,
 *   Opera, Chromium, Firefox or Safari, like Arc's own importer. The readers (chromiumImport.ts, firefoxImport.ts,
 *   safariImport.ts) and the state change (bookmarkImport.ts) are separate; this file finds what can be imported and
 *   runs one import in two steps: prepare (read the files once and count, changing nothing) and apply (bring the
 *   chosen parts over). The onboarding shows the counts first; the menu brings both and shows a summary.
 *
 * Data source:
 *   The browsers' profile folders under ~/Library/Application Support (Firefox's listed in its profiles.ini), and
 *   ~/Library/Safari (macOS only lets us read Safari's files with Full Disk Access).
 *
 * Data flow:
 *   menu / Library → listImportSources() → importFromBrowser(sourceId) → prepareBrowserImport() → applyBrowserImport()
 *   → summary dialog
 *   onboardingWindow.ts → prepareBrowserImport() → counts on its card → applyBrowserImport(chosen parts)
 *   applyBrowserImport: addImportedBookmarks() → applyChange() → importHistoryEntries()
 */
import { dialog, shell } from "electron";
import type { BrowserWindow } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { applyChange, getState, getWindow } from "./browserCore";
import { addImportedBookmarks, countBookmarks } from "./bookmarkImport";
import type { ImportedBookmarkNode } from "./bookmarkImport";
import { findChromiumProfiles, readChromiumBookmarks, readChromiumHistory } from "./chromiumImport";
import { findFirefoxProfiles, readFirefoxProfile } from "./firefoxImport";
import type { HistoryEntry } from "./history";
import { countNewHistoryUrls, importHistoryEntries } from "./historyStore";
import { getImportHomeFolder } from "./importHome";
import { readSafariBookmarks, readSafariHistory } from "./safariImport";
import { getActiveSpace } from "./tree";
import { IMPORT_PART_ORDER } from "../shared/onboarding";
import type { ImportFound, ImportPart } from "../shared/onboarding";

/** Something the user can import from, as the menus and the onboarding list it. */
export interface ImportSource {
  /** "safari", "chromium:<browser>:<profile folder>" or "firefox:<profile folder>". */
  id: string;
  /** "Google Chrome", or with the profile's name when the browser has several: "Google Chrome (Work)". */
  label: string;
  /** The browser it belongs to: "safari", "firefox", or a Chromium browser's id (chromiumImport.ts). */
  browserId: string;
  /** The profile's name, or null for a browser without profiles to tell apart. */
  profileName: string | null;
}

/** Everything a browser import needs, read once; nothing has changed yet. */
export interface PreparedBrowserImport {
  browserName: string;
  bookmarks: ImportedBookmarkNode[];
  history: HistoryEntry[];
  found: ImportFound;
}

/** What a prepare found: the import, Safari waiting for Full Disk Access, or a source that is not on this Mac. */
export type BrowserPreparation = { prepared: PreparedBrowserImport } | { needsFullDiskAccess: true } | { isMissing: true };

/** What applying an import brought over. */
export interface BrowserImportResult {
  bookmarks: number;
  historyPages: number;
}

const SAFARI_SOURCE_ID = "safari";
const CHROMIUM_SOURCE_PREFIX = "chromium:";
const FIREFOX_SOURCE_PREFIX = "firefox:";

/** Where macOS keeps Safari's files. */
const SAFARI_FOLDER = path.join("Library", "Safari");

/** System Settings › Privacy & Security › Full Disk Access. */
const FULL_DISK_ACCESS_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

/**
 * The browsers and profiles on this Mac that have bookmarks or history to import.
 */
export function listImportSources(): ImportSource[] {
  const homeFolder = getImportHomeFolder();
  const chromiumProfiles = findChromiumProfiles(homeFolder);
  const sources: ImportSource[] = [];
  for (const profile of chromiumProfiles) {
    const sameBrowser = chromiumProfiles.filter((candidate) => candidate.browserId === profile.browserId);
    const profileName = sameBrowser.length > 1 || profile.displayName !== profile.folderName ? profile.displayName : null;
    sources.push({
      id: `${CHROMIUM_SOURCE_PREFIX}${profile.browserId}:${profile.folderName}`,
      label: profileName === null ? profile.browserName : `${profile.browserName} (${profileName})`,
      browserId: profile.browserId,
      profileName: profileName,
    });
  }
  // One Firefox profile is just "Firefox"; several are told apart by their names.
  const firefoxProfiles = findFirefoxProfiles(homeFolder);
  for (const profile of firefoxProfiles) {
    const profileName = firefoxProfiles.length === 1 ? null : profile.displayName;
    const label = profileName === null ? "Firefox" : `Firefox (${profileName})`;
    sources.push({ id: `${FIREFOX_SOURCE_PREFIX}${profile.folderName}`, label: label, browserId: "firefox", profileName: profileName });
  }
  if (fs.existsSync(path.join(homeFolder, SAFARI_FOLDER))) {
    sources.push({ id: SAFARI_SOURCE_ID, label: "Safari", browserId: "safari", profileName: null });
  }
  return sources;
}

/**
 * The counts of a browser import: its bookmarks and the sites not in our history yet.
 */
function countBrowserImport(bookmarks: ImportedBookmarkNode[], history: HistoryEntry[]): ImportFound {
  const counts: Partial<Record<ImportPart, number>> = { bookmarks: countBookmarks(bookmarks), history: countNewHistoryUrls(history) };
  const parts = IMPORT_PART_ORDER.filter((part) => (counts[part] ?? 0) > 0);
  return { parts: parts, counts: counts, tabs: 0 };
}

/**
 * A prepared import of what was read.
 */
function toPreparation(browserName: string, bookmarks: ImportedBookmarkNode[], history: HistoryEntry[]): BrowserPreparation {
  return { prepared: { browserName: browserName, bookmarks: bookmarks, history: history, found: countBrowserImport(bookmarks, history) } };
}

/**
 * Reads Safari's bookmarks (with the Reading List as a folder of its own) and history.
 */
async function prepareSafari(): Promise<BrowserPreparation> {
  const homeFolder = getImportHomeFolder();
  const bookmarks = await readSafariBookmarks(homeFolder);
  if (!bookmarks.ok && bookmarks.reason === "needsFullDiskAccess") {
    return { needsFullDiskAccess: true };
  }
  const tree: ImportedBookmarkNode[] = [];
  if (bookmarks.ok) {
    tree.push(...bookmarks.value.bookmarks);
    if (bookmarks.value.readingList.length > 0) {
      tree.push({ kind: "folder", title: "Reading List", children: bookmarks.value.readingList });
    }
  }
  const history = await readSafariHistory(homeFolder);
  return toPreparation("Safari", tree, history.ok ? history.value : []);
}

/**
 * Reads what one source from listImportSources() has, and counts it. Changes nothing.
 */
export async function prepareBrowserImport(sourceId: string): Promise<BrowserPreparation> {
  const homeFolder = getImportHomeFolder();
  if (sourceId === SAFARI_SOURCE_ID) {
    return prepareSafari();
  }
  if (sourceId.startsWith(FIREFOX_SOURCE_PREFIX)) {
    const firefoxProfile = findFirefoxProfiles(homeFolder).find((candidate) => `${FIREFOX_SOURCE_PREFIX}${candidate.folderName}` === sourceId);
    if (firefoxProfile === undefined) {
      return { isMissing: true };
    }
    const profileData = await readFirefoxProfile(firefoxProfile);
    return toPreparation("Firefox", profileData.bookmarks, profileData.history);
  }
  const profile = findChromiumProfiles(homeFolder).find((candidate) => `${CHROMIUM_SOURCE_PREFIX}${candidate.browserId}:${candidate.folderName}` === sourceId);
  if (profile === undefined) {
    return { isMissing: true };
  }
  return toPreparation(profile.browserName, readChromiumBookmarks(profile), await readChromiumHistory(profile));
}

/**
 * Brings the chosen parts of a prepared import over: the bookmarks as one folder in the active Space, then the
 * history. `onPartDone` hears as each lands (the onboarding ticks its checklist).
 */
export function applyBrowserImport(prepared: PreparedBrowserImport, parts: ImportPart[], onPartDone: (part: ImportPart) => void): BrowserImportResult {
  const result: BrowserImportResult = { bookmarks: 0, historyPages: 0 };
  const bookmarkCount = countBookmarks(prepared.bookmarks);
  if (parts.includes("bookmarks") && bookmarkCount > 0) {
    const folderTitle = `${prepared.browserName} Bookmarks`;
    applyChange((state) => addImportedBookmarks(state, getActiveSpace(state).id, folderTitle, prepared.bookmarks, Date.now()));
    result.bookmarks = bookmarkCount;
    onPartDone("bookmarks");
  }
  if (parts.includes("history")) {
    result.historyPages = importHistoryEntries(prepared.history);
    onPartDone("history");
  }
  return result;
}

/**
 * Explains that macOS keeps Safari's files private, and offers to open the right settings pane. `window`: the window
 * the question is attached to.
 */
async function explainFullDiskAccess(window: BrowserWindow): Promise<void> {
  const answer = await dialog.showMessageBox(window, {
    type: "info",
    message: "Safari's bookmarks need your permission",
    detail:
      "macOS keeps Safari's files private. Turn on Bow in System Settings › Privacy & Security › Full Disk Access, then import again.",
    buttons: ["Open System Settings", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
  if (answer.response === 0) {
    await openFullDiskAccessSettings();
  }
}

/**
 * Opens System Settings at Full Disk Access (the onboarding's button, and the menu's question above).
 */
export async function openFullDiskAccessSettings(): Promise<void> {
  await shell.openExternal(FULL_DISK_ACCESS_SETTINGS_URL);
}

/**
 * Tells the user what arrived.
 */
async function showSummary(window: BrowserWindow, browserName: string, result: BrowserImportResult): Promise<void> {
  const spaceName = getActiveSpace(getState()).name;
  const nothingNew = result.bookmarks === 0 && result.historyPages === 0;
  await dialog.showMessageBox(window, {
    type: "info",
    message: nothingNew ? `Nothing to import from ${browserName}` : `Imported from ${browserName}`,
    detail: nothingNew
      ? "No bookmarks, and no pages that are not in your history already."
      : `Bookmarks: ${result.bookmarks}, in the folder "${browserName} Bookmarks" in ${spaceName}.\nHistory: ${result.historyPages} pages.`,
  });
}

/**
 * File › Import From Browser: brings one source's bookmarks and history over and says what arrived.
 */
export async function importFromBrowser(sourceId: string): Promise<void> {
  const window = getWindow();
  if (window === null) {
    return;
  }
  const preparation = await prepareBrowserImport(sourceId);
  if ("needsFullDiskAccess" in preparation) {
    await explainFullDiskAccess(window);
    return;
  }
  if ("isMissing" in preparation) {
    return;
  }
  const result = applyBrowserImport(preparation.prepared, IMPORT_PART_ORDER, () => undefined);
  await showSummary(window, preparation.prepared.browserName, result);
}
