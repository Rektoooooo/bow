/**
 * WHY this file exists:
 *   File › Import from Arc… brings the user's Arc sidebar into this browser. The pure reader (arcImport.ts) does the
 *   translating; this file does the parts around it: find or ask for the file, read it, attach Arc's cached icons,
 *   replace the empty starter Spaces, switch to the first imported Space and report what happened.
 *
 * Data source:
 *   ~/Library/Application Support/Arc/StorableSidebar.json (or a file the user picks) and the
 *   SidebarItemsFaviconCache folder next to it.
 *
 * Data flow:
 *   menu → importFromArc() → importArcSidebar() → attachArcFavicons() → applyChange() → summary dialog
 */
import { app, dialog } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { attachArcFavicons } from "./arcFavicons";
import { importArcSidebar } from "./arcImport";
import type { ArcImportReport } from "./arcImport";
import { applyChange, getState, getWindow } from "./browserCore";
import { removeEmptySpaces, switchSpace } from "./spaces";

/** Where Arc keeps its sidebar on the account that uses it (docs/research/arc-data-model.md). */
const ARC_SIDEBAR_FILE = path.join(app.getPath("home"), "Library", "Application Support", "Arc", "StorableSidebar.json");

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
function describeReport(report: ArcImportReport): string {
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
  return lines.join("\n");
}

/**
 * Imports the user's Arc sidebar. Safe to run twice: Spaces imported before are skipped.
 */
export async function importFromArc(): Promise<void> {
  const window = getWindow();
  const filePath = await chooseSidebarFile();
  if (window === null || filePath === null) {
    return;
  }

  let parsedFile: unknown = null;
  try {
    parsedFile = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    dialog.showErrorBox("Import from Arc", `The file could not be read: ${String(error)}`);
    return;
  }

  const stateBefore = getState();
  const result = importArcSidebar(parsedFile, stateBefore, Date.now());
  if (result.report.error !== null) {
    dialog.showErrorBox("Import from Arc", result.report.error);
    return;
  }

  const existingSpaceIds = new Set(stateBefore.spaces.map((space) => space.id));
  const firstNewSpace = result.state.spaces.find((space) => space.id.startsWith(IMPORTED_SPACE_PREFIX) && !existingSpaceIds.has(space.id));
  const faviconFolder = path.join(path.dirname(filePath), "SidebarItemsFaviconCache");
  applyChange(() => {
    const withIcons = attachArcFavicons(result.state, faviconFolder);
    const withoutStarters = result.report.spacesImported > 0 ? removeEmptySpaces(withIcons, STARTER_SPACE_IDS) : withIcons;
    if (firstNewSpace === undefined) {
      return withoutStarters;
    }
    return switchSpace(withoutStarters, firstNewSpace.id, Date.now());
  });

  await dialog.showMessageBox(window, {
    type: "info",
    message: result.report.spacesImported > 0 ? "Imported your Arc sidebar" : "Nothing new to import",
    detail: describeReport(result.report),
  });
}
