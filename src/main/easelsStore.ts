/**
 * WHY this file exists:
 *   An easel's board is kept in a file of its own (one JSON file per easel in the app's data folder): boards hold
 *   pictures and can be large, so they do not travel with every state change.
 *
 * Data source:
 *   <userData>/Easels/<easel id>.json, written by the sidebar page's easel editor through IPC.
 *
 * Data flow:
 *   easelEditor.ts → browserApi.readEasel / saveEasel → ipc.ts → readEasel() / writeEasel() → the file
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { isEaselId } from "../shared/easels";

const EASELS_FOLDER_NAME = "Easels";

/** Largest board we store, in characters of JSON (pictures inside count). Our choice: generous, still bounded. */
export const MAX_EASEL_LENGTH = 40_000_000;

let easelsFolder: string | null = null;

/**
 * Remembers where easels live. Runs once at startup.
 */
export function initializeEaselsStore(userDataFolder: string): void {
  easelsFolder = path.join(userDataFolder, EASELS_FOLDER_NAME);
}

/**
 * The file of an easel, or null for an id that is not an easel id (it names a file, so it is checked).
 */
function getEaselPath(easelId: string): string | null {
  if (easelsFolder === null || !isEaselId(easelId)) {
    return null;
  }
  return path.join(easelsFolder, `${easelId}.json`);
}

/**
 * A board's JSON, or "" when it has none yet.
 */
export function readEasel(easelId: string): string {
  const filePath = getEaselPath(easelId);
  if (filePath === null || !fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Saves a board's JSON. Too large boards and text that is not JSON are refused.
 */
export function writeEasel(easelId: string, json: string): boolean {
  const filePath = getEaselPath(easelId);
  if (filePath === null || json.length > MAX_EASEL_LENGTH || easelsFolder === null) {
    return false;
  }
  try {
    JSON.parse(json);
  } catch {
    return false;
  }
  fs.mkdirSync(easelsFolder, { recursive: true });
  fs.writeFileSync(filePath, json);
  return true;
}
