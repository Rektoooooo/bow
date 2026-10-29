/**
 * WHY this file exists:
 *   Our icons are Apple's SF Symbols, like Arc's. macOS draws them for us: nativeImage.createFromNamedImage() renders
 *   a symbol by name as a template image (a black glyph on transparent, at 2× resolution). This file renders every
 *   symbol in SYMBOL_NAMES once and hands them to our pages, which tint them with the text color. Nothing is copied
 *   into the project; the images come from the running system. Rendering all of them takes about 190 ms (measured
 *   2026-10-27) and the sidebar's first picture waited for it, so the rendered images are kept in a cache file in the
 *   user's data folder, made again when macOS or the list of symbols changes.
 *
 * Data source:
 *   SYMBOL_NAMES (src/shared/symbols.ts) and macOS, or <userData>/symbol-cache.json from an earlier start.
 *
 * Data flow:
 *   page starts → getSymbols() over IPC ("browser:get-symbols") → getSymbolImages() → the cache file if it matches,
 *   else render and write the cache → { name: { url, width, height } } → icons.ts installSymbols() in the page
 */
import { app, ipcMain, nativeImage, session } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { IPC_CHANNELS } from "../shared/ipcChannels";
import { SPACE_ICON_CHOICES } from "../shared/spaceIcons";
import { SYMBOL_NAMES } from "../shared/symbols";
import type { SymbolImage } from "../shared/symbols";
import type { WebContents } from "electron";

/** macOS renders symbols at 2× (a 13 pt symbol arrives as roughly 26 pixels tall). */
const SYMBOL_SCALE_FACTOR = 2;

/** Rendered (or read) once, then reused for every page. */
let renderedSymbols: Record<string, SymbolImage> | null = null;

const SYMBOL_CACHE_FILE_NAME = "symbol-cache.json";

/** What the cache file holds: the images, and what they were made from (a mismatch means render again). */
interface SymbolCache {
  systemVersion: string;
  symbolList: string;
  images: Record<string, SymbolImage>;
}

/**
 * Every icon name with the symbol it shows. Space icons (shared/spaceIcons.ts) are keyed "space:<name>";
 * renderer/spaceIcon.ts draws them.
 */
function listSymbolEntries(): [string, string][] {
  const spaceIconEntries: [string, string][] = SPACE_ICON_CHOICES.filter((choice) => choice.symbol !== null).map((choice) => [`space:${choice.name}`, choice.symbol as string]);
  return [...Object.entries(SYMBOL_NAMES), ...spaceIconEntries];
}

/**
 * The cache file's images when they were made by this macOS for this list of symbols, else null.
 */
function readSymbolCache(cachePath: string, symbolList: string): Record<string, SymbolImage> | null {
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf8")) as Partial<SymbolCache>;
    const isCurrent = cache.systemVersion === process.getSystemVersion() && cache.symbolList === symbolList;
    return isCurrent && typeof cache.images === "object" && cache.images !== null ? cache.images : null;
  } catch {
    return null;
  }
}

/**
 * Renders every symbol in SYMBOL_NAMES (or reads them from the cache file of an earlier start). A name macOS does not
 * know is left out (the page then shows no icon there).
 */
export function getSymbolImages(): Record<string, SymbolImage> {
  if (renderedSymbols !== null) {
    return renderedSymbols;
  }
  const entries = listSymbolEntries();
  const symbolList = entries.map(([iconName, symbolName]) => `${iconName}=${symbolName}`).join(",");
  const cachePath = path.join(app.getPath("userData"), SYMBOL_CACHE_FILE_NAME);
  const cachedImages = readSymbolCache(cachePath, symbolList);
  if (cachedImages !== null) {
    renderedSymbols = cachedImages;
    return cachedImages;
  }
  const images: Record<string, SymbolImage> = {};
  for (const [iconName, symbolName] of entries) {
    const image = nativeImage.createFromNamedImage(symbolName);
    if (image.isEmpty()) {
      console.warn(`macOS has no SF Symbol named ${symbolName}`);
      continue;
    }
    const size = image.getSize();
    images[iconName] = { url: image.toDataURL(), width: size.width / SYMBOL_SCALE_FACTOR, height: size.height / SYMBOL_SCALE_FACTOR };
  }
  renderedSymbols = images;
  const cache: SymbolCache = { systemVersion: process.getSystemVersion(), symbolList: symbolList, images: images };
  // Written in the background; a failed write only means rendering again next time.
  fs.promises.writeFile(cachePath, JSON.stringify(cache)).catch((error) => console.warn("Could not keep the rendered symbols:", error));
  return images;
}

/**
 * True for our own pages. Two proofs, because web pages in a profile with extensions or the forms helper now have a
 * preload with ipcRenderer too: our pages all use the default session (web pages never do: they run in a profile's
 * or a private window's own session), and they load from files in the app.
 */
function isOwnPage(contents: WebContents, url: string | undefined): boolean {
  const isDefaultSession = contents.session === session.defaultSession;
  return isDefaultSession && url !== undefined && url.startsWith("file://");
}

/**
 * Answers the pages' getSymbols() calls. Runs once at startup.
 */
export function registerSymbolIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getSymbols, (event) => (isOwnPage(event.sender, event.senderFrame?.url) ? getSymbolImages() : {}));
}
