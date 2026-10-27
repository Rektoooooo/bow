/**
 * WHY this file exists:
 *   Our app icon, Bow (our own design, 2026-10-27: the app's name is another word for an arc): one thick, rounded
 *   bow on a soft tile, as an SVG drawing. Arc offers many app icons; ours are the same bow in other colours and
 *   styles (a neon glow, rainbow bands, frosted glass, pixels). tools/make-icon.cjs draws the bundled icon from the
 *   "classic" variant; main/appIcon.ts draws the chosen one for the Dock while the app runs.
 *
 * Data source:
 *   Our own design; the colours and styles of each variant are our choice (the user picked Classic, and Graphite
 *   with the colourful bow for dark mode).
 *
 * Data flow:
 *   Library › Settings › App Icon → setting appIcon → main/appIcon.ts → buildAppIconSvg(variant) → Dock icon
 */

/** How the bow is drawn. */
export type AppIconStyle = "gradient" | "neon" | "rainbow" | "glass" | "pixel";

/** One variant of our icon. */
export interface AppIconVariant {
  id: string;
  label: string;
  style: AppIconStyle;
  /** The tile, top to bottom. */
  tile: [string, string];
  /** The bow's colours, from its left foot over the top to its right foot (rainbow: outer, middle, inner band). */
  bow: [string, string, string];
  /** The colour of the bow's soft shadow on the tile. */
  shadow: string;
}

/** The bow's colours in Classic, also used by Graphite and the styles. */
const CLASSIC_BOW: [string, string, string] = ["#ff8a7a", "#b56cff", "#4f7cff"];

/** The variants, the bundled one first. Our own colour and style choices. */
export const APP_ICON_VARIANTS: AppIconVariant[] = [
  { id: "classic", label: "Classic", style: "gradient", tile: ["#fbfaff", "#e9e6f5"], bow: CLASSIC_BOW, shadow: "#5b4bb0" },
  { id: "graphite", label: "Graphite", style: "gradient", tile: ["#4a4a50", "#1c1c1f"], bow: CLASSIC_BOW, shadow: "#000000" },
  { id: "neon", label: "Neon", style: "neon", tile: ["#16131f", "#06050a"], bow: ["#ff4fa3", "#b56cff", "#3ee0ff"], shadow: "#000000" },
  { id: "rainbow", label: "Rainbow", style: "rainbow", tile: ["#eef6ff", "#d9e8fb"], bow: CLASSIC_BOW, shadow: "#3d5a99" },
  { id: "glass", label: "Glass", style: "glass", tile: ["#f6f3ff", "#e6e0fa"], bow: CLASSIC_BOW, shadow: "#5b4bb0" },
  { id: "pixel", label: "Pixel", style: "pixel", tile: ["#25213f", "#151229"], bow: CLASSIC_BOW, shadow: "#000000" },
  { id: "mint", label: "Mint", style: "gradient", tile: ["#f4fffa", "#dcf3ea"], bow: ["#8fe8bd", "#3cc79c", "#1f9e8a"], shadow: "#1f7a6b" },
  { id: "sunset", label: "Sunset", style: "gradient", tile: ["#fffaf2", "#fbe7dc"], bow: ["#ffc95c", "#ff8a5c", "#e8457a"], shadow: "#b8405e" },
];

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

/** Rainbow: three bands of this width with this much tile between them. */
const RAINBOW_BAND_WIDTH = 72;
const RAINBOW_BAND_GAP = 6;

/** Pixel: the grid the bow is built on (columns across it, rows from its feet up), and the room between blocks. */
const PIXEL_SIZE = 56;
const PIXEL_COLUMNS = 12;
const PIXEL_ROWS = 6;
const PIXEL_GAP = 3;
const PIXEL_BAND_MARGIN = 2;

/**
 * The variant with this id, or the classic one.
 */
export function findAppIconVariant(variantId: string | undefined): AppIconVariant {
  const found = APP_ICON_VARIANTS.find((variant) => variant.id === variantId);
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
 * A neon tube: a wide blurred glow under a thinner bright stroke with a white-hot core.
 */
function drawNeonBow(): string {
  const path = describeHalfCircle(BOW_RADIUS);
  return `<path d="${path}" fill="none" stroke="url(#bow)" stroke-width="${BOW_WIDTH}" stroke-linecap="round" filter="url(#glow)" opacity="0.9"/>
  <path d="${path}" fill="none" stroke="url(#bow)" stroke-width="64" stroke-linecap="round"/>
  <path d="${path}" fill="none" stroke="#ffffff" stroke-width="16" stroke-linecap="round" opacity="0.85"/>`;
}

/**
 * Three bands, outer to inner in the variant's three colours, like a rainbow.
 */
function drawRainbowBow(variant: AppIconVariant): string {
  const outerRadius = BOW_RADIUS + RAINBOW_BAND_WIDTH / 2 + RAINBOW_BAND_GAP;
  const bands = variant.bow.map((color, index) => {
    const radius = outerRadius - index * (RAINBOW_BAND_WIDTH + RAINBOW_BAND_GAP);
    return `<path d="${describeHalfCircle(radius)}" fill="none" stroke="${color}" stroke-width="${RAINBOW_BAND_WIDTH}" stroke-linecap="round"/>`;
  });
  return `<g filter="url(#shadow)">${bands.join("")}</g>`;
}

/**
 * Frosted glass: soft colour blobs on the tile, and a milky see-through bow with a bright rim over them.
 */
function drawGlassBow(variant: AppIconVariant): string {
  const [first, middle, last] = variant.bow;
  const path = describeHalfCircle(BOW_RADIUS);
  return `<g clip-path="url(#tile-shape)" filter="url(#blur)" opacity="0.75">
    <circle cx="330" cy="360" r="210" fill="${first}"/>
    <circle cx="720" cy="430" r="220" fill="${middle}"/>
    <circle cx="500" cy="780" r="240" fill="${last}"/>
  </g>
  <path d="${path}" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="${BOW_WIDTH}" stroke-linecap="round" filter="url(#shadow)"/>
  <path d="${path}" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="${BOW_WIDTH}" stroke-linecap="round" mask="url(#rim)"/>`;
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
  if (variant.style === "neon") {
    return drawNeonBow();
  }
  if (variant.style === "rainbow") {
    return drawRainbowBow(variant);
  }
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
    <filter id="glow" ${filterRegion}>
      <feGaussianBlur stdDeviation="30"/>
    </filter>
    <filter id="blur" ${filterRegion}>
      <feGaussianBlur stdDeviation="70"/>
    </filter>
    <clipPath id="tile-shape"><rect ${tileRect}/></clipPath>
    <mask id="rim" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <path d="${describeHalfCircle(BOW_RADIUS)}" fill="none" stroke="#ffffff" stroke-width="${BOW_WIDTH}" stroke-linecap="round"/>
      <path d="${describeHalfCircle(BOW_RADIUS)}" fill="none" stroke="#000000" stroke-width="${BOW_WIDTH - 10}" stroke-linecap="round"/>
    </mask>
  </defs>
  <rect ${tileRect} fill="url(#tile)"/>
  ${drawBow(variant)}
</svg>`;
}
