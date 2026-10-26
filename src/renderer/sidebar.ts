/**
 * WHY this file exists:
 *   Draws the sidebar: Space heading, pinned tabs, today tabs, the archive, the
 *   "Archive tabs after" setting and the Space switcher. It holds no data of its own;
 *   it redraws from each new state.
 *
 * Data source:
 *   BrowserState from window.browserApi (getState on load, onStateChanged after every change).
 *
 * Data flow:
 *   state arrives → renderSidebar() → rebuilds #sidebar-content and #sidebar-footer → click → window.browserApi.<action>()
 *
 * Pattern: "render from state". We never patch one row by hand; we redraw from the newest state.
 * The sidebar has at most a few hundred rows, so redrawing everything stays fast.
 */
import { ARCHIVE_THRESHOLD_OPTIONS, DAY_MS, HOUR_MS, MINUTE_MS } from "../shared/settings.js";
import type { ArchiveReason, ArchivedTab, BrowserApi, BrowserState, ItemId, TabItem } from "../shared/types";

declare global {
  interface Window {
    browserApi: BrowserApi;
  }
}

/** How many archive entries to draw. Older ones stay saved; drawing thousands of rows would slow the sidebar. */
const MAX_ARCHIVE_ROWS = 50;

/** Words shown next to each archive entry. */
const ARCHIVE_REASON_LABELS: Record<ArchiveReason, string> = {
  auto: "Auto-archived",
  manual: "Closed",
  "clear-button": "Cleared",
};

/** Shown instead of a letter when a tab's URL has no readable host name. */
const FALLBACK_SITE_INITIAL = "•";

/** Remembers whether the Archive section is open, because every redraw builds it again from scratch. */
let isArchiveOpen = false;

/**
 * Creates an element with a class and optional text. Almost every element below starts here.
 */
function createElement(tagName: string, className: string, text: string = ""): HTMLElement {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

/**
 * Creates a button that runs onClick. The click does not reach the row underneath,
 * so pressing "Close" on a tab does not also select that tab.
 */
function createButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

/**
 * Returns the selected tab id of the active Space, or null when the Space is empty.
 */
function getSelectedTabId(state: BrowserState): ItemId | null {
  // "?? null" turns a missing entry (undefined) into null, so both mean "nothing selected".
  return state.selectedTabIdBySpace[state.activeSpaceId] ?? null;
}

/**
 * Returns the first letter of a tab's site, used as a simple stand-in for a favicon.
 * Example: "https://www.github.com/x" → "G"
 */
function getSiteInitial(url: string): string {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    return FALLBACK_SITE_INITIAL;
  }

  const wwwPrefix = "www.";
  if (hostname.startsWith(wwwPrefix)) {
    hostname = hostname.slice(wwwPrefix.length);
  }
  const firstLetter = hostname.charAt(0);
  if (firstLetter === "") {
    return FALLBACK_SITE_INITIAL;
  }
  return firstLetter.toUpperCase();
}

/**
 * Turns an archive time into short text for the archive list.
 * Example: archived 2 hours ago → "2 h ago"; 3 days ago → "3 d ago"
 */
function formatTimeAgo(archivedAt: number, now: number): string {
  const elapsedMs = now - archivedAt;
  if (elapsedMs < MINUTE_MS) {
    return "just now";
  }
  if (elapsedMs < HOUR_MS) {
    const minutes = Math.floor(elapsedMs / MINUTE_MS);
    return `${minutes} min ago`;
  }
  if (elapsedMs < DAY_MS) {
    const hours = Math.floor(elapsedMs / HOUR_MS);
    return `${hours} h ago`;
  }
  const days = Math.floor(elapsedMs / DAY_MS);
  return `${days} d ago`;
}

/**
 * Pins an unpinned tab, or unpins a pinned one.
 */
function togglePin(tab: TabItem, isPinned: boolean): void {
  if (isPinned) {
    window.browserApi.dispatch({ type: "unpinTab", tabId: tab.id });
    return;
  }
  window.browserApi.dispatch({ type: "pinTab", tabId: tab.id });
}

/**
 * Builds one tab row: site letter, title, and hover buttons for pin/unpin and close.
 */
function renderTabRow(tab: TabItem, isSelected: boolean, isPinned: boolean): HTMLElement {
  const row = createElement("div", "tab-row");
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  row.title = tab.url;
  if (isSelected) {
    row.classList.add("is-selected");
    row.setAttribute("aria-current", "page");
  }

  let pinLabel = "Pin";
  if (isPinned) {
    pinLabel = "Unpin";
  }
  const icon = createElement("span", "tab-icon", getSiteInitial(tab.url));
  const title = createElement("span", "tab-title", tab.customTitle ?? tab.title);
  const pinButton = createButton(pinLabel, "tab-action", () => togglePin(tab, isPinned));
  const closeButton = createButton("×", "tab-action tab-close", () => window.browserApi.dispatch({ type: "closeTab", tabId: tab.id }));
  closeButton.setAttribute("aria-label", "Close tab");
  closeButton.title = "Close (moves the tab to the Archive)";

  row.append(icon, title, pinButton, closeButton);
  row.addEventListener("click", () => window.browserApi.dispatch({ type: "selectTab", tabId: tab.id }));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      window.browserApi.dispatch({ type: "selectTab", tabId: tab.id });
    }
  });
  return row;
}

/**
 * Builds one titled list of tabs. Used twice: "Pinned" and "Today".
 * The "Today" list also gets a "Clear" button that archives all its tabs.
 */
function renderTabList(title: string, tabs: TabItem[], selectedTabId: ItemId | null, emptyMessage: string, showClearButton: boolean): HTMLElement {
  const section = createElement("section", "tab-list");
  const header = createElement("div", "section-header");
  header.append(createElement("h2", "section-title", title));
  if (showClearButton && tabs.length > 0) {
    const clearButton = createButton("Clear", "text-button", () => window.browserApi.dispatch({ type: "clearTodayTabs" }));
    clearButton.title = "Move all of today's tabs to the Archive";
    header.append(clearButton);
  }
  section.append(header);

  if (tabs.length === 0) {
    section.append(createElement("p", "list-empty", emptyMessage));
    return section;
  }
  for (const tab of tabs) {
    const isSelected = tab.id === selectedTabId;
    section.append(renderTabRow(tab, isSelected, !showClearButton));
  }
  return section;
}

/**
 * Builds one archive entry: title, why and when it was archived, and a Restore button.
 */
function renderArchiveRow(entry: ArchivedTab, now: number): HTMLElement {
  const row = createElement("div", "archive-row");
  row.title = entry.tab.url;

  const reasonLabel = ARCHIVE_REASON_LABELS[entry.reason];
  const timeAgo = formatTimeAgo(entry.archivedAt, now);
  const text = createElement("div", "archive-text");
  text.append(createElement("span", "archive-title", entry.tab.customTitle ?? entry.tab.title));
  text.append(createElement("span", "archive-meta", `${reasonLabel} · ${timeAgo}`));

  const restoreButton = createButton("Restore", "text-button archive-restore", () => {
    window.browserApi.dispatch({ type: "restoreArchivedTab", tabId: entry.tab.id });
  });
  row.append(text, restoreButton);
  return row;
}

/**
 * Builds the collapsible "Archive" section, newest first. Only the newest MAX_ARCHIVE_ROWS are drawn.
 */
function renderArchiveSection(archive: ArchivedTab[]): HTMLElement {
  const details = document.createElement("details");
  details.className = "archive";
  details.open = isArchiveOpen;
  details.addEventListener("toggle", () => {
    isArchiveOpen = details.open;
  });
  details.append(createElement("summary", "section-title archive-summary", `Archive · ${archive.length}`));

  if (archive.length === 0) {
    details.append(createElement("p", "list-empty", "Closed and auto-archived tabs land here."));
    return details;
  }

  const now = Date.now();
  const visibleEntries = archive.slice(0, MAX_ARCHIVE_ROWS);
  for (const entry of visibleEntries) {
    details.append(renderArchiveRow(entry, now));
  }
  const hiddenCount = archive.length - visibleEntries.length;
  if (hiddenCount > 0) {
    details.append(createElement("p", "list-empty", `${hiddenCount} older entries not shown.`));
  }
  return details;
}

/**
 * Sends the newly chosen "Archive tabs after" value to the main process.
 */
function handleArchiveSettingChange(select: HTMLSelectElement): void {
  // The options were added in the same order as ARCHIVE_THRESHOLD_OPTIONS, so the index finds the choice.
  const chosenOption = ARCHIVE_THRESHOLD_OPTIONS[select.selectedIndex];
  if (chosenOption === undefined) {
    return;
  }
  window.browserApi.dispatch({ type: "setArchiveAfter", archiveAfterMs: chosenOption.valueMs });
}

/**
 * Builds the "Archive tabs after" dropdown from ARCHIVE_THRESHOLD_OPTIONS, with the current setting selected.
 */
function renderArchiveSetting(state: BrowserState): HTMLElement {
  const wrapper = createElement("label", "archive-setting");
  const caption = createElement("span", "archive-setting-label", "Archive tabs after");

  const select = document.createElement("select");
  select.id = "archive-after";
  for (const option of ARCHIVE_THRESHOLD_OPTIONS) {
    const optionElement = document.createElement("option");
    optionElement.textContent = option.label;
    optionElement.selected = option.valueMs === state.settings.archiveAfterMs;
    select.append(optionElement);
  }
  select.addEventListener("change", () => handleArchiveSettingChange(select));

  wrapper.append(caption, select);
  return wrapper;
}

/**
 * Builds the row of Space icons. The active Space is highlighted; clicking another one switches to it.
 */
function renderSpaceSwitcher(state: BrowserState): HTMLElement {
  const switcher = createElement("nav", "space-switcher");
  switcher.setAttribute("aria-label", "Spaces");

  for (const space of state.spaces) {
    const button = createButton(space.icon, "space-button", () => window.browserApi.dispatch({ type: "switchSpace", spaceId: space.id }));
    button.title = space.name;
    button.setAttribute("aria-label", space.name);
    if (space.id === state.activeSpaceId) {
      button.classList.add("is-active");
      button.setAttribute("aria-pressed", "true");
    }
    switcher.append(button);
  }
  return switcher;
}

/**
 * Builds the heading with the active Space's icon and name, and paints the window frame in its color.
 */
function renderSpaceHeading(state: BrowserState): HTMLElement {
  const heading = createElement("h1", "space-heading");
  const activeSpace = state.spaces.find((space) => space.id === state.activeSpaceId);
  if (activeSpace === undefined) {
    return heading;
  }

  heading.textContent = `${activeSpace.icon}  ${activeSpace.name}`;
  const frameColor = activeSpace.theme.colors[0] ?? "#e9d8d4";
  document.documentElement.style.setProperty("--frame-color", frameColor);
  return heading;
}

/**
 * Shows the "No tab open" message only while the active Space has no selected tab.
 */
function updateEmptyCard(selectedTabId: ItemId | null): void {
  const emptyCard = document.getElementById("empty-card");
  if (emptyCard === null) {
    return;
  }
  emptyCard.hidden = selectedTabId !== null;
}

/**
 * Returns the tabs under a list of items in sidebar order, looking inside folders and split views.
 */
function collectTabs(state: BrowserState, itemIds: ItemId[]): TabItem[] {
  const tabs: TabItem[] = [];
  for (const itemId of itemIds) {
    const item = state.items[itemId];
    if (item === undefined) {
      continue;
    }
    if (item.kind === "tab") {
      tabs.push(item);
      continue;
    }
    tabs.push(...collectTabs(state, item.childIds));
  }
  return tabs;
}

/**
 * Redraws the sidebar from the given state.
 */
function renderSidebar(state: BrowserState): void {
  const content = document.getElementById("sidebar-content");
  const footer = document.getElementById("sidebar-footer");
  if (content === null || footer === null) {
    return;
  }

  const activeSpace = state.spaces.find((space) => space.id === state.activeSpaceId);
  const pinnedTabs = collectTabs(state, activeSpace === undefined ? [] : activeSpace.pinnedIds);
  const todayTabs = collectTabs(state, activeSpace === undefined ? [] : activeSpace.todayIds);

  const selectedTabId = getSelectedTabId(state);
  content.replaceChildren(
    renderSpaceHeading(state),
    renderTabList("Pinned", pinnedTabs, selectedTabId, "Pin tabs you keep coming back to.", false),
    renderTabList("Today", todayTabs, selectedTabId, "New tabs show up here.", true),
    renderArchiveSection(state.archive),
  );
  footer.replaceChildren(renderArchiveSetting(state), renderSpaceSwitcher(state));
  updateEmptyCard(selectedTabId);
}

/**
 * Opens what was typed in the address box as a new tab, then empties the box.
 */
function handleAddressSubmit(input: HTMLInputElement): void {
  const typedText = input.value;
  input.value = "";
  window.browserApi.dispatch({ type: "openTab", typedText: typedText });
}

/**
 * Connects the address box, which lives in index.html and is never redrawn.
 */
function setUpAddressBox(): void {
  const form = document.getElementById("address-form");
  const input = document.getElementById("address-input");
  if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement)) {
    return;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    handleAddressSubmit(input);
  });
}

/**
 * Entry point: connects the address box, then draws the first state and every state after it.
 */
async function startSidebar(): Promise<void> {
  setUpAddressBox();
  window.browserApi.onStateChanged(renderSidebar);
  const firstState = await window.browserApi.getState();
  renderSidebar(firstState);
}

startSidebar();
