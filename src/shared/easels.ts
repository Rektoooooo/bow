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

/**
 * An empty board.
 */
export function createEmptyBoard(): EaselBoard {
  return { version: 1, elements: [], view: { x: 0, y: 0, zoom: 1 } };
}
