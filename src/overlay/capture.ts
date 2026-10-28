/**
 * WHY this file exists:
 *   Capture, from the Control Center: like Arc's, you drag a rectangle over the page and that part is copied (and
 *   saved to Downloads). The page dims except for the part being selected; Escape or a click outside the page cancels.
 *
 * Data source:
 *   The "capture" panel message: the page's frame in the window.
 *
 * Data flow:
 *   Control Center › Capture → "overlay:show" (capture) → drag → overlayApi.captureRegion(rect) → main copies that part
 */
import type { OverlayPanel, OverlayRect } from "../shared/overlay";
import { createElement } from "../renderer/dom.js";

type CapturePanel = Extract<OverlayPanel, { kind: "capture" }>;

/**
 * The rectangle between two points, kept inside the page's frame.
 */
function rectBetween(startX: number, startY: number, endX: number, endY: number, frame: OverlayRect): OverlayRect {
  const left = Math.max(Math.min(startX, endX), frame.x);
  const top = Math.max(Math.min(startY, endY), frame.y);
  const right = Math.min(Math.max(startX, endX), frame.x + frame.width);
  const bottom = Math.min(Math.max(startY, endY), frame.y + frame.height);
  return { x: left, y: top, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) };
}

/**
 * Places an element over a rectangle.
 */
function placeOver(element: HTMLElement, rect: OverlayRect): void {
  element.style.left = `${rect.x}px`;
  element.style.top = `${rect.y}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

/**
 * Draws the capture layer over the page and follows the drag.
 */
/** MouseEvent.buttons' bit for the primary (left) button. */
const PRIMARY_BUTTON_MASK = 1;

export function renderCapture(host: HTMLElement, panel: CapturePanel): void {
  const layer = createElement("div", "capture-layer");
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-label", "Drag over the part of the page to capture. Escape cancels.");
  const pageArea = createElement("div", "capture-page");
  placeOver(pageArea, panel.frame);
  const selection = createElement("div", "capture-selection");
  selection.hidden = true;
  const hint = createElement("div", "capture-hint", "Drag to capture part of the page · Esc to cancel");
  pageArea.append(hint);
  layer.append(pageArea, selection);

  let start: { x: number; y: number } | null = null;
  let region: OverlayRect | null = null;
  layer.addEventListener("mousedown", (event) => {
    event.preventDefault();
    start = { x: event.clientX, y: event.clientY };
    region = rectBetween(start.x, start.y, start.x, start.y, panel.frame);
    placeOver(selection, region);
    selection.hidden = false;
    hint.hidden = true;
    // From now on only the outside of the selection is dimmed (the selection's own shadow).
    layer.classList.add("is-selecting");
  });
  layer.addEventListener("mousemove", (event) => {
    // Chromium also sends "mousemove" events of its own (when the layer's look changes) at a pointer place it
    // remembers; only moves with the button held draw the selection, and the release point ends it (below).
    const isDragging = (event.buttons & PRIMARY_BUTTON_MASK) !== 0;
    if (start === null || !isDragging) {
      return;
    }
    region = rectBetween(start.x, start.y, event.clientX, event.clientY, panel.frame);
    placeOver(selection, region);
  });
  layer.addEventListener("mouseup", (event) => {
    if (start === null) {
      return;
    }
    // Where the button was let go ends the selection, whatever the last move said.
    region = rectBetween(start.x, start.y, event.clientX, event.clientY, panel.frame);
    start = null;
    window.overlayApi.captureRegion(region);
  });
  host.replaceChildren(layer);
}
