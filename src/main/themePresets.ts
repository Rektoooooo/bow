/**
 * WHY this file exists:
 *   Arc lets each Space pick colors, light or dark text, and grain. Until a full color picker exists, the Space menu
 *   offers these ready-made themes. The names and colors are our own.
 *
 * Data source:
 *   None. Our palette.
 *
 * Data flow:
 *   menus.ts Space menu → user picks a preset → runAction({ type: "setSpaceTheme", theme })
 */
import type { SpaceTheme, ThemeAppearance } from "../shared/types";

/** One entry in the Space menu's Theme submenu. */
export interface ThemePreset {
  label: string;
  colors: string[];
  appearance: ThemeAppearance;
}

export const THEME_PRESETS: ThemePreset[] = [
  { label: "Blush", colors: ["#f3d5d3", "#e8c6dc"], appearance: "auto" },
  { label: "Peach", colors: ["#f6dcc6"], appearance: "auto" },
  { label: "Butter", colors: ["#f2e7ba", "#f5d9b8"], appearance: "auto" },
  { label: "Mint", colors: ["#cdeadb", "#c2e3e8"], appearance: "auto" },
  { label: "Sky", colors: ["#cfe0f4"], appearance: "auto" },
  { label: "Lavender", colors: ["#ddd5f3", "#cfd8f5"], appearance: "auto" },
  { label: "Graphite", colors: ["#3a3a3c"], appearance: "dark" },
  { label: "Midnight", colors: ["#1f2b47", "#2e2147"], appearance: "dark" },
  { label: "Forest", colors: ["#1f3a2e", "#22332f"], appearance: "dark" },
  { label: "Ember", colors: ["#4a2621", "#3c2231"], appearance: "dark" },
];

/** The grain choices in the Space menu, from none to strong. */
export const GRAIN_CHOICES: { label: string; grain: number }[] = [
  { label: "No Grain", grain: 0 },
  { label: "Light Grain", grain: 0.35 },
  { label: "Strong Grain", grain: 0.8 },
];

/**
 * Applies a preset's colors and appearance to a theme, keeping its grain.
 */
export function applyPreset(theme: SpaceTheme, preset: ThemePreset): SpaceTheme {
  return { ...theme, colors: preset.colors, appearance: preset.appearance };
}
