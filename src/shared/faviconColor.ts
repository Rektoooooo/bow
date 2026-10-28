/**
 * WHY this file exists:
 *   Arc borders the selected Favorite in the site's own colour (red for YouTube, green for Spotify; the user's
 *   screenshots, 2026-10-27). The user's rule: the colour that appears most in the logo, for every Favorite. This
 *   picks it from a favicon's pixels, and names the address a page's icon comes from, so the main process (which
 *   decodes the icon) and the sidebar (which draws it) mean the same icon.
 *
 * Data source:
 *   A favicon's raw pixels as macOS hands them out (BGRA, colours premultiplied by alpha), already scaled down.
 *
 * Data flow:
 *   main/faviconAccents.ts decodes the icon → pickAccentColor() → RuntimeState.faviconAccents[getFaviconAddress()]
 *   → sidebar draws the selected tile's border and tint in it
 */
import { isLocalHost } from "./localNames.js";

/** Pixels more transparent than this are left out (the icon's soft edge and empty corners). */
const MIN_ALPHA = 128;

/** Colours are counted in groups of 16 levels per channel, so antialiasing does not split one colour. Our choice. */
const LEVELS_PER_GROUP = 16;
const GROUPS_PER_CHANNEL = 16;

/**
 * A near-black most common colour is usually the icon's square, not its logo (X: a thin white X on black, 5 % of
 * the visible pixels). Then the most common colour that is not near-black counts instead, when it covers at least
 * this share. Our choice, set by X's icon.
 */
const NEAR_BLACK_LUMINANCE = 0.12;
const LOGO_SHARE = 0.04;

/** Bytes per pixel and the place of each channel in BGRA. */
const BYTES_PER_PIXEL = 4;
const BLUE_OFFSET = 0;
const GREEN_OFFSET = 1;
const RED_OFFSET = 2;
const ALPHA_OFFSET = 3;

const CHANNEL_MAX = 255;

interface ColorGroup {
  count: number;
  red: number;
  green: number;
  blue: number;
}

/**
 * The address a page's icon is loaded from: the one the page reported, or the site's /favicon.ico (null for pages
 * that are not on the web). The guess goes over https, even for an http page (local names keep their own scheme):
 * a guess over http would tell the network which site you have open, which HTTPS-Only Mode exists to prevent.
 * Examples: ("data:image/png;…", any) → that address; (null, "http://example.com/a") → "https://example.com/favicon.ico"
 */
export function getFaviconAddress(faviconUrl: string | null, pageUrl: string): string | null {
  if (faviconUrl !== null) {
    return faviconUrl;
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(pageUrl);
  } catch {
    return null;
  }
  const isWebPage = parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:";
  if (!isWebPage) {
    return null;
  }
  const keepsScheme = parsedUrl.protocol === "https:" || isLocalHost(parsedUrl.hostname);
  return keepsScheme ? `${parsedUrl.origin}/favicon.ico` : `https://${parsedUrl.host}/favicon.ico`;
}

/**
 * A "#rrggbb" colour's perceived brightness, 0 (black) to 1 (white).
 */
export function getHexLuminance(hex: string): number {
  const red = parseInt(hex.slice(1, 3), 16) / CHANNEL_MAX;
  const green = parseInt(hex.slice(3, 5), 16) / CHANNEL_MAX;
  const blue = parseInt(hex.slice(5, 7), 16) / CHANNEL_MAX;
  return 0.299 * red + 0.587 * green + 0.114 * blue;
}

/**
 * Two hex digits for a channel.
 */
function toHexChannel(channel: number): string {
  const clamped = Math.max(0, Math.min(CHANNEL_MAX, Math.round(channel)));
  return clamped.toString(16).padStart(2, "0");
}

/**
 * The perceived brightness (0…1) of a group's average colour.
 */
function computeLuminance(group: ColorGroup): number {
  return (0.299 * group.red + 0.587 * group.green + 0.114 * group.blue) / group.count / CHANNEL_MAX;
}

/**
 * Counts the visible pixels by colour group (premultiplied BGRA in, real colours counted).
 */
function countColorGroups(pixels: Uint8Array, pixelCount: number): Map<number, ColorGroup> {
  const groups = new Map<number, ColorGroup>();
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * BYTES_PER_PIXEL;
    const alpha = pixels[offset + ALPHA_OFFSET] ?? 0;
    if (alpha < MIN_ALPHA) {
      continue;
    }
    // Premultiplied: undo the alpha so a half-transparent edge pixel counts with its real colour.
    const red = Math.min(CHANNEL_MAX, ((pixels[offset + RED_OFFSET] ?? 0) * CHANNEL_MAX) / alpha);
    const green = Math.min(CHANNEL_MAX, ((pixels[offset + GREEN_OFFSET] ?? 0) * CHANNEL_MAX) / alpha);
    const blue = Math.min(CHANNEL_MAX, ((pixels[offset + BLUE_OFFSET] ?? 0) * CHANNEL_MAX) / alpha);
    const key = (Math.floor(red / LEVELS_PER_GROUP) * GROUPS_PER_CHANNEL + Math.floor(green / LEVELS_PER_GROUP)) * GROUPS_PER_CHANNEL + Math.floor(blue / LEVELS_PER_GROUP);
    const group = groups.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    group.count += 1;
    group.red += red;
    group.green += green;
    group.blue += blue;
    groups.set(key, group);
  }
  return groups;
}

/**
 * A favicon's colour, the way the user asked for it: the colour that appears most in the logo (the average of its
 * group). A near-black square behind a logo gives way to the logo's colour when that covers at least LOGO_SHARE.
 * Null only for an icon with no visible pixels.
 * Examples: YouTube (red with a white triangle) → red; X (white X on black) → white; an all-black logo → black
 */
export function pickAccentColor(pixels: Uint8Array, width: number, height: number): string | null {
  const pixelCount = Math.min(width * height, Math.floor(pixels.length / BYTES_PER_PIXEL));
  const groups = countColorGroups(pixels, pixelCount);
  const largestFirst = [...groups.values()].sort((first, second) => second.count - first.count);
  const visibleCount = largestFirst.reduce((sum, group) => sum + group.count, 0);
  const mostCommon = largestFirst[0];
  if (mostCommon === undefined) {
    return null;
  }
  const logo = largestFirst.find((group) => computeLuminance(group) >= NEAR_BLACK_LUMINANCE);
  const isBlackSquare = computeLuminance(mostCommon) < NEAR_BLACK_LUMINANCE;
  const isLogoLarge = logo !== undefined && logo.count / visibleCount >= LOGO_SHARE;
  const chosen = isBlackSquare && isLogoLarge && logo !== undefined ? logo : mostCommon;
  return `#${toHexChannel(chosen.red / chosen.count)}${toHexChannel(chosen.green / chosen.count)}${toHexChannel(chosen.blue / chosen.count)}`;
}
