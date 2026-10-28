/**
 * WHY this file exists:
 *   Library › Boosts › Export… and Import…: the parts of sharing Boosts that need the Mac (sheets and files).
 *   boostFiles.ts makes and checks the files; boosts.ts puts an imported Boost in place.
 *
 * Data source:
 *   The state's Boosts (browserCore.ts) and the file the user picks.
 *
 * Data flow:
 *   Export… → save sheet → createBoostFile → file
 *   Import… → open sheet → parseBoostFile → (the site has a Boost: asks first) → applyChange(importBoost) → a note when
 *   its JavaScript arrived switched off
 */
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { applyChange, getState } from "./browserCore";
import { createBoostFile, parseBoostFile } from "./boostFiles";
import { importBoost } from "./boosts";
import { ask, askWhereToSave, askWhichFile } from "./dialogs";

/** A Boost file's extension. Its content is JSON. */
export const BOOST_FILE_EXTENSION = "bowboost";

/** Largest Boost file Bow reads. Our choice: two code fields at their limit fit many times over. */
const MAX_BOOST_FILE_BYTES = 1024 * 1024;

/** The buttons of the replace question, in order. */
const REPLACE_BUTTON_INDEX = 0;
const CANCEL_BUTTON_INDEX = 1;

/**
 * Export…: the site's Boost to a file the user names (Documents, named after the site, by default).
 */
export async function exportBoostToFile(site: string): Promise<void> {
  const boost = (getState().boosts ?? []).find((candidate) => candidate.site === site);
  if (boost === undefined) {
    return;
  }
  const filePath = await askWhereToSave({
    title: "Export Boost",
    defaultPath: path.join(app.getPath("documents"), `${site}.${BOOST_FILE_EXTENSION}`),
    filters: [{ name: "Bow Boost", extensions: [BOOST_FILE_EXTENSION] }],
  });
  if (filePath === null) {
    return;
  }
  fs.writeFileSync(filePath, JSON.stringify(createBoostFile(boost), null, 1));
}

/**
 * Reads a Boost file's text, or null when it is too large or cannot be read.
 */
function readBoostFileText(filePath: string): string | null {
  try {
    if (fs.statSync(filePath).size > MAX_BOOST_FILE_BYTES) {
      return null;
    }
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Import…: a Boost file in place of the site's own Boost (after asking, when it has one). Its JavaScript arrives
 * switched off, and Bow says so.
 */
export async function importBoostFromFile(): Promise<void> {
  const filePath = await askWhichFile({
    title: "Import Boost",
    defaultPath: app.getPath("documents"),
    properties: ["openFile"],
    filters: [{ name: "Bow Boost", extensions: [BOOST_FILE_EXTENSION, "json"] }],
  });
  if (filePath === null) {
    return;
  }
  const text = readBoostFileText(filePath);
  const result = text === null ? null : parseBoostFile(text);
  if (result === null || !result.isValid) {
    const detail = result === null ? "This file could not be read." : result.error;
    await ask({ type: "warning", message: "This Boost can't be imported", detail: detail });
    return;
  }
  const site = result.boost.site;
  const hasOwnBoost = (getState().boosts ?? []).some((candidate) => candidate.site === site);
  if (hasOwnBoost) {
    const choice = await ask({
      type: "question",
      message: `Replace your Boost for ${site}?`,
      detail: "The imported Boost takes its place.",
      buttons: ["Replace", "Cancel"],
      defaultId: REPLACE_BUTTON_INDEX,
      cancelId: CANCEL_BUTTON_INDEX,
    });
    if (choice !== REPLACE_BUTTON_INDEX) {
      return;
    }
  }
  applyChange((state) => importBoost(state, result.boost, Date.now()));
  if (result.hasJavaScript) {
    await ask({ type: "info", message: `Imported the Boost for ${site}`, detail: "Its JavaScript arrives switched off. Turn it on in the Boost editor once you trust it." });
  }
}
