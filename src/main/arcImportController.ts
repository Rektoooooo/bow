/**
 * WHY this file exists:
 *   File › Import from Arc… brings the user's Arc sidebar, archive, history and extensions into this browser. The pure reader (arcImport.ts) does the
 *   translating; this file does the parts around it: find or ask for the file, read it, attach Arc's cached icons,
 *   replace the empty starter Spaces, switch to the first imported Space and report what happened.
 *
 * Data source:
 *   ~/Library/Application Support/Arc/StorableSidebar.json (or a file the user picks, such as a backup of that
 *   folder), and next to it StorableArchiveItems.json, StorableWindows.json (the sidebar width), the favicon cache
 *   folders, and "User Data" with the History databases and the extensions.
 *
 * Data flow:
 *   menu → importFromArc() → importArcSidebar() → importArcArchive() → attachArcFavicons() → applyChange()
 *   → readArcHistory() → importHistoryEntries() → importArcExtensions() → summary dialog (or, from the onboarding,
 *   the summary returned to its card)
 */
import { app, dialog } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { importArcArchive } from "./arcArchiveImport";
import type { ArcArchiveImportReport } from "./arcArchiveImport";
import { attachArcArchiveFavicons, attachArcFavicons } from "./arcFavicons";
import { readArcHistory } from "./arcHistoryImport";
import { importArcSidebar, readArcSidebarWidth } from "./arcImport";
import type { ArcImportReport } from "./arcImport";
import { applyChange, getState, getWindow } from "./browserCore";
import { importArcExtensions } from "./extensionsController";
import type { ArcExtensionsImportReport } from "./extensionsController";
import type { ImportSummary } from "../shared/onboarding";
import { importHistoryEntries } from "./historyStore";
import { removeEmptySpaces, switchSpace } from "./spaces";
import { setSidebarWidth } from "./state";

/** Where Arc keeps its sidebar on the account that uses it (docs/research/arc-data-model.md). */
const ARC_SIDEBAR_FILE = path.join(app.getPath("home"), "Library", "Application Support", "Arc", "StorableSidebar.json");

const ARCHIVE_FILE_NAME = "StorableArchiveItems.json";

/** Arc's windows, with the sidebar width the user dragged to (docs/research/arc-data-model.md). */
const WINDOWS_FILE_NAME = "StorableWindows.json";

/** The two Spaces a fresh install starts with; an import replaces them while they are still empty. */
const STARTER_SPACE_IDS = ["space-personal", "space-work"];

/** The prefix arcImport.ts gives imported Space ids. */
const IMPORTED_SPACE_PREFIX = "arc-space-";

/**
 * Returns Arc's sidebar file, asking the user to pick one when Arc's usual file is missing. Null when cancelled.
 */
async function chooseSidebarFile(): Promise<string | null> {
  if (fs.existsSync(ARC_SIDEBAR_FILE)) {
    return ARC_SIDEBAR_FILE;
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
 * Builds the summary shown after an import.
 */
function describeReport(
  report: ArcImportReport,
  archiveReport: ArcArchiveImportReport | undefined,
  historyPagesImported: number,
  extensionsReport: ArcExtensionsImportReport,
): string {
  const skippedCount = Object.values(report.skippedByKind).reduce((sum, count) => sum + count, 0);
  const lines = [
    `Spaces: ${report.spacesImported} (already imported before: ${report.spacesAlreadyImported})`,
    `Tabs: ${report.tabsImported}, folders: ${report.foldersImported}, split views: ${report.splitViewsImported}`,
    `Favorites: ${report.favoritesImported}`,
  ];
  if (report.favoritesDropped > 0) {
    lines.push(`${report.favoritesDropped} Favorite(s) left out: a profile can have 12.`);
  }
  if (report.spacesDropped > 0) {
    lines.push(`${report.spacesDropped} Space(s) left out: the browser holds 9.`);
  }
  if (skippedCount > 0) {
    lines.push(`${skippedCount} item(s) this browser cannot show yet were left out (easels, notes, …).`);
  }
  if (archiveReport !== undefined) {
    lines.push(`Archived tabs: ${archiveReport.archivedImported}`);
  }
  lines.push(`History: ${historyPagesImported} pages`);
  const turnedOff = extensionsReport.importedTurnedOff > 0 ? ` (${extensionsReport.importedTurnedOff} off, as they were in Arc)` : "";
  const alreadyAdded = extensionsReport.alreadyAdded > 0 ? `, already added before: ${extensionsReport.alreadyAdded}` : "";
  lines.push(`Extensions: ${extensionsReport.imported}${turnedOff}${alreadyAdded}`);
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
 * True when Arc's sidebar is on this Mac (the onboarding offers Arc only then; the menu can also pick a backup).
 */
export function isArcSidebarPresent(): boolean {
  return fs.existsSync(ARC_SIDEBAR_FILE);
}

/**
 * Imports the user's Arc sidebar. Safe to run twice: Spaces imported before are skipped. Returns what arrived, or
 * null when nothing was imported (cancelled, or an error the user was shown). `showsSummary`: the dialog at the end
 * (the onboarding shows the summary on its card instead).
 */
export async function importFromArc(showsSummary: boolean = true): Promise<ImportSummary | null> {
  const window = getWindow();
  const filePath = await chooseSidebarFile();
  if (window === null || filePath === null) {
    return null;
  }

  let parsedFile: unknown = null;
  try {
    parsedFile = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    dialog.showErrorBox("Import from Arc", `The file could not be read: ${String(error)}`);
    return null;
  }

  const stateBefore = getState();
  const result = importArcSidebar(parsedFile, stateBefore, Date.now());
  if (result.report.error !== null) {
    dialog.showErrorBox("Import from Arc", result.report.error);
    return null;
  }

  const existingSpaceIds = new Set(stateBefore.spaces.map((space) => space.id));
  const firstNewSpace = result.state.spaces.find((space) => space.id.startsWith(IMPORTED_SPACE_PREFIX) && !existingSpaceIds.has(space.id));
  const faviconFolder = path.join(path.dirname(filePath), "SidebarItemsFaviconCache");
  const archiveFaviconFolder = path.join(path.dirname(filePath), "ArchiveItemsFaviconCache");
  const arcArchiveFile = readFileNextToSidebar(filePath, ARCHIVE_FILE_NAME);
  const arcSidebarWidth = readArcSidebarWidth(readFileNextToSidebar(filePath, WINDOWS_FILE_NAME));
  // A list, because the callback below fills it and TypeScript cannot see assignments to a plain variable there.
  const archiveReports: ArcArchiveImportReport[] = [];
  applyChange(() => {
    let sidebarAndArchiveState = result.state;
    if (arcArchiveFile !== null) {
      const archiveResult = importArcArchive(arcArchiveFile, result.state, Date.now());
      archiveReports.push(archiveResult.report);
      sidebarAndArchiveState = attachArcArchiveFavicons(archiveResult.state, archiveFaviconFolder);
    }
    const withIcons = attachArcFavicons(sidebarAndArchiveState, faviconFolder);
    const withoutStarters = result.report.spacesImported > 0 ? removeEmptySpaces(withIcons, STARTER_SPACE_IDS) : withIcons;
    // Arc's sidebar width comes along with the first import only; a later run must not undo a width set here since.
    const takesArcWidth = result.report.spacesImported > 0 && arcSidebarWidth !== null;
    const withSidebarWidth = takesArcWidth ? setSidebarWidth(withoutStarters, arcSidebarWidth) : withoutStarters;
    if (firstNewSpace === undefined) {
      return withSidebarWidth;
    }
    return switchSpace(withSidebarWidth, firstNewSpace.id, Date.now());
  });

  // History and extensions come from the folder of the chosen sidebar file: Arc's own folder, or a backup copy of it
  // (with its "User Data" folder) once Arc is gone.
  const arcFolder = path.dirname(filePath);
  const historyPagesImported = importHistoryEntries(await readArcHistory(arcFolder));
  // After the sidebar, which creates the profiles the extensions belong to.
  const extensionsReport = importArcExtensions(arcFolder);

  const summary: ImportSummary = {
    spaces: result.report.spacesImported,
    tabs: result.report.tabsImported,
    bookmarks: 0,
    historyPages: historyPagesImported,
  };
  if (showsSummary) {
    await dialog.showMessageBox(window, {
      type: "info",
      message: result.report.spacesImported > 0 ? "Imported your Arc sidebar" : "Nothing new to import",
      detail: describeReport(result.report, archiveReports[0], historyPagesImported, extensionsReport),
    });
  }
  return summary;
}
