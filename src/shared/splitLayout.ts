/**
 * WHY this file exists:
 *   A split view divides the page card into panes: side by side, stacked, or a 2×2 grid (3 or 4 panes), each pane
 *   as big as the user dragged it. Main places the page views with this, and the sidebar page draws the dividers
 *   between them with the same arithmetic, so the handles always sit in the gaps without main sending them.
 *
 * Data source:
 *   The card's rectangle (layout.ts computeCardBounds in main; #card-slot in the sidebar page), the number of panes
 *   on screen, the split view's layout and its sizes (SplitItem.sizes), and the pointer while a divider is dragged.
 *
 * Data flow:
 *   main tabViews.ts → computePaneBounds() → WebContentsView.setBounds()
 *   sidebar page → computeSplitDividers() → handles → drag → resizeSplit() → action previewSplitSizes / setSplitSizes
 *
 * Rules: pure. Sizes are fractions of the space the panes share (gaps left out): one per pane side by side or
 * stacked, [column, row] in a grid. readPaneSizes() is the one place that decides whether saved sizes still fit;
 * anything else (a pane closed, a Note among the panes, a damaged file) falls back to equal panes.
 */
import { SPLIT_GAP_PX, SPLIT_MIN_PANE_PX } from "./settings.js";
import type { SplitOrientation } from "./types";

/** A rectangle in window content coordinates, in pixels. */
export interface PaneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A divider between panes: between pane `index` and the next ("pane"), or the grid's column or row line. */
export interface SplitDivider {
  kind: "pane" | "column" | "row";
  index: number;
  rect: PaneRect;
}

/** How close sizes must add up to 1 to be taken as they are. */
const SIZES_SUM_TOLERANCE = 0.01;

/** Saved sizes keep this many decimals, so the same layout always saves the same numbers. */
const SIZE_DECIMALS = 1000;

/** The fewest panes a grid takes; with two, a grid is just side by side. */
export const GRID_MIN_PANES = 3;

/**
 * The layout actually used: a grid needs at least GRID_MIN_PANES panes, else the panes sit side by side.
 */
function readLayout(orientation: SplitOrientation, paneCount: number): SplitOrientation {
  return orientation === "grid" && paneCount < GRID_MIN_PANES ? "horizontal" : orientation;
}

/**
 * Equal sizes for a layout: 1/n each, or the grid's middle lines.
 */
export function equalPaneSizes(orientation: SplitOrientation, paneCount: number): number[] {
  if (readLayout(orientation, paneCount) === "grid") {
    return [0.5, 0.5];
  }
  return Array.from({ length: Math.max(paneCount, 1) }, () => 1 / Math.max(paneCount, 1));
}

/**
 * The sizes to lay panes out with: the saved ones when they still fit this many panes, else equal.
 */
export function readPaneSizes(orientation: SplitOrientation, sizes: number[] | undefined, paneCount: number): number[] {
  const layout = readLayout(orientation, paneCount);
  const expectedCount = layout === "grid" ? 2 : paneCount;
  const isEachFraction = sizes !== undefined && sizes.every((size) => Number.isFinite(size) && size > 0 && size < 1);
  if (sizes === undefined || !isEachFraction || sizes.length !== expectedCount) {
    return equalPaneSizes(layout, paneCount);
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const isWhole = layout === "grid" || Math.abs(total - 1) <= SIZES_SUM_TOLERANCE;
  return isWhole ? sizes : equalPaneSizes(layout, paneCount);
}

/**
 * Splits a length into parts by fractions; the last part takes the rounding leftovers.
 */
function splitLength(length: number, fractions: number[]): number[] {
  const parts: number[] = [];
  let used = 0;
  fractions.forEach((fraction, index) => {
    const isLast = index === fractions.length - 1;
    const part = isLast ? Math.max(length - used, 0) : Math.round(length * fraction);
    parts.push(part);
    used += part;
  });
  return parts;
}

/**
 * Divides the card into panes with a gap between them: side by side ("horizontal"), stacked ("vertical"), or a 2×2
 * grid (top left, top right, bottom left, bottom right; with 3 panes the third spans the bottom row).
 * Example: card width 1000, 2 panes side by side, sizes [0.3, 0.7], gap 6 → widths 298 and 696
 */
export function computePaneBounds(card: PaneRect, paneCount: number, orientation: SplitOrientation, sizes?: number[]): PaneRect[] {
  if (paneCount <= 1) {
    return [card];
  }
  const layout = readLayout(orientation, paneCount);
  const fractions = readPaneSizes(layout, sizes, paneCount);
  if (layout === "grid") {
    return computeGridBounds(card, paneCount, fractions);
  }
  const isSideBySide = layout === "horizontal";
  const available = Math.max((isSideBySide ? card.width : card.height) - SPLIT_GAP_PX * (paneCount - 1), 0);
  const lengths = splitLength(available, fractions);
  const panes: PaneRect[] = [];
  let offset = 0;
  for (const length of lengths) {
    if (isSideBySide) {
      panes.push({ x: card.x + offset, y: card.y, width: length, height: card.height });
    } else {
      panes.push({ x: card.x, y: card.y + offset, width: card.width, height: length });
    }
    offset += length + SPLIT_GAP_PX;
  }
  return panes;
}

/**
 * The grid's two column widths and two row heights.
 */
function measureGrid(card: PaneRect, fractions: number[]): { columns: number[]; rows: number[] } {
  const columns = splitLength(Math.max(card.width - SPLIT_GAP_PX, 0), [fractions[0] ?? 0.5, 1 - (fractions[0] ?? 0.5)]);
  const rows = splitLength(Math.max(card.height - SPLIT_GAP_PX, 0), [fractions[1] ?? 0.5, 1 - (fractions[1] ?? 0.5)]);
  return { columns: columns, rows: rows };
}

/**
 * The panes of a 2×2 grid.
 */
function computeGridBounds(card: PaneRect, paneCount: number, fractions: number[]): PaneRect[] {
  const { columns, rows } = measureGrid(card, fractions);
  const leftWidth = columns[0] ?? 0;
  const rightWidth = columns[1] ?? 0;
  const topHeight = rows[0] ?? 0;
  const bottomHeight = rows[1] ?? 0;
  const rightX = card.x + leftWidth + SPLIT_GAP_PX;
  const bottomY = card.y + topHeight + SPLIT_GAP_PX;
  const panes: PaneRect[] = [
    { x: card.x, y: card.y, width: leftWidth, height: topHeight },
    { x: rightX, y: card.y, width: rightWidth, height: topHeight },
  ];
  if (paneCount === GRID_MIN_PANES) {
    panes.push({ x: card.x, y: bottomY, width: card.width, height: bottomHeight });
    return panes;
  }
  panes.push({ x: card.x, y: bottomY, width: leftWidth, height: bottomHeight }, { x: rightX, y: bottomY, width: rightWidth, height: bottomHeight });
  return panes;
}

/**
 * The dividers between the panes: the gaps a pointer can drag to resize them.
 */
export function computeSplitDividers(card: PaneRect, paneCount: number, orientation: SplitOrientation, sizes?: number[]): SplitDivider[] {
  if (paneCount <= 1) {
    return [];
  }
  const layout = readLayout(orientation, paneCount);
  const panes = computePaneBounds(card, paneCount, layout, sizes);
  if (layout === "grid") {
    const topLeft = panes[0] as PaneRect;
    const columnHeight = paneCount === GRID_MIN_PANES ? topLeft.height : card.height;
    return [
      { kind: "column", index: 0, rect: { x: topLeft.x + topLeft.width, y: card.y, width: SPLIT_GAP_PX, height: columnHeight } },
      { kind: "row", index: 0, rect: { x: card.x, y: topLeft.y + topLeft.height, width: card.width, height: SPLIT_GAP_PX } },
    ];
  }
  const dividers: SplitDivider[] = [];
  for (let index = 0; index < panes.length - 1; index++) {
    const pane = panes[index] as PaneRect;
    const rect =
      layout === "horizontal"
        ? { x: pane.x + pane.width, y: card.y, width: SPLIT_GAP_PX, height: card.height }
        : { x: card.x, y: pane.y + pane.height, width: card.width, height: SPLIT_GAP_PX };
    dividers.push({ kind: "pane", index: index, rect: rect });
  }
  return dividers;
}

/**
 * A fraction kept to SIZE_DECIMALS.
 */
function roundSize(size: number): number {
  return Math.round(size * SIZE_DECIMALS) / SIZE_DECIMALS;
}

/**
 * The sizes after dragging a divider to the pointer: the two panes beside it share their space anew, neither
 * smaller than SPLIT_MIN_PANE_PX (a grid's line moves the whole column or row).
 * Example: 2 panes side by side in a 1006 px card, the divider dragged to x = card.x + 303 → [0.3, 0.7]
 */
export function resizeSplit(card: PaneRect, paneCount: number, orientation: SplitOrientation, sizes: number[] | undefined, divider: SplitDivider, pointerX: number, pointerY: number): number[] {
  const layout = readLayout(orientation, paneCount);
  const fractions = readPaneSizes(layout, sizes, paneCount);
  if (layout === "grid") {
    const isColumn = divider.kind === "column";
    const length = isColumn ? card.width : card.height;
    const pointer = isColumn ? pointerX - card.x : pointerY - card.y;
    const share = clampShare(pointer - SPLIT_GAP_PX / 2, length - SPLIT_GAP_PX);
    return isColumn ? [roundSize(share), fractions[1] ?? 0.5] : [fractions[0] ?? 0.5, roundSize(share)];
  }
  const isSideBySide = layout === "horizontal";
  const available = Math.max((isSideBySide ? card.width : card.height) - SPLIT_GAP_PX * (paneCount - 1), 1);
  const index = divider.index;
  const before = fractions.slice(0, index).reduce((sum, size) => sum + size, 0);
  const paneStart = before * available + index * SPLIT_GAP_PX;
  const pointer = (isSideBySide ? pointerX - card.x : pointerY - card.y) - SPLIT_GAP_PX / 2;
  const pairLength = ((fractions[index] ?? 0) + (fractions[index + 1] ?? 0)) * available;
  const firstLength = Math.min(Math.max(pointer - paneStart, SPLIT_MIN_PANE_PX), pairLength - SPLIT_MIN_PANE_PX);
  const resized = [...fractions];
  resized[index] = firstLength / available;
  resized[index + 1] = (pairLength - firstLength) / available;
  return roundToWhole(resized);
}

/**
 * A grid line's share of a length, keeping both sides at least SPLIT_MIN_PANE_PX.
 */
function clampShare(position: number, length: number): number {
  const safeLength = Math.max(length, 1);
  const clamped = Math.min(Math.max(position, SPLIT_MIN_PANE_PX), safeLength - SPLIT_MIN_PANE_PX);
  return Math.min(Math.max(clamped / safeLength, 0.01), 0.99);
}

/**
 * Rounds fractions that add up to 1, the last taking what rounding left, so they still add up to 1.
 */
function roundToWhole(fractions: number[]): number[] {
  const rounded = fractions.slice(0, -1).map(roundSize);
  const rest = 1 - rounded.reduce((sum, size) => sum + size, 0);
  return [...rounded, roundSize(rest)];
}
