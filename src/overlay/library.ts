/**
 * WHY this file exists:
 *   The Library, like Arc's: the Archive (every closed, cleared and auto-archived tab, searchable and restorable),
 *   browsing History, Media, Downloads, Spaces, Boosts, command Chains (chainEditor.ts), Extensions and the settings. Like Arc's it takes the sidebar
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
import type { ExtensionLine, HistoryLine, LibraryBoost, LibraryData, LibrarySection, LibrarySpace, LibrarySpaceItem, MediaCommand, MediaLine, SyncStatusData, TaskLine } from "../shared/overlay";
import { computeFramePalette } from "../shared/themePalette.js";
import { ARCHIVE_THRESHOLD_OPTIONS, DAY_MS, GLOBAL_SHORTCUT_CHOICES, HOUR_MS, MINUTE_MS, TAB_SLEEP_OPTIONS } from "../shared/settings.js";
import { APP_ICON_VARIANTS, buildAppIconSvg } from "../shared/appIconDrawing.js";
import { isSearchEngineId, SEARCH_ENGINE_IDS, SEARCH_ENGINES } from "../shared/searchEngines.js";
import { isValidSearchKeyword } from "../shared/searchKeywords.js";
import type { ArchiveReason, ArchivedTab, RoutingRule } from "../shared/types";
import { createElement, createFavicon, createIconButton, createTextButton, dispatch, getDisplayHost } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";
import type { IconName } from "../renderer/icons";
import { createSpaceIcon } from "../renderer/spaceIcon.js";
import { describeSpaceIconAsText } from "../shared/spaceIcons.js";
import { describeDay } from "../shared/timeAgo.js";
import { findMatchingRule } from "../shared/routingRules.js";
import { haveChainsChanged, renderChainsSection } from "./chainEditor.js";
import { renderPrivacySection } from "./privacyView.js";

/** How long a Media tile says what its button did: as long as Copy URL's toast (statusBubble.ts TOAST_SHOWN_MS). */
const MEDIA_FEEDBACK_MS = 1600;

/** What a Media tile says after a button worked; Show in Finder and Delete show their result themselves. */
const MEDIA_FEEDBACK_TEXT: Partial<Record<MediaCommand, string>> = {
  copy: "Copied",
  save: "Saved to Downloads",
};

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
  { id: "chains", label: "Chains", icon: "chains" },
  { id: "archive", label: "Archived Tabs", icon: "archiveOutline" },
  { id: "history", label: "History", icon: "clock" },
  { id: "privacy", label: "Privacy", icon: "privacy" },
  { id: "extensions", label: "Extensions", icon: "puzzle" },
  { id: "tasks", label: "Task Manager", icon: "taskManager" },
  { id: "settings", label: "Settings", icon: "gear" },
];

const MEGABYTES_PER_GIGABYTE = 1024;

/**
 * What an empty section shows: its own icon from the rail, a short title and one sentence on how things get there,
 * centered in the column (a single grey line at the top looked like something had failed to load).
 */
function createEmptyState(sectionId: LibrarySection, title: string, text: string): HTMLElement {
  const emptyState = createElement("div", "library-empty-state");
  const choice = SECTIONS.find((candidate) => candidate.id === sectionId);
  if (choice !== undefined) {
    emptyState.append(createIcon(choice.icon, "icon library-empty-icon"));
  }
  emptyState.append(createElement("h3", "library-empty-title", title), createElement("p", "library-empty-text", text));
  return emptyState;
}

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
    const emptyElement =
      data.archive.length === 0
        ? createEmptyState("archive", "No archived tabs", "Tabs you close, clear or leave unused land here, ready to open again.")
        : createElement("p", "library-empty", "No archived tab matches.");
    list.replaceChildren(emptyElement);
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
    const emptyElement = historyQuery === "" ? createEmptyState("history", "No history yet", "Pages you visit show up here.") : createElement("p", "library-empty", "No page matches.");
    list.replaceChildren(emptyElement);
    return;
  }
  // Search results come by how well they match, so only the plain list (newest first) is split into days.
  if (historyQuery !== "") {
    list.replaceChildren(...historyLines.map((entry) => createHistoryLine(entry, now)));
    return;
  }
  const elements: HTMLElement[] = [];
  let shownDay = "";
  for (const entry of historyLines) {
    const day = describeDay(entry.lastVisitAt, now);
    if (day !== shownDay) {
      elements.push(createElement("h3", "library-day-heading", day));
      shownDay = day;
    }
    elements.push(createHistoryLine(entry, now));
  }
  list.replaceChildren(...elements);
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
  const clearClass = isConfirmingClearHistory ? "library-chip danger is-confirming" : "library-chip danger";
  const clearButton = createTextButton(clearLabel, clearClass, () => {
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
    list.append(createEmptyState("downloads", "No downloads", "Files you download show up here while Bow is open. They are saved in your Downloads folder."));
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
 * Runs a Media button and, once it worked, says so on the picture for a moment. The picture is looked up again by
 * its id: the Library may have redrawn meanwhile (a download's progress, a change in the sidebar).
 */
async function runMediaCommand(mediaId: string, command: MediaCommand): Promise<void> {
  const isDone = await window.overlayApi.mediaCommand(mediaId, command).catch(() => false);
  const text = MEDIA_FEEDBACK_TEXT[command];
  const picture = document.querySelector(`.media-tile[data-media-id="${CSS.escape(mediaId)}"] .media-picture`);
  if (!isDone || text === undefined || picture === null) {
    return;
  }
  picture.querySelector(".media-feedback")?.remove();
  const feedback = createElement("div", "media-feedback");
  feedback.style.animationDuration = `${MEDIA_FEEDBACK_MS}ms`;
  feedback.append(createIcon("checkmark", "icon media-feedback-icon"), createElement("span", "", text));
  picture.append(feedback);
  setTimeout(() => feedback.remove(), MEDIA_FEEDBACK_MS);
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
    createIconButton("copy", "Copy", "media-action", () => runMediaCommand(media.id, "copy")),
    createIconButton("folder", "Show in Finder", "media-action", () => runMediaCommand(media.id, "reveal")),
    createIconButton("download", "Save to Downloads", "media-action", () => runMediaCommand(media.id, "save")),
    createIconButton("trash", "Delete", "media-action", () => runMediaCommand(media.id, "delete")),
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
    body.replaceChildren(createEmptyState("media", "No screenshots yet", "Screenshots and captures from the Control Center land here and on the clipboard."));
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
  body.replaceChildren(columns, createTemplateStrip(data));
}

/**
 * The Space templates under the columns: each makes a new Space like it, or can be deleted.
 */
function createTemplateStrip(data: LibraryData): HTMLElement {
  const strip = createElement("div", "space-templates");
  strip.append(createElement("span", "space-templates-heading", "Templates"));
  if (data.spaceTemplates.length === 0) {
    strip.append(createElement("span", "space-templates-note", "A Space's menu › Save as Template keeps its look, Pinned tabs and defaults to make new Spaces from."));
    return strip;
  }
  for (const template of data.spaceTemplates) {
    const entry = createElement("span", "space-template");
    entry.dataset.templateId = template.id;
    const makeButton = createTextButton(`${describeSpaceIconAsText(template.icon)} ${template.name}`, "library-chip space-template-make", () =>
      dispatch({ type: "createSpaceFromTemplate", templateId: template.id }),
    );
    makeButton.title = `New Space from this template (${template.itemCount} pinned)`;
    const deleteButton = createIconButton("close", `Delete the ${template.name} template`, "library-line-icon-button space-template-delete", () =>
      dispatch({ type: "deleteSpaceTemplate", templateId: template.id }),
    );
    entry.append(makeButton, deleteButton);
    strip.append(entry);
  }
  return strip;
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
  const exportButton = createTextButton("Export…", "library-chip boost-export", () => dispatch({ type: "exportBoost", site: boost.site }));
  exportButton.title = "Save this Boost as a file to share";
  const deleteButton = createIconButton("trash", "Delete Boost", "library-line-icon-button", () => dispatch({ type: "deleteBoost", site: boost.site }));
  line.append(text, switchButton, editButton, exportButton, deleteButton);
  return line;
}

/**
 * Builds the Boosts section: every site you changed, like Arc's Library.
 */
function renderBoostsSection(body: HTMLElement, data: LibraryData): void {
  const section = createElement("div", "library-boosts");
  const toolbar = createElement("div", "library-toolbar");
  const importButton = createTextButton("Import Boost…", "library-chip boost-import", () => dispatch({ type: "importBoost" }));
  importButton.title = "Add a Boost someone shared as a file (its JavaScript arrives switched off)";
  toolbar.append(importButton);
  section.append(toolbar);
  if (data.boosts.length === 0) {
    section.append(createEmptyState("boosts", "No Boosts yet", "Boosts change how a site looks. Open the Control Center on a site and choose Boost, or import one."));
    body.replaceChildren(section);
    return;
  }
  const list = createElement("div", "library-list");
  list.append(...data.boosts.map((boost) => createBoostLine(boost)));
  section.append(list);
  body.replaceChildren(section);
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
      "Chrome extensions run per profile. Open one from the puzzle button in the toolbar; add more with " +
        "Add Extension on a Chrome Web Store page. Web Store extensions update by themselves. " +
        "Reload open pages after adding or turning one on. Extensions that need Chrome features this browser lacks may only partly work.",
    ),
  );
  if (data.extensions.length === 0) {
    section.append(createEmptyState("extensions", "No extensions yet", "Add one from the Chrome Web Store, import your Arc extensions, or load an unpacked folder."));
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
 * Memory for people: "640 MB", "1.4 GB".
 */
function formatMemory(megabytes: number): string {
  if (megabytes < MEGABYTES_PER_GIGABYTE) {
    return `${megabytes} MB`;
  }
  return `${(megabytes / MEGABYTES_PER_GIGABYTE).toFixed(1)} GB`;
}

/**
 * One awake page: its icon, name and site (and the tabs it shares a process with), its memory and processor use, and
 * Sleep. Clicking the line switches to the tab.
 */
function createTaskLine(task: TaskLine): HTMLElement {
  const line = createElement("div", "library-line task-line");
  line.setAttribute("role", "button");
  line.dataset.tabId = task.tabId;
  line.title = task.url;
  let meta = getDisplayHost(task.url);
  if (task.sharedWith === 1) {
    meta += " · shares its process with 1 other tab";
  }
  if (task.sharedWith > 1) {
    meta += ` · shares its process with ${task.sharedWith} other tabs`;
  }
  const text = createElement("span", "library-line-text");
  text.append(createElement("span", "library-line-title", task.title === "" ? task.url : task.title), createElement("span", "library-line-meta", meta));
  const numbers = createElement("span", "task-numbers", `${formatMemory(task.memoryMb)} · ${task.cpuPercent}% CPU`);
  const sleepButton = createTextButton("Sleep", "library-chip task-sleep", () => dispatch({ type: "sleepTab", tabId: task.tabId }));
  sleepButton.disabled = !task.canSleep;
  sleepButton.title = task.canSleep ? "Put this page to sleep" : "On screen or in use, so it stays awake";
  line.append(createFavicon(task.faviconUrl, task.url), text, numbers, sleepButton);
  line.addEventListener("click", (event) => {
    const isOnButton = event.target instanceof Element && event.target.closest("button") !== null;
    if (!isOnButton) {
      window.overlayApi.chooseTab(task.tabId).catch(() => undefined);
    }
  });
  return line;
}

/**
 * Library › Task Manager: every awake page with the memory and processor it uses, biggest first, and what Bow itself
 * uses. Main measures again every two seconds while this is shown.
 */
function renderTasksSection(body: HTMLElement, data: LibraryData): void {
  const tasks = data.tasks;
  const section = createElement("div", "library-tasks");
  const toolbar = createElement("div", "library-toolbar");
  toolbar.append(createTextButton("Sleep Other Tabs", "library-chip", () => dispatch({ type: "sleepOtherTabs" })));
  section.append(toolbar);
  const awake = tasks.lines.length === 1 ? "1 page awake uses" : `${tasks.lines.length} pages awake use`;
  const asleep = tasks.sleepingCount === 1 ? "1 tab is asleep" : `${tasks.sleepingCount} tabs are asleep`;
  const summary = `${awake} ${formatMemory(tasks.pagesMemoryMb)}; Bow itself (windows, graphics, extensions) uses ${formatMemory(tasks.bowMemoryMb)}. ${asleep}.`;
  section.append(createElement("p", "library-setting-note task-summary", summary));
  if (tasks.lines.length === 0) {
    section.append(createEmptyState("tasks", "No pages awake", "Pages you open show up here with the memory they use."));
  }
  const list = createElement("div", "library-list");
  list.append(...tasks.lines.map((task) => createTaskLine(task)));
  section.append(list);
  body.replaceChildren(section);
}

/**
 * The sites kept awake, each with a button that lets it sleep again.
 */
function createKeepAwakeSites(data: LibraryData): HTMLElement {
  const sites = createElement("div", "keep-awake-sites");
  for (const site of data.keepAwakeSites) {
    const chip = createTextButton(`${site} ×`, "library-chip", () => dispatch({ type: "setSiteKeptAwake", site: site, isKeptAwake: false }));
    chip.title = `Let ${site}'s pages sleep again`;
    sites.append(chip);
  }
  return sites;
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
 * What the shortcut from any app does now, or why it does not.
 */
function describeGlobalShortcut(data: LibraryData): string {
  if (data.globalShortcutStatus === "taken") {
    return "Another app uses these keys. Pick others, or change them in that app.";
  }
  if (data.globalShortcutStatus === "on") {
    return "Press it in any app to bring up Bow.";
  }
  return "Brings up the Command Bar or a Little Window from any app, without switching to Bow first.";
}

/**
 * The shortcut from any app: its keys (or Off) and what it opens.
 */
function createGlobalShortcutControls(data: LibraryData): HTMLElement {
  const controls = createElement("div", "global-shortcut");
  const keysSelect = document.createElement("select");
  keysSelect.className = "library-select global-shortcut-keys";
  keysSelect.setAttribute("aria-label", "Shortcut");
  keysSelect.append(new Option("Off", ""));
  for (const choice of GLOBAL_SHORTCUT_CHOICES) {
    keysSelect.append(new Option(choice.label, choice.accelerator));
  }
  keysSelect.value = data.globalShortcut ?? "";
  const opensSelect = document.createElement("select");
  opensSelect.className = "library-select global-shortcut-opens";
  opensSelect.setAttribute("aria-label", "Opens");
  opensSelect.append(new Option("Command Bar", "commandBar"), new Option("Little Window", "littleWindow"));
  opensSelect.value = data.globalShortcutOpens;
  opensSelect.disabled = data.globalShortcut === null;
  const save = (): void => {
    const accelerator = keysSelect.value === "" ? null : keysSelect.value;
    const opens = opensSelect.value === "littleWindow" ? "littleWindow" : "commandBar";
    dispatch({ type: "setGlobalShortcut", accelerator: accelerator, opens: opens });
  };
  keysSelect.addEventListener("change", save);
  opensSelect.addEventListener("change", save);
  controls.append(keysSelect, opensSelect);
  return controls;
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
 * The choice of how long a page may go unused before it sleeps.
 */
function createTabSleepSelect(data: LibraryData): HTMLElement {
  const select = document.createElement("select");
  select.className = "library-select";
  select.setAttribute("aria-label", "Sleep unused tabs after");
  for (const option of TAB_SLEEP_OPTIONS) {
    const optionElement = document.createElement("option");
    optionElement.textContent = option.label;
    optionElement.selected = option.valueMs === data.tabSleepAfterMs;
    select.append(optionElement);
  }
  select.addEventListener("change", () => {
    // Options were added in the order of TAB_SLEEP_OPTIONS, so the index finds the choice.
    const chosen = TAB_SLEEP_OPTIONS[select.selectedIndex];
    if (chosen !== undefined) {
      dispatch({ type: "setTabSleepAfter", tabSleepAfterMs: chosen.valueMs });
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
      "Unused Today tabs move to the Archive (default 12 hours). Pinned tabs and Favorites never do; time with the browser closed does not count. A Space can have its own timing (right-click it), and a tab marked Never Archive in its menu stays, even through Clear. The Archive keeps your newest 250 tabs.",
      createArchiveSelect(data),
    ),
    createSettingRow(
      "Sleep unused tabs after",
      "A page you have not used for this long closes to free memory and wakes where you left it when you go back; its tab fades meanwhile. Pages on screen, playing sound or in a call stay awake, and so do the sites below.",
      createTabSleepSelect(data),
    ),
    createSettingRow(
      "Keep Favorites awake",
      "Favorites are usually apps like mail and chat: kept awake, their unread counts keep coming. Pinned tabs sleep like others.",
      createSwitch(data.areFavoritesKeptAwake, "Keep Favorites awake", (isOn) => dispatch({ type: "setFavoritesKeptAwake", isOn: isOn })),
    ),
    createSettingRow(
      "Sites kept awake",
      data.keepAwakeSites.length === 0 ? "None yet. Turn on Keep Awake in a site's Control Center or a tab's menu." : "Their pages never go to sleep by themselves.",
      createKeepAwakeSites(data),
    ),
    createSettingRow(
      "Tidy titles for pinned tabs",
      "Short names: “Inbox” instead of “(3) Inbox - Mail”. Your own names stay as they are.",
      createSwitch(data.areTitlesTidy, "Tidy titles for pinned tabs", (isOn) => dispatch({ type: "setTidyTitles", isOn: isOn })),
    ),
  ]);
  const browsing = createSettingGroup("Browsing", [
    createSettingRow("Search engine", "Searches what you type in the address field and the Command Bar, and suggests as you type.", createSearchEngineSelect(data)),
    createSettingRow("Downloads", `Saved in ${data.downloadFolder}.`, createTextButton("Change…", "library-chip", () => dispatch({ type: "chooseDownloadFolder" }))),
    createSettingRow(
      "Ask where to save each download",
      "A save dialog opens for every download, starting in the folder above.",
      createSwitch(data.asksWhereToSave, "Ask where to save each download", (isOn) => dispatch({ type: "setAskWhereToSave", isOn: isOn })),
    ),
    createSettingRow("Block ads and trackers", describeAdBlockStatus(data.adBlock), createSwitch(data.adBlock.isOn, "Block ads and trackers", (isOn) => dispatch({ type: "setAdBlock", isOn: isOn }))),
    createSettingRow("Shortcut from any app", describeGlobalShortcut(data), createGlobalShortcutControls(data)),
  ]);
  const appearance = createSettingGroup("Appearance", [
    createSettingRow(
      "Show full URLs",
      "The toolbar shows the whole address, with https:// and everything after the page's path. Off: just the site and path.",
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
  const backup = createSettingGroup("Backup", [
    createSettingRow(
      "Export a backup",
      "Everything that makes this setup yours (Spaces, pinned tabs, folders, Favorites, Notes, Easels, Boosts, rules and settings) in one open file you can keep or move to another Mac.",
      createTextButton("Export…", "library-chip", () => dispatch({ type: "exportBackup" })),
    ),
    createSettingRow(
      "Restore from a backup",
      "Put a backup in place of this setup (Bow keeps a copy of it first) or add its Spaces next to yours.",
      createTextButton("Restore…", "library-chip", () => dispatch({ type: "restoreBackup" })),
    ),
    createSettingRow(
      "Automatic backups",
      "While Bow is in use, it keeps a copy every hour: the last 12 hours, then one a day for a week. Restore… opens the folder they're in.",
      createSwitch(data.areSnapshotsOn, "Automatic backups", (isOn) => dispatch({ type: "setSnapshots", isOn: isOn })),
    ),
    createSettingRow(
      "Bow's backups folder",
      "The automatic copies and the ones kept before a restore.",
      createTextButton("Show in Finder", "library-chip", () => dispatch({ type: "revealBackups" })),
    ),
  ]);
  settings.append(tabs, browsing, renderSearchKeywordSettings(data), appearance, importing, backup, renderSyncSettings(data.sync), renderRoutingSettings(data));
  body.replaceChildren(settings);
}

/** The part of an iCloud Drive path that names it (Finder shows that folder as "iCloud Drive"). */
const ICLOUD_DRIVE_PATH_PART = "/Mobile Documents/com~apple~CloudDocs";

/** The folder Bow makes inside the one the user picks (syncController.ts). */
const SYNC_FOLDER_NAME = "Bow Sync";

/**
 * The sync folder as people know it: "iCloud Drive", or the folder they picked ("Dropbox").
 */
function describeSyncFolder(folderPath: string): string {
  if (folderPath.includes(ICLOUD_DRIVE_PATH_PART)) {
    return "iCloud Drive";
  }
  const parts = folderPath.split("/").filter((part) => part !== "");
  const folderName = parts.at(-1) ?? folderPath;
  return folderName === SYNC_FOLDER_NAME ? (parts.at(-2) ?? folderName) : folderName;
}

/**
 * What sync last did, in words: a problem first, else the other Macs, the last sync and changes kept from both.
 */
function describeSyncStatus(sync: SyncStatusData): string {
  if (sync.problem !== null) {
    return sync.problem;
  }
  const sentences = [sync.peerNames.length === 0 ? "No other Mac has synced here yet." : `With ${sync.peerNames.join(", ")}.`];
  if (sync.lastSyncAt !== null) {
    const time = new Date(sync.lastSyncAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    sentences.push(`Last synced at ${time}.`);
  }
  if (sync.conflicts === 1) {
    sentences.push("1 thing was changed on two Macs at the same moment; both now show the same version.");
  }
  if (sync.conflicts > 1) {
    sentences.push(`${sync.conflicts} things were changed on two Macs at the same moment; both now show the same version.`);
  }
  return sentences.join(" ");
}

/**
 * The Sync group: off, what it does and Choose Folder…; on, where it syncs, how it went, and Stop Syncing.
 */
function renderSyncSettings(sync: SyncStatusData): HTMLElement {
  if (sync.folderPath === null) {
    return createSettingGroup("Sync", [
      createSettingRow(
        "Sync between your Macs",
        "Bow keeps one file per Mac in a folder you choose, like iCloud Drive or Dropbox, and reads the others: Spaces, pinned tabs, folders, Favorites, Notes, Easels, Boosts and rules. No account, no server. Today tabs, the Archive and settings stay on each Mac.",
        createTextButton("Choose Folder…", "library-chip", () => dispatch({ type: "chooseSyncFolder" })),
      ),
    ]);
  }
  return createSettingGroup("Sync", [
    createSettingRow(
      `Syncing through ${describeSyncFolder(sync.folderPath)}`,
      describeSyncStatus(sync),
      createTextButton("Show in Finder", "library-chip", () => dispatch({ type: "revealSyncFolder" })),
    ),
    createSettingRow(
      "Stop syncing",
      "This Mac stops sending and receiving changes. Its setup stays as it is; the other Macs go on syncing.",
      createTextButton("Stop Syncing", "library-chip", () => dispatch({ type: "stopSyncing" })),
    ),
  ]);
}

/**
 * Search keywords: the ones there are, each with a remove button, and a form to add one ("yt", "YouTube",
 * "https://www.youtube.com/results?search_query=%s").
 */
function renderSearchKeywordSettings(data: LibraryData): HTMLElement {
  const section = createElement("div", "library-routing search-keywords");
  section.append(createElement("h2", "library-setting-heading", "Search keywords"));
  section.append(createElement("p", "library-setting-note", "Type a keyword, a space and your words in the address field or the Command Bar to search that site: “yt cats”."));
  for (const entry of data.searchKeywords) {
    const line = createElement("div", "library-line search-keyword");
    line.dataset.keyword = entry.keyword;
    const text = createElement("span", "library-line-text");
    text.append(createElement("span", "library-line-title", `${entry.keyword} → ${entry.name}`), createElement("span", "library-line-meta", entry.url));
    line.append(text, createIconButton("trash", "Remove keyword", "library-line-icon-button", () => dispatch({ type: "removeSearchKeyword", keyword: entry.keyword })));
    section.append(line);
  }
  const form = document.createElement("form");
  form.className = "routing-form keyword-form";
  const keywordInput = createFormInput("yt", "Keyword");
  keywordInput.classList.add("keyword-input");
  keywordInput.dataset.keep = "keyword";
  const nameInput = createFormInput("YouTube", "Name");
  nameInput.dataset.keep = "keyword-name";
  const urlInput = createFormInput("https://www.youtube.com/results?search_query=%s", "Search address, with %s for the words");
  urlInput.dataset.keep = "keyword-url";
  urlInput.classList.add("keyword-url-input");
  const addButton = document.createElement("button");
  addButton.type = "submit";
  addButton.className = "library-chip is-active";
  addButton.textContent = "Add Keyword";
  const problem = createElement("p", "library-setting-note keyword-problem");
  form.append(keywordInput, nameInput, urlInput, addButton);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const entry = { keyword: keywordInput.value.trim().toLowerCase(), name: nameInput.value.trim(), url: urlInput.value.trim() };
    if (!isValidSearchKeyword(entry)) {
      problem.textContent = "Use one short word as the keyword, a name, and a web address with %s where the words go.";
      return;
    }
    // Cleared first: the redraw that shows the new keyword keeps what the fields hold.
    keywordInput.value = "";
    nameInput.value = "";
    urlInput.value = "";
    dispatch({ type: "addSearchKeyword", keyword: entry.keyword, name: entry.name, url: entry.url });
  });
  section.append(form, problem);
  return section;
}

/**
 * A text field of a Settings form, with its example as placeholder.
 */
function createFormInput(example: string, label: string): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "library-search";
  input.placeholder = example;
  input.setAttribute("aria-label", label);
  return input;
}

/**
 * A rule in words: "If the address contains “github.com”", "If the link comes from “Slack”".
 */
function describeRule(rule: RoutingRule): string {
  if (rule.matchType === "app") {
    return `If the link comes from “${rule.appName ?? rule.value}”`;
  }
  const verb = rule.matchType === "contains" ? "contains" : "is";
  return `If the address ${verb} “${rule.value}”`;
}

/**
 * A Space as the routing settings name it: "✦ Work", or "a deleted Space".
 */
function describeRuleSpace(data: LibraryData, spaceId: string): string {
  const space = data.spaces.find((candidate) => candidate.id === spaceId);
  return space === undefined ? "a deleted Space" : `${describeSpaceIconAsText(space.icon)} ${space.name}`;
}

/**
 * A select of the apps an app rule can name; with `anyLabel`, a first choice for "any app" (value "").
 */
function createAppSelect(data: LibraryData, keepKey: string, anyLabel: string | null): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "library-select";
  select.dataset.keep = keepKey;
  select.setAttribute("aria-label", "App");
  if (anyLabel !== null) {
    select.append(new Option(anyLabel, ""));
  }
  for (const app of data.linkSourceApps) {
    select.append(new Option(app.name, app.bundleId));
  }
  if (anyLabel === null && data.linkSourceApps.length === 0) {
    const none = new Option("No apps found", "");
    none.disabled = true;
    select.append(none);
  }
  return select;
}

/**
 * Builds the Air Traffic Control settings: the rules that send links from other apps to a Space, a form to add one
 * (by address or by the app the link comes from), and a field that tests where a link would open.
 */
function renderRoutingSettings(data: LibraryData): HTMLElement {
  const section = createElement("div", "library-routing");
  section.append(createElement("h2", "library-setting-heading", "Links from other apps"));
  section.append(createElement("p", "library-setting-note", "Links you open in other apps open in a Little Window, unless a rule below sends them to a Space. The first rule that matches wins."));

  for (const rule of data.routingRules) {
    const line = createElement("div", "library-line routing-rule");
    line.append(createElement("span", "library-line-title", `${describeRule(rule)} → ${describeRuleSpace(data, rule.spaceId)}`));
    line.append(createIconButton("trash", "Remove rule", "library-line-icon-button", () => dispatch({ type: "removeRoutingRule", ruleId: rule.id })));
    section.append(line);
  }

  const form = document.createElement("form");
  form.className = "routing-form routing-rule-form";
  const matchSelect = document.createElement("select");
  matchSelect.className = "library-select routing-match";
  matchSelect.dataset.keep = "route-match";
  matchSelect.append(new Option("Address contains", "contains"), new Option("Address is", "is"), new Option("Link comes from", "app"));
  const valueInput = document.createElement("input");
  valueInput.className = "library-search";
  valueInput.dataset.keep = "route-value";
  valueInput.placeholder = "github.com";
  valueInput.setAttribute("aria-label", "Address part");
  const appSelect = createAppSelect(data, "route-app", null);
  appSelect.classList.add("routing-app");
  const spaceSelect = document.createElement("select");
  spaceSelect.className = "library-select";
  spaceSelect.dataset.keep = "route-space";
  for (const space of data.spaces) {
    spaceSelect.append(new Option(`${describeSpaceIconAsText(space.icon)} ${space.name}`, space.id));
  }
  const addButton = document.createElement("button");
  addButton.type = "submit";
  addButton.className = "library-chip is-active";
  addButton.textContent = "Add Rule";
  // An app rule picks an app instead of typing part of an address.
  const showMatchFields = (): void => {
    const isAppRule = matchSelect.value === "app";
    valueInput.hidden = isAppRule;
    appSelect.hidden = !isAppRule;
  };
  matchSelect.addEventListener("change", showMatchFields);
  showMatchFields();
  form.append(matchSelect, valueInput, appSelect, spaceSelect, addButton);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (matchSelect.value === "app") {
      const app = data.linkSourceApps.find((candidate) => candidate.bundleId === appSelect.value);
      if (app !== undefined) {
        dispatch({ type: "addAppRoutingRule", bundleId: app.bundleId, appName: app.name, spaceId: spaceSelect.value });
      }
      return;
    }
    const matchType = matchSelect.value === "is" ? "is" : "contains";
    const value = valueInput.value;
    // Cleared first: the redraw that shows the new rule keeps what the field holds.
    valueInput.value = "";
    dispatch({ type: "addRoutingRule", matchType: matchType, value: value, spaceId: spaceSelect.value });
  });
  section.append(form, renderLinkTest(data));
  return section;
}

/**
 * "Test a link": paste a link (and pick the app it would come from) to see where it would open, by the same rules.
 */
function renderLinkTest(data: LibraryData): HTMLElement {
  const box = createElement("div", "routing-form route-test");
  const urlInput = document.createElement("input");
  urlInput.className = "library-search route-test-url";
  urlInput.dataset.keep = "route-test-url";
  urlInput.placeholder = "Test a link: paste one to see where it opens";
  urlInput.setAttribute("aria-label", "Link to test");
  const appSelect = createAppSelect(data, "route-test-app", "From any app");
  appSelect.classList.add("route-test-app");
  const result = createElement("p", "library-setting-note route-test-result");
  const showResult = (): void => {
    const url = urlInput.value.trim();
    if (url === "") {
      result.textContent = "";
      return;
    }
    const app = data.linkSourceApps.find((candidate) => candidate.bundleId === appSelect.value) ?? null;
    const spaceIds = data.spaces.map((space) => space.id);
    const rule = findMatchingRule(data.routingRules, spaceIds, url, app);
    result.textContent = rule === null ? "Opens in a Little Window: no rule matches." : `Opens in ${describeRuleSpace(data, rule.spaceId)}: ${describeRule(rule)}.`;
  };
  urlInput.addEventListener("input", showResult);
  appSelect.addEventListener("change", showResult);
  box.append(urlInput, appSelect, result);
  return box;
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

/** What was typed or chosen in a section's fields (by data-keep), and which one had the focus and where. */
interface KeptFields {
  values: Map<string, string>;
  focusedKey: string | null;
  selection: { start: number | null; end: number | null };
}

/**
 * Reads the section's kept fields before a redraw: a Library update must not wipe what the user is typing.
 */
function readKeptFields(body: HTMLElement): KeptFields {
  const values = new Map<string, string>();
  for (const field of body.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-keep]")) {
    values.set(field.dataset.keep as string, field.value);
  }
  const focused = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement ? document.activeElement : null;
  const focusedKey = focused !== null && body.contains(focused) ? (focused.dataset.keep ?? null) : null;
  const selection = focused instanceof HTMLInputElement ? { start: focused.selectionStart, end: focused.selectionEnd } : { start: null, end: null };
  return { values: values, focusedKey: focusedKey, selection: selection };
}

/**
 * Puts kept values back after a redraw (each field's own handlers run, as if the user had typed or chosen it again)
 * and gives the focus back to the field that had it.
 */
function restoreKeptFields(body: HTMLElement, kept: KeptFields): void {
  for (const field of body.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-keep]")) {
    const value = kept.values.get(field.dataset.keep as string);
    if (value === undefined || value === field.value) {
      continue;
    }
    field.value = value;
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input"));
  }
  const focusedField = kept.focusedKey === null ? null : body.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-keep="${kept.focusedKey}"]`);
  focusedField?.focus();
  if (focusedField instanceof HTMLInputElement && kept.selection.start !== null) {
    focusedField.setSelectionRange(kept.selection.start, kept.selection.end);
  }
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
  const keptFields = isRedraw ? readKeptFields(body) : null;
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
  if (section === "privacy") {
    const emptyState = createEmptyState("privacy", "Blocking is off", "Turn on blocking of ads and trackers to see what Bow stops, site by site.");
    renderPrivacySection(body, data, emptyState, []);
  }
  if (section === "chains") {
    const emptyState = createEmptyState("chains", "No chains yet", "A chain runs several Command Bar actions and pages in one go. Build one here, then type its name in the Command Bar.");
    renderChainsSection(body, data, emptyState);
  }
  if (section === "extensions") {
    renderExtensionsSection(body, data);
  }
  if (section === "tasks") {
    renderTasksSection(body, data);
  }
  if (section === "settings") {
    renderSettingsSection(body, data);
  }
  body.dataset.section = section;
  restoreScrollPositions(body, scrollPositions);
  if (keptFields !== null) {
    restoreKeptFields(body, keptFields);
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
  if (section === "downloads" || section === "settings" || section === "media" || section === "spaces" || section === "boosts" || section === "privacy") {
    renderBody(updated);
  }
  // Chains have text fields: drawn again only when the chains changed (an edit was saved), not on every update.
  if (section === "chains" && haveChainsChanged(updated)) {
    renderBody(updated);
  }
}

window.overlayApi.onLibraryUpdate(handleLibraryUpdate);
