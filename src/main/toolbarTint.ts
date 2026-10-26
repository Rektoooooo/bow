/**
 * WHY this file exists:
 *   Arc tints the toolbar at the top of the page card with the page's own color, and remembers that color per site
 *   (its preferences hold a "TopBarColorCache" of 50 sites, each a hex color and when it was last used). We do the
 *   same. Matching the page's top color also hides the page view's rounded top corners: Electron rounds all four
 *   corners of a web view, while Arc's page meets the toolbar with square corners.
 *
 * Data source:
 *   A one-pixel-high capture of the shown page's top row (its most common color, so a logo at the edge does not
 *   tint the bar), and the cache file toolbar-colors.json in the app's data folder.
 *
 * Data flow:
 *   page stops loading / navigates inside the page → sampleToolbarColorSoon(contents) → cache → onColorChanged
 *   → runtime push → collectTabRuntime() reports toolbarColor → sidebar.ts sets the card's color
 */
import type { WebContents } from "electron";
import * as fs from "node:fs";
import { getSiteKey } from "./urls";

/** Sites remembered, like Arc's cache. The least recently used goes first. */
const CACHE_LIMIT = 50;

/** Wait this long after a page settles before sampling, so it has painted. Our choice. */
const SAMPLE_DELAY_MS = 300;

/** Colors closer than this per channel count as the same when finding the most common one. */
const COLOR_BUCKET_SIZE = 8;

/** Write the cache at most this often. */
const SAVE_DELAY_MS = 2000;

interface CachedColor {
  color: string;
  lastUsed: number;
}

const cache = new Map<string, CachedColor>();
let cacheFilePath: string | null = null;
let saveTimer: NodeJS.Timeout | null = null;
let colorChangedListener: (() => void) | null = null;

/** Pages with a sample already waiting, so a burst of events samples once. */
const pendingSamples = new WeakSet<WebContents>();

/**
 * Loads the cache. Runs once at startup; a missing or broken file starts an empty cache.
 */
export function loadToolbarColors(filePath: string, onColorChanged: () => void): void {
  cacheFilePath = filePath;
  colorChangedListener = onColorChanged;
  try {
    const saved: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (typeof saved !== "object" || saved === null) {
      return;
    }
    for (const [site, entry] of Object.entries(saved as Record<string, unknown>)) {
      const color = (entry as CachedColor | undefined)?.color;
      const lastUsed = (entry as CachedColor | undefined)?.lastUsed;
      if (typeof color === "string" && /^#[0-9a-f]{6}$/.test(color) && typeof lastUsed === "number") {
        cache.set(site, { color: color, lastUsed: lastUsed });
      }
    }
  } catch {
    // No cache yet.
  }
}

/**
 * Returns the site a page's color is remembered under: its registrable domain, or the host for IP addresses.
 */
function getCacheKey(url: string): string | null {
  const site = getSiteKey(url);
  if (site !== null) {
    return site;
  }
  try {
    const host = new URL(url).host;
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

/**
 * The remembered toolbar color of a page's site, or null.
 */
export function getToolbarColor(url: string): string | null {
  const key = getCacheKey(url);
  return key === null ? null : cache.get(key)?.color ?? null;
}

/**
 * Saves the cache a little later (a burst of samples writes once).
 */
function scheduleSave(): void {
  if (saveTimer !== null || cacheFilePath === null) {
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (cacheFilePath === null) {
      return;
    }
    try {
      fs.writeFileSync(cacheFilePath, JSON.stringify(Object.fromEntries(cache)));
    } catch (error) {
      console.warn("Could not save the toolbar colors:", error);
    }
  }, SAVE_DELAY_MS);
}

/**
 * Remembers a site's color, dropping the least recently used site past the limit.
 */
function rememberColor(key: string, color: string, now: number): void {
  const previous = cache.get(key);
  cache.set(key, { color: color, lastUsed: now });
  while (cache.size > CACHE_LIMIT) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [site, entry] of cache) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = site;
      }
    }
    if (oldestKey === null) {
      break;
    }
    cache.delete(oldestKey);
  }
  scheduleSave();
  if (previous?.color !== color) {
    colorChangedListener?.();
  }
}

/**
 * Finds the most common color in a row of BGRA pixels, as "#rrggbb" (colors in the same small bucket count
 * together; the bucket's average is returned).
 */
export function findDominantColor(bgraPixels: Buffer): string | null {
  const buckets = new Map<string, { count: number; red: number; green: number; blue: number }>();
  for (let offset = 0; offset + 3 < bgraPixels.length; offset += 4) {
    const blue = bgraPixels[offset] ?? 0;
    const green = bgraPixels[offset + 1] ?? 0;
    const red = bgraPixels[offset + 2] ?? 0;
    const key = [red, green, blue].map((channel) => Math.floor(channel / COLOR_BUCKET_SIZE)).join(",");
    const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count = bucket.count + 1;
    bucket.red = bucket.red + red;
    bucket.green = bucket.green + green;
    bucket.blue = bucket.blue + blue;
    buckets.set(key, bucket);
  }
  let best: { count: number; red: number; green: number; blue: number } | null = null;
  for (const bucket of buckets.values()) {
    if (best === null || bucket.count > best.count) {
      best = bucket;
    }
  }
  if (best === null) {
    return null;
  }
  const channels = [best.red / best.count, best.green / best.count, best.blue / best.count];
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Samples a page's top row and remembers its color under the page's site.
 */
async function sampleToolbarColor(contents: WebContents): Promise<void> {
  if (contents.isDestroyed()) {
    return;
  }
  const key = getCacheKey(contents.getURL());
  if (key === null) {
    return;
  }
  const image = await contents.capturePage();
  if (image.isEmpty()) {
    return;
  }
  const size = image.getSize();
  const topRow = image.crop({ x: 0, y: 0, width: size.width, height: 1 });
  const color = findDominantColor(topRow.toBitmap());
  if (color !== null) {
    rememberColor(key, color, Date.now());
  }
}

/**
 * Samples a shown page's color shortly, once it has painted. Pages that are not on screen cannot be captured.
 */
export function sampleToolbarColorSoon(contents: WebContents): void {
  if (pendingSamples.has(contents)) {
    return;
  }
  pendingSamples.add(contents);
  setTimeout(() => {
    pendingSamples.delete(contents);
    sampleToolbarColor(contents).catch(() => undefined);
  }, SAMPLE_DELAY_MS);
}
