/**
 * WHY this file exists:
 *   A note's text is kept in a file of its own (one HTML file per note in the app's data folder), so long notes do
 *   not travel with every state change and survive the tab being archived and restored.
 *
 * Data source:
 *   <userData>/Notes/<note id>.html, written by the sidebar page's note editor through IPC.
 *
 * Data flow:
 *   noteEditor.ts → browserApi.readNote / saveNote → ipc.ts → readNote() / writeNote() → the file
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { isNoteId } from "../shared/notes";

const NOTES_FOLDER_NAME = "Notes";

/** Longest note we store, in characters of HTML. Our choice: far more than notes need; bounds one message. */
export const MAX_NOTE_LENGTH = 2_000_000;

let notesFolder: string | null = null;

/**
 * Remembers where notes live. Runs once at startup.
 */
export function initializeNotesStore(userDataFolder: string): void {
  notesFolder = path.join(userDataFolder, NOTES_FOLDER_NAME);
}

/**
 * The file of a note, or null for an id that is not a note id (it names a file, so it is checked).
 */
function getNotePath(noteId: string): string | null {
  if (notesFolder === null || !isNoteId(noteId)) {
    return null;
  }
  return path.join(notesFolder, `${noteId}.html`);
}

/**
 * A note's HTML, or "" when it has none yet.
 */
export function readNote(noteId: string): string {
  const filePath = getNotePath(noteId);
  if (filePath === null || !fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Saves a note's HTML (the editor cleans it before sending). Too long notes are refused.
 */
export function writeNote(noteId: string, html: string): boolean {
  const filePath = getNotePath(noteId);
  if (filePath === null || html.length > MAX_NOTE_LENGTH || notesFolder === null) {
    return false;
  }
  fs.mkdirSync(notesFolder, { recursive: true });
  fs.writeFileSync(filePath, html);
  return true;
}
