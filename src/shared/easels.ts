/**
 * WHY this file exists:
 *   Arc's Easels are boards you fill with text, drawings, pictures and captures of web pages. Ours are tabs with an
 *   address of our own, "sidebar-easel:<easel id>", like notes (shared/notes.ts): they sit in the sidebar like tabs,
 *   the sidebar page draws the board in the page card, and the board is kept in a file of its own
 *   (main/easelsStore.ts). This file holds the address rules and the board's data model.
 *
 * Data source:
 *   A tab's address; a board's JSON.
 *
 * Data flow:
 *   New Easel → openTab("sidebar-easel:<id>") ; tabViews.ts skips these tabs ; sidebar.ts shows easelEditor.ts
 */

/** The address scheme of an easel tab. Our own; no web page uses it. */
export const EASEL_URL_PREFIX = "sidebar-easel:";

/** An easel id: letters, digits and dashes (it names the easel's file). */
const EASEL_ID_PATTERN = /^[a-z0-9-]{1,80}$/;

/** The name a new easel shows until the user renames it. */
export const NEW_EASEL_TITLE = "New Easel";

/** Text on the board. */
export interface EaselText {
  kind: "text";
  id: string;
  x: number;
  y: number;
  width: number;
  text: string;
  size: number;
  color: string;
}

/** A pen stroke: points relative to the board, drawn as one smooth line. */
export interface EaselStroke {
  kind: "stroke";
  id: string;
  points: [number, number][];
  color: string;
  width: number;
}

/**
 * Where a capture came from, so it can be taken again later: the page, the size of its view, how far it was scrolled,
 * its zoom and the captured part of the view (all in the view's points). Easels keep captures "live" with it, like
 * Arc's live captures.
 */
export interface CaptureSource {
  url: string;
  viewport: { width: number; height: number };
  scroll: { x: number; y: number };
  zoomFactor: number;
  region: { x: number; y: number; width: number; height: number };
}

/** A picture or a capture of a page, kept inside the board as a data: URL. */
export interface EaselImage {
  kind: "image";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  /** For a capture: the page it shows, so a click can open it. */
  sourceUrl: string | null;
  /** For a live capture: where to take it again, and when it last was. Optional: plain pictures have none. */
  live?: { source: CaptureSource; refreshedAt: number };
}

export type EaselElement = EaselText | EaselStroke | EaselImage;

/** A whole board: its elements in drawing order, and where the view stands. */
export interface EaselBoard {
  version: 1;
  elements: EaselElement[];
  view: { x: number; y: number; zoom: number };
}

/**
 * True for an easel tab's address.
 */
export function isEaselUrl(url: string): boolean {
  return url.startsWith(EASEL_URL_PREFIX);
}

/**
 * The easel id in an easel tab's address, or null when it is not a (valid) easel address.
 */
export function getEaselId(url: string): string | null {
  if (!isEaselUrl(url)) {
    return null;
  }
  const easelId = url.slice(EASEL_URL_PREFIX.length);
  return EASEL_ID_PATTERN.test(easelId) ? easelId : null;
}

/**
 * True for a valid easel id.
 */
export function isEaselId(value: unknown): value is string {
  return typeof value === "string" && EASEL_ID_PATTERN.test(value);
}

/**
 * The address of an easel tab.
 */
export function createEaselUrl(easelId: string): string {
  return `${EASEL_URL_PREFIX}${easelId}`;
}

/** The largest view a capture may be taken again in, in points. Our choice: bigger than any screen. */
const MAX_CAPTURE_VIEW_PX = 8000;

/** The page zoom range Chromium allows. */
const MIN_ZOOM_FACTOR = 0.25;
const MAX_ZOOM_FACTOR = 5;

/**
 * True for a whole number from 0 up to a limit.
 */
function isWholeNumberUpTo(value: unknown, limit: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= limit;
}

/**
 * True for a well-formed capture source: a web address and sizes in range. Checked again in the main process before
 * a capture is taken again, because a board's file is data the page could have been handed.
 */
export function isCaptureSource(value: unknown): value is CaptureSource {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const source = value as Record<string, unknown>;
  const viewport = source.viewport as Record<string, unknown> | null | undefined;
  const scroll = source.scroll as Record<string, unknown> | null | undefined;
  const region = source.region as Record<string, unknown> | null | undefined;
  if (typeof source.url !== "string" || !/^https?:\/\//.test(source.url) || typeof viewport !== "object" || viewport === null) {
    return false;
  }
  if (typeof scroll !== "object" || scroll === null || typeof region !== "object" || region === null) {
    return false;
  }
  const isViewOk = isWholeNumberUpTo(viewport.width, MAX_CAPTURE_VIEW_PX) && isWholeNumberUpTo(viewport.height, MAX_CAPTURE_VIEW_PX);
  const isScrollOk = typeof scroll.x === "number" && typeof scroll.y === "number" && scroll.x >= 0 && scroll.y >= 0;
  const isZoomOk = typeof source.zoomFactor === "number" && source.zoomFactor >= MIN_ZOOM_FACTOR && source.zoomFactor <= MAX_ZOOM_FACTOR;
  const isRegionOk = [region.x, region.y, region.width, region.height].every((part) => isWholeNumberUpTo(part, MAX_CAPTURE_VIEW_PX));
  return isViewOk && isScrollOk && isZoomOk && isRegionOk;
}

/**
 * An empty board.
 */
export function createEmptyBoard(): EaselBoard {
  return { version: 1, elements: [], view: { x: 0, y: 0, zoom: 1 } };
}
