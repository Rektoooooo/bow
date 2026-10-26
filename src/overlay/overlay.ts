/**
 * WHY this file exists:
 *   Entry point of the overlay page. It receives "show this panel" messages, draws the right panel, closes on
 *   Escape or a click outside, and holds the Command Bar (the panel used most, so it lives here).
 *
 * Data source:
 *   window.overlayApi messages from overlayController.ts (panel to show, Command Bar results).
 *
 * Data flow:
 *   "overlay:show" → showPanel() → renderCommandBar / renderLibrary / renderSiteControls / renderFindBar
 *   typing → overlayApi.query → lines → drawn; Enter → overlayApi.choose(line id)
 */
import type { CommandBarLine, CommandBarMode, OverlayApi, OverlayShowMessage } from "../shared/overlay";
import { createElement, createFavicon } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";
import type { IconName } from "../renderer/icons.js";
import { renderFindBar } from "./findBar.js";
import { renderLibrary } from "./library.js";
import { renderSiteControls } from "./siteControls.js";

declare global {
  interface Window {
    overlayApi: OverlayApi;
  }
}

/** Hint on the right of each Command Bar line, by kind. */
const LINE_HINTS: Record<CommandBarLine["kind"], string> = {
  tab: "Switch to Tab",
  history: "Open",
  navigate: "Open",
  search: "Search",
  action: "Run",
};

/** Icon for lines that have no favicon, by kind. */
const LINE_ICONS: Record<CommandBarLine["kind"], IconName> = {
  tab: "globe",
  history: "reload",
  navigate: "globe",
  search: "search",
  action: "sliders",
};

/** Placeholder text per Command Bar mode. */
const PLACEHOLDERS: Record<CommandBarMode, string> = {
  newTab: "Search or Enter URL…",
  editUrl: "Search or Enter URL…",
  splitWith: "Open in Split View…",
};

/** The Command Bar's current lines and which one is highlighted. */
let commandLines: CommandBarLine[] = [];
let highlightedIndex = 0;
let commandMode: CommandBarMode = "newTab";
let commandInput: HTMLInputElement | null = null;

/** Counts queries, so a slow answer to an old query does not replace a newer one. */
let queryCounter = 0;

/**
 * Closes the overlay.
 */
export function closeOverlay(): void {
  window.overlayApi.close();
}

/**
 * Builds one Command Bar line.
 */
function createCommandLine(line: CommandBarLine, index: number): HTMLElement {
  const row = createElement("div", "command-line");
  row.setAttribute("role", "option");
  row.dataset.index = String(index);
  row.classList.toggle("is-highlighted", index === highlightedIndex);

  const iconSlot = createElement("span", "command-line-icon");
  const hasPage = line.url !== null && (line.kind === "tab" || line.kind === "history" || line.kind === "navigate");
  if (line.faviconUrl !== null || hasPage) {
    iconSlot.append(createFavicon(line.faviconUrl, line.url ?? ""));
  } else {
    iconSlot.append(createIcon(LINE_ICONS[line.kind]));
  }

  const text = createElement("span", "command-line-text");
  text.append(createElement("span", "command-line-title", line.title));
  if (line.subtitle !== "") {
    text.append(createElement("span", "command-line-subtitle", line.subtitle));
  }
  const hint = createElement("span", "command-line-hint", LINE_HINTS[line.kind]);
  if (line.kind === "tab") {
    hint.append(createIcon("forward", "icon hint-arrow"));
  }

  row.append(iconSlot, text, hint);
  row.addEventListener("mousemove", () => {
    if (highlightedIndex !== index) {
      highlightedIndex = index;
      drawCommandLines();
    }
  });
  row.addEventListener("click", () => chooseLine(index));
  return row;
}

/**
 * Redraws the Command Bar's lines.
 */
function drawCommandLines(): void {
  const list = document.getElementById("command-lines");
  if (list === null) {
    return;
  }
  const rows = commandLines.map((line, index) => createCommandLine(line, index));
  list.replaceChildren(...rows);
  list.hidden = rows.length === 0;
}

/**
 * Picks a line (or, with no lines, what was typed).
 */
function chooseLine(index: number): void {
  const line = commandLines[index];
  const typedText = commandInput === null ? "" : commandInput.value;
  window.overlayApi.choose(line === undefined ? null : line.id, typedText, commandMode);
}

/**
 * Asks for results for the typed text and draws them, unless a newer query was sent meanwhile.
 */
async function runQuery(text: string): Promise<void> {
  queryCounter = queryCounter + 1;
  const thisQuery = queryCounter;
  const lines = await window.overlayApi.query(text, commandMode);
  if (thisQuery !== queryCounter) {
    return;
  }
  commandLines = lines;
  highlightedIndex = 0;
  drawCommandLines();
}

/**
 * Arrow keys move the highlight, Enter chooses, Escape closes.
 */
function handleCommandKeys(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    const count = commandLines.length;
    highlightedIndex = count === 0 ? 0 : (highlightedIndex + step + count) % count;
    drawCommandLines();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    chooseLine(highlightedIndex);
  }
}

/**
 * Builds the Command Bar: an input and the result lines. ⌘L starts with the current address selected.
 */
function renderCommandBar(host: HTMLElement, mode: CommandBarMode, initialText: string): void {
  commandMode = mode;
  commandLines = [];
  highlightedIndex = 0;

  const panel = createElement("div", "panel command-bar");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Command Bar");
  const inputRow = createElement("div", "command-input-row");
  inputRow.append(createIcon("search", "icon command-search-icon"));

  const input = document.createElement("input");
  input.className = "command-input";
  input.type = "text";
  input.spellcheck = false;
  input.placeholder = PLACEHOLDERS[mode];
  input.value = initialText;
  input.setAttribute("aria-label", PLACEHOLDERS[mode]);
  input.addEventListener("input", () => runQuery(input.value));
  input.addEventListener("keydown", handleCommandKeys);
  inputRow.append(input);
  commandInput = input;

  const list = createElement("div", "command-lines");
  list.id = "command-lines";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  panel.append(inputRow, list);
  host.replaceChildren(panel);

  input.focus();
  input.select();
  runQuery(initialText);
}

/**
 * Draws the panel a "show" message asks for.
 */
function showPanel(message: OverlayShowMessage): void {
  const host = document.getElementById("panel");
  const backdrop = document.getElementById("backdrop");
  if (host === null || backdrop === null) {
    return;
  }
  document.body.classList.toggle("dark", message.isDark);
  document.body.dataset.panel = message.panel.kind;
  // The Find bar's overlay is only as big as the bar, so it needs no backdrop.
  backdrop.hidden = message.panel.kind === "find";

  if (message.panel.kind === "commandBar") {
    renderCommandBar(host, message.panel.mode, message.panel.initialText);
    return;
  }
  if (message.panel.kind === "library" && message.library !== null) {
    renderLibrary(host, message.library, message.panel.section);
    return;
  }
  if (message.panel.kind === "siteControls" && message.site !== null) {
    renderSiteControls(host, message.site);
    return;
  }
  if (message.panel.kind === "find") {
    renderFindBar(host);
  }
}

/**
 * Entry point: listens for panels and results, and closes on Escape or a click on the backdrop.
 */
function startOverlay(): void {
  window.overlayApi.onShow(showPanel);
  window.overlayApi.onResults((query, lines) => {
    if (commandInput === null || commandInput.value !== query) {
      return;
    }
    const highlightedId = commandLines[highlightedIndex]?.id;
    commandLines = lines;
    const sameLineIndex = lines.findIndex((line) => line.id === highlightedId);
    highlightedIndex = sameLineIndex === -1 ? 0 : sameLineIndex;
    drawCommandLines();
  });
  document.getElementById("backdrop")?.addEventListener("mousedown", () => closeOverlay());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeOverlay();
    }
  });
}

startOverlay();
