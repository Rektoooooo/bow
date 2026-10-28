/**
 * WHY this file exists:
 *   Library › Shortcuts: every app-menu command with its keys, menu by menu. Click the keys and press new ones; the
 *   × removes them, Reset brings back the default, Reset All every default (main/shortcutEditor.ts records, checks
 *   and saves).
 *
 * Data source:
 *   LibraryData.shortcuts.
 *
 * Data flow:
 *   keys clicked → beginShortcutRecording (main stops the menu's keys) → the next key press here →
 *   recordShortcutKeys → main checks and saves → fresh LibraryData → drawn again
 */
import type { LibraryData } from "../shared/overlay";
import { createElement, createIconButton, createTextButton, dispatch } from "../renderer/dom.js";

/** Whether the section is recording now (from the last data drawn), for the key listener. */
let isRecording = false;

/** The keys that only modify: a press of one alone waits for the key. */
const MODIFIER_CODES = ["ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "CapsLock", "Fn"];

/**
 * While recording, every key press is for the recorder: Escape stops, a modifier alone waits, anything else goes to
 * main. Nothing else on the page sees it (Escape would close the Library).
 */
function handleRecordingKey(event: KeyboardEvent): void {
  if (!isRecording) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.code === "Escape") {
    dispatch({ type: "cancelShortcutRecording" });
    return;
  }
  if (MODIFIER_CODES.includes(event.code)) {
    return;
  }
  dispatch({ type: "recordShortcutKeys", code: event.code, meta: event.metaKey, control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey });
}

// Capturing on the window, so the recorder hears a key before anything else on the page.
window.addEventListener("keydown", handleRecordingKey, true);

/**
 * One command's row: its name, its keys (a button that records new ones), and Reset / × when they apply.
 */
function createShortcutRow(item: LibraryData["shortcuts"]["groups"][number]["items"][number], recordingPath: string | null): HTMLElement {
  const row = createElement("div", "library-line shortcut-row");
  row.dataset.path = item.path;
  const isRecording = recordingPath === item.path;
  row.append(createElement("span", "library-line-title", item.label));
  const keysLabel = isRecording ? "Press keys…" : item.keys === "" ? "None" : item.keys;
  const keysButton = createTextButton(keysLabel, "library-chip shortcut-keys", () => {
    dispatch(isRecording ? { type: "cancelShortcutRecording" } : { type: "beginShortcutRecording", path: item.path });
  });
  keysButton.classList.toggle("is-active", isRecording);
  keysButton.classList.toggle("is-empty", item.keys === "" && !isRecording);
  keysButton.title = isRecording ? "Press the new keys (Esc stops)" : "Click, then press the new keys";
  row.append(keysButton);
  if (item.isChanged) {
    row.append(createTextButton("Reset", "library-chip shortcut-reset", () => dispatch({ type: "setShortcut", path: item.path, accelerator: null })));
  }
  if (item.keys !== "") {
    row.append(createIconButton("close", "Remove the keys", "library-line-icon-button shortcut-remove", () => dispatch({ type: "setShortcut", path: item.path, accelerator: "" })));
  }
  return row;
}

/**
 * Builds the Shortcuts section.
 */
export function renderShortcutsSection(body: HTMLElement, data: LibraryData): void {
  const shortcuts = data.shortcuts;
  isRecording = shortcuts.recordingPath !== null;
  const section = createElement("div", "library-settings library-shortcuts");
  const toolbar = createElement("div", "library-toolbar");
  const hasChanges = shortcuts.groups.some((group) => group.items.some((item) => item.isChanged));
  const resetAll = createTextButton("Reset All", "library-chip shortcut-reset-all", () => dispatch({ type: "resetAllShortcuts" }));
  resetAll.disabled = !hasChanges;
  toolbar.append(resetAll);
  section.append(toolbar, createElement("p", "library-setting-note", "Click a command's keys and press new ones; Esc stops. Keys another command or macOS already uses are refused."));
  if (shortcuts.problem !== null) {
    section.append(createElement("p", "library-setting-note shortcut-problem", shortcuts.problem));
  }
  for (const group of shortcuts.groups) {
    section.append(createElement("h2", "library-setting-heading", group.title));
    for (const item of group.items) {
      section.append(createShortcutRow(item, shortcuts.recordingPath));
    }
  }
  body.replaceChildren(section);
}
