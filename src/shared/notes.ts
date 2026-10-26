/**
 * WHY this file exists:
 *   Arc's Notes sit in the sidebar like tabs. Ours are tabs with an address of our own, "sidebar-note:<note id>", so
 *   pinning, Today, folders, the Archive and dragging work for them unchanged. No web page is loaded for them: the
 *   sidebar page draws the note editor in the page card, and the text lives in its own file (main/notesStore.ts).
 *
 * Data source:
 *   A tab's address.
 *
 * Data flow:
 *   New Note → openTab("sidebar-note:<id>") ; tabViews.ts skips these tabs ; sidebar.ts shows noteEditor.ts for them
 */

/** The address scheme of a note tab. Our own; no web page uses it. */
export const NOTE_URL_PREFIX = "sidebar-note:";

/** A note id: letters, digits and dashes (it names the note's file). */
const NOTE_ID_PATTERN = /^[a-z0-9-]{1,80}$/;

/** The name a new note shows until its first line gives it one. */
export const NEW_NOTE_TITLE = "New Note";

/**
 * True for a note tab's address.
 */
export function isNoteUrl(url: string): boolean {
  return url.startsWith(NOTE_URL_PREFIX);
}

/**
 * The note id in a note tab's address, or null when it is not a (valid) note address.
 * Example: "sidebar-note:note-1714-ab12" → "note-1714-ab12"
 */
export function getNoteId(url: string): string | null {
  if (!isNoteUrl(url)) {
    return null;
  }
  const noteId = url.slice(NOTE_URL_PREFIX.length);
  return NOTE_ID_PATTERN.test(noteId) ? noteId : null;
}

/**
 * True for a valid note id.
 */
export function isNoteId(value: unknown): value is string {
  return typeof value === "string" && NOTE_ID_PATTERN.test(value);
}

/**
 * The address of a note tab.
 */
export function createNoteUrl(noteId: string): string {
  return `${NOTE_URL_PREFIX}${noteId}`;
}
