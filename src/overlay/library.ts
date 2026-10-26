/**
 * WHY this file exists:
 *   The Library, like Arc's: the Archive (every closed, cleared and auto-archived tab, searchable and restorable),
 *   browsing History, Downloads, and the auto-archive setting. It is a large panel in the overlay.
 *
 * Data source:
 *   LibraryData from overlayController.ts (archive, Spaces, recent history, downloads, setting), refreshed while open,
 *   and history searches through window.overlayApi.searchHistory.
 *
 * Data flow:
 *   "overlay:show" (library) → renderLibrary() → a section → click Restore → dispatch restoreArchivedTab → close
 */
import type { ExtensionLine, HistoryLine, LibraryData, LibrarySection } from "../shared/overlay";
import { ARCHIVE_THRESHOLD_OPTIONS, DAY_MS, HOUR_MS, MINUTE_MS } from "../shared/settings.js";
import type { ArchiveReason, ArchivedTab } from "../shared/types";
import { createElement, createFavicon, createIconButton, createTextButton, dispatch, getDisplayHost } from "../renderer/dom.js";

/** Words shown for each archive reason. */
const REASON_LABELS: Record<ArchiveReason, string> = {
  auto: "Auto-archived",
  manual: "Closed",
  "clear-button": "Cleared",
};

/** Section tabs in display order. */
const SECTIONS: { id: LibrarySection; label: string }[] = [
  { id: "archive", label: "Archive" },
  { id: "history", label: "History" },
  { id: "downloads", label: "Downloads" },
  { id: "extensions", label: "Extensions" },
  { id: "settings", label: "Settings" },
];

/** Most archive lines drawn at once; the search finds older ones. */
const MAX_ARCHIVE_LINES = 200;

/** Wait this long after typing before searching history. */
const HISTORY_SEARCH_DELAY_MS = 150;

/** Bytes per kilobyte and megabyte, for download sizes. */
const KILOBYTE = 1024;
const MEGABYTE = 1024 * 1024;

/** The archive filter chips. "all" shows everything; the others match one reason. */
type ArchiveFilter = "all" | ArchiveReason;

/** The panel's own state, kept across refreshes while it stays open. */
let library: LibraryData | null = null;
let section: LibrarySection = "archive";
let archiveQuery = "";
let archiveFilter: ArchiveFilter = "all";
let historyQuery = "";
let historyLines: HistoryLine[] = [];
let historySearchTimer: number | null = null;
let isConfirmingClearHistory = false;

/**
 * Turns a time into short text such as "2 h ago".
 */
function formatTimeAgo(time: number, now: number): string {
  const elapsed = now - time;
  if (elapsed < MINUTE_MS) {
    return "just now";
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)} h ago`;
  }
  return `${Math.floor(elapsed / DAY_MS)} d ago`;
}

/**
 * Turns a byte count into "512 KB" or "3.4 MB".
 */
function formatSize(bytes: number): string {
  if (bytes < MEGABYTE) {
    return `${Math.max(1, Math.round(bytes / KILOBYTE))} KB`;
  }
  return `${(bytes / MEGABYTE).toFixed(1)} MB`;
}

/**
 * Builds a search field that calls back on every keystroke.
 */
function createSearchField(placeholder: string, value: string, onInput: (text: string) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "library-search";
  input.type = "search";
  input.placeholder = placeholder;
  input.value = value;
  input.setAttribute("aria-label", placeholder);
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

/**
 * True when an archive entry matches the search text and the filter chip.
 */
function matchesArchiveFilters(entry: ArchivedTab): boolean {
  if (archiveFilter !== "all" && entry.reason !== archiveFilter) {
    return false;
  }
  const words = archiveQuery.toLowerCase().split(/\s+/).filter((word) => word !== "");
  const searchable = `${entry.tab.customTitle ?? entry.tab.title} ${entry.tab.url}`.toLowerCase();
  return words.every((word) => searchable.includes(word));
}

/**
 * Builds one archive line: icon, title, where and when it was archived. Clicking restores the tab.
 */
function createArchiveLine(entry: ArchivedTab, data: LibraryData, now: number): HTMLElement {
  const line = createElement("div", "library-line");
  line.setAttribute("role", "button");
  line.title = `${entry.tab.url}\nClick to restore`;
  const space = data.spaces.find((candidate) => candidate.id === entry.fromSpaceId);
  const placeLabel = space === undefined ? "Little Window or removed Space" : `${space.icon} ${space.name}`;
  const meta = `${getDisplayHost(entry.tab.url)} · ${REASON_LABELS[entry.reason]} ${formatTimeAgo(entry.archivedAt, now)} · ${placeLabel}`;

  const text = createElement("span", "library-line-text");
  text.append(createElement("span", "library-line-title", entry.tab.customTitle ?? entry.tab.title));
  text.append(createElement("span", "library-line-meta", meta));
  const restoreButton = createTextButton("Restore", "library-line-button", () => restoreEntry(entry));

  line.append(createFavicon(entry.tab.faviconUrl, entry.tab.url), text, restoreButton);
  line.addEventListener("click", () => restoreEntry(entry));
  return line;
}

/**
 * Restores an archived tab and closes the Library, so the tab is in front of you, like Arc.
 */
function restoreEntry(entry: ArchivedTab): void {
  dispatch({ type: "restoreArchivedTab", tabId: entry.tab.id });
  window.overlayApi.close();
}

/**
 * Builds the Archive section: search, reason chips, and the newest matching entries.
 */
function renderArchiveSection(body: HTMLElement, data: LibraryData): void {
  const controls = createElement("div", "library-controls");
  const search = createSearchField("Search archived tabs", archiveQuery, (text) => {
    archiveQuery = text;
    drawArchiveLines(data);
  });
  const chips = createElement("div", "library-chips");
  const chipChoices: { filter: ArchiveFilter; label: string }[] = [
    { filter: "all", label: "All" },
    { filter: "auto", label: "Auto-archived" },
    { filter: "manual", label: "Closed" },
    { filter: "clear-button", label: "Cleared" },
  ];
  for (const choice of chipChoices) {
    const chip = createTextButton(choice.label, "library-chip", () => {
      archiveFilter = choice.filter;
      renderBody(data);
    });
    chip.classList.toggle("is-active", archiveFilter === choice.filter);
    chips.append(chip);
  }
  controls.append(search, chips);
  const list = createElement("div", "library-list");
  list.id = "archive-list";
  body.replaceChildren(controls, list);
  drawArchiveLines(data);
  requestAnimationFrame(() => search.focus());
}

/**
 * Draws the archive lines that match the current search and chip.
 */
function drawArchiveLines(data: LibraryData): void {
  const list = document.getElementById("archive-list");
  if (list === null) {
    return;
  }
  const now = Date.now();
  const matching = data.archive.filter(matchesArchiveFilters);
  const lines = matching.slice(0, MAX_ARCHIVE_LINES).map((entry) => createArchiveLine(entry, data, now));
  if (lines.length === 0) {
    const emptyText = data.archive.length === 0 ? "Closed and auto-archived tabs land here." : "No archived tab matches.";
    list.replaceChildren(createElement("p", "library-empty", emptyText));
    return;
  }
  const countText = `${matching.length} archived tab${matching.length === 1 ? "" : "s"}`;
  list.replaceChildren(createElement("p", "library-count", countText), ...lines);
}

/**
 * Builds one history line; clicking opens the page in a new tab.
 */
function createHistoryLine(entry: HistoryLine, now: number): HTMLElement {
  const line = createElement("div", "library-line");
  line.setAttribute("role", "button");
  line.title = entry.url;
  const text = createElement("span", "library-line-text");
  text.append(createElement("span", "library-line-title", entry.title === "" ? entry.url : entry.title));
  text.append(createElement("span", "library-line-meta", `${getDisplayHost(entry.url)} · ${formatTimeAgo(entry.lastVisitAt, now)}`));
  line.append(createFavicon(null, entry.url), text);
  line.addEventListener("click", () => window.overlayApi.openUrl(entry.url));
  return line;
}

/**
 * Draws the history lines.
 */
function drawHistoryLines(): void {
  const list = document.getElementById("history-list");
  if (list === null) {
    return;
  }
  const now = Date.now();
  if (historyLines.length === 0) {
    list.replaceChildren(createElement("p", "library-empty", historyQuery === "" ? "Pages you visit show up here." : "No page matches."));
    return;
  }
  list.replaceChildren(...historyLines.map((entry) => createHistoryLine(entry, now)));
}

/**
 * Searches history in the main process a moment after typing stops.
 */
function scheduleHistorySearch(text: string): void {
  historyQuery = text;
  if (historySearchTimer !== null) {
    window.clearTimeout(historySearchTimer);
  }
  historySearchTimer = window.setTimeout(async () => {
    historyLines = await window.overlayApi.searchHistory(historyQuery);
    drawHistoryLines();
  }, HISTORY_SEARCH_DELAY_MS);
}

/**
 * Builds the History section: search, Clear History (asks once more before deleting), and the lines.
 */
function renderHistorySection(body: HTMLElement, data: LibraryData): void {
  const controls = createElement("div", "library-controls");
  const search = createSearchField("Search history", historyQuery, scheduleHistorySearch);
  const clearLabel = isConfirmingClearHistory ? "Click again to delete all history" : "Clear History";
  const clearButton = createTextButton(clearLabel, "library-chip danger", () => {
    if (!isConfirmingClearHistory) {
      isConfirmingClearHistory = true;
      renderBody(data);
      return;
    }
    isConfirmingClearHistory = false;
    historyLines = [];
    window.overlayApi.clearHistory();
  });
  controls.append(search, clearButton);
  const list = createElement("div", "library-list");
  list.id = "history-list";
  body.replaceChildren(controls, list);
  if (historyQuery === "") {
    historyLines = data.history;
  }
  drawHistoryLines();
  requestAnimationFrame(() => search.focus());
}

/**
 * Builds the Downloads section: one line per download with progress or result, and Show in Finder.
 */
function renderDownloadsSection(body: HTMLElement, data: LibraryData): void {
  const list = createElement("div", "library-list");
  if (data.downloads.length === 0) {
    list.append(createElement("p", "library-empty", "Files you download in this session show up here. They are saved in your Downloads folder."));
  }
  const now = Date.now();
  for (const download of data.downloads) {
    const line = createElement("div", "library-line");
    const text = createElement("span", "library-line-text");
    text.append(createElement("span", "library-line-title", download.fileName));
    let status = `${formatSize(download.receivedBytes)} · ${download.state} · ${formatTimeAgo(download.startedAt, now)}`;
    if (download.state === "progressing" && download.totalBytes > 0) {
      const percent = Math.round((download.receivedBytes / download.totalBytes) * 100);
      status = `${percent}% of ${formatSize(download.totalBytes)}`;
    }
    text.append(createElement("span", "library-line-meta", status));
    const showButton = createIconButton("download", "Show in Finder", "library-line-icon-button", () => window.overlayApi.showDownload(download.id));
    line.append(text, showButton);
    list.append(line);
  }
  body.replaceChildren(list);
}

/**
 * Builds one extension line: icon, name, version and where it came from, an On/Off switch and Remove.
 */
function createExtensionLine(extension: ExtensionLine): HTMLElement {
  const line = createElement("div", "library-line extension-line");
  line.classList.toggle("is-off", !extension.isEnabled);
  const icon = document.createElement("img");
  icon.className = "extension-icon";
  icon.alt = "";
  if (extension.iconUrl !== null) {
    icon.src = extension.iconUrl;
  }
  const text = createElement("span", "library-line-text");
  text.append(createElement("span", "library-line-title", extension.name));
  const origin = extension.source === "arc" ? "from Arc" : "unpacked";
  const meta = extension.loadError === null ? `${extension.version} · ${origin}` : `Could not load: ${extension.loadError}`;
  text.append(createElement("span", "library-line-meta", meta));
  const switchButton = createTextButton(extension.isEnabled ? "On" : "Off", extension.isEnabled ? "library-chip is-active" : "library-chip", () =>
    dispatch({ type: "setExtensionEnabled", profileId: extension.profileId, extensionId: extension.id, isEnabled: !extension.isEnabled }),
  );
  switchButton.title = extension.isEnabled ? "Turn off" : "Turn on";
  const removeButton = createIconButton("trash", "Remove extension", "library-line-icon-button", () =>
    dispatch({ type: "removeExtension", profileId: extension.profileId, extensionId: extension.id }),
  );
  line.append(icon, text, switchButton, removeButton);
  return line;
}

/**
 * Builds the Extensions section: Load Unpacked and Import from Arc, then each profile's extensions.
 */
function renderExtensionsSection(body: HTMLElement, data: LibraryData): void {
  const section = createElement("div", "library-extensions");
  const toolbar = createElement("div", "library-toolbar");
  toolbar.append(
    createTextButton("Load Unpacked…", "library-chip", () => dispatch({ type: "loadUnpackedExtension" })),
    createTextButton("Import from Arc…", "library-chip", () => dispatch({ type: "importFromArc" })),
  );
  section.append(toolbar);
  section.append(
    createElement(
      "p",
      "library-setting-note",
      "Chrome extensions run per profile, like in Arc. Open one from the puzzle button in the toolbar. " +
        "Reload open pages after adding or turning one on. Extensions that need Chrome features this browser lacks may only partly work.",
    ),
  );
  if (data.extensions.length === 0) {
    section.append(createElement("p", "library-empty", "No extensions yet. Import your Arc extensions, or load an unpacked extension folder."));
  }
  const profileIds = Array.from(new Set(data.extensions.map((extension) => extension.profileId)));
  for (const profileId of profileIds) {
    const profileExtensions = data.extensions.filter((extension) => extension.profileId === profileId);
    if (profileIds.length > 1) {
      section.append(createElement("h2", "library-setting-heading", `Profile: ${profileExtensions[0]?.profileName ?? profileId}`));
    }
    const list = createElement("div", "library-list");
    list.append(...profileExtensions.map((extension) => createExtensionLine(extension)));
    section.append(list);
  }
  body.replaceChildren(section);
}

/**
 * Builds the Settings section: when unused tabs are archived.
 */
function renderSettingsSection(body: HTMLElement, data: LibraryData): void {
  const settings = createElement("div", "library-settings");
  const row = createElement("label", "library-setting-row");
  row.append(createElement("span", "library-setting-label", "Archive Today tabs after"));
  const select = document.createElement("select");
  select.className = "library-select";
  for (const option of ARCHIVE_THRESHOLD_OPTIONS) {
    const optionElement = document.createElement("option");
    optionElement.textContent = option.label;
    optionElement.selected = option.valueMs === data.archiveAfterMs;
    select.append(optionElement);
  }
  select.addEventListener("change", () => {
    // Options were added in the order of ARCHIVE_THRESHOLD_OPTIONS, so the index finds the choice.
    const chosen = ARCHIVE_THRESHOLD_OPTIONS[select.selectedIndex];
    if (chosen !== undefined) {
      dispatch({ type: "setArchiveAfter", archiveAfterMs: chosen.valueMs });
    }
  });
  row.append(select);
  const explanation = createElement(
    "p",
    "library-setting-note",
    "Today tabs you have not used for this long move to the Archive, checked every 5 minutes, like Arc (default 12 hours). " +
      "Pinned tabs and Favorites never do. Time while the browser is closed does not count. Little Windows archive after 6 hours. " +
      "The Archive keeps your newest 250 tabs, like Arc.",
  );
  settings.append(row, explanation, renderRoutingSettings(data));
  body.replaceChildren(settings);
}

/**
 * Builds the Air Traffic Control settings: the rules that send links from other apps to a Space, and a form to add one.
 */
function renderRoutingSettings(data: LibraryData): HTMLElement {
  const section = createElement("div", "library-routing");
  section.append(createElement("h2", "library-setting-heading", "Links from other apps"));
  section.append(createElement("p", "library-setting-note", "Links you open in other apps open in a Little Window, unless a rule below sends them to a Space (Arc's Air Traffic Control)."));

  for (const rule of data.routingRules) {
    const space = data.spaces.find((candidate) => candidate.id === rule.spaceId);
    const spaceLabel = space === undefined ? "a deleted Space" : `${space.icon} ${space.name}`;
    const line = createElement("div", "library-line routing-rule");
    const verb = rule.matchType === "contains" ? "contains" : "is";
    line.append(createElement("span", "library-line-title", `If the address ${verb} “${rule.value}” → ${spaceLabel}`));
    line.append(createIconButton("trash", "Remove rule", "library-line-icon-button", () => dispatch({ type: "removeRoutingRule", ruleId: rule.id })));
    section.append(line);
  }

  const form = document.createElement("form");
  form.className = "routing-form";
  const matchSelect = document.createElement("select");
  matchSelect.className = "library-select";
  matchSelect.append(new Option("Address contains", "contains"), new Option("Address is", "is"));
  const valueInput = document.createElement("input");
  valueInput.className = "library-search";
  valueInput.placeholder = "github.com";
  valueInput.setAttribute("aria-label", "Address part");
  const spaceSelect = document.createElement("select");
  spaceSelect.className = "library-select";
  for (const space of data.spaces) {
    spaceSelect.append(new Option(`${space.icon} ${space.name}`, space.id));
  }
  const addButton = document.createElement("button");
  addButton.type = "submit";
  addButton.className = "library-chip is-active";
  addButton.textContent = "Add Rule";
  form.append(matchSelect, valueInput, spaceSelect, addButton);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const matchType = matchSelect.value === "is" ? "is" : "contains";
    dispatch({ type: "addRoutingRule", matchType: matchType, value: valueInput.value, spaceId: spaceSelect.value });
  });
  section.append(form);
  return section;
}

/**
 * Draws the selected section into the panel body.
 */
function renderBody(data: LibraryData): void {
  const body = document.getElementById("library-body");
  const tabs = document.getElementById("library-tabs");
  if (body === null || tabs === null) {
    return;
  }
  for (const button of tabs.querySelectorAll<HTMLButtonElement>("button")) {
    button.classList.toggle("is-active", button.dataset.section === section);
  }
  if (section === "archive") {
    renderArchiveSection(body, data);
  }
  if (section === "history") {
    renderHistorySection(body, data);
  }
  if (section === "downloads") {
    renderDownloadsSection(body, data);
  }
  if (section === "extensions") {
    renderExtensionsSection(body, data);
  }
  if (section === "settings") {
    renderSettingsSection(body, data);
  }
}

/**
 * Builds the Library panel and shows the requested section.
 */
export function renderLibrary(host: HTMLElement, data: LibraryData, requestedSection: LibrarySection): void {
  library = data;
  section = requestedSection;
  isConfirmingClearHistory = false;

  const panel = createElement("div", "panel library");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Library");
  const header = createElement("div", "library-header");
  header.append(createElement("h1", "library-title", "Library"));
  const tabs = createElement("nav", "library-tabs");
  tabs.id = "library-tabs";
  for (const choice of SECTIONS) {
    const button = createTextButton(choice.label, "library-tab", () => {
      section = choice.id;
      if (library !== null) {
        renderBody(library);
      }
    });
    button.dataset.section = choice.id;
    tabs.append(button);
  }
  header.append(tabs, createIconButton("close", "Close (Esc)", "library-close", () => window.overlayApi.close()));
  const body = createElement("div", "library-body");
  body.id = "library-body";
  panel.append(header, body);
  host.replaceChildren(panel);
  renderBody(data);
}

/**
 * Takes fresh data while the Library is open. Redraws only the lists that change by themselves, so typing in a
 * search field is never interrupted.
 */
function handleLibraryUpdate(updated: LibraryData): void {
  if (document.body.dataset.panel !== "library") {
    return;
  }
  library = updated;
  if (section === "archive") {
    drawArchiveLines(updated);
  }
  if (section === "downloads" || section === "settings") {
    renderBody(updated);
  }
}

window.overlayApi.onLibraryUpdate(handleLibraryUpdate);
