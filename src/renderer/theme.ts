/**
 * WHY this file exists:
 *   Each Space colors the window frame, like Arc's Space themes: one color or a gradient of up to three, an
 *   intensity, light or dark, and an optional film grain. themePalette.ts computes the frame colors the way Arc
 *   does; this file puts them on the page as CSS variables, and sidebar.css does the rest (every other color is a
 *   white or black overlay on the frame).
 *
 * Data source:
 *   The active Space's theme from BrowserState (colors checked as #rrggbb by ipc.ts), and whether macOS is in dark
 *   mode (for themes set to "auto").
 *
 * Data flow:
 *   sidebar.ts renderAll() → applySpaceTheme(space.theme) → --frame-1…3, data-appearance, --grain-opacity
 *   macOS switches light/dark → onSystemAppearanceChange listener → sidebar.ts redraws
 */
import { computeFramePalette } from "../shared/themePalette.js";
import type { SpaceTheme } from "../shared/types";

/** Grain opacity at grain = 1. Our choice: strong enough to see, weak enough to read text on. */
const MAXIMUM_GRAIN_OPACITY = 0.32;

const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

/**
 * True while macOS shows dark mode.
 */
function isSystemDark(): boolean {
  return window.matchMedia(DARK_MODE_QUERY).matches;
}

/**
 * Calls back when macOS switches between light and dark (themes set to "auto" follow it).
 */
export function onSystemAppearanceChange(listener: () => void): void {
  window.matchMedia(DARK_MODE_QUERY).addEventListener("change", listener);
}

/**
 * Applies a Space's theme to the whole sidebar page.
 */
export function applySpaceTheme(theme: SpaceTheme): void {
  const root = document.documentElement;
  const palette = computeFramePalette(theme, isSystemDark());
  root.style.setProperty("--frame-1", palette.colors[0]);
  root.style.setProperty("--frame-2", palette.colors[1]);
  root.style.setProperty("--frame-3", palette.colors[2]);
  root.dataset.appearance = palette.isDark ? "dark" : "light";

  const grainOpacity = Math.max(0, Math.min(theme.grain, 1)) * MAXIMUM_GRAIN_OPACITY;
  root.style.setProperty("--grain-opacity", grainOpacity.toFixed(3));
}
