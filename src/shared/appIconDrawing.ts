/**
 * WHY this file exists:
 *   Our app icon (our own design: a window with a sidebar and three tab lines on a gradient squircle) as an SVG
 *   drawing, in color variants. Arc lets you pick another app icon; ours are the same drawing in other colors.
 *   tools/make-icon.cjs draws the bundled icon from the "classic" variant; main/appIcon.ts draws the chosen one for
 *   the Dock while the app runs.
 *
 * Data source:
 *   Our own design; the colors of each variant are our choice.
 *
 * Data flow:
 *   Library › Settings › App Icon → setting appIcon → main/appIcon.ts → buildAppIconSvg(variant) → Dock icon
 */

/** One color variant of our icon: the background gradient (three stops) and the accent of the tab lines. */
export interface AppIconVariant {
  id: string;
  label: string;
  gradient: [string, string, string];
  accent: string;
  accentSoft: string;
}

/** The variants, the bundled one first. Our own color choices. */
export const APP_ICON_VARIANTS: AppIconVariant[] = [
  { id: "classic", label: "Classic", gradient: ["#ff8a7a", "#b56cff", "#4f7cff"], accent: "#7a68ff", accentSoft: "#c4bcff" },
  { id: "midnight", label: "Midnight", gradient: ["#2d3a6b", "#1d2347", "#0d1024"], accent: "#5b6cff", accentSoft: "#aab3ff" },
  { id: "mint", label: "Mint", gradient: ["#a8f0c8", "#4fd1a5", "#1f9e8a"], accent: "#1f9e8a", accentSoft: "#9fe3cf" },
  { id: "sunset", label: "Sunset", gradient: ["#ffd36e", "#ff8a5c", "#e8457a"], accent: "#e8457a", accentSoft: "#ffc0b0" },
  { id: "graphite", label: "Graphite", gradient: ["#8e8e93", "#4a4a4f", "#1f1f22"], accent: "#4a4a4f", accentSoft: "#c7c7cc" },
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
 * The icon drawing as SVG text.
 */
export function buildAppIconSvg(variant: AppIconVariant): string {
  const [firstColor, middleColor, lastColor] = variant.gradient;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${firstColor}"/>
      <stop offset="0.5" stop-color="${middleColor}"/>
      <stop offset="1" stop-color="${lastColor}"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#000" flood-opacity="0.25"/>
    </filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="190" fill="url(#background)"/>
  <g filter="url(#shadow)">
    <rect x="250" y="285" width="524" height="454" rx="56" fill="#ffffff" fill-opacity="0.96"/>
  </g>
  <rect x="250" y="285" width="190" height="454" rx="56" fill="#ffffff"/>
  <rect x="392" y="285" width="48" height="454" fill="#ffffff"/>
  <rect x="440" y="285" width="10" height="454" fill="${variant.accent}" fill-opacity="0.18"/>
  <rect x="290" y="352" width="110" height="26" rx="13" fill="${variant.accent}"/>
  <rect x="290" y="408" width="110" height="26" rx="13" fill="${variant.accentSoft}"/>
  <rect x="290" y="464" width="80" height="26" rx="13" fill="${variant.accentSoft}"/>
  <rect x="490" y="340" width="236" height="354" rx="30" fill="url(#background)" fill-opacity="0.22"/>
</svg>`;
}
