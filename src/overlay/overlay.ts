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
 *   a site's name + Tab → site search mode (siteSearch.ts) → Enter → overlayApi.choose(null, that site's search address)
 */
import type { CommandBarLine, CommandBarMode, OverlayApi, OverlayShowMessage } from "../shared/overlay";
import { createElement, createFavicon } from "../renderer/dom.js";
import { createIcon, installSymbols } from "../renderer/icons.js";
import type { IconName } from "../renderer/icons.js";
import { renderFindBar } from "./findBar.js";
import { renderLibrary } from "./library.js";
import { renderBoostEditor } from "./boostEditor.js";
import { renderPeekFrame } from "./peekFrame.js";
import { renderPermissionPrompt } from "./permissionPrompt.js";
import { renderThemeEditor } from "./themeEditor.js";
import { renderSiteControls } from "./siteControls.js";
import { buildSiteSearchUrl, findSiteSearch } from "../shared/siteSearch.js";
import type { SiteSearch } from "../shared/siteSearch.js";

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

/** The site being searched after Tab (Arc's "search YouTube"), or null for the normal Command Bar. */
let siteSearch: SiteSearch | null = null;

/** The chip that shows the site being searched, and the "Tab: Search …" hint. Made with the Command Bar. */
let siteChip: HTMLElement | null = null;
let siteHint: HTMLElement | null = null;

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
 * Picks a line (or, with no lines, what was typed). In site search mode it opens the site's search for the text.
 */
function chooseLine(index: number): void {
  const typedText = commandInput === null ? "" : commandInput.value;
  if (siteSearch !== null) {
    if (typedText.trim() !== "") {
      window.overlayApi.choose(null, buildSiteSearchUrl(siteSearch, typedText), commandMode);
    }
    return;
  }
  const line = commandLines[index];
  window.overlayApi.choose(line === undefined ? null : line.id, typedText, commandMode);
}

/**
 * Shows "Tab: Search YouTube" while the typed text names a searchable site.
 */
function updateSiteHint(text: string): void {
  if (siteHint === null) {
    return;
  }
  const site = siteSearch === null ? findSiteSearch(text) : null;
  siteHint.hidden = site === null;
  siteHint.textContent = site === null ? "" : `Tab: Search ${site.name}`;
}

/**
 * In site search mode the only line is the search itself: "Search YouTube for “lofi”".
 */
function drawSiteSearchLine(text: string): void {
  const query = text.trim();
  commandLines =
    siteSearch === null || query === ""
      ? []
      : [{ id: "site-search", kind: "search", title: `Search ${siteSearch.name} for “${query}”`, subtitle: "", url: null, faviconUrl: null }];
  highlightedIndex = 0;
  drawCommandLines();
}

/**
 * Tab on a site's name: the input now searches that site, shown as a chip before it.
 */
function enterSiteSearch(site: SiteSearch): void {
  siteSearch = site;
  // Answers to queries sent before this point are for the site's name, not for the search.
  queryCounter = queryCounter + 1;
  if (siteChip !== null) {
    siteChip.textContent = site.name;
    siteChip.hidden = false;
  }
  if (commandInput !== null) {
    commandInput.value = "";
    commandInput.placeholder = `Search ${site.name}…`;
  }
  updateSiteHint("");
  drawSiteSearchLine("");
}

/**
 * Backspace in the empty input: back to the normal Command Bar.
 */
function leaveSiteSearch(): void {
  siteSearch = null;
  if (siteChip !== null) {
    siteChip.hidden = true;
  }
  if (commandInput !== null) {
    commandInput.placeholder = PLACEHOLDERS[commandMode];
  }
  runQuery("");
}

/**
 * Typing: rank results for the text, or in site search mode just show the search line.
 */
function handleCommandInput(text: string): void {
  if (siteSearch !== null) {
    drawSiteSearchLine(text);
    return;
  }
  updateSiteHint(text);
  runQuery(text);
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
 * Arrow keys move the highlight, Enter chooses, Tab starts a site search, Backspace leaves it, Escape closes.
 */
function handleCommandKeys(event: KeyboardEvent): void {
  if (event.key === "Tab") {
    // Keep the focus in the input either way.
    event.preventDefault();
    const site = siteSearch === null && commandInput !== null ? findSiteSearch(commandInput.value) : null;
    if (site !== null) {
      enterSiteSearch(site);
    }
    return;
  }
  if (event.key === "Backspace" && siteSearch !== null && commandInput !== null && commandInput.value === "") {
    event.preventDefault();
    leaveSiteSearch();
    return;
  }
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
  siteSearch = null;

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
  input.addEventListener("input", () => handleCommandInput(input.value));
  input.addEventListener("keydown", handleCommandKeys);
  const chip = createElement("span", "command-site-chip");
  chip.hidden = true;
  const hint = createElement("span", "command-site-hint");
  hint.hidden = true;
  inputRow.append(chip, input, hint);
  commandInput = input;
  siteChip = chip;
  siteHint = hint;

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
  // The Find bar's and a permission prompt's overlay is only as big as the card, so it needs no backdrop.
  backdrop.hidden = message.panel.kind === "find" || message.panel.kind === "permission";

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
  if (message.panel.kind === "peek") {
    renderPeekFrame(host, message.panel);
  }
  if (message.panel.kind === "theme") {
    renderThemeEditor(host, message.panel);
  }
  if (message.panel.kind === "boost") {
    renderBoostEditor(host, message.panel);
  }
  if (message.panel.kind === "permission") {
    renderPermissionPrompt(host, message.panel);
  }
}

/**
 * Entry point: listens for panels and results, and closes on Escape or a click on the backdrop.
 */
function startOverlay(): void {
  window.overlayApi.getSymbols().then(installSymbols).catch(() => undefined);
  window.overlayApi.onShow(showPanel);
  window.overlayApi.onResults((query, lines) => {
    if (commandInput === null || commandInput.value !== query || siteSearch !== null) {
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
