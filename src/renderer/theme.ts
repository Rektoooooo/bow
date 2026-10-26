/**
 * WHY this file exists:
 *   Each Space colors the window frame, like Arc's Space themes: one color, or a gradient of up to three, light or
 *   dark text, and an optional film grain. This file turns a SpaceTheme into CSS variables; sidebar.css does the rest.
 *
 * Data source:
 *   The active Space's theme from BrowserState. Colors were checked as #rrggbb by ipc.ts before they were saved.
 *
 * Data flow:
 *   sidebar.ts renderAll() → applySpaceTheme(space.theme) → --frame-color-1…3, data-appearance, --grain-opacity
 */
import type { SpaceTheme } from "../shared/types";

/** Grain opacity at grain = 1. Our choice: strong enough to see, weak enough to read text on. */
const MAXIMUM_GRAIN_OPACITY = 0.32;

/** Only plain hex colors may reach CSS; anything else falls back to this neutral color. */
const FALLBACK_FRAME_COLOR = "#d9d4e9";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Returns the color at a position, repeating the last color when the theme has fewer, so a one-color theme
 * fills all three gradient stops with the same color (a flat frame).
 */
function pickColor(colors: string[], index: number): string {
  const lastIndex = colors.length - 1;
  const color = colors[Math.min(index, lastIndex)] ?? FALLBACK_FRAME_COLOR;
  return HEX_COLOR_PATTERN.test(color) ? color : FALLBACK_FRAME_COLOR;
}

/**
 * Applies a Space's theme to the whole sidebar page.
 */
export function applySpaceTheme(theme: SpaceTheme): void {
  const root = document.documentElement;
  root.style.setProperty("--frame-color-1", pickColor(theme.colors, 0));
  root.style.setProperty("--frame-color-2", pickColor(theme.colors, 1));
  root.style.setProperty("--frame-color-3", pickColor(theme.colors, 2));
  root.dataset.appearance = theme.appearance;

  const grainOpacity = Math.max(0, Math.min(theme.grain, 1)) * MAXIMUM_GRAIN_OPACITY;
  root.style.setProperty("--grain-opacity", grainOpacity.toFixed(3));
}
