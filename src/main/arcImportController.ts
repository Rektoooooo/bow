/**
 * WHY this file exists:
 *   File › Import from Arc… and the onboarding bring the user's Arc sidebar, archive, history and extensions into this
 *   browser. The pure readers (arcImport.ts, arcArchiveImport.ts) do the translating; this file does the parts around
 *   them, in two steps: prepare (find or ask for the file, read everything once and count what would arrive, without
 *   changing anything) and apply (bring the chosen parts over one by one: attach Arc's cached icons, replace the empty
 *   starter Spaces, switch to the first imported Space). The onboarding shows the counts and lets the user leave parts
 *   out; the menu brings everything and shows a summary.
 *
 * Data source:
 *   ~/Library/Application Support/Arc/StorableSidebar.json (or a file the user picks, such as a backup of that
 *   folder), and next to it StorableArchiveItems.json, StorableWindows.json (the sidebar width), the favicon cache
 *   folders, and "User Data" with the History databases and the extensions.
 *
 * Data flow:
 *   menu → importFromArc() → prepareArcImport() → applyArcImport(every part) → summary dialog
 *   onboardingWindow.ts → prepareArcImport(ARC_SIDEBAR_FILE) → counts on its card → applyArcImport(chosen parts,
 *   each reported as it lands)
 *   applyArcImport: importArcSidebar() → attachArcFavicons() → applyChange() → importArcArchive() → applyChange()
 *   → importArcExtensions() → importHistoryEntries()
 */
import { dialog } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { importArcArchive } from "./arcArchiveImport";
import type { ArcArchiveImportReport } from "./arcArchiveImport";
import { findArcExtensions } from "./arcExtensionsImport";
import { attachArcArchiveFavicons, attachArcFavicons } from "./arcFavicons";
import { readArcHistory } from "./arcHistoryImport";
import { importArcSidebar, readArcSidebarWidth } from "./arcImport";
import type { ArcImportReport } from "./arcImport";
import { applyChange, getState, getWindow } from "./browserCore";
import { findExtension } from "./extensionList";
import { importArcExtensions } from "./extensionsController";
import type { ArcExtensionsImportReport } from "./extensionsController";
import { IMPORT_PART_ORDER } from "../shared/onboarding";
import type { ImportFound, ImportPart } from "../shared/onboarding";
import type { HistoryEntry } from "./history";
import { countNewHistoryUrls, importHistoryEntries } from "./historyStore";
import { getImportHomeFolder } from "./importHome";
import { STARTER_SPACE_IDS, removeEmptySpaces, switchSpace } from "./spaces";
import { setSidebarWidth } from "./state";

/** Where Arc keeps its sidebar on the account that uses it (docs/research/arc-data-model.md). */
function getArcSidebarFile(): string {
  return path.join(getImportHomeFolder(), "Library", "Application Support", "Arc", "StorableSidebar.json");
}

const ARCHIVE_FILE_NAME = "StorableArchiveItems.json";

/** Arc's windows, with the sidebar width the user dragged to (docs/research/arc-data-model.md). */
const WINDOWS_FILE_NAME = "StorableWindows.json";

/** The prefix arcImport.ts gives imported Space ids. */
const IMPORTED_SPACE_PREFIX = "arc-space-";

/** Everything an Arc import needs, read once; nothing has changed yet. */
export interface PreparedArcImport {
  /** The folder of the sidebar file: Arc's own, or a backup copy of it (with its "User Data" folder). */
  arcFolder: string;
  sidebarFile: unknown;
  archiveFile: unknown;
  sidebarWidth: number | null;
  history: HistoryEntry[];
  found: ImportFound;
}

/** What applying an import did, part by part (null: that part was not chosen). */
export interface ArcImportResult {
  sidebarReport: ArcImportReport | null;
  archiveReport: ArcArchiveImportReport | null;
  extensionsReport: ArcExtensionsImportReport | null;
  historyPages: number;
}

/**
 * Returns Arc's sidebar file, asking the user to pick one when Arc's usual file is missing. Null when cancelled.
 */
async function chooseSidebarFile(): Promise<string | null> {
  if (fs.existsSync(getArcSidebarFile())) {
    return getArcSidebarFile();
  }
  const window = getWindow();
  if (window === null) {
    return null;
  }
  const choice = await dialog.showOpenDialog(window, {
    title: "Choose Arc's StorableSidebar.json",
    properties: ["openFile"],
    filters: [{ name: "Arc sidebar", extensions: ["json"] }],
  });
  const chosenPath = choice.filePaths[0];
  if (choice.canceled || chosenPath === undefined) {
    return null;
  }
  return chosenPath;
}

/**
 * Builds the summary shown after an import from the menu.
 */
function describeResult(result: ArcImportResult): string {
  const report = result.sidebarReport;
  const lines: string[] = [];
  if (report !== null) {
    const skippedCount = Object.values(report.skippedByKind).reduce((sum, count) => sum + count, 0);
    lines.push(`Spaces: ${report.spacesImported} (already imported before: ${report.spacesAlreadyImported})`);
    lines.push(`Tabs: ${report.tabsImported}, folders: ${report.foldersImported}, split views: ${report.splitViewsImported}`);
    lines.push(`Favorites: ${report.favoritesImported}`);
    if (report.favoritesDropped > 0) {
      lines.push(`${report.favoritesDropped} Favorite(s) left out: a Space can have 12.`);
    }
    if (report.spacesDropped > 0) {
      lines.push(`${report.spacesDropped} Space(s) left out: the browser holds 9.`);
    }
    if (skippedCount > 0) {
      lines.push(`${skippedCount} item(s) this browser cannot show yet were left out (easels, notes, …).`);
    }
  }
  if (result.archiveReport !== null) {
    lines.push(`Archived tabs: ${result.archiveReport.archivedImported}`);
  }
  lines.push(`History: ${result.historyPages} pages`);
  const extensionsReport = result.extensionsReport;
  if (extensionsReport !== null) {
    const turnedOff = extensionsReport.importedTurnedOff > 0 ? ` (${extensionsReport.importedTurnedOff} off, as they were in Arc)` : "";
    const alreadyAdded = extensionsReport.alreadyAdded > 0 ? `, already added before: ${extensionsReport.alreadyAdded}` : "";
    lines.push(`Extensions: ${extensionsReport.imported}${turnedOff}${alreadyAdded}`);
  }
  return lines.join("\n");
}

/**
 * Reads one of Arc's files next to the sidebar file. Null when it is missing or cannot be parsed (the archive and the
 * windows file are optional: the sidebar import stands on its own).
 */
function readFileNextToSidebar(sidebarFilePath: string, fileName: string): unknown {
  const filePath = path.join(path.dirname(sidebarFilePath), fileName);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`Could not read Arc's ${fileName}; importing without it:`, error);
    return null;
  }
}

/**
 * Arc's sidebar file on this Mac, or null when Arc is not here (the onboarding offers Arc only then; the menu can
 * also pick a backup).
 */
export function findArcSidebarFile(): string | null {
  const filePath = getArcSidebarFile();
  return fs.existsSync(filePath) ? filePath : null;
}

/**
 * How many of Arc's extensions are not in our profiles yet (the import skips those already added).
 */
function countNewExtensions(arcFolder: string): number {
  const state = getState();
  const scan = findArcExtensions(arcFolder);
  const newExtensions = scan.extensions.filter((found) => findExtension(state, found.profileId, found.extensionId) === undefined);
  return newExtensions.length;
}

/**
 * Reads everything an Arc import needs from the sidebar file and the folder around it, and counts what would arrive
 * (dry runs of the pure importers on the current state). Changes nothing. An error says why the file is not usable.
 */
export async function prepareArcImport(sidebarFilePath: string): Promise<{ prepared: PreparedArcImport } | { error: string }> {
  let sidebarFile: unknown = null;
  try {
    sidebarFile = JSON.parse(await fs.promises.readFile(sidebarFilePath, "utf8"));
  } catch (error) {
    return { error: `The file could not be read: ${String(error)}` };
  }
  const state = getState();
  const now = Date.now();
  const spacesOnly = importArcSidebar(sidebarFile, state, now, { spaces: true, favorites: false });
  if (spacesOnly.report.error !== null) {
    return { error: spacesOnly.report.error };
  }
  const wholeSidebar = importArcSidebar(sidebarFile, state, now);
  const archiveFile = readFileNextToSidebar(sidebarFilePath, ARCHIVE_FILE_NAME);
  const archiveCount = archiveFile === null ? 0 : importArcArchive(archiveFile, wholeSidebar.state, now).report.archivedImported;
  const arcFolder = path.dirname(sidebarFilePath);
  const history = await readArcHistory(arcFolder);
  const counts: Partial<Record<ImportPart, number>> = {
    spaces: spacesOnly.report.spacesImported,
    favorites: wholeSidebar.report.favoritesImported,
    archive: archiveCount,
    extensions: countNewExtensions(arcFolder),
    history: countNewHistoryUrls(history),
  };
  const parts = IMPORT_PART_ORDER.filter((part) => (counts[part] ?? 0) > 0);
  const prepared: PreparedArcImport = {
    arcFolder: arcFolder,
    sidebarFile: sidebarFile,
    archiveFile: archiveFile,
    sidebarWidth: readArcSidebarWidth(readFileNextToSidebar(sidebarFilePath, WINDOWS_FILE_NAME)),
    history: history,
    found: { parts: parts, counts: counts, tabs: spacesOnly.report.tabsImported },
  };
  return { prepared: prepared };
}

/**
 * Brings Arc's Spaces and/or Favorites in (against the state as it is now: the user may have changed things since
 * the counts were made), with their icons; a first import replaces the empty starter Spaces, takes Arc's sidebar width
 * and switches to the first imported Space.
 */
function applySidebarParts(prepared: PreparedArcImport, parts: ImportPart[]): ArcImportReport | null {
  const sidebarParts = { spaces: parts.includes("spaces"), favorites: parts.includes("favorites") };
  const faviconFolder = path.join(prepared.arcFolder, "SidebarItemsFaviconCache");
  // A list, because the callback below fills it and TypeScript cannot see assignments to a plain variable there.
  const reports: ArcImportReport[] = [];
  applyChange((stateBefore) => {
    const result = importArcSidebar(prepared.sidebarFile, stateBefore, Date.now(), sidebarParts);
    reports.push(result.report);
    if (result.report.error !== null) {
      return stateBefore;
    }
    const existingSpaceIds = new Set(stateBefore.spaces.map((space) => space.id));
    const firstNewSpace = result.state.spaces.find((space) => space.id.startsWith(IMPORTED_SPACE_PREFIX) && !existingSpaceIds.has(space.id));
    const withIcons = attachArcFavicons(result.state, faviconFolder);
    const isFirstImport = result.report.spacesImported > 0;
    const withoutStarters = isFirstImport ? removeEmptySpaces(withIcons, STARTER_SPACE_IDS) : withIcons;
    // Arc's sidebar width comes along with the first import only; a later run must not undo a width set here since.
    const takesArcWidth = isFirstImport && prepared.sidebarWidth !== null;
    const withSidebarWidth = takesArcWidth ? setSidebarWidth(withoutStarters, prepared.sidebarWidth ?? 0) : withoutStarters;
    if (firstNewSpace === undefined) {
      return withSidebarWidth;
    }
    return switchSpace(withSidebarWidth, firstNewSpace.id, Date.now());
  });
  return reports[0] ?? null;
}

/**
 * Brings Arc's archived tabs in, with their icons.
 */
function applyArchive(prepared: PreparedArcImport): ArcArchiveImportReport | null {
  if (prepared.archiveFile === null) {
    return null;
  }
  const archiveFaviconFolder = path.join(prepared.arcFolder, "ArchiveItemsFaviconCache");
  const reports: ArcArchiveImportReport[] = [];
  applyChange((stateBefore) => {
    const result = importArcArchive(prepared.archiveFile, stateBefore, Date.now());
    reports.push(result.report);
    return attachArcArchiveFavicons(result.state, archiveFaviconFolder);
  });
  return reports[0] ?? null;
}

/**
 * Brings the chosen parts of a prepared import over, in IMPORT_PART_ORDER, telling `onPartDone` as each lands (the
 * onboarding ticks its checklist). Extensions come after the Spaces, which create the profiles they belong to.
 */
export async function applyArcImport(prepared: PreparedArcImport, parts: ImportPart[], onPartDone: (part: ImportPart) => void): Promise<ArcImportResult> {
  const result: ArcImportResult = { sidebarReport: null, archiveReport: null, extensionsReport: null, historyPages: 0 };
  const sidebarChosen = parts.filter((part) => part === "spaces" || part === "favorites");
  if (sidebarChosen.length > 0) {
    result.sidebarReport = applySidebarParts(prepared, sidebarChosen);
    sidebarChosen.forEach((part) => onPartDone(part));
  }
  if (parts.includes("archive")) {
    result.archiveReport = applyArchive(prepared);
    onPartDone("archive");
  }
  if (parts.includes("extensions")) {
    result.extensionsReport = importArcExtensions(prepared.arcFolder);
    onPartDone("extensions");
  }
  if (parts.includes("history")) {
    result.historyPages = importHistoryEntries(prepared.history);
    onPartDone("history");
  }
  return result;
}

/**
 * File › Import from Arc…: brings everything over and says what arrived. Safe to run twice: Spaces imported before
 * are skipped.
 */
export async function importFromArc(): Promise<void> {
  const window = getWindow();
  const filePath = await chooseSidebarFile();
  if (window === null || filePath === null) {
    return;
  }
  const preparation = await prepareArcImport(filePath);
  if ("error" in preparation) {
    dialog.showErrorBox("Import from Arc", preparation.error);
    return;
  }
  const result = await applyArcImport(preparation.prepared, IMPORT_PART_ORDER, () => undefined);
  const spacesImported = result.sidebarReport?.spacesImported ?? 0;
  await dialog.showMessageBox(window, {
    type: "info",
    message: spacesImported > 0 ? "Imported your Arc sidebar" : "Nothing new to import",
    detail: describeResult(result),
  });
}
