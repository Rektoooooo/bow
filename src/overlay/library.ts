/**
 * WHY this file exists:
 *   The Library, like Arc's: the Archive (every closed, cleared and auto-archived tab, searchable and restorable),
 *   browsing History, Media, Downloads, Spaces, Boosts, Extensions and the settings. Like Arc's it takes the sidebar
 *   column, which widens for it (LIBRARY_COLUMN_WIDTH_PX): a rail of sections with the list beside it. The overlay is
 *   exactly that column and draws see-through, so the sidebar's own frame shows behind it.
 *
 * Data source:
 *   LibraryData from overlayController.ts (archive, Spaces, recent history, downloads, setting), refreshed while open,
 *   and history searches through window.overlayApi.searchHistory.
 *
 * Data flow:
 *   "overlay:show" (library) → renderLibrary() → a section → click Restore → dispatch restoreArchivedTab → close
 */
import type { ExtensionLine, HistoryLine, LibraryBoost, LibraryData, LibrarySection, LibrarySpace, LibrarySpaceItem, MediaLine } from "../shared/overlay";
import { computeFramePalette } from "../shared/themePalette.js";
import { ARCHIVE_THRESHOLD_OPTIONS, DAY_MS, HOUR_MS, MINUTE_MS } from "../shared/settings.js";
import { APP_ICON_VARIANTS, buildAppIconSvg } from "../shared/appIconDrawing.js";
import { isSearchEngineId, SEARCH_ENGINE_IDS, SEARCH_ENGINES } from "../shared/searchEngines.js";
import type { ArchiveReason, ArchivedTab } from "../shared/types";
import { createElement, createFavicon, createIconButton, createTextButton, dispatch, getDisplayHost } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";
import type { IconName } from "../renderer/icons";
import { createSpaceIcon } from "../renderer/spaceIcon.js";
import { describeSpaceIconAsText } from "../shared/spaceIcons.js";

/** Words shown for each archive reason. */
const REASON_LABELS: Record<ArchiveReason, string> = {
  auto: "Auto-archived",
  manual: "Closed",
  "clear-button": "Cleared",
};

/** The rail's sections in display order: Arc's (Media … Archived Tabs), then ours that Arc keeps elsewhere. */
const SECTIONS: { id: LibrarySection; label: string; icon: IconName }[] = [
  { id: "media", label: "Media", icon: "media" },
  { id: "downloads", label: "Downloads", icon: "download" },
  { id: "spaces", label: "Spaces", icon: "spaces" },
  { id: "boosts", label: "Boosts", icon: "boost" },
  { id: "archive", label: "Archived Tabs", icon: "archiveOutline" },
  { id: "history", label: "History", icon: "clock" },
  { id: "extensions", label: "Extensions", icon: "puzzle" },
  { id: "settings", label: "Settings", icon: "gear" },
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
  const placeLabel = space === undefined ? "Little Window or removed Space" : `${describeSpaceIconAsText(space.icon)} ${space.name}`;
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
 * One picture in Media: its thumbnail, the page it shows and when, and Copy / Show in Finder / Save / Delete on hover.
 */
function createMediaTile(media: MediaLine, now: number): HTMLElement {
  const tile = createElement("div", "media-tile");
  tile.dataset.mediaId = media.id;
  const picture = createElement("div", "media-picture");
  if (media.thumbnailUrl !== null) {
    const image = document.createElement("img");
    image.src = media.thumbnailUrl;
    image.alt = "";
    picture.append(image);
  }
  const actions = createElement("div", "media-actions");
  actions.append(
    createIconButton("copy", "Copy", "media-action", () => window.overlayApi.mediaCommand(media.id, "copy")),
    createIconButton("folder", "Show in Finder", "media-action", () => window.overlayApi.mediaCommand(media.id, "reveal")),
    createIconButton("download", "Save to Downloads", "media-action", () => window.overlayApi.mediaCommand(media.id, "save")),
    createIconButton("trash", "Delete", "media-action", () => window.overlayApi.mediaCommand(media.id, "delete")),
  );
  picture.append(actions);
  const caption = createElement("div", "media-caption");
  caption.append(
    createElement("span", "library-line-title", media.title === "" ? getDisplayHost(media.url) : media.title),
    createElement("span", "library-line-meta", `${media.width} × ${media.height} · ${formatTimeAgo(media.createdAt, now)}`),
  );
  tile.append(picture, caption);
  return tile;
}

/**
 * Builds the Media section: screenshots and captures, newest first, as a grid (Arc keeps them in its Library).
 */
function renderMediaSection(body: HTMLElement, data: LibraryData): void {
  if (data.media.length === 0) {
    body.replaceChildren(createElement("p", "library-empty", "Screenshots and captures from the Control Center land here (and on the clipboard)."));
    return;
  }
  const grid = createElement("div", "media-grid");
  const now = Date.now();
  grid.append(...data.media.map((media) => createMediaTile(media, now)));
  body.replaceChildren(grid);
}

/** macOS dark mode, for Spaces whose theme follows the system. */
const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

/** A row's left padding in a Space's column, and how much more each folder level indents. Our choice. */
const SPACE_ITEM_PADDING_PX = 10;
const SPACE_ITEM_INDENT_PX = 16;

/**
 * One row of a Space's column: a folder (bold) or a tab, indented by how deep it sits. A tab opens on click (in its
 * Space, so the page beside the Library shows it).
 */
function createSpaceItemRow(item: LibrarySpaceItem): HTMLElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = `space-item is-${item.kind}`;
  row.style.paddingLeft = `${SPACE_ITEM_PADDING_PX + item.depth * SPACE_ITEM_INDENT_PX}px`;
  const icon = item.kind === "folder" ? createIcon("folder", "icon space-item-icon") : createFavicon(item.faviconUrl, item.url);
  row.append(icon, createElement("span", "space-item-title", item.title === "" ? item.url : item.title));
  row.title = item.title;
  if (item.kind === "tab") {
    row.addEventListener("click", () => dispatch({ type: "selectTab", tabId: item.id }));
  } else {
    row.disabled = true;
  }
  return row;
}

/**
 * One Space as a column, like Arc's Library › Spaces: painted like the Space's frame, its name (click to switch to
 * it), its profile, a pencil to edit its theme, its pinned folders and tabs, and a "…" menu.
 */
function createSpaceColumn(space: LibrarySpace): HTMLElement {
  const column = createElement("section", "space-column");
  column.classList.toggle("is-active", space.isActive);
  const palette = computeFramePalette(space.theme, window.matchMedia(DARK_MODE_QUERY).matches, true);
  const [firstColor, middleColor, lastColor] = palette.colors;
  column.style.background = `linear-gradient(165deg, ${firstColor}, ${middleColor} 55%, ${lastColor})`;
  column.classList.toggle("is-dark", palette.isDark);

  const header = createElement("header", "space-column-header");
  const title = document.createElement("button");
  title.type = "button";
  title.className = "space-column-title";
  title.title = space.isActive ? `${space.name} (open now)` : `Switch to ${space.name}`;
  title.append(createSpaceIcon(space.icon, "space-column-icon"), createElement("span", "space-column-name", space.name));
  title.addEventListener("click", () => dispatch({ type: "switchSpace", spaceId: space.id }));
  header.append(title);
  if (space.profileName !== "") {
    const profile = createElement("span", "space-column-profile");
    profile.append(createIcon("person", "icon space-column-profile-icon"), createElement("span", "", space.profileName));
    header.append(profile);
  }
  header.append(createIconButton("pencil", "Edit Theme…", "space-column-button", () => dispatch({ type: "openThemeEditor", spaceId: space.id })));

  const items = createElement("div", "space-column-items");
  if (space.items.length === 0) {
    items.append(createElement("p", "space-column-empty", "Nothing pinned yet"));
  }
  items.append(...space.items.map((item) => createSpaceItemRow(item)));

  const footer = createElement("footer", "space-column-footer");
  footer.append(
    createElement("span", "space-column-count", `${space.todayCount} today`),
    createIconButton("more", "Rename, profile, delete…", "space-column-button", () => dispatch({ type: "showMenu", request: { menu: "space", spaceId: space.id } })),
  );
  column.append(header, items, footer);
  return column;
}

/**
 * Builds the Spaces section like Arc's: every Space as a column of what it has pinned, and a round + for a new Space.
 * The Library's column widens to hold them (main: computeLibraryWidth).
 */
function renderSpacesSection(body: HTMLElement, data: LibraryData): void {
  const columns = createElement("div", "space-columns");
  columns.append(...data.spaces.map((space) => createSpaceColumn(space)));
  const addButton = createIconButton("plus", "New Space", "space-add", () =>
    dispatch({ type: "createSpace", name: "New Space", icon: "✦", theme: data.newSpaceTheme }),
  );
  columns.append(addButton);
  body.replaceChildren(columns);
}

/**
 * Sums up a Boost in a few words, e.g. "2 zapped · CSS".
 */
function describeBoost(boost: LibraryBoost): string {
  const parts: string[] = [];
  if (boost.zapCount > 0) {
    parts.push(`${boost.zapCount} zapped`);
  }
  if (boost.hasCss) {
    parts.push("CSS");
  }
  return parts.length === 0 ? "No changes yet" : parts.join(" · ");
}

/**
 * One Boost: its site and what it changes, On/Off, Edit and Delete.
 */
function createBoostLine(boost: LibraryBoost): HTMLElement {
  const line = createElement("div", "library-line");
  line.classList.toggle("is-off", !boost.isEnabled);
  line.append(createFavicon(null, `https://${boost.site}/`));
  const text = createElement("span", "library-line-text");
  text.append(createElement("span", "library-line-title", boost.site), createElement("span", "library-line-meta", describeBoost(boost)));
  const switchButton = createTextButton(boost.isEnabled ? "On" : "Off", boost.isEnabled ? "library-chip is-active" : "library-chip", () =>
    dispatch({ type: "setBoostEnabled", site: boost.site, isEnabled: !boost.isEnabled }),
  );
  const editButton = createTextButton("Edit…", "library-chip", () => dispatch({ type: "openBoostEditor", site: boost.site }));
  const deleteButton = createIconButton("trash", "Delete Boost", "library-line-icon-button", () => dispatch({ type: "deleteBoost", site: boost.site }));
  line.append(text, switchButton, editButton, deleteButton);
  return line;
}

/**
 * Builds the Boosts section: every site you changed, like Arc's Library.
 */
function renderBoostsSection(body: HTMLElement, data: LibraryData): void {
  if (data.boosts.length === 0) {
    body.replaceChildren(createElement("p", "library-empty", "Boosts change how a site looks. Open the Control Center on a site and choose Boost."));
    return;
  }
  const list = createElement("div", "library-list");
  list.append(...data.boosts.map((boost) => createBoostLine(boost)));
  body.replaceChildren(list);
}

/** Where an extension came from, as its line says it. */
const EXTENSION_ORIGINS: Record<ExtensionLine["source"], string> = {
  arc: "from Arc",
  webstore: "from Chrome Web Store",
  unpacked: "unpacked",
};

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
  const origin = EXTENSION_ORIGINS[extension.source];
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
    createTextButton("Check for Updates", "library-chip", () => dispatch({ type: "checkExtensionUpdates" })),
  );
  section.append(toolbar);
  section.append(
    createElement(
      "p",
      "library-setting-note",
      "Chrome extensions run per profile, like in Arc. Open one from the puzzle button in the toolbar; add more with " +
        "Add Extension on a Chrome Web Store page. Web Store extensions update by themselves. " +
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
 * One setting: its name and a short explanation on the left, its control on the right.
 */
function createSettingRow(label: string, note: string, control: HTMLElement): HTMLElement {
  const row = createElement("div", "setting-row");
  const text = createElement("div", "setting-text");
  text.append(createElement("span", "setting-label", label));
  if (note !== "") {
    text.append(createElement("span", "setting-note", note));
  }
  row.append(text, control);
  return row;
}

/**
 * An on/off switch (role "switch", so assistive technology reads it as one).
 */
function createSwitch(isOn: boolean, label: string, onToggle: (isOn: boolean) => void): HTMLElement {
  const toggle = createElement("button", "setting-switch");
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", String(isOn));
  toggle.setAttribute("aria-label", label);
  toggle.addEventListener("click", () => onToggle(!isOn));
  return toggle;
}

/**
 * A titled group of settings.
 */
function createSettingGroup(title: string, rows: HTMLElement[]): HTMLElement {
  const group = createElement("section", "setting-group");
  group.append(createElement("h2", "library-setting-heading", title), ...rows);
  return group;
}

/**
 * The choice of how long Today tabs stay before they move to the Archive.
 */
function createArchiveSelect(data: LibraryData): HTMLElement {
  const select = document.createElement("select");
  select.className = "library-select";
  select.setAttribute("aria-label", "Archive Today tabs after");
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
  return select;
}

/**
 * The choice of search engine for typed words.
 */
function createSearchEngineSelect(data: LibraryData): HTMLElement {
  const select = document.createElement("select");
  select.className = "library-select";
  select.setAttribute("aria-label", "Search engine");
  for (const engineId of SEARCH_ENGINE_IDS) {
    const optionElement = document.createElement("option");
    optionElement.value = engineId;
    optionElement.textContent = SEARCH_ENGINES[engineId].name;
    optionElement.selected = engineId === data.searchEngineId;
    select.append(optionElement);
  }
  select.addEventListener("change", () => {
    const chosenId = select.value;
    if (isSearchEngineId(chosenId)) {
      dispatch({ type: "setSearchEngine", engineId: chosenId });
    }
  });
  return select;
}

/**
 * The app icon choices, each a swatch of its colors.
 */
function createAppIconChoices(data: LibraryData): HTMLElement {
  const iconChoices = createElement("div", "app-icon-choices");
  for (const variant of APP_ICON_VARIANTS) {
    const choice = createTextButton("", "app-icon-choice", () => dispatch({ type: "setAppIcon", variantId: variant.id }));
    // Glass and Classic follow macOS: their dark twin while macOS is in dark mode (main/appIcon.ts).
    choice.title = variant.darkVariantId === undefined ? variant.label : `${variant.label} (dark tile in dark mode)`;
    choice.setAttribute("aria-label", `${variant.label} app icon`);
    choice.classList.toggle("is-active", variant.id === data.appIcon);
    // The choice shows the icon itself (overlay.css crops the drawing's margin around the tile).
    const iconDrawing = encodeURIComponent(buildAppIconSvg(variant));
    choice.style.backgroundImage = `url("data:image/svg+xml;utf8,${iconDrawing}")`;
    iconChoices.append(choice);
  }
  return iconChoices;
}

/** What the ad blocker's row says, by its state. */
function describeAdBlockStatus(adBlock: LibraryData["adBlock"]): string {
  const notes: Record<typeof adBlock.status, string> = {
    off: "Uses the public EasyList and EasyPrivacy lists, downloaded from easylist.to when you turn this on and refreshed every 4 days.",
    loading: "Downloading the EasyList and EasyPrivacy lists…",
    ready: `EasyList and EasyPrivacy: ${adBlock.filterCount.toLocaleString()} filters. Allow a site in its Control Center.`,
    failed: "The lists could not be downloaded. Check the connection, then turn this off and on again.",
  };
  return notes[adBlock.status];
}

/**
 * Builds the Settings section: tabs, browsing, appearance, import, and links from other apps.
 */
function renderSettingsSection(body: HTMLElement, data: LibraryData): void {
  const settings = createElement("div", "library-settings");
  const tabs = createSettingGroup("Tabs", [
    createSettingRow(
      "Archive Today tabs after",
      "Unused Today tabs move to the Archive, like Arc (default 12 hours). Pinned tabs and Favorites never do; time with the browser closed does not count. The Archive keeps your newest 250 tabs.",
      createArchiveSelect(data),
    ),
    createSettingRow(
      "Tidy titles for pinned tabs",
      "Short names: “Inbox” instead of “(3) Inbox - Mail”. Your own names stay as they are.",
      createSwitch(data.areTitlesTidy, "Tidy titles for pinned tabs", (isOn) => dispatch({ type: "setTidyTitles", isOn: isOn })),
    ),
  ]);
  const browsing = createSettingGroup("Browsing", [
    createSettingRow("Search engine", "Searches what you type in the address field and the Command Bar, and suggests as you type.", createSearchEngineSelect(data)),
    createSettingRow("Block ads and trackers", describeAdBlockStatus(data.adBlock), createSwitch(data.adBlock.isOn, "Block ads and trackers", (isOn) => dispatch({ type: "setAdBlock", isOn: isOn }))),
  ]);
  const appearance = createSettingGroup("Appearance", [
    createSettingRow(
      "Show full URLs",
      "The toolbar shows the whole address, with https:// and everything after the page's path. Off: just the site and path, like Arc.",
      createSwitch(data.showsFullUrls, "Show full URLs", (isOn) => dispatch({ type: "setShowFullUrls", isOn: isOn })),
    ),
    createSettingRow("App icon", "Shown in the Dock while the browser runs.", createAppIconChoices(data)),
  ]);
  const importing = createSettingGroup("Import", [
    createSettingRow(
      "Bookmarks and history from another browser",
      "Arc, Chrome, Brave, Edge, Vivaldi, Firefox or Safari. Bookmarks arrive as a folder in this Space.",
      createTextButton("Import…", "library-chip", () => dispatch({ type: "showMenu", request: { menu: "import" } })),
    ),
  ]);
  settings.append(tabs, browsing, appearance, importing, renderRoutingSettings(data));
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
    const spaceLabel = space === undefined ? "a deleted Space" : `${describeSpaceIconAsText(space.icon)} ${space.name}`;
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
    spaceSelect.append(new Option(`${describeSpaceIconAsText(space.icon)} ${space.name}`, space.id));
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

/** The parts of a Library section that scroll (overlay.css overflow-y: auto). */
const SCROLLING_PARTS = ".library-settings, .library-list, .media-grid";

/**
 * How far each scrolling part of the section is scrolled, in page order.
 */
function readScrollPositions(body: HTMLElement): number[] {
  const positions: number[] = [];
  for (const part of body.querySelectorAll<HTMLElement>(SCROLLING_PARTS)) {
    positions.push(part.scrollTop);
  }
  return positions;
}

/**
 * Scrolls the redrawn section's parts back to where the old ones were.
 */
function restoreScrollPositions(body: HTMLElement, positions: number[]): void {
  const parts = body.querySelectorAll<HTMLElement>(SCROLLING_PARTS);
  parts.forEach((part, index) => {
    part.scrollTop = positions[index] ?? 0;
  });
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
  // A redraw of the same section (fresh data after a switch was flipped) keeps its lists where they were scrolled;
  // without this, every change in Settings jumped back to the top (the user, 2026-10-27).
  const isRedraw = body.dataset.section === section;
  const scrollPositions = isRedraw ? readScrollPositions(body) : [];
  for (const button of tabs.querySelectorAll<HTMLButtonElement>("button")) {
    button.classList.toggle("is-active", button.dataset.section === section);
  }
  if (section === "archive") {
    renderArchiveSection(body, data);
  }
  if (section === "history") {
    renderHistorySection(body, data);
  }
  if (section === "media") {
    renderMediaSection(body, data);
  }
  if (section === "downloads") {
    renderDownloadsSection(body, data);
  }
  if (section === "spaces") {
    renderSpacesSection(body, data);
  }
  if (section === "boosts") {
    renderBoostsSection(body, data);
  }
  if (section === "extensions") {
    renderExtensionsSection(body, data);
  }
  if (section === "settings") {
    renderSettingsSection(body, data);
  }
  body.dataset.section = section;
  restoreScrollPositions(body, scrollPositions);
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
  // The rail: the window can be dragged by its top strip (the traffic lights sit there); Back closes the Library.
  const rail = createElement("nav", "library-rail");
  rail.id = "library-tabs";
  const entries = createElement("div", "library-rail-entries");
  for (const choice of SECTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "library-tab";
    button.dataset.section = choice.id;
    button.append(createIcon(choice.icon), createElement("span", "library-tab-label", choice.label));
    button.addEventListener("click", () => {
      section = choice.id;
      // Spaces widens the Library's column, the other sections narrow it again (main lays the page out).
      window.overlayApi.setLibrarySection(choice.id).catch(() => undefined);
      if (library !== null) {
        renderBody(library);
      }
    });
    entries.append(button);
  }
  rail.append(createElement("div", "library-drag-strip"), entries, createIconButton("back", "Close Library (Esc)", "library-close", () => window.overlayApi.close()));
  const body = createElement("div", "library-body");
  body.id = "library-body";
  panel.append(rail, body);
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
  if (section === "downloads" || section === "settings" || section === "media" || section === "spaces" || section === "boosts") {
    renderBody(updated);
  }
}

window.overlayApi.onLibraryUpdate(handleLibraryUpdate);
