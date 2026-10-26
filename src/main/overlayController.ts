/**
 * WHY this file exists:
 *   Opens and runs the overlay panels: the Command Bar (rank results while typing, act on the chosen line), the
 *   Library (archive, history, downloads, settings), site controls and Find in page. It answers the overlay page's
 *   messages, and only from the overlay page itself.
 *
 * Data source:
 *   browserCore.ts (state), historyStore.ts, downloads.ts, the selected page (tabViews.ts), DuckDuckGo's
 *   suggestion service for search suggestions, and the action registry (commandBarActions.ts).
 *
 * Data flow:
 *   ⌘T → openCommandBar() → showOverlay → overlay types → "overlay:query" → rankCommandBarResults → lines
 *   (suggestions arrive later as "overlay:results") → "overlay:choose" → close overlay → run the result
 */
import { app, clipboard, ClipboardItem, ipcMain, nativeTheme, net } from "electron";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { OVERLAY_CHANNELS } from "../shared/overlay";
import type { CommandBarLine, CommandBarMode, LibraryData, LibrarySection, OverlayPanel, SiteCommand, SiteInfo } from "../shared/overlay";
import type { BrowserState, ItemId } from "../shared/types";
import { applyChange, getLayoutOptions, getRecentTabIds, getState, getWindow } from "./browserCore";
import { rankCommandBarResults } from "./commandBar";
import type { CommandBarResult } from "./commandBar";
import type { CommandActionRegistry } from "./commandBarActions";
import { getDownloads, showDownloadInFolder } from "./downloads";
import { searchHistory } from "./history";
import { clearHistory, getHistory } from "./historyStore";
import { computeCardBounds } from "./layout";
import type { Bounds } from "./layout";
import { getOverlayContents, hideOverlay, sendToOverlay, setOverlayBounds, showOverlay } from "./overlay";
import { closePeek, isPeekOpen, openPeekAsTab, openPeekInSplit } from "./peek";
import { toggleDevTools, zoomPage } from "./pageCommands";
import { splitTabs } from "./split";
import { getSelectedTabId, openTab, selectTab } from "./state";
import { loadUrlInTab, openLinkInNewTab, setMuted } from "./tabActions";
import { getFocusedContents, getTabContents } from "./tabViews";
import { findTab, getActiveSpace } from "./tree";
import { looksLikeWebAddress, normalizeTypedInput } from "./urls";

/** DuckDuckGo's suggestion service; it is also the browser's search engine (urls.ts). */
const SUGGESTION_URL_PREFIX = "https://duckduckgo.com/ac/?type=list&q=";

/** Most suggestions mixed into the results. */
const SUGGESTIONS_LIMIT = 4;

/** Give up on suggestions after this long; results without them are already on screen. */
const SUGGESTION_TIMEOUT_MS = 1500;

/** Most history lines sent to the Library at once. */
const LIBRARY_HISTORY_LIMIT = 300;

/** Size of the Find bar, which sits in the top-right corner of the page card. Our choice. */
const FIND_BAR_WIDTH_PX = 380;
const FIND_BAR_HEIGHT_PX = 56;
const FIND_BAR_MARGIN_PX = 10;

/** The panel on screen, or null. */
let shownPanel: OverlayPanel | null = null;

/** The results of the last query, by id, so a chosen id can be turned back into a result. */
let lastResults = new Map<string, CommandBarResult>();

/** The newest query; late suggestion answers for older queries are dropped. */
let latestQuery = "";

/** The text the Find bar last searched for, so ⌘G can search again. */
let lastFindText = "";

/** Pages whose "found-in-page" event already reports to the Find bar. */
const findListeners = new WeakSet<WebContents>();

/** The action list for the Command Bar. Set once at startup. */
let actionRegistry: CommandActionRegistry | null = null;

/**
 * Gives the controller the Command Bar's action list. Runs once at startup.
 */
export function setCommandActionRegistry(registry: CommandActionRegistry): void {
  actionRegistry = registry;
}

/**
 * True when the active Space draws dark: its own setting, or the system's for "automatic".
 */
function isActiveSpaceDark(state: BrowserState): boolean {
  const appearance = getActiveSpace(state).theme.appearance;
  if (appearance === "auto") {
    return nativeTheme.shouldUseDarkColors;
  }
  return appearance === "dark";
}

/**
 * Where the overlay goes: the whole window for modal panels, a small corner of the card for the Find bar.
 */
function computeOverlayBounds(panel: OverlayPanel): Bounds | null {
  const window = getWindow();
  if (window === null) {
    return null;
  }
  const contentSize = window.getContentSize();
  const contentWidth = contentSize[0] ?? 0;
  const contentHeight = contentSize[1] ?? 0;
  if (panel.kind !== "find") {
    return { x: 0, y: 0, width: contentWidth, height: contentHeight };
  }
  const card = computeCardBounds(contentWidth, contentHeight, getLayoutOptions());
  return {
    x: card.x + card.width - FIND_BAR_WIDTH_PX - FIND_BAR_MARGIN_PX,
    y: card.y + FIND_BAR_MARGIN_PX,
    width: FIND_BAR_WIDTH_PX,
    height: FIND_BAR_HEIGHT_PX,
  };
}

/**
 * Collects what the Library shows.
 */
function buildLibraryData(state: BrowserState): LibraryData {
  const historyLines = getHistory()
    .slice(0, LIBRARY_HISTORY_LIMIT)
    .map((entry) => ({ url: entry.url, title: entry.title, lastVisitAt: entry.lastVisitAt }));
  return {
    archive: state.archive,
    spaces: state.spaces.map((space) => ({ id: space.id, name: space.name, icon: space.icon })),
    history: historyLines,
    downloads: getDownloads(),
    archiveAfterMs: state.settings.archiveAfterMs,
    routingRules: state.routingRules ?? [],
  };
}

/**
 * Collects what the site controls show about the selected page, or null when no tab is selected.
 */
function buildSiteInfo(state: BrowserState): SiteInfo | null {
  const selectedTabId = getSelectedTabId(state);
  const tab = selectedTabId === null ? undefined : findTab(state, selectedTabId);
  if (tab === undefined) {
    return null;
  }
  const contents = getTabContents(tab.id);
  let host = tab.url;
  try {
    host = new URL(tab.url).host;
  } catch {
    // Keep the full address as the label.
  }
  const zoomFactor = contents === null ? 1 : contents.getZoomFactor();
  return {
    tabId: tab.id,
    url: tab.url,
    host: host,
    isSecure: tab.url.startsWith("https://"),
    isMuted: tab.isMuted,
    zoomPercent: Math.round(zoomFactor * 100),
    isLoaded: contents !== null,
  };
}

/**
 * Opens a panel in the overlay.
 */
function openPanel(panel: OverlayPanel): void {
  const window = getWindow();
  const bounds = computeOverlayBounds(panel);
  if (window === null || bounds === null) {
    return;
  }
  const state = getState();
  shownPanel = panel;
  const library = panel.kind === "library" ? buildLibraryData(state) : null;
  const site = panel.kind === "siteControls" ? buildSiteInfo(state) : null;
  showOverlay(window, bounds, { panel: panel, isDark: isActiveSpaceDark(state), library: library, site: site }).catch((error) => {
    console.error("Could not open the overlay:", error);
  });
}

/**
 * Opens the Command Bar. "editUrl" starts with the current address, like ⌘L.
 */
export function openCommandBar(mode: CommandBarMode): void {
  const state = getState();
  const selectedTabId = getSelectedTabId(state);
  const selectedTab = selectedTabId === null ? undefined : findTab(state, selectedTabId);
  const initialText = mode === "editUrl" && selectedTab !== undefined ? selectedTab.url : "";
  latestQuery = initialText;
  openPanel({ kind: "commandBar", mode: mode, initialText: initialText });
}

export function openLibrary(section: LibrarySection = "archive"): void {
  openPanel({ kind: "library", section: section });
}

export function openSiteControls(): void {
  if (buildSiteInfo(getState()) !== null) {
    openPanel({ kind: "siteControls" });
  }
}

export function openFind(): void {
  if (getFocusedContents() !== null) {
    openPanel({ kind: "find" });
  }
}

/**
 * ⌘G / ⇧⌘G: the next or previous match, opening the Find bar if needed.
 */
export function findNextMatch(forward: boolean): void {
  if (shownPanel?.kind !== "find" || lastFindText === "") {
    openFind();
    return;
  }
  handleFind(lastFindText, forward, false);
}

/**
 * Closes whatever panel is open and gives the keyboard back to the page.
 */
export function closeOverlay(): void {
  const window = getWindow();
  if (window === null) {
    return;
  }
  // The overlay under a Peek belongs to the Peek: closing it (a click outside, Escape) dismisses the Peek.
  if (isPeekOpen()) {
    closePeek();
    return;
  }
  if (shownPanel?.kind === "find") {
    getFocusedContents()?.stopFindInPage("keepSelection");
  }
  shownPanel = null;
  hideOverlay(window);
  // Give the keyboard back to the page, or to the sidebar when no page is open.
  const pageContents = getFocusedContents();
  if (pageContents !== null) {
    pageContents.focus();
  } else {
    window.webContents.focus();
  }
}

/**
 * Keeps an open panel in place after the window was resized.
 */
export function relayoutOverlay(): void {
  if (shownPanel === null) {
    return;
  }
  const bounds = computeOverlayBounds(shownPanel);
  if (bounds !== null) {
    setOverlayBounds(bounds);
  }
}

/**
 * Sends fresh Library data after the state or the downloads changed, when the Library is open.
 */
export function refreshOpenPanel(): void {
  if (shownPanel?.kind === "library") {
    sendToOverlay(OVERLAY_CHANNELS.libraryUpdate, buildLibraryData(getState()));
  }
}

/**
 * Turns results into the lines the overlay draws, and remembers them by id.
 */
function toLines(results: CommandBarResult[]): CommandBarLine[] {
  lastResults = new Map(results.map((result) => [result.id, result]));
  return results.map((result) => ({
    id: result.id,
    kind: result.kind,
    title: result.title,
    subtitle: result.subtitle,
    url: result.url,
    faviconUrl: result.faviconUrl,
  }));
}

/**
 * Ranks the Command Bar results for a query. A split-view pane can only hold a page, so actions are left out there.
 */
function rankForQuery(query: string, mode: CommandBarMode, suggestions: string[]): CommandBarResult[] {
  const state = getState();
  const selectedTabId = getSelectedTabId(state);
  const selectedTab = selectedTabId === null ? undefined : findTab(state, selectedTabId);
  const actions = mode === "splitWith" || actionRegistry === null ? [] : actionRegistry.list();
  const results = rankCommandBarResults(
    {
      query: query,
      state: state,
      history: getHistory(),
      suggestions: suggestions,
      actions: actions,
      currentUrl: selectedTab === undefined ? null : selectedTab.url,
      recentTabIds: getRecentTabIds(),
    },
    Date.now(),
  );
  if (mode !== "splitWith") {
    return results;
  }
  return results.filter((result) => result.tabId !== selectedTabId);
}

/**
 * Asks DuckDuckGo for search suggestions. Resolves to an empty list on any failure or after the timeout.
 */
async function fetchSuggestions(query: string): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUGGESTION_TIMEOUT_MS);
  try {
    const response = await net.fetch(SUGGESTION_URL_PREFIX + encodeURIComponent(query), { signal: controller.signal });
    const body: unknown = await response.json();
    // The answer is ["query", ["suggestion 1", "suggestion 2", …]].
    const suggestionList = Array.isArray(body) ? body[1] : null;
    if (!Array.isArray(suggestionList)) {
      return [];
    }
    const textSuggestions = suggestionList.filter((value): value is string => typeof value === "string");
    return textSuggestions.filter((suggestion) => suggestion.toLowerCase() !== query.toLowerCase()).slice(0, SUGGESTIONS_LIMIT);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Answers a query at once with local results, then sends again with search suggestions when they arrive.
 */
function handleQuery(query: string, mode: CommandBarMode): CommandBarLine[] {
  latestQuery = query;
  const lines = toLines(rankForQuery(query, mode, []));
  const wantsSuggestions = query.trim() !== "" && !looksLikeWebAddress(query.trim());
  if (wantsSuggestions) {
    fetchSuggestions(query.trim()).then((suggestions) => {
      if (suggestions.length === 0 || latestQuery !== query || shownPanel?.kind !== "commandBar") {
        return;
      }
      sendToOverlay(OVERLAY_CHANNELS.results, query, toLines(rankForQuery(query, mode, suggestions)));
    });
  }
  return lines;
}

/**
 * Opens an address the way the Command Bar's mode asks: in the current tab (⌘L), next to it (split), or new (⌘T).
 */
function openAddress(url: string, mode: CommandBarMode): void {
  const state = getState();
  const selectedTabId = getSelectedTabId(state);
  if (mode === "editUrl" && selectedTabId !== null) {
    loadUrlInTab(selectedTabId, url);
    return;
  }
  if (mode === "splitWith" && selectedTabId !== null) {
    const now = Date.now();
    applyChange((currentState) => {
      const withNewTab = openTab(currentState, url, now, { select: false });
      const newTabId = getActiveSpace(withNewTab).todayIds[0] as ItemId;
      return splitTabs(withNewTab, selectedTabId, newTabId, now);
    });
    return;
  }
  openLinkInNewTab(url, "foreground");
}

/**
 * Carries out the chosen line, or what was typed when no line was chosen.
 */
function handleChoose(resultId: string | null, typedText: string, mode: CommandBarMode): void {
  const result = resultId === null ? undefined : lastResults.get(resultId);
  closeOverlay();
  if (result === undefined) {
    const text = typedText.trim();
    if (text !== "") {
      openAddress(normalizeTypedInput(text), mode);
    }
    return;
  }
  if (result.kind === "tab" && result.tabId !== null) {
    const tabId = result.tabId;
    const selectedTabId = getSelectedTabId(getState());
    if (mode === "splitWith" && selectedTabId !== null) {
      applyChange((state) => splitTabs(state, selectedTabId, tabId, Date.now()));
      return;
    }
    applyChange((state) => selectTab(state, tabId, Date.now()));
    return;
  }
  if (result.kind === "action" && result.actionId !== null && actionRegistry !== null) {
    actionRegistry.run(result.actionId);
    return;
  }
  if (result.url !== null) {
    openAddress(result.url, mode);
  }
}

/**
 * Saves a picture of the visible page into Downloads and copies it, like Arc's capture.
 */
async function capturePage(contents: WebContents, host: string): Promise<void> {
  const image = await contents.capturePage();
  const pngBytes = image.toPNG();
  // Electron 44's clipboard follows the web's async Clipboard API: an item per MIME type.
  // Blob wants a plain Uint8Array view, not Node's Buffer type.
  const pngView = new Uint8Array(pngBytes.buffer as ArrayBuffer, pngBytes.byteOffset, pngBytes.byteLength);
  await clipboard.write([new ClipboardItem({ "image/png": new Blob([pngView], { type: "image/png" }) })]);
  const timestamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const safeHost = host.replace(/[^a-zA-Z0-9.-]/g, "_");
  const filePath = path.join(app.getPath("downloads"), `Screenshot ${safeHost} ${timestamp}.png`);
  fs.writeFileSync(filePath, pngBytes);
}

/**
 * Runs a site-controls button, then redraws the panel with fresh values (or closes it for one-shot commands).
 */
function handleSiteCommand(command: SiteCommand): void {
  const site = buildSiteInfo(getState());
  if (site === null) {
    return;
  }
  const contents = getTabContents(site.tabId);
  if (command === "copyLink") {
    clipboard.writeText(site.url);
    closeOverlay();
    return;
  }
  if (command === "toggleMute") {
    setMuted(site.tabId, !site.isMuted);
  }
  if (contents === null) {
    openPanel({ kind: "siteControls" });
    return;
  }
  if (command === "screenshot") {
    closeOverlay();
    capturePage(contents, site.host).catch((error) => console.error("Screenshot failed:", error));
    return;
  }
  if (command === "devTools") {
    closeOverlay();
    toggleDevTools(contents);
    return;
  }
  if (command === "zoomIn" || command === "zoomOut" || command === "zoomReset") {
    const direction = command === "zoomIn" ? "in" : command === "zoomOut" ? "out" : "reset";
    zoomPage(contents, direction);
  }
  if (command === "reload") {
    contents.reload();
  }
  if (command === "clearSiteData") {
    const origin = new URL(site.url).origin;
    contents.session.clearStorageData({ origin: origin }).then(() => contents.reload());
  }
  openPanel({ kind: "siteControls" });
}

/**
 * Searches the page for the Find bar, and reports "match n of m" back to it.
 * A new search must start a new find session: Electron's option for that is called `findNext` and must be true for
 * the first request and false for "next / previous match" (the name suggests the opposite; see FindInPageOptions).
 */
function handleFind(text: string, forward: boolean, isNewSearch: boolean): void {
  const contents = getFocusedContents();
  if (contents === null) {
    return;
  }
  lastFindText = text;
  if (text === "") {
    contents.stopFindInPage("clearSelection");
    sendToOverlay(OVERLAY_CHANNELS.findProgress, { activeMatch: 0, matches: 0 });
    return;
  }
  if (!findListeners.has(contents)) {
    contents.on("found-in-page", (_event, result) => {
      sendToOverlay(OVERLAY_CHANNELS.findProgress, { activeMatch: result.activeMatchOrdinal, matches: result.matches });
    });
    findListeners.add(contents);
  }
  contents.findInPage(text, { forward: forward, findNext: isNewSearch });
}

/**
 * True when an IPC message comes from the overlay page (and not from a web page or another view).
 */
function isFromOverlay(event: IpcMainInvokeEvent): boolean {
  return event.sender === getOverlayContents();
}

function isMode(value: unknown): value is CommandBarMode {
  return value === "newTab" || value === "editUrl" || value === "splitWith";
}

const SITE_COMMANDS: SiteCommand[] = ["copyLink", "screenshot", "toggleMute", "devTools", "zoomIn", "zoomOut", "zoomReset", "clearSiteData", "reload"];

/** Longest text accepted from the overlay. */
const MAX_TEXT_LENGTH = 8192;

function isShortText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_TEXT_LENGTH;
}

/**
 * Registers the overlay page's IPC handlers. Every handler ignores messages from anyone but the overlay.
 */
export function registerOverlayIpc(): void {
  ipcMain.handle(OVERLAY_CHANNELS.query, (event, text: unknown, mode: unknown) => {
    if (!isFromOverlay(event) || !isShortText(text) || !isMode(mode)) {
      return [];
    }
    return handleQuery(text, mode);
  });
  ipcMain.handle(OVERLAY_CHANNELS.choose, (event, resultId: unknown, typedText: unknown, mode: unknown) => {
    const resultIdOk = resultId === null || isShortText(resultId);
    if (!isFromOverlay(event) || !resultIdOk || !isShortText(typedText) || !isMode(mode)) {
      return;
    }
    handleChoose(resultId as string | null, typedText, mode);
  });
  ipcMain.handle(OVERLAY_CHANNELS.close, (event) => {
    if (isFromOverlay(event)) {
      closeOverlay();
    }
  });
  ipcMain.handle(OVERLAY_CHANNELS.siteCommand, (event, command: unknown) => {
    if (isFromOverlay(event) && SITE_COMMANDS.includes(command as SiteCommand)) {
      handleSiteCommand(command as SiteCommand);
    }
  });
  ipcMain.handle(OVERLAY_CHANNELS.find, (event, text: unknown, forward: unknown, isNewSearch: unknown) => {
    if (isFromOverlay(event) && isShortText(text) && typeof forward === "boolean" && typeof isNewSearch === "boolean") {
      handleFind(text, forward, isNewSearch);
    }
  });
  ipcMain.handle(OVERLAY_CHANNELS.searchHistory, (event, query: unknown) => {
    if (!isFromOverlay(event) || !isShortText(query)) {
      return [];
    }
    return searchHistory(getHistory(), query, LIBRARY_HISTORY_LIMIT).map((entry) => ({ url: entry.url, title: entry.title, lastVisitAt: entry.lastVisitAt }));
  });
  ipcMain.handle(OVERLAY_CHANNELS.clearHistory, (event) => {
    if (isFromOverlay(event)) {
      clearHistory();
      refreshOpenPanel();
    }
  });
  ipcMain.handle(OVERLAY_CHANNELS.showDownload, (event, downloadId: unknown) => {
    if (isFromOverlay(event) && isShortText(downloadId)) {
      showDownloadInFolder(downloadId);
    }
  });
  ipcMain.handle(OVERLAY_CHANNELS.peekCommand, (event, command: unknown) => {
    if (!isFromOverlay(event)) {
      return;
    }
    if (command === "openAsTab") {
      openPeekAsTab();
    }
    if (command === "split") {
      openPeekInSplit();
    }
    if (command === "close") {
      closePeek();
    }
  });
  ipcMain.handle(OVERLAY_CHANNELS.openUrl, (event, url: unknown) => {
    const isWebAddress = isShortText(url) && (url.startsWith("https://") || url.startsWith("http://"));
    if (isFromOverlay(event) && isWebAddress) {
      closeOverlay();
      openLinkInNewTab(url, "foreground");
    }
  });
}
