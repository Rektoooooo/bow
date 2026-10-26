/**
 * WHY this file exists:
 *   Arc's Notes: rich text that sits in the sidebar like a tab. When a note tab is selected no web page shows, and
 *   this editor fills the page card: a row of formatting buttons and the text. Typing "# ", "- ", "1. " or "[] " at
 *   the start of a line makes a heading, a list or a checklist; ⌘B / ⌘I / ⌘U format; a pasted text arrives plain.
 *   The note's first line names the tab. Everything that goes in or out is cleaned to a short list of tags.
 *
 * Data source:
 *   The note's HTML (browserApi.readNote), and what the user types.
 *
 * Data flow:
 *   sidebar.ts (a note tab is selected) → showNoteEditor(noteId) → readNote → cleaned → editable text
 *   typing → a moment later → cleaned HTML + first line → browserApi.saveNote → main writes the file, names the tab
 */
import { createElement } from "./dom.js";
import { createIcon } from "./icons.js";
import type { IconName } from "./icons.js";

/** Save this long after the last change. Our choice: nothing typed is lost, and not one write per letter. */
const SAVE_DELAY_MS = 600;

/** A click this close to a checklist item's left edge ticks it (the box is drawn there). */
const CHECKBOX_AREA_PX = 24;

/** The tab's name is the note's first line, cut to this many characters. Our choice. */
const MAX_TITLE_LENGTH = 60;

/** Tags a note may contain; everything else is unwrapped to its text. Our choice: what the buttons can make. */
const ALLOWED_TAGS = new Set(["P", "DIV", "BR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "H1", "H2", "H3", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "HR"]);

/** The only attributes kept: a checklist's class and an item's checked mark. */
const ALLOWED_ATTRIBUTES: Record<string, string[]> = { UL: ["class"], LI: ["data-checked"] };

/** Markdown-like starts of a line and the block they make. */
const LINE_SHORTCUTS: { typed: string; command: string; value?: string }[] = [
  { typed: "#", command: "formatBlock", value: "h1" },
  { typed: "##", command: "formatBlock", value: "h2" },
  { typed: "###", command: "formatBlock", value: "h3" },
  { typed: ">", command: "formatBlock", value: "blockquote" },
  { typed: "-", command: "insertUnorderedList" },
  { typed: "*", command: "insertUnorderedList" },
  { typed: "1.", command: "insertOrderedList" },
  { typed: "[]", command: "checklist" },
];

/** The formatting buttons, left to right. */
const FORMAT_BUTTONS: { icon: IconName | null; label: string; text: string; command: string; value?: string }[] = [
  { icon: null, label: "Title", text: "H1", command: "formatBlock", value: "h1" },
  { icon: null, label: "Heading", text: "H2", command: "formatBlock", value: "h2" },
  { icon: null, label: "Text", text: "¶", command: "formatBlock", value: "p" },
  { icon: null, label: "Bold (⌘B)", text: "B", command: "bold" },
  { icon: null, label: "Italic (⌘I)", text: "I", command: "italic" },
  { icon: null, label: "Strikethrough", text: "S", command: "strikeThrough" },
  { icon: null, label: "Bulleted list", text: "•", command: "insertUnorderedList" },
  { icon: null, label: "Numbered list", text: "1.", command: "insertOrderedList" },
  { icon: "checkmark", label: "Checklist", text: "", command: "checklist" },
  { icon: null, label: "Quote", text: "❝", command: "formatBlock", value: "blockquote" },
  { icon: "code", label: "Code block", text: "", command: "formatBlock", value: "pre" },
];

let openNoteId: string | null = null;
let saveTimer: number | null = null;

/**
 * Copies a node into a clean document fragment: allowed tags with allowed attributes, everything else unwrapped.
 */
function cleanNode(node: Node, target: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (!(child instanceof Element)) {
      continue;
    }
    if (!ALLOWED_TAGS.has(child.tagName)) {
      cleanNode(child, target);
      continue;
    }
    const copy = document.createElement(child.tagName.toLowerCase());
    for (const attribute of ALLOWED_ATTRIBUTES[child.tagName] ?? []) {
      const value = child.getAttribute(attribute);
      if (value !== null) {
        copy.setAttribute(attribute, value);
      }
    }
    cleanNode(child, copy);
    target.appendChild(copy);
  }
}

/**
 * Cleans HTML to the allowed tags (parsed in an inert document, so nothing in it runs).
 */
function cleanHtml(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const fragment = document.createDocumentFragment();
  cleanNode(parsed.body, fragment);
  return fragment;
}

/**
 * The note's first line, for the tab's name.
 */
function readTitle(body: HTMLElement): string {
  const firstLine = (body.innerText ?? "").split("\n").map((line) => line.trim()).find((line) => line !== "") ?? "";
  return firstLine.slice(0, MAX_TITLE_LENGTH);
}

/**
 * Saves the note a moment after the last change.
 */
function scheduleSave(noteId: string, body: HTMLElement): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    const holder = document.createElement("div");
    holder.appendChild(cleanHtml(body.innerHTML));
    window.browserApi.saveNote(noteId, holder.innerHTML, readTitle(body)).catch(() => undefined);
  }, SAVE_DELAY_MS);
}

/**
 * Turns the current block into a checklist (a list whose items tick on click).
 */
function makeChecklist(): void {
  document.execCommand("insertUnorderedList");
  const selection = window.getSelection();
  const list = selection?.anchorNode instanceof Element ? selection.anchorNode.closest("ul") : selection?.anchorNode?.parentElement?.closest("ul");
  list?.classList.add("checklist");
}

/**
 * Runs a formatting command on the selection.
 */
function runFormat(command: string, value: string | undefined): void {
  if (command === "checklist") {
    makeChecklist();
    return;
  }
  document.execCommand(command, false, value);
}

/**
 * Typing a Markdown-like start of a line followed by a space turns the line into that block.
 */
function applyLineShortcut(body: HTMLElement): boolean {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode ?? null;
  if (selection === null || anchor === null || anchor.nodeType !== Node.TEXT_NODE || !body.contains(anchor)) {
    return false;
  }
  const typedBefore = (anchor.textContent ?? "").slice(0, selection.anchorOffset);
  const shortcut = LINE_SHORTCUTS.find((candidate) => candidate.typed === typedBefore);
  if (shortcut === undefined) {
    return false;
  }
  // Remove what was typed, then format the now empty line.
  const range = document.createRange();
  range.setStart(anchor, 0);
  range.setEnd(anchor, selection.anchorOffset);
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand("delete");
  runFormat(shortcut.command, shortcut.value);
  return true;
}

/**
 * Builds the editor for a note and loads its text.
 */
function buildEditor(noteId: string): HTMLElement {
  const editor = createElement("div", "note-editor");
  editor.dataset.noteId = noteId;
  const formatBar = createElement("div", "note-format-bar");
  const body = createElement("div", "note-body");
  body.contentEditable = "true";
  body.spellcheck = true;
  body.setAttribute("role", "textbox");
  body.setAttribute("aria-multiline", "true");
  body.setAttribute("aria-label", "Note");
  body.dataset.placeholder = "Start writing…";

  for (const button of FORMAT_BUTTONS) {
    const element = createElement("button", "note-format-button", button.text);
    element.title = button.label;
    element.setAttribute("aria-label", button.label);
    if (button.icon !== null) {
      element.append(createIcon(button.icon));
    }
    // Keep the selection in the text while clicking.
    element.addEventListener("mousedown", (event) => event.preventDefault());
    element.addEventListener("click", () => {
      runFormat(button.command, button.value);
      scheduleSave(noteId, body);
    });
    formatBar.append(element);
  }

  body.addEventListener("input", () => scheduleSave(noteId, body));
  body.addEventListener("keydown", (event) => {
    if (event.key === " " && applyLineShortcut(body)) {
      event.preventDefault();
      scheduleSave(noteId, body);
    }
  });
  body.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    document.execCommand("insertText", false, text);
  });
  // A checklist item ticks when its box (the item's left edge) is clicked.
  body.addEventListener("click", (event) => {
    const item = (event.target as Element | null)?.closest("ul.checklist > li");
    if (!(item instanceof HTMLElement) || event.clientX - item.getBoundingClientRect().left > CHECKBOX_AREA_PX) {
      return;
    }
    item.dataset.checked = item.dataset.checked === "true" ? "false" : "true";
    scheduleSave(noteId, body);
  });

  editor.append(formatBar, body);
  window.browserApi
    .readNote(noteId)
    .then((html) => {
      if (openNoteId !== noteId) {
        return;
      }
      body.replaceChildren(cleanHtml(html));
      body.focus();
    })
    .catch(() => undefined);
  return editor;
}

/**
 * Shows the editor of a note in the page card (keeping it while the same note stays open), or removes it for null.
 */
export function showNoteEditor(slot: HTMLElement, noteId: string | null): void {
  if (noteId === openNoteId) {
    return;
  }
  openNoteId = noteId;
  slot.querySelector(".note-editor")?.remove();
  if (noteId !== null) {
    slot.append(buildEditor(noteId));
  }
}
