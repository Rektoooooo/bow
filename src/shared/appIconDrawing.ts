/**
 * WHY this file exists:
 *   Our app icon, Bow (our own design, 2026-10-27: the app's name is another word for an arc): one thick, rounded
 *   bow in a colour gradient on a soft tile, as an SVG drawing in colour variants. Arc lets you pick another app icon;
 *   ours are the same drawing in other colours. tools/make-icon.cjs draws the bundled icon from the "classic"
 *   variant; main/appIcon.ts draws the chosen one for the Dock while the app runs.
 *
 * Data source:
 *   Our own design; the colours of each variant are our choice.
 *
 * Data flow:
 *   Library › Settings › App Icon → setting appIcon → main/appIcon.ts → buildAppIconSvg(variant) → Dock icon
 */

/** One colour variant of our icon. */
export interface AppIconVariant {
  id: string;
  label: string;
  /** The tile, top to bottom. */
  tile: [string, string];
  /** The bow, from its left foot over the top to its right foot. */
  bow: [string, string, string];
  /** The colour of the bow's soft shadow on the tile. */
  shadow: string;
}

/** The variants, the bundled one first. Our own colour choices. */
export const APP_ICON_VARIANTS: AppIconVariant[] = [
  { id: "classic", label: "Classic", tile: ["#fbfaff", "#e9e6f5"], bow: ["#ff8a7a", "#b56cff", "#4f7cff"], shadow: "#5b4bb0" },
  { id: "midnight", label: "Midnight", tile: ["#2a2950", "#121226"], bow: ["#ff8a7a", "#b56cff", "#4f7cff"], shadow: "#000000" },
  { id: "mint", label: "Mint", tile: ["#f4fffa", "#dcf3ea"], bow: ["#8fe8bd", "#3cc79c", "#1f9e8a"], shadow: "#1f7a6b" },
  { id: "sunset", label: "Sunset", tile: ["#fffaf2", "#fbe7dc"], bow: ["#ffc95c", "#ff8a5c", "#e8457a"], shadow: "#b8405e" },
  { id: "graphite", label: "Graphite", tile: ["#45454b", "#1f1f22"], bow: ["#ffffff", "#d1d1d6", "#9a9aa0"], shadow: "#000000" },
];

/** The edge length the drawing is made for, in pixels (the macOS app icon size). */
export const APP_ICON_SIZE_PX = 1024;

/**
 * The variant with this id, or the classic one.
 */
export function findAppIconVariant(variantId: string | undefined): AppIconVariant {
  const found = APP_ICON_VARIANTS.find((variant) => variant.id === variantId);
  return found ?? (APP_ICON_VARIANTS[0] as AppIconVariant);
}

/**
 * The icon drawing as SVG text: the macOS icon tile (824 of 1024 px, corner radius 190) and the bow, a half circle
 * of radius 250 drawn with a 116 px rounded stroke, centred in the tile. The shadow's filter covers the whole tile:
 * measured from the path alone it would cut off the stroke's outer edge.
 */
export function buildAppIconSvg(variant: AppIconVariant): string {
  const [tileTop, tileBottom] = variant.tile;
  const [bowStart, bowMiddle, bowEnd] = variant.bow;
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
    <filter id="shadow" filterUnits="userSpaceOnUse" x="100" y="100" width="824" height="824">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="${variant.shadow}" flood-opacity="0.25"/>
    </filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="190" fill="url(#tile)"/>
  <path d="M262 640 A250 250 0 0 1 762 640" fill="none" stroke="url(#bow)" stroke-width="116" stroke-linecap="round" filter="url(#shadow)"/>
</svg>`;
}
