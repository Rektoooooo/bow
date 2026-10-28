/**
 * WHY this file exists:
 *   A Boost made for one site is worth sharing: Library › Boosts exports it as a small open file (.bowboost) that
 *   anyone can import. A shared file is untrusted, so it is checked like a Boost in a restored backup (backup.ts
 *   checkBoosts): a site name Bow can read, code within the size limits, and its JavaScript switched off on arrival.
 *   The file never says whether the JavaScript was on.
 *
 * Data source:
 *   A Boost from the state (export), or the text of a file the user picked (import).
 *
 * Data flow:
 *   Export… → createBoostFile(boost) → JSON → file
 *   Import… → file text → parseBoostFile() → boosts.ts importBoost() → the Boost is in place, JavaScript off
 *
 * Rules: pure.
 */
import { checkBoosts } from "./backup";
import type { CheckCounter } from "./backup";
import type { Boost } from "../shared/types";

/** What every Boost file says it is. */
export const BOOST_FILE_FORMAT = "bow-boost";

/** The Boost file format's version. A newer one is refused until this Bow is updated. */
export const BOOST_FILE_VERSION = 1;

/** A shared Boost: what it changes on its site, nothing about this Mac or whether its JavaScript was on. */
export interface BoostFile {
  format: typeof BOOST_FILE_FORMAT;
  formatVersion: number;
  site: string;
  css: string;
  zappedSelectors: string[];
  hueShift?: number;
  isInverted?: boolean;
  fontId?: string;
  javascript?: string;
}

/** What reading a Boost file gave: the Boost to import, or why it cannot be. */
export type BoostFileResult = { isValid: true; boost: Boost; hasJavaScript: boolean } | { isValid: false; error: string };

/**
 * The file of a Boost.
 */
export function createBoostFile(boost: Boost): BoostFile {
  const file: BoostFile = { format: BOOST_FILE_FORMAT, formatVersion: BOOST_FILE_VERSION, site: boost.site, css: boost.css, zappedSelectors: boost.zappedSelectors };
  if (boost.hueShift !== undefined) {
    file.hueShift = boost.hueShift;
  }
  if (boost.isInverted !== undefined) {
    file.isInverted = boost.isInverted;
  }
  if (boost.fontId !== undefined) {
    file.fontId = boost.fontId;
  }
  if (boost.javascript !== undefined && boost.javascript.trim() !== "") {
    file.javascript = boost.javascript;
  }
  return file;
}

/**
 * Reads a Boost file: refused when it is not one, from a newer Bow, or damaged; else the Boost, its JavaScript off.
 */
export function parseBoostFile(text: string): BoostFileResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { isValid: false, error: "This file is not a Bow Boost." };
  }
  const isRecord = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  const file = isRecord ? (parsed as Record<string, unknown>) : {};
  if (file.format !== BOOST_FILE_FORMAT) {
    return { isValid: false, error: "This file is not a Bow Boost." };
  }
  if (typeof file.formatVersion !== "number" || file.formatVersion > BOOST_FILE_VERSION) {
    return { isValid: false, error: "This Boost was made by a newer Bow. Update Bow to import it." };
  }
  const counter: CheckCounter = { leftOut: 0, scriptsTurnedOff: 0 };
  const checked = checkBoosts([{ ...file, id: "imported", isEnabled: true }], counter);
  const boost = checked[0];
  if (boost === undefined) {
    return { isValid: false, error: "This Boost is damaged: its site or code cannot be used." };
  }
  return { isValid: true, boost: boost, hasJavaScript: boost.javascript !== undefined && boost.javascript.trim() !== "" };
}
