/**
 * WHY this file exists:
 *   Arc colors the window frame (sidebar and the margin around the page card) from a Space's theme color, the
 *   theme's intensity and the appearance (light or dark). These pure functions compute that frame color the way Arc
 *   does, so an imported Space looks like it did in Arc.
 *
 * Data source:
 *   Calibrated on the user's Arc: their Main Space is black at intensity 1 in dark mode. Arc draws the frame darker
 *   while its window is active: black measures 19 active (their screen recording) and 53 inactive (a capture of the
 *   window in the background), sRGB, on the real screen. Arc's own saved palettes (StorableSidebar.json,
 *   semanticColorPalette) give the dark scale: a pink #a6729d at intensity 0.57 has the dark background #231721,
 *   which is the color × 0.21, i.e. × 0.37 per unit of intensity. The lift toward white is what turns black into
 *   that grey (52/255 inactive, 19/255 active); colored themes are assumed to follow the same two lifts.
 *   Light appearance: a dark color would make a black frame, so Arc shows dark colors as a light grey instead (its
 *   saved light palette for a black Space is #e5e5e5, about 10 % of the color over white). Other colors: full
 *   intensity keeps the color, lower intensity fades it toward white (our choice).
 *
 * Data flow:
 *   theme.ts (sidebar page) → computeFramePalette(space.theme, isSystemDark, isWindowActive) → --frame-1…3
 */
import type { SpaceTheme } from "./types";

/** Dark appearance: the color is scaled down by this much per unit of intensity (Arc's saved palettes). */
export const DARK_COLOR_SCALE_PER_INTENSITY = 0.37;

/** Dark appearance, window in the background: then lifted this far toward white (black → #343434, measured). */
export const DARK_LIFT_TOWARD_WHITE = 0.204;

/** Dark appearance, active window: lifted this little (black → #131313, measured in the user's recording). */
export const DARK_LIFT_TOWARD_WHITE_ACTIVE = 0.0745;

/** Light appearance: share of the color kept at intensity 0; full intensity keeps it all. Our choice. */
export const LIGHT_MINIMUM_COLOR_SHARE = 0.5;

/** The near-white the light frame fades toward. Our choice: Arc's light frames never reach pure white. */
const LIGHT_BASE_CHANNEL = 250;

/** Light appearance: colors darker than this (perceived brightness 0…1) become a light grey, like Arc's. */
const DARK_COLOR_LUMINANCE = 0.25;

/** Light appearance: how much of a dark color stays in that grey (black → #e6e6e6; Arc's palette: #e5e5e5). */
const LIGHT_DARK_COLOR_SHARE = 0.1;

/** A theme without a usable color falls back to this neutral grey. */
const FALLBACK_COLOR = "#808080";

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** What the frame looks like for one theme in one appearance. */
export interface FramePalette {
  /** Exactly three gradient stops (a one-color theme repeats its color). */
  colors: [string, string, string];
  isDark: boolean;
}

/**
 * Reads "#rrggbb" into channels 0…255.
 */
function parseHex(hex: string): [number, number, number] {
  const valid = HEX_COLOR_PATTERN.test(hex) ? hex : FALLBACK_COLOR;
  return [parseInt(valid.slice(1, 3), 16), parseInt(valid.slice(3, 5), 16), parseInt(valid.slice(5, 7), 16)];
}

/**
 * Writes channels 0…255 as "#rrggbb", rounding and clamping each.
 */
function toHex(channels: [number, number, number]): string {
  return `#${channels.map((channel) => Math.round(Math.min(Math.max(channel, 0), 255)).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Clamps intensity to 0…1; a missing intensity counts as full.
 */
function clampIntensity(intensity: number | undefined): number {
  if (intensity === undefined || Number.isNaN(intensity)) {
    return 1;
  }
  return Math.min(Math.max(intensity, 0), 1);
}

/**
 * The frame color for one theme color, in an active window or one in the background (light frames do not change:
 * no measurement of Arc's yet).
 * Examples: ("#000000", 1, dark) → "#343434"; ("#000000", 1, dark, active) → "#131313"; ("#e9d8d4", 1, light) → itself
 */
export function computeFrameColor(color: string, intensity: number | undefined, isDark: boolean, isWindowActive: boolean = false): string {
  const channels = parseHex(color);
  const strength = clampIntensity(intensity);
  if (isDark) {
    const scale = DARK_COLOR_SCALE_PER_INTENSITY * strength;
    const lift = isWindowActive ? DARK_LIFT_TOWARD_WHITE_ACTIVE : DARK_LIFT_TOWARD_WHITE;
    return toHex(channels.map((channel) => channel * scale + (255 - channel * scale) * lift) as [number, number, number]);
  }
  const luminance = (0.299 * channels[0] + 0.587 * channels[1] + 0.114 * channels[2]) / 255;
  if (luminance < DARK_COLOR_LUMINANCE) {
    return toHex(channels.map((channel) => channel * LIGHT_DARK_COLOR_SHARE + 255 * (1 - LIGHT_DARK_COLOR_SHARE)) as [number, number, number]);
  }
  const colorShare = LIGHT_MINIMUM_COLOR_SHARE + (1 - LIGHT_MINIMUM_COLOR_SHARE) * strength;
  return toHex(channels.map((channel) => channel * colorShare + LIGHT_BASE_CHANNEL * (1 - colorShare)) as [number, number, number]);
}

/**
 * Decides whether a theme shows dark: its own appearance, or the system's for "auto".
 */
export function isThemeDark(theme: SpaceTheme, isSystemDark: boolean): boolean {
  if (theme.appearance === "dark") {
    return true;
  }
  if (theme.appearance === "light") {
    return false;
  }
  return isSystemDark;
}

/**
 * The three gradient stops of a Space's frame, in an active window or one in the background.
 */
export function computeFramePalette(theme: SpaceTheme, isSystemDark: boolean, isWindowActive: boolean = false): FramePalette {
  const isDark = isThemeDark(theme, isSystemDark);
  const colors = theme.colors.length === 0 ? [FALLBACK_COLOR] : theme.colors;
  const pick = (index: number): string => colors[Math.min(index, colors.length - 1)] ?? FALLBACK_COLOR;
  const frameColors = [0, 1, 2].map((index) => computeFrameColor(pick(index), theme.intensity, isDark, isWindowActive));
  return {
    colors: frameColors as [string, string, string],
    isDark: isDark,
  };
}
