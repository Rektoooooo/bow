/**
 * WHY this file exists:
 *   Arc borders the selected Favorite in the site's own colour (red for YouTube, green for Spotify; the user's
 *   screenshots, 2026-10-27). This picks that colour from a favicon's pixels, and names the address a page's icon comes
 *   from, so the main process (which decodes the icon) and the sidebar (which draws it) mean the same icon.
 *
 * Data source:
 *   A favicon's raw pixels as macOS hands them out (BGRA, colours premultiplied by alpha), already scaled down.
 *
 * Data flow:
 *   main/faviconAccents.ts decodes the icon → pickAccentColor() → RuntimeState.faviconAccents[getFaviconAddress()]
 *   → sidebar draws the selected tile's border and tint in it
 */

/** Pixels more transparent than this are left out (the icon's soft edge and empty corners). */
const MIN_ALPHA = 128;

/** Pixels greyer or darker than these are left out: black and white parts of a logo are not its colour. */
const MIN_SATURATION = 0.3;
const MIN_VALUE = 0.25;

/** Hues are grouped in 12 buckets of 30°; the heaviest bucket is the icon's colour. Our choice. */
const HUE_BUCKET_COUNT = 12;
const FULL_TURN_DEGREES = 360;

/** At least this share of the visible pixels must be coloured, or the icon counts as black and white. Our choice. */
const MIN_COLORED_SHARE = 0.05;

/** Bytes per pixel and the place of each channel in BGRA. */
const BYTES_PER_PIXEL = 4;
const BLUE_OFFSET = 0;
const GREEN_OFFSET = 1;
const RED_OFFSET = 2;
const ALPHA_OFFSET = 3;

const CHANNEL_MAX = 255;

interface HueBucket {
  weight: number;
  red: number;
  green: number;
  blue: number;
}

/**
 * The address a page's icon is loaded from: the one the page reported, or the site's /favicon.ico (null for pages
 * that are not on the web).
 * Examples: ("data:image/png;…", any) → that address; (null, "https://example.com/a") → "https://example.com/favicon.ico"
 */
export function getFaviconAddress(faviconUrl: string | null, pageUrl: string): string | null {
  if (faviconUrl !== null) {
    return faviconUrl;
  }
  try {
    const parsedUrl = new URL(pageUrl);
    const isWebPage = parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:";
    return isWebPage ? `${parsedUrl.origin}/favicon.ico` : null;
  } catch {
    return null;
  }
}

/**
 * The hue (degrees) of an RGB colour, or null for a grey.
 */
function computeHue(red: number, green: number, blue: number): number | null {
  const highest = Math.max(red, green, blue);
  const lowest = Math.min(red, green, blue);
  const chroma = highest - lowest;
  if (chroma === 0) {
    return null;
  }
  if (highest === red) {
    return (((green - blue) / chroma + 6) % 6) * 60;
  }
  if (highest === green) {
    return ((blue - red) / chroma + 2) * 60;
  }
  return ((red - green) / chroma + 4) * 60;
}

/**
 * Two hex digits for a channel.
 */
function toHexChannel(channel: number): string {
  const clamped = Math.max(0, Math.min(CHANNEL_MAX, Math.round(channel)));
  return clamped.toString(16).padStart(2, "0");
}

/**
 * The colour of a favicon: the average of its most common hue among its coloured pixels, or null for an icon that is
 * black, white or grey (no colour to show).
 * Example: a red square with a white triangle → about "#ff0000"
 */
export function pickAccentColor(pixels: Uint8Array, width: number, height: number): string | null {
  const buckets: HueBucket[] = Array.from({ length: HUE_BUCKET_COUNT }, () => ({ weight: 0, red: 0, green: 0, blue: 0 }));
  let visibleCount = 0;
  let coloredCount = 0;
  const pixelCount = Math.min(width * height, Math.floor(pixels.length / BYTES_PER_PIXEL));
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * BYTES_PER_PIXEL;
    const alpha = pixels[offset + ALPHA_OFFSET] ?? 0;
    if (alpha < MIN_ALPHA) {
      continue;
    }
    visibleCount += 1;
    // Premultiplied: undo the alpha so a half-transparent edge pixel has its real colour.
    const red = Math.min(CHANNEL_MAX, ((pixels[offset + RED_OFFSET] ?? 0) * CHANNEL_MAX) / alpha);
    const green = Math.min(CHANNEL_MAX, ((pixels[offset + GREEN_OFFSET] ?? 0) * CHANNEL_MAX) / alpha);
    const blue = Math.min(CHANNEL_MAX, ((pixels[offset + BLUE_OFFSET] ?? 0) * CHANNEL_MAX) / alpha);
    const highest = Math.max(red, green, blue);
    const saturation = highest === 0 ? 0 : (highest - Math.min(red, green, blue)) / highest;
    const value = highest / CHANNEL_MAX;
    const hue = computeHue(red, green, blue);
    if (hue === null || saturation < MIN_SATURATION || value < MIN_VALUE) {
      continue;
    }
    coloredCount += 1;
    const bucket = buckets[Math.floor(hue / (FULL_TURN_DEGREES / HUE_BUCKET_COUNT)) % HUE_BUCKET_COUNT] as HueBucket;
    const weight = saturation * value;
    bucket.weight += weight;
    bucket.red += red * weight;
    bucket.green += green * weight;
    bucket.blue += blue * weight;
  }
  if (visibleCount === 0 || coloredCount / visibleCount < MIN_COLORED_SHARE) {
    return null;
  }
  let heaviest = buckets[0] as HueBucket;
  for (const bucket of buckets) {
    if (bucket.weight > heaviest.weight) {
      heaviest = bucket;
    }
  }
  return `#${toHexChannel(heaviest.red / heaviest.weight)}${toHexChannel(heaviest.green / heaviest.weight)}${toHexChannel(heaviest.blue / heaviest.weight)}`;
}
