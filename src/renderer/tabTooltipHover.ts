/**
 * WHY this file exists:
 *   Resting the pointer on a tab in the sidebar shows Arc's tab tooltip beside the pointer: the title, and "Double-click
 *   to rename" on the selected tab. Moving on hides it, like a native tooltip. The box reaches over the page, so the
 *   overlay draws it; this file watches the pointer and works out where the box goes and how big it is (the sidebar has
 *   the same fonts, so it can measure the text).
 *
 * Data source:
 *   Pointer events on the sidebar's tab rows (data-row="tab"), the row's title text and whether it is selected.
 *
 * Data flow:
 *   pointer rests on a row for TAB_TOOLTIP_DELAY_MS → action showTabTooltip(title, hint, frame) → overlayController.ts
 *   pointer moves on, leaves, presses, scrolls or a drag starts → action hideTabTooltip
 */
import {
  TAB_TOOLTIP_DELAY_MS,
  TAB_TOOLTIP_HINT_FONT,
  TAB_TOOLTIP_MAX_WIDTH_PX,
  TAB_TOOLTIP_OFFSET_X_PX,
  TAB_TOOLTIP_OFFSET_Y_PX,
  TAB_TOOLTIP_ONE_LINE_HEIGHT_PX,
  TAB_TOOLTIP_RENAME_HINT,
  TAB_TOOLTIP_SIDE_PX,
  TAB_TOOLTIP_TITLE_FONT,
  TAB_TOOLTIP_TWO_LINE_HEIGHT_PX,
} from "../shared/settings.js";
import { dispatch } from "./dom.js";

/** How far the pointer may drift while a tooltip shows before it hides. Our choice: a hand never rests perfectly. */
const MOVE_TOLERANCE_PX = 3;

/** Distance kept from the window's edges when the box would not fit beside the pointer. Our choice. */
const WINDOW_MARGIN_PX = 4;

let restTimer: number | null = null;
/** Where the pointer was when the shown tooltip appeared (null: none shows). */
let shownAt: { x: number; y: number } | null = null;
let measuringContext: CanvasRenderingContext2D | null = null;

/**
 * The width of a line of text in one of the tooltip's fonts.
 */
function measureText(text: string, font: string): number {
  if (measuringContext === null) {
    measuringContext = document.createElement("canvas").getContext("2d");
  }
  if (measuringContext === null) {
    return 0;
  }
  measuringContext.font = font;
  return measuringContext.measureText(text).width;
}

/**
 * The title a row shows, without the "/ " of a tab that left home.
 */
function readRowTitle(row: HTMLElement): string {
  const title = row.querySelector(".row-title");
  if (title === null) {
    return "";
  }
  const awaySlash = title.querySelector(".away-slash");
  const fullText = title.textContent ?? "";
  const slashText = awaySlash?.textContent ?? "";
  return fullText.slice(slashText.length).trim();
}

/**
 * Cancels a tooltip that is waiting and hides one that shows.
 */
function hideTooltip(): void {
  if (restTimer !== null) {
    window.clearTimeout(restTimer);
    restTimer = null;
  }
  if (shownAt !== null) {
    shownAt = null;
    dispatch({ type: "hideTabTooltip" });
  }
}

/**
 * Shows a row's tooltip below and right of the pointer, or above / left of it where the window ends.
 */
function showTooltip(row: HTMLElement, pointerX: number, pointerY: number): void {
  const title = readRowTitle(row);
  if (title === "") {
    return;
  }
  const showsRenameHint = row.classList.contains("is-selected");
  const titleWidth = measureText(title, TAB_TOOLTIP_TITLE_FONT);
  const hintWidth = showsRenameHint ? measureText(TAB_TOOLTIP_RENAME_HINT, TAB_TOOLTIP_HINT_FONT) : 0;
  const textWidth = Math.ceil(Math.max(titleWidth, hintWidth));
  const width = Math.min(textWidth + 2 * TAB_TOOLTIP_SIDE_PX, TAB_TOOLTIP_MAX_WIDTH_PX);
  const height = showsRenameHint ? TAB_TOOLTIP_TWO_LINE_HEIGHT_PX : TAB_TOOLTIP_ONE_LINE_HEIGHT_PX;

  let x = pointerX + TAB_TOOLTIP_OFFSET_X_PX;
  let y = pointerY + TAB_TOOLTIP_OFFSET_Y_PX;
  if (x + width > window.innerWidth - WINDOW_MARGIN_PX) {
    x = window.innerWidth - WINDOW_MARGIN_PX - width;
  }
  if (y + height > window.innerHeight - WINDOW_MARGIN_PX) {
    y = pointerY - WINDOW_MARGIN_PX - height;
  }
  shownAt = { x: pointerX, y: pointerY };
  const frame = { x: Math.round(x), y: Math.round(y), width: width, height: height };
  dispatch({ type: "showTabTooltip", title: title, showsRenameHint: showsRenameHint, frame: frame });
}

/**
 * The pointer moved over the sidebar: hide a tooltip it moved away from, and start waiting for it to rest on a row.
 */
function handlePointerMove(event: PointerEvent): void {
  if (shownAt !== null) {
    const drift = Math.hypot(event.clientX - shownAt.x, event.clientY - shownAt.y);
    if (drift <= MOVE_TOLERANCE_PX) {
      return;
    }
  }
  hideTooltip();
  const row = (event.target as Element | null)?.closest<HTMLElement>('[data-row="tab"]') ?? null;
  if (row === null || event.buttons !== 0) {
    return;
  }
  const pointerX = event.clientX;
  const pointerY = event.clientY;
  restTimer = window.setTimeout(() => {
    restTimer = null;
    if (row.isConnected) {
      showTooltip(row, pointerX, pointerY);
    }
  }, TAB_TOOLTIP_DELAY_MS);
}

/**
 * Watches the pointer over the sidebar's tab rows.
 */
export function installTabTooltipHover(root: HTMLElement): void {
  root.addEventListener("pointermove", handlePointerMove);
  root.addEventListener("pointerleave", hideTooltip);
  root.addEventListener("pointerdown", hideTooltip);
  root.addEventListener("dragstart", hideTooltip);
  root.addEventListener("wheel", hideTooltip, { passive: true });
}
