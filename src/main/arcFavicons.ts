/**
 * WHY this file exists:
 *   Imported tabs have not loaded yet, so they have no icons. Arc keeps a 16×16 PNG of every sidebar item's favicon
 *   on disk; reusing those makes the imported sidebar look right before any page loads.
 *
 * Data source:
 *   Arc's SidebarItemsFaviconCache folder, and ArchiveItemsFaviconCache for archived tabs (same naming). Each file is a PNG named after the MD5 hash of the Arc item id
 *   (found on 2026-10-26: 23 of 26 tabs matched md5(item id), none matched the URL or host).
 *
 * Data flow:
 *   main.ts importFromArc() → attachArcFavicons() / attachArcArchiveFavicons(state, folder) → tabs with "arc-<id>"
 *   ids get data: URL icons
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchivedTab, BrowserState, TabItem } from "../shared/types";

/** Imported item ids are "arc-" + Arc's own id (arcImport.ts). */
const IMPORTED_ITEM_PREFIX = "arc-";

/** Arc's cached icons are tiny; anything bigger is not an icon we want inside the state file. */
const MAX_ICON_BYTES = 16 * 1024;

/**
 * Returns the path of Arc's cached icon for an Arc item id.
 */
function getCachedIconPath(cacheFolder: string, arcItemId: string): string {
  const fileName = createHash("md5").update(arcItemId).digest("hex");
  return path.join(cacheFolder, fileName);
}

/**
 * Reads one cached icon as a data: URL, or returns null when it is missing, too big or unreadable.
 */
function readIconAsDataUrl(iconPath: string): string | null {
  try {
    const iconBytes = fs.readFileSync(iconPath);
    if (iconBytes.length === 0 || iconBytes.length > MAX_ICON_BYTES) {
      return null;
    }
    return `data:image/png;base64,${iconBytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Gives every imported tab without an icon the icon Arc cached for it. Returns the same state when none was found.
 */
export function attachArcFavicons(state: BrowserState, cacheFolder: string): BrowserState {
  if (!fs.existsSync(cacheFolder)) {
    return state;
  }
  let items = state.items;
  for (const item of Object.values(state.items)) {
    if (item.kind !== "tab" || item.faviconUrl !== null || !item.id.startsWith(IMPORTED_ITEM_PREFIX)) {
      continue;
    }
    const arcItemId = item.id.slice(IMPORTED_ITEM_PREFIX.length);
    const dataUrl = readIconAsDataUrl(getCachedIconPath(cacheFolder, arcItemId));
    if (dataUrl === null) {
      continue;
    }
    const tabWithIcon: TabItem = { ...item, faviconUrl: dataUrl };
    items = { ...items, [item.id]: tabWithIcon };
  }
  return items === state.items ? state : { ...state, items: items };
}

/**
 * Gives every imported archived tab without an icon the icon Arc cached for it in ArchiveItemsFaviconCache.
 * Returns the same state when none was found.
 */
export function attachArcArchiveFavicons(state: BrowserState, cacheFolder: string): BrowserState {
  if (!fs.existsSync(cacheFolder)) {
    return state;
  }
  let hasChanged = false;
  const archive: ArchivedTab[] = state.archive.map((archivedTab) => {
    const tab = archivedTab.tab;
    if (tab.faviconUrl !== null || !tab.id.startsWith(IMPORTED_ITEM_PREFIX)) {
      return archivedTab;
    }
    const arcItemId = tab.id.slice(IMPORTED_ITEM_PREFIX.length);
    const dataUrl = readIconAsDataUrl(getCachedIconPath(cacheFolder, arcItemId));
    if (dataUrl === null) {
      return archivedTab;
    }
    hasChanged = true;
    return { ...archivedTab, tab: { ...tab, faviconUrl: dataUrl } };
  });
  return hasChanged ? { ...state, archive: archive } : state;
}
