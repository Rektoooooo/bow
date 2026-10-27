/**
 * WHY this file exists:
 *   Arc borders the selected Favorite in the site's own colour. The sidebar cannot read a favicon's pixels (icons
 *   from other sites taint a canvas), so main loads each Favorite's icon, has macOS decode it and keeps its colour
 *   (shared/faviconColor.ts picks it).
 *
 * Data source:
 *   The Favorites' icon addresses in the state (the page's own icon, or the site's /favicon.ico); the icons from the
 *   network, or from data: addresses.
 *
 * Data flow:
 *   state changes → refreshFaviconAccents(state) → icons not seen yet load in the background → decoded by macOS, or
 *   by iconFile.ts for .ico files macOS cannot read → pickAccentColor()
 *   → onAccentFound → runtime push → RuntimeState.faviconAccents → sidebar.ts
 */
import { nativeImage, net } from "electron";
import { getFaviconAddress, pickAccentColor } from "../shared/faviconColor";
import type { BrowserState } from "../shared/types";
import { readIconFile } from "./iconFile";
import { findTab } from "./tree";

/** Icons are read at this size: enough to tell a logo's colour, cheap to scan. Our choice. */
const SAMPLE_SIZE_PX = 32;

/** Icon address → its colour, or null when it has none (black and white, or it would not load). */
const accents = new Map<string, string | null>();
const loading = new Set<string>();
let accentFoundListener: (() => void) | null = null;

/**
 * Sets what to call when an icon's colour becomes known (main.ts pushes the runtime state then). Runs once.
 */
export function initializeFaviconAccents(onAccentFound: () => void): void {
  accentFoundListener = onAccentFound;
}

/**
 * The colours found so far, by icon address, for the sidebar.
 */
export function getFaviconAccents(): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [address, color] of accents) {
    if (color !== null) {
      found[address] = color;
    }
  }
  return found;
}

/**
 * The raw bytes behind an icon address: decoded from a data: address, or fetched from the web.
 */
async function readIconBytes(address: string): Promise<Buffer | null> {
  if (address.startsWith("data:")) {
    const commaIndex = address.indexOf(",");
    const isBase64 = address.slice(0, commaIndex).endsWith(";base64");
    const payload = address.slice(commaIndex + 1);
    return isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
  }
  if (!address.startsWith("https://") && !address.startsWith("http://")) {
    return null;
  }
  const response = await net.fetch(address);
  if (!response.ok) {
    return null;
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * The colour of an image macOS can decode (PNG, JPEG, most .ico files), or null.
 */
function pickColorOfImage(bytes: Uint8Array): string | null {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (image.isEmpty()) {
    return null;
  }
  const small = image.resize({ width: SAMPLE_SIZE_PX, height: SAMPLE_SIZE_PX, quality: "good" });
  return pickAccentColor(small.toBitmap(), SAMPLE_SIZE_PX, SAMPLE_SIZE_PX);
}

/**
 * The colour of an icon's bytes: decoded by macOS, or read here when it is an .ico macOS cannot decode (YouTube's).
 */
function pickColorOfIcon(bytes: Buffer): string | null {
  const decodedColor = pickColorOfImage(bytes);
  if (decodedColor !== null) {
    return decodedColor;
  }
  const picture = readIconFile(bytes);
  if (picture === null) {
    return null;
  }
  if (picture.kind === "png") {
    return pickColorOfImage(picture.bytes);
  }
  return pickAccentColor(picture.pixels, picture.width, picture.height);
}

/**
 * Loads one icon and keeps its colour (null when it has none or cannot be read).
 */
async function loadAccent(address: string): Promise<void> {
  loading.add(address);
  let color: string | null = null;
  try {
    const bytes = await readIconBytes(address);
    color = bytes === null ? null : pickColorOfIcon(bytes);
  } catch {
    color = null;
  }
  loading.delete(address);
  accents.set(address, color);
  if (color !== null) {
    accentFoundListener?.();
  }
}

/**
 * Starts loading the colour of every Favorite's icon not seen yet.
 */
export function refreshFaviconAccents(state: BrowserState): void {
  for (const profile of state.profiles) {
    for (const favoriteId of profile.favoriteIds) {
      const tab = findTab(state, favoriteId);
      const address = tab === undefined ? null : getFaviconAddress(tab.faviconUrl, tab.url);
      if (address === null || accents.has(address) || loading.has(address)) {
        continue;
      }
      loadAccent(address).catch(() => undefined);
    }
  }
}
