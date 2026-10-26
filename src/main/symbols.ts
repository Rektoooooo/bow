/**
 * WHY this file exists:
 *   Our icons are Apple's SF Symbols, like Arc's. macOS draws them for us: nativeImage.createFromNamedImage() renders
 *   a symbol by name as a template image (a black glyph on transparent, at 2× resolution). This file renders every
 *   symbol in SYMBOL_NAMES once and hands them to our pages, which tint them with the text color. Nothing is copied
 *   into the project; the images come from the running system.
 *
 * Data source:
 *   SYMBOL_NAMES (src/shared/symbols.ts) and macOS.
 *
 * Data flow:
 *   page starts → getSymbols() over IPC ("browser:get-symbols") → getSymbolImages() → { name: { url, width, height } }
 *   → icons.ts installSymbols() in the page
 */
import { ipcMain, nativeImage } from "electron";
import { IPC_CHANNELS } from "../shared/ipcChannels";
import { SYMBOL_NAMES } from "../shared/symbols";
import type { SymbolImage } from "../shared/symbols";

/** macOS renders symbols at 2× (a 13 pt symbol arrives as roughly 26 pixels tall). */
const SYMBOL_SCALE_FACTOR = 2;

/** Rendered once, then reused for every page. */
let renderedSymbols: Record<string, SymbolImage> | null = null;

/**
 * Renders every symbol in SYMBOL_NAMES. A name macOS does not know is left out (the page then shows no icon there).
 */
export function getSymbolImages(): Record<string, SymbolImage> {
  if (renderedSymbols !== null) {
    return renderedSymbols;
  }
  const images: Record<string, SymbolImage> = {};
  for (const [iconName, symbolName] of Object.entries(SYMBOL_NAMES)) {
    const image = nativeImage.createFromNamedImage(symbolName);
    if (image.isEmpty()) {
      console.warn(`macOS has no SF Symbol named ${symbolName}`);
      continue;
    }
    const size = image.getSize();
    images[iconName] = { url: image.toDataURL(), width: size.width / SYMBOL_SCALE_FACTOR, height: size.height / SYMBOL_SCALE_FACTOR };
  }
  renderedSymbols = images;
  return images;
}

/**
 * True for our own pages (they load from files in the app); web pages have no preload and cannot ask anyway.
 */
function isOwnPage(url: string | undefined): boolean {
  return url !== undefined && url.startsWith("file://");
}

/**
 * Answers the pages' getSymbols() calls. Runs once at startup.
 */
export function registerSymbolIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getSymbols, (event) => (isOwnPage(event.senderFrame?.url) ? getSymbolImages() : {}));
}
