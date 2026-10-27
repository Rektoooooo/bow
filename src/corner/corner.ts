/**
 * WHY this file exists:
 *   Draws one rounded bottom corner of the page card (see corner.html): a window-sized copy of the frame, shifted so
 *   this tiny page shows exactly the spot of the window it lies on, with the card's shadow where the card is.
 *
 * Data source:
 *   cornerMasks.ts calls window.showCorner(info) whenever the window's size, the card's place, the Space theme or
 *   the window's focus changed; macOS switching light and dark (themes set to "auto") redraws the last one.
 *
 * Data flow:
 *   showCorner(info) → applySpaceTheme() (the sidebar's own frame colors) → #frame-replica at (-x, -y), window-sized
 *   → #card-replica at the card's place → corner.css cuts the curve
 */
import { applySpaceTheme, onSystemAppearanceChange } from "../renderer/theme.js";
import type { SpaceTheme } from "../shared/types";

/** A place in the window, in pixels. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What cornerMasks.ts sends. */
interface CornerInfo {
  corner: "bottom-left" | "bottom-right";
  /** This page's place in the window. */
  x: number;
  y: number;
  windowWidth: number;
  windowHeight: number;
  /** The page area of the card, in the window. */
  card: Box;
  theme: SpaceTheme;
  isWindowActive: boolean;
}

declare global {
  interface Window {
    showCorner(info: CornerInfo): void;
  }
}

let lastInfo: CornerInfo | null = null;

/**
 * Puts an element at a place, in pixels.
 */
function placeElement(element: HTMLElement, box: Box): void {
  element.style.left = `${box.x}px`;
  element.style.top = `${box.y}px`;
  element.style.width = `${box.width}px`;
  element.style.height = `${box.height}px`;
}

/**
 * Draws the corner for the newest info.
 */
function showCorner(info: CornerInfo): void {
  lastInfo = info;
  const root = document.documentElement;
  root.dataset.corner = info.corner;
  applySpaceTheme(info.theme, info.isWindowActive);
  const frame = document.getElementById("frame-replica");
  const card = document.getElementById("card-replica");
  if (frame === null || card === null) {
    return;
  }
  placeElement(frame, { x: -info.x, y: -info.y, width: info.windowWidth, height: info.windowHeight });
  placeElement(card, info.card);
  // Two frames later the first colors are on screen; from then on theme changes cross-fade.
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("is-starting")));
}

window.showCorner = showCorner;
onSystemAppearanceChange(() => {
  if (lastInfo !== null) {
    showCorner(lastInfo);
  }
});
