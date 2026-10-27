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
import { app, clipboard, ipcMain, Menu, nativeTheme, net, ShareMenu } from "electron";
import type { IpcMainInvokeEvent, MenuItemConstructorOptions, Rectangle, WebContents } from "electron";
import { OVERLAY_CHANNELS } from "../shared/overlay";
import type { CommandBarLine, CommandBarMode, LibraryData, LibrarySection, OverlayPanel, OverlayRect, SiteCommand, SiteInfo, SwitcherTab } from "../shared/overlay";
import { getSnapshot } from "./tabSnapshots";
import { copyPngToClipboard, listCaptures, runCaptureCommand, saveCapture } from "./captures";
import { describeCaptureSource } from "./liveCaptures";
import type { CaptureCommand } from "./captures";
import type { BrowserState, ItemId, SitePermissionKind } from "../shared/types";
import { applyChange, getLayoutOptions, getRecentTabIds, getState, getWindow, sendSidebarCommand, setNewTabPending } from "./browserCore";
import { rankCommandBarResults } from "./commandBar";
import type { CommandBarResult } from "./commandBar";
import type { CommandActionRegistry } from "./commandBarActions";
import { getDownloads, showDownloadInFolder } from "./downloads";
import { activateExtensionOfActiveProfile, getExtensionIconUrl, getExtensionLoadError, listExtensionTiles } from "./extensionHost";
import { searchHistory } from "./history";
import { clearHistory, getHistory } from "./historyStore";
import { computeCardBounds } from "./layout";
import { THEME_PRESETS } from "./themePresets";
import { addZappedSelector, findBoostForUrl } from "./boosts";
import { reapplyBoostsToAllPages, zapElements } from "./boostPages";
import { getSiteKey } from "./urls";
import { DEFAULT_PROFILE_ID, SIDEBAR_WIDTH_PX } from "../shared/settings";
import type { Bounds } from "./layout";
import { getOverlayContents, hideOverlay, sendToOverlay, setOverlayBounds, showOverlay } from "./overlay";
import { closePeek, isPeekOpen, openPeekAsTab, openPeekInSplit } from "./peek";
import { toggleDevTools, translatePage, zoomPage } from "./pageCommands";
import { splitTabs } from "./split";
import { getSelectedTabId, openTab, selectTab } from "./state";
import { loadUrlInTab, openLinkInNewTab, setMuted } from "./tabActions";
import { getFocusedContents, getTabContents, getTabViews } from "./tabViews";
import { findProfileIdOfItem, findTab, getActiveSpace } from "./tree";
import { getPermissionOrigin, getSitePermissions } from "./sitePermissions";
import { looksLikeWebAddress, normalizeTypedInput } from "./urls";
import { isDeveloperModeOn } from "../shared/developerMode";
import { listImportSources } from "./browserImportController";
import { addMenuIcons } from "./menuIcons";
import { describeAdBlock, getBlockedCount, isAdBlockActiveFor } from "./adBlock";

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

/** Size of a permission prompt, at the page card's top left. Must fit overlay.css's .permission-prompt. */
const PERMISSION_PROMPT_WIDTH_PX = 360;
const PERMISSION_PROMPT_HEIGHT_PX = 116;
const PERMISSION_PROMPT_MARGIN_PX = 10;

/** Why a panel went away: closed (Escape, a click outside, an answer) or replaced by another panel. */
export type PanelEndReason = "closed" | "replaced";

/** Functions to run when a panel goes away (permissionPrompts.ts shows a waiting prompt or notes a dismissal). */
const panelEndListeners: ((panel: OverlayPanel, reason: PanelEndReason) => void)[] = [];

/**
 * Registers a function to run whenever a panel closes or another panel replaces it.
 */
export function onPanelEnded(listener: (panel: OverlayPanel, reason: PanelEndReason) => void): void {
  panelEndListeners.push(listener);
}

/**
 * Tells the listeners that a panel went away.
 */
function notifyPanelEnded(panel: OverlayPanel, reason: PanelEndReason): void {
  for (const listener of panelEndListeners) {
    listener(panel, reason);
  }
}

/**
 * True while the overlay shows any panel.
 */
export function isPanelShown(): boolean {
  return shownPanel !== null;
}

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
  if (panel.kind === "preview") {
    return panel.frame;
  }
  if (panel.kind === "permission") {
    // Under the toolbar at the page's top left, like Chromium's permission bubble; the page stays usable around it.
    const pageCard = computeCardBounds(contentWidth, contentHeight, getLayoutOptions());
    return { x: pageCard.x + PERMISSION_PROMPT_MARGIN_PX, y: pageCard.y + PERMISSION_PROMPT_MARGIN_PX, width: PERMISSION_PROMPT_WIDTH_PX, height: PERMISSION_PROMPT_HEIGHT_PX };
  }
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
    spaces: state.spaces.map((space) => ({
      id: space.id,
      name: space.name,
      icon: space.icon,
      color: space.theme.colors[0] ?? null,
      pinnedCount: space.pinnedIds.length,
      todayCount: space.todayIds.length,
      profileName: state.profiles.find((profile) => profile.id === space.profileId)?.name ?? "",
      isActive: space.id === state.activeSpaceId,
    })),
    boosts: (state.boosts ?? []).map((boost) => ({ site: boost.site, isEnabled: boost.isEnabled, zapCount: boost.zappedSelectors.length, hasCss: boost.css.trim() !== "" })),
    history: historyLines,
    downloads: getDownloads(),
    media: listCaptures(LIBRARY_MEDIA_LIMIT).map((record) => ({
      id: record.id,
      title: record.title,
      url: record.url,
      createdAt: record.createdAt,
      width: record.width,
      height: record.height,
      thumbnailUrl: record.thumbnailUrl,
    })),
    archiveAfterMs: state.settings.archiveAfterMs,
    areSoundEffectsOn: state.settings.areSoundEffectsOn !== false,
    appIcon: state.settings.appIcon ?? "classic",
    areTitlesTidy: state.settings.areTitlesTidy !== false,
    showsFullUrls: state.settings.showsFullUrls === true,
    adBlock: describeAdBlock(state),
    routingRules: state.routingRules ?? [],
    extensions: (state.extensions ?? []).map((extension) => ({
      id: extension.id,
      profileId: extension.profileId,
      profileName: state.profiles.find((profile) => profile.id === extension.profileId)?.name ?? "",
      name: extension.name,
      version: extension.version,
      isEnabled: extension.isEnabled,
      source: extension.source,
      iconUrl: getExtensionIconUrl(extension),
      loadError: extension.isEnabled ? getExtensionLoadError(extension.profileId, extension.id) : null,
    })),
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
  const profileId = findProfileIdOfItem(state, tab.id) ?? DEFAULT_PROFILE_ID;
  const origin = getPermissionOrigin(tab.url);
  const permissions = origin === null ? [] : getSitePermissions(state, profileId, origin).map((answer) => ({ kind: answer.kind, isAllowed: answer.isAllowed }));
  const boost = findBoostForUrl(state, tab.url);
  const boostSummary = boost === undefined ? null : { isEnabled: boost.isEnabled, zapCount: boost.zappedSelectors.length, hasCss: boost.css.trim() !== "" };
  return {
    tabId: tab.id,
    url: tab.url,
    host: host,
    isSecure: tab.url.startsWith("https://"),
    isMuted: tab.isMuted,
    zoomPercent: Math.round(zoomFactor * 100),
    isLoaded: contents !== null,
    site: getSiteKey(tab.url),
    boost: boostSummary,
    profileId: profileId,
    origin: origin,
    permissions: permissions,
    isDeveloperMode: isDeveloperModeOn(state, tab.url),
    adBlock: state.settings.isAdBlockOn === true ? { isOnForSite: isAdBlockActiveFor(state, tab.url), blockedCount: contents === null ? 0 : getBlockedCount(contents) } : null,
    extensions: listExtensionTiles(state, profileId),
  };
}

/**
 * Opens the Boost CSS editor for the selected tab's site.
 */
export function openBoostEditor(requestedSite?: string): void {
  const state = getState();
  const site = requestedSite ?? buildSiteInfo(state)?.site ?? null;
  if (site === null) {
    return;
  }
  const boost = (state.boosts ?? []).find((candidate) => candidate.site === site);
  openPanel({
    kind: "boost",
    site: site,
    css: boost?.css ?? "",
    hueShift: boost?.hueShift ?? 0,
    isInverted: boost?.isInverted ?? false,
    fontId: boost?.fontId ?? "",
    javascript: boost?.javascript ?? "",
    isJavaScriptOn: boost?.isJavaScriptOn ?? false,
    zapCount: boost?.zappedSelectors.length ?? 0,
  });
}

/**
 * Starts Zap mode on the selected tab: the panel closes, and each click in the page hides that element.
 */
function startZapping(site: string, tabId: string): void {
  closeOverlay();
  zapElements(tabId, (selector) => {
    applyChange((state) => addZappedSelector(state, site, selector, Date.now()));
    reapplyBoostsToAllPages(getState());
  });
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
  const replacedPanel = shownPanel;
  shownPanel = panel;
  setNewTabPending(panel.kind === "commandBar" && panel.mode === "newTab");
  if (replacedPanel !== null) {
    notifyPanelEnded(replacedPanel, "replaced");
  }
  const library = panel.kind === "library" ? buildLibraryData(state) : null;
  const site = panel.kind === "siteControls" ? buildSiteInfo(state) : null;
  const takesKeyboard = panel.kind !== "preview";
  showOverlay(window, bounds, { panel: panel, isDark: isActiveSpaceDark(state), library: library, site: site }, takesKeyboard).catch((error) => {
    console.error("Could not open the overlay:", error);
  });
}

/**
 * Shows a permission prompt (permissionPrompts.ts decides when).
 */
export function openPermissionPrompt(requestId: string, host: string, kinds: SitePermissionKind[], appName: string | null): void {
  openPanel({ kind: "permission", requestId: requestId, host: host, kinds: kinds, appName: appName });
}

/**
 * Closes the overlay when it shows the given permission prompt.
 */
export function closePermissionPrompt(requestId: string): void {
  if (shownPanel?.kind === "permission" && shownPanel.requestId === requestId) {
    closeOverlay();
  }
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

/**
 * The first-start tour (overlay/welcome.ts), with the browsers this Mac has to import from.
 */
export function openWelcome(): void {
  const state = getState();
  const presets = THEME_PRESETS.map((preset) => ({ label: preset.label, colors: preset.colors, appearance: preset.appearance }));
  openPanel({ kind: "welcome", spaceId: state.activeSpaceId, importSources: listImportSources(), presets: presets });
}

export function openLibrary(section: LibrarySection = "archive"): void {
  openPanel({ kind: "library", section: section });
}

/**
 * Opens the theme editor for a Space, next to the sidebar so the change shows while you edit.
 */
export function openThemeEditor(spaceId: string): void {
  const state = getState();
  const space = state.spaces.find((candidate) => candidate.id === spaceId);
  if (space === undefined) {
    return;
  }
  const presets = THEME_PRESETS.map((preset) => ({ label: preset.label, colors: preset.colors, appearance: preset.appearance }));
  const sidebarWidth = getLayoutOptions().sidebarWidth ?? SIDEBAR_WIDTH_PX;
  openPanel({ kind: "theme", spaceId: space.id, spaceName: space.name, spaceIcon: space.icon, theme: space.theme, sidebarWidth: sidebarWidth, presets: presets });
}

/** The tab preview card: its size, and its distance from the sidebar's row. Our choice. */
const PREVIEW_WIDTH_PX = 290;
const PREVIEW_HEIGHT_PX = 250;
const PREVIEW_GAP_PX = 10;

/**
 * Shows the preview card of a tab next to its row in the sidebar, when we have a picture of the page and no other
 * panel is open. The card does not take the keyboard.
 */
export function showTabPreview(tabId: string, anchor: OverlayRect): void {
  const window = getWindow();
  const tab = findTab(getState(), tabId);
  const snapshotUrl = getSnapshot(tabId);
  const isOtherPanelOpen = shownPanel !== null && shownPanel.kind !== "preview";
  if (window === null || tab === undefined || snapshotUrl === null || isOtherPanelOpen) {
    return;
  }
  const contentHeight = window.getContentSize()[1] ?? 0;
  const centeredTop = anchor.y + anchor.height / 2 - PREVIEW_HEIGHT_PX / 2;
  const top = Math.max(PREVIEW_GAP_PX, Math.min(centeredTop, contentHeight - PREVIEW_HEIGHT_PX - PREVIEW_GAP_PX));
  const frame = { x: anchor.x + anchor.width + PREVIEW_GAP_PX, y: Math.round(top), width: PREVIEW_WIDTH_PX, height: PREVIEW_HEIGHT_PX };
  openPanel({ kind: "preview", frame: frame, tabId: tab.id, title: tab.customTitle ?? tab.title, url: tab.url, faviconUrl: tab.faviconUrl, snapshotUrl: snapshotUrl });
}

/**
 * Hides the tab preview card (nothing else).
 */
export function hideTabPreview(): void {
  if (shownPanel?.kind === "preview") {
    closeOverlay();
  }
}

/** Most tabs the recent-tab switcher shows. Our choice: a row that fits a laptop screen. */
const SWITCHER_TABS_LIMIT = 8;

/** How long we listen for ⌃ being let go on the page before the switcher's own page takes over. Our choice. */
const CONTROL_RELEASE_WATCH_MS = 3000;

/**
 * Notices ⌃ being let go while the page still has the keyboard (in the moment before the switcher's page gets it),
 * so a quick ⌃Tab tap still switches.
 */
function watchControlRelease(contents: WebContents | null): void {
  if (contents === null) {
    return;
  }
  const listener = (_event: Electron.Event, input: Electron.Input): void => {
    if (input.type !== "keyUp" || input.key !== "Control") {
      return;
    }
    contents.off("before-input-event", listener);
    if (shownPanel?.kind === "switcher") {
      sendToOverlay(OVERLAY_CHANNELS.switcherCommit);
    }
  };
  contents.on("before-input-event", listener);
  setTimeout(() => {
    if (!contents.isDestroyed()) {
      contents.off("before-input-event", listener);
    }
  }, CONTROL_RELEASE_WATCH_MS);
}

/**
 * ⌃Tab: the recent-tab switcher, most recently used first. While it is open, each ⌃Tab moves one card on; letting go
 * of ⌃ switches to the highlighted tab (the switcher's page and watchControlRelease() notice that).
 */
export function openTabSwitcher(step: number): void {
  if (shownPanel?.kind === "switcher") {
    sendToOverlay(OVERLAY_CHANNELS.switcherStep, step);
    return;
  }
  const state = getState();
  const selectedTabId = getSelectedTabId(state);
  const recentIds = getRecentTabIds().filter((tabId) => tabId !== selectedTabId);
  const orderedIds = selectedTabId === null ? recentIds : [selectedTabId, ...recentIds];
  const tabs: SwitcherTab[] = [];
  for (const tabId of orderedIds) {
    const tab = findTab(state, tabId);
    if (tab === undefined || tabs.length >= SWITCHER_TABS_LIMIT) {
      continue;
    }
    tabs.push({ tabId: tab.id, title: tab.customTitle ?? tab.title, url: tab.url, faviconUrl: tab.faviconUrl, snapshotUrl: getSnapshot(tab.id) });
  }
  if (tabs.length < 2) {
    return;
  }
  watchControlRelease(getFocusedContents());
  openPanel({ kind: "switcher", tabs: tabs, index: step > 0 ? 1 : tabs.length - 1 });
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
  const closedPanel = shownPanel;
  shownPanel = null;
  setNewTabPending(false);
  hideOverlay(window);
  if (closedPanel !== null) {
    notifyPanelEnded(closedPanel, "closed");
  }
  // A preview never had the keyboard, so there is nothing to give back.
  if (closedPanel?.kind === "preview") {
    return;
  }
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
  // The Control Center shows settings that actions change (a Boost turned off, a permission forgotten).
  if (shownPanel?.kind === "siteControls" && buildSiteInfo(getState()) !== null) {
    openPanel({ kind: "siteControls" });
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
 * Takes a picture of the visible page (or a part of it), copies it and keeps it in the Library's Media, like Arc's
 * screenshot and capture.
 */
async function capturePage(contents: WebContents, region?: Rectangle): Promise<void> {
  const source = await describeCaptureSource(contents, region);
  const image = await contents.capturePage(region);
  await copyPngToClipboard(image.toPNG());
  saveCapture(image, contents.getTitle(), contents.getURL(), Date.now(), source);
  refreshOpenPanel();
  if (getState().settings.areSoundEffectsOn !== false) {
    sendSidebarCommand({ kind: "playSound", sound: "capture" });
  }
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
  if (command === "share") {
    closeOverlay();
    // macOS's own share menu (Messages, Mail, AirDrop, Notes, …) at the pointer, like Arc's Share button.
    new ShareMenu({ urls: [site.url] }).popup();
    return;
  }
  if (command === "addExtension") {
    closeOverlay();
    openLinkInNewTab(CHROME_WEB_STORE_URL, "foreground");
    return;
  }
  if (command === "capture") {
    const pageBounds = getTabViews().get(site.tabId)?.getBounds();
    if (pageBounds !== undefined && contents !== null) {
      openPanel({ kind: "capture", frame: pageBounds });
    }
    return;
  }
  if (command === "zap" && site.site !== null && contents !== null) {
    startZapping(site.site, site.tabId);
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
    capturePage(contents).catch((error) => console.error("Screenshot failed:", error));
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
 * Runs a site-controls command without the panel (the Command Bar's "Zap Elements").
 */
export function runSiteCommand(command: SiteCommand): void {
  handleSiteCommand(command);
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

const SITE_COMMANDS: SiteCommand[] = [
  "copyLink",
  "share",
  "screenshot",
  "capture",
  "toggleMute",
  "devTools",
  "zoomIn",
  "zoomOut",
  "zoomReset",
  "clearSiteData",
  "reload",
  "zap",
  "addExtension",
];

/** What the Library's Media buttons may ask for. */
const MEDIA_COMMANDS: CaptureCommand[] = ["copy", "reveal", "save", "delete"];

/** Pictures the Library's Media lists (their thumbnails travel with the message). Our choice. */
const LIBRARY_MEDIA_LIMIT = 120;

/** Where the Control Center's "+" tile goes to find extensions. */
const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/";

/** A capture smaller than this (either side, in points) counts as a click, not a selection. */
const MIN_CAPTURE_SIZE_PX = 4;

/**
 * True for a rectangle of finite numbers with a positive size.
 */
function isOverlayRect(value: unknown): value is OverlayRect {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rect = value as Record<string, unknown>;
  const numbers = [rect.x, rect.y, rect.width, rect.height];
  return numbers.every((number) => typeof number === "number" && Number.isFinite(number)) && (rect.width as number) >= 0 && (rect.height as number) >= 0;
}

/**
 * Rounds a rectangle to whole points (menus and captures want integers).
 */
function roundRect(rect: OverlayRect): Rectangle {
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
}

/**
 * Capture: the user dragged out a part of the page. Copies it and saves it like a screenshot.
 */
function handleCaptureRegion(region: OverlayRect | null): void {
  const panel = shownPanel;
  closeOverlay();
  const site = buildSiteInfo(getState());
  const contents = site === null ? null : getTabContents(site.tabId);
  if (region === null || panel?.kind !== "capture" || site === null || contents === null) {
    return;
  }
  // The region is in window points; the page starts at the frame's corner.
  const left = Math.max(region.x - panel.frame.x, 0);
  const top = Math.max(region.y - panel.frame.y, 0);
  const right = Math.min(region.x + region.width - panel.frame.x, panel.frame.width);
  const bottom = Math.min(region.y + region.height - panel.frame.y, panel.frame.height);
  if (right - left < MIN_CAPTURE_SIZE_PX || bottom - top < MIN_CAPTURE_SIZE_PX) {
    return;
  }
  const pageRegion = roundRect({ x: left, y: top, width: right - left, height: bottom - top });
  capturePage(contents, pageRegion).catch((error) => console.error("Capture failed:", error));
}

/**
 * Translates the selected page (pageCommands.ts), closing the Control Center first.
 */
function handleTranslate(): void {
  closeOverlay();
  const contents = getFocusedContents();
  if (contents !== null) {
    translatePage(contents);
  }
}

/**
 * The Control Center's "…" button: the less used page commands, as a native menu under the button.
 */
function showSiteMenu(anchor: OverlayRect): void {
  const window = getWindow();
  const site = buildSiteInfo(getState());
  if (window === null || site === null) {
    return;
  }
  const template: MenuItemConstructorOptions[] = [
    { label: "Copy Link", click: () => handleSiteCommand("copyLink") },
    { label: "Reload", enabled: site.isLoaded, click: () => handleSiteCommand("reload") },
    { label: "Clear Site Data and Reload", enabled: site.isLoaded, click: () => handleSiteCommand("clearSiteData") },
    { type: "separator" },
    { label: "Zoom In", enabled: site.isLoaded, click: () => handleSiteCommand("zoomIn") },
    { label: "Zoom Out", enabled: site.isLoaded, click: () => handleSiteCommand("zoomOut") },
    { label: `Actual Size (now ${site.zoomPercent}%)`, enabled: site.isLoaded && site.zoomPercent !== 100, click: () => handleSiteCommand("zoomReset") },
    { type: "separator" },
    { label: "Zap Elements", enabled: site.isLoaded && site.site !== null, click: () => handleSiteCommand("zap") },
    { label: "Edit Boost…", enabled: site.site !== null, click: () => openBoostEditor() },
    { type: "separator" },
    { label: "Translate Page (Google Translate)", enabled: site.isLoaded, click: () => handleTranslate() },
    { type: "separator" },
    { label: "Developer Tools", enabled: site.isLoaded, click: () => handleSiteCommand("devTools") },
  ];
  const position = roundRect(anchor);
  Menu.buildFromTemplate(addMenuIcons(template)).popup({ window: window, x: position.x, y: position.y + position.height });
}

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
  ipcMain.handle(OVERLAY_CHANNELS.mediaCommand, (event, mediaId: unknown, command: unknown) => {
    if (!isFromOverlay(event) || !isShortText(mediaId) || !MEDIA_COMMANDS.includes(command as CaptureCommand)) {
      return;
    }
    const isListChanged = runCaptureCommand(mediaId, command as CaptureCommand, app.getPath("downloads"));
    if (isListChanged) {
      refreshOpenPanel();
    }
  });
  ipcMain.handle(OVERLAY_CHANNELS.chooseTab, (event, tabId: unknown) => {
    if (!isFromOverlay(event) || !isShortText(tabId) || findTab(getState(), tabId) === undefined) {
      return;
    }
    closeOverlay();
    applyChange((state) => selectTab(state, tabId, Date.now()));
  });
  ipcMain.handle(OVERLAY_CHANNELS.captureRegion, (event, region: unknown) => {
    if (isFromOverlay(event) && (region === null || isOverlayRect(region))) {
      handleCaptureRegion(region);
    }
  });
  ipcMain.handle(OVERLAY_CHANNELS.activateExtension, (event, extensionId: unknown, anchor: unknown) => {
    if (isFromOverlay(event) && isShortText(extensionId) && isOverlayRect(anchor)) {
      closeOverlay();
      activateExtensionOfActiveProfile(extensionId, roundRect(anchor));
    }
  });
  ipcMain.handle(OVERLAY_CHANNELS.showSiteMenu, (event, anchor: unknown) => {
    if (isFromOverlay(event) && isOverlayRect(anchor)) {
      showSiteMenu(anchor);
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
