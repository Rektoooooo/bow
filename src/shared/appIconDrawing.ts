/**
 * WHY this file exists:
 *   Our app icon, Bow (our own design, 2026-10-27: the app's name is another word for an arc): one thick, rounded
 *   bow on a soft tile, as an SVG drawing. Arc offers several app icons; ours are the same bow in four looks the user
 *   kept: Glass (the default, a frosted bow over soft colour light), Classic (a gradient bow), Graphite (Classic on a
 *   dark tile) and Pixel (8-bit blocks). tools/make-icon.cjs draws the bundled icon from the default variant;
 *   main/appIcon.ts draws the chosen one for the Dock while the app runs, and its dark twin while macOS is dark.
 *
 * Data source:
 *   Our own design; the colours and looks are our choice, picked by the user (2026-10-27).
 *
 * Data flow:
 *   Library › Settings › App Icon → setting appIcon → main/appIcon.ts → buildAppIconSvg(variant) → Dock icon
 */

/** How the bow is drawn. */
export type AppIconStyle = "gradient" | "glass" | "pixel";

/** One variant of our icon. */
export interface AppIconVariant {
  id: string;
  label: string;
  style: AppIconStyle;
  /** The tile, top to bottom. */
  tile: [string, string];
  /** True for a dark tile (Glass draws its frost and highlights fainter there). */
  isDark: boolean;
  /** The bow's colours, from its left foot over the top to its right foot. */
  bow: [string, string, string];
  /** The colour of the bow's soft shadow on the tile. */
  shadow: string;
  /** The variant the Dock shows instead while macOS is in dark mode, if any. */
  darkVariantId?: string;
}

/** The bow's colours, shared by every variant. */
const BOW_COLORS: [string, string, string] = ["#ff8a7a", "#b56cff", "#4f7cff"];

/** The variants to choose from, the bundled default first. */
export const APP_ICON_VARIANTS: AppIconVariant[] = [
  { id: "glass", label: "Glass", style: "glass", tile: ["#f8f6ff", "#e9e3fa"], isDark: false, bow: BOW_COLORS, shadow: "#5b4bb0", darkVariantId: "glass-dark" },
  { id: "classic", label: "Classic", style: "gradient", tile: ["#fbfaff", "#e9e6f5"], isDark: false, bow: BOW_COLORS, shadow: "#5b4bb0", darkVariantId: "graphite" },
  { id: "graphite", label: "Graphite", style: "gradient", tile: ["#4a4a50", "#1c1c1f"], isDark: true, bow: BOW_COLORS, shadow: "#000000" },
  { id: "pixel", label: "Pixel", style: "pixel", tile: ["#25213f", "#151229"], isDark: true, bow: BOW_COLORS, shadow: "#000000" },
];

/** Shown only in dark mode, in place of a light variant (its darkVariantId). */
const DARK_MODE_VARIANTS: AppIconVariant[] = [
  { id: "glass-dark", label: "Glass", style: "glass", tile: ["#3a3a42", "#141418"], isDark: true, bow: BOW_COLORS, shadow: "#000000" },
];

/** The bundled icon and the choice when none was made. */
export const DEFAULT_APP_ICON_ID = "glass";

/** The edge length the drawing is made for, in pixels (the macOS app icon size). */
export const APP_ICON_SIZE_PX = 1024;

/** The macOS icon tile inside the drawing: 824 of 1024 px with a corner radius of 190 (Apple's icon grid). */
const TILE_START = 100;
const TILE_SIZE = 824;
const TILE_RADIUS = 190;

/** The bow: a half circle around this centre, drawn with a thick rounded stroke. Our design. */
const BOW_CENTER_X = 512;
const BOW_CENTER_Y = 640;
const BOW_RADIUS = 250;
const BOW_WIDTH = 116;

/** Glass: the width of the highlight along the bow's top edge, and of its bright rim. Our design. */
const GLASS_HIGHLIGHT_WIDTH = 34;
const GLASS_RIM_WIDTH = 4;

/** Pixel: the grid the bow is built on (columns across it, rows from its feet up), and the room between blocks. */
const PIXEL_SIZE = 56;
const PIXEL_COLUMNS = 12;
const PIXEL_ROWS = 6;
const PIXEL_GAP = 3;
const PIXEL_BAND_MARGIN = 2;

/**
 * The variant with this id (also a dark-mode one), or the default.
 */
export function findAppIconVariant(variantId: string | undefined): AppIconVariant {
  const allVariants = [...APP_ICON_VARIANTS, ...DARK_MODE_VARIANTS];
  const found = allVariants.find((variant) => variant.id === variantId);
  return found ?? (APP_ICON_VARIANTS[0] as AppIconVariant);
}

/**
 * The path of a half circle of a radius around the bow's centre, left foot to right foot.
 */
function describeHalfCircle(radius: number): string {
  const left = BOW_CENTER_X - radius;
  const right = BOW_CENTER_X + radius;
  return `M${left} ${BOW_CENTER_Y} A${radius} ${radius} 0 0 1 ${right} ${BOW_CENTER_Y}`;
}

/**
 * Two hex digits for a colour channel.
 */
function toHexChannel(channel: number): string {
  return Math.round(channel).toString(16).padStart(2, "0");
}

/**
 * A colour part of the way (0…1) from one #rrggbb colour to another.
 */
function mixColors(from: string, to: string, share: number): string {
  let mixed = "#";
  for (let start = 1; start < 7; start += 2) {
    const fromChannel = parseInt(from.slice(start, start + 2), 16);
    const toChannel = parseInt(to.slice(start, start + 2), 16);
    mixed += toHexChannel(fromChannel + (toChannel - fromChannel) * share);
  }
  return mixed;
}

/**
 * The bow's colour at a place across it (0 = left foot, 1 = right foot), through its three colours.
 */
function pickBowColor(variant: AppIconVariant, across: number): string {
  const [start, middle, end] = variant.bow;
  if (across <= 0.5) {
    return mixColors(start, middle, across * 2);
  }
  return mixColors(middle, end, (across - 0.5) * 2);
}

/**
 * The plain bow: one gradient stroke with a soft shadow (Classic, Graphite, Mint, Sunset).
 */
function drawGradientBow(): string {
  return `<path d="${describeHalfCircle(BOW_RADIUS)}" fill="none" stroke="url(#bow)" stroke-width="${BOW_WIDTH}" stroke-linecap="round" filter="url(#shadow)"/>`;
}

/**
 * Soft light behind the glass: overlapping blurred blobs of the bow's colours and two of their mixes, so every part
 * of the bow has colour behind it and no two blobs meet in a visible edge.
 */
function drawColorLight(variant: AppIconVariant): string {
  const [first, middle, last] = variant.bow;
  const warmMix = mixColors(first, middle, 0.5);
  const coolMix = mixColors(first, last, 0.5);
  return `<circle cx="290" cy="320" r="255" fill="${first}"/>
    <circle cx="760" cy="380" r="255" fill="${middle}"/>
    <circle cx="520" cy="820" r="275" fill="${last}"/>
    <circle cx="230" cy="720" r="175" fill="${warmMix}"/>
    <circle cx="820" cy="770" r="170" fill="${coolMix}"/>`;
}

/**
 * Frosted glass: soft colour light on the tile, and a glass bow over it. Through the bow the light looks sharper and
 * more saturated (like light bent by glass); the bow is milky, catches a bright highlight along its top and has a
 * fine bright rim; the tile itself has a gentle sheen and edge. Fainter frost and light on a dark tile.
 */
function drawGlassBow(variant: AppIconVariant): string {
  const path = describeHalfCircle(BOW_RADIUS);
  const frostOpacity = variant.isDark ? 0.16 : 0.36;
  const lightOpacity = variant.isDark ? 0.8 : 0.72;
  const sheenOpacity = variant.isDark ? 0.12 : 0.5;
  const rimOpacity = variant.isDark ? 0.55 : 0.9;
  const shadowOpacity = variant.isDark ? 0.5 : 0.28;
  const highlightRadius = BOW_RADIUS + BOW_WIDTH / 2 - GLASS_HIGHLIGHT_WIDTH / 2;
  const tileRect = `x="${TILE_START}" y="${TILE_START}" width="${TILE_SIZE}" height="${TILE_SIZE}" rx="${TILE_RADIUS}"`;
  return `<defs>
    <filter id="light-blur" filterUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <feGaussianBlur stdDeviation="72"/>
    </filter>
    <filter id="refraction" filterUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <feGaussianBlur stdDeviation="58"/>
      <feColorMatrix type="saturate" values="1.45"/>
    </filter>
    <filter id="glass-shadow" filterUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <feGaussianBlur in="SourceAlpha" stdDeviation="18"/>
      <feOffset dy="14" result="blurred"/>
      <feFlood flood-color="${variant.shadow}" flood-opacity="${shadowOpacity}"/>
      <feComposite in2="blurred" operator="in"/>
    </filter>
    <mask id="outside-bow" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <rect width="1024" height="1024" fill="#ffffff"/>
      <path d="${path}" fill="none" stroke="#000000" stroke-width="${BOW_WIDTH}" stroke-linecap="round"/>
    </mask>
    <mask id="bow-shape" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <path d="${path}" fill="none" stroke="#ffffff" stroke-width="${BOW_WIDTH}" stroke-linecap="round"/>
    </mask>
    <mask id="bow-rim" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <path d="${path}" fill="none" stroke="#ffffff" stroke-width="${BOW_WIDTH}" stroke-linecap="round"/>
      <path d="${path}" fill="none" stroke="#000000" stroke-width="${BOW_WIDTH - 2 * GLASS_RIM_WIDTH}" stroke-linecap="round"/>
    </mask>
    <linearGradient id="highlight" gradientUnits="userSpaceOnUse" x1="0" y1="${BOW_CENTER_Y - BOW_RADIUS - BOW_WIDTH / 2}" x2="0" y2="${BOW_CENTER_Y}">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="${sheenOpacity}"/>
      <stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#tile-shape)" filter="url(#light-blur)" opacity="${lightOpacity}">${drawColorLight(variant)}</g>
  <rect ${tileRect} fill="url(#sheen)"/>
  <g mask="url(#outside-bow)"><path d="${path}" fill="none" stroke="#000000" stroke-width="${BOW_WIDTH}" stroke-linecap="round" filter="url(#glass-shadow)"/></g>
  <g mask="url(#bow-shape)"><g filter="url(#refraction)">${drawColorLight(variant)}</g></g>
  <path d="${path}" fill="none" stroke="#ffffff" stroke-opacity="${frostOpacity}" stroke-width="${BOW_WIDTH}" stroke-linecap="round"/>
  <path d="${describeHalfCircle(highlightRadius)}" fill="none" stroke="url(#highlight)" stroke-width="${GLASS_HIGHLIGHT_WIDTH}" stroke-linecap="round" mask="url(#bow-shape)"/>
  <path d="${path}" fill="none" stroke="#ffffff" stroke-opacity="${rimOpacity}" stroke-width="${BOW_WIDTH}" stroke-linecap="round" mask="url(#bow-rim)"/>
  <rect x="${TILE_START + 1.5}" y="${TILE_START + 1.5}" width="${TILE_SIZE - 3}" height="${TILE_SIZE - 3}" rx="${TILE_RADIUS - 1.5}" fill="none" stroke="#ffffff" stroke-opacity="${rimOpacity * 0.5}" stroke-width="3"/>`;
}

/**
 * Pixels: the bow built from square blocks on a grid centred under it, each block in the bow's colour where it sits.
 * A block belongs to the bow when its centre lies in the bow's band, widened a little so the band stays whole.
 */
function drawPixelBow(variant: AppIconVariant): string {
  const innerRadius = BOW_RADIUS - BOW_WIDTH / 2 - PIXEL_BAND_MARGIN;
  const outerRadius = BOW_RADIUS + BOW_WIDTH / 2 + PIXEL_BAND_MARGIN;
  const blocks: string[] = [];
  for (let cellIndex = 0; cellIndex < PIXEL_COLUMNS * PIXEL_ROWS; cellIndex++) {
    const column = cellIndex % PIXEL_COLUMNS;
    const row = Math.floor(cellIndex / PIXEL_COLUMNS);
    const left = BOW_CENTER_X + (column - PIXEL_COLUMNS / 2) * PIXEL_SIZE;
    const top = BOW_CENTER_Y - (row + 1) * PIXEL_SIZE;
    const distance = Math.hypot(left + PIXEL_SIZE / 2 - BOW_CENTER_X, top + PIXEL_SIZE / 2 - BOW_CENTER_Y);
    if (distance < innerRadius || distance > outerRadius) {
      continue;
    }
    const color = pickBowColor(variant, column / (PIXEL_COLUMNS - 1));
    blocks.push(`<rect x="${left + PIXEL_GAP}" y="${top + PIXEL_GAP}" width="${PIXEL_SIZE - 2 * PIXEL_GAP}" height="${PIXEL_SIZE - 2 * PIXEL_GAP}" rx="6" fill="${color}"/>`);
  }
  return `<g filter="url(#shadow)">${blocks.join("")}</g>`;
}

/**
 * The bow in the variant's style.
 */
function drawBow(variant: AppIconVariant): string {
  if (variant.style === "glass") {
    return drawGlassBow(variant);
  }
  if (variant.style === "pixel") {
    return drawPixelBow(variant);
  }
  return drawGradientBow();
}

/**
 * The icon drawing as SVG text: the tile and the bow. Filters cover the whole tile: measured from a path alone they
 * would cut off the stroke's outer edge.
 */
export function buildAppIconSvg(variant: AppIconVariant): string {
  const [tileTop, tileBottom] = variant.tile;
  const [bowStart, bowMiddle, bowEnd] = variant.bow;
  const tileRect = `x="${TILE_START}" y="${TILE_START}" width="${TILE_SIZE}" height="${TILE_SIZE}" rx="${TILE_RADIUS}"`;
  const filterRegion = `filterUnits="userSpaceOnUse" x="${TILE_START}" y="${TILE_START}" width="${TILE_SIZE}" height="${TILE_SIZE}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${tileTop}"/>
      <stop offset="1" stop-color="${tileBottom}"/>
    </linearGradient>
    <linearGradient id="bow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${bowStart}"/>
      <stop offset="0.5" stop-color="${bowMiddle}"/>
      <stop offset="1" stop-color="${bowEnd}"/>
    </linearGradient>
    <filter id="shadow" ${filterRegion}>
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="${variant.shadow}" flood-opacity="0.25"/>
    </filter>
    <clipPath id="tile-shape"><rect ${tileRect}/></clipPath>
  </defs>
  <rect ${tileRect} fill="url(#tile)"/>
  ${drawBow(variant)}
</svg>`;
}
