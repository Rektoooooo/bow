/**
 * WHY this file exists:
 *   Every user action in the sidebar (open, select, pin, close, switch Space) changes the browser's data.
 *   These functions make those changes without touching Electron, so they are easy to test.
 *
 * Data source:
 *   The BrowserState passed in. Nothing is read from disk or the screen here.
 *
 * Data flow:
 *   ipc.ts receives a click → main.ts calls one function here → gets a new BrowserState back → saves and redraws
 *
 * Rules for every function in this file:
 *   - Never change the state that was passed in. Build and return a changed copy.
 *   - When nothing changes, return the same state object, so main.ts can skip saving.
 */
import { DEFAULT_ARCHIVE_AFTER_MS } from "../shared/settings";
import type { ArchiveReason, ArchivedTab, BrowserState, Space, SpaceId, Tab, TabId } from "../shared/types";

/** Counts tabs created during this run, so two tabs opened in the same millisecond still get different ids. */
let tabCounter = 0;

/**
 * Builds the state for a first launch: two Spaces ("Personal" and "Work"), no tabs, default settings.
 * Example: createInitialState().spaces.length → 2
 */
export function createInitialState(): BrowserState {
  const personalSpace: Space = { id: "space-personal", name: "Personal", icon: "🏠", color: "#e9d8d4" };
  const workSpace: Space = { id: "space-work", name: "Work", icon: "💼", color: "#d4dfe9" };

  return {
    version: 1,
    spaces: [personalSpace, workSpace],
    tabs: [],
    activeSpaceId: personalSpace.id,
    selectedTabIdBySpace: {
      [personalSpace.id]: null,
      [workSpace.id]: null,
    },
    archive: [],
    settings: { archiveAfterMs: DEFAULT_ARCHIVE_AFTER_MS },
  };
}

/**
 * Makes a new unique tab id from the current time plus a counter.
 * Example: createTabId(1793020000000) → "tab-1793020000000-1"
 */
export function createTabId(now: number): TabId {
  tabCounter = tabCounter + 1;
  return `tab-${now}-${tabCounter}`;
}

/**
 * Returns a tab by id, or undefined when it does not exist.
 */
export function findTab(state: BrowserState, tabId: TabId): Tab | undefined {
  return state.tabs.find((tab) => tab.id === tabId);
}

/**
 * Returns the id of the selected tab in the active Space, or null when that Space is empty.
 */
export function getSelectedTabId(state: BrowserState): TabId | null {
  const selectedTabId = state.selectedTabIdBySpace[state.activeSpaceId];
  if (selectedTabId === undefined) {
    return null;
  }
  return selectedTabId;
}

/**
 * Returns a copy of the tab list where one tab has some fields changed.
 * Selecting, switching Spaces and page updates all edit a single tab, so the copy rule lives here once.
 * Example: updateTab(tabs, "tab-1", { title: "Inbox" }) → same list, tab-1 now titled "Inbox"
 */
function updateTab(tabs: Tab[], tabId: TabId, changes: Partial<Tab>): Tab[] {
  const updatedTabs: Tab[] = [];
  for (const tab of tabs) {
    if (tab.id === tabId) {
      updatedTabs.push({ ...tab, ...changes });
    } else {
      updatedTabs.push(tab);
    }
  }
  return updatedTabs;
}

/**
 * Adds a new unpinned tab at the top of the active Space's today list and selects it.
 * Example: openTab(state, "https://example.com", now) → state with that tab first and selected
 */
export function openTab(state: BrowserState, url: string, now: number): BrowserState {
  const newTab: Tab = {
    id: createTabId(now),
    spaceId: state.activeSpaceId,
    url: url,
    title: url,
    isPinned: false,
    homeUrl: null,
    lastActiveAt: now,
  };

  // The first item in state.tabs is drawn at the top of its section.
  const stateWithNewTab: BrowserState = { ...state, tabs: [newTab, ...state.tabs] };
  return selectTab(stateWithNewTab, newTab.id, now);
}

/**
 * Selects a tab and makes its Space active. Both the tab you leave and the tab you open
 * get lastActiveAt = now, because leaving a tab is the last moment it was in use.
 */
export function selectTab(state: BrowserState, tabId: TabId, now: number): BrowserState {
  const tab = findTab(state, tabId);
  if (tab === undefined) {
    return state;
  }

  let tabs = state.tabs;
  const previousTabId = getSelectedTabId(state);
  if (previousTabId !== null) {
    tabs = updateTab(tabs, previousTabId, { lastActiveAt: now });
  }
  tabs = updateTab(tabs, tabId, { lastActiveAt: now });

  return {
    ...state,
    tabs: tabs,
    activeSpaceId: tab.spaceId,
    selectedTabIdBySpace: { ...state.selectedTabIdBySpace, [tab.spaceId]: tabId },
  };
}

/**
 * Pins a tab, remembers its current URL as its home URL and moves it to the bottom of the pinned list.
 * Example: pin a tab on "https://mail.example.com/inbox" → homeUrl is "https://mail.example.com/inbox"
 */
export function pinTab(state: BrowserState, tabId: TabId): BrowserState {
  const tab = findTab(state, tabId);
  if (tab === undefined || tab.isPinned) {
    return state;
  }

  const pinnedTab: Tab = { ...tab, isPinned: true, homeUrl: tab.url };
  const otherTabs = state.tabs.filter((existingTab) => existingTab.id !== tabId);
  return { ...state, tabs: [...otherTabs, pinnedTab] };
}

/**
 * Unpins a tab, clears its home URL and moves it to the top of today's tabs.
 * Its lastActiveAt is set to now, so it does not archive the moment it is unpinned.
 */
export function unpinTab(state: BrowserState, tabId: TabId, now: number): BrowserState {
  const tab = findTab(state, tabId);
  if (tab === undefined || !tab.isPinned) {
    return state;
  }

  const unpinnedTab: Tab = { ...tab, isPinned: false, homeUrl: null, lastActiveAt: now };
  const otherTabs = state.tabs.filter((existingTab) => existingTab.id !== tabId);
  return { ...state, tabs: [unpinnedTab, ...otherTabs] };
}

/**
 * Switches to another Space. The tab you leave and the tab that becomes visible both get lastActiveAt = now.
 */
export function switchSpace(state: BrowserState, spaceId: SpaceId, now: number): BrowserState {
  const spaceExists = state.spaces.some((space) => space.id === spaceId);
  if (!spaceExists || spaceId === state.activeSpaceId) {
    return state;
  }

  let tabs = state.tabs;
  const leavingTabId = getSelectedTabId(state);
  if (leavingTabId !== null) {
    tabs = updateTab(tabs, leavingTabId, { lastActiveAt: now });
  }

  const arrivingTabId = state.selectedTabIdBySpace[spaceId] ?? null;
  if (arrivingTabId !== null) {
    tabs = updateTab(tabs, arrivingTabId, { lastActiveAt: now });
  }

  return { ...state, tabs: tabs, activeSpaceId: spaceId };
}

/**
 * Records a tab's new URL and title after the page navigates. An empty title falls back to the URL.
 */
export function updateTabPage(state: BrowserState, tabId: TabId, url: string, title: string): BrowserState {
  const tab = findTab(state, tabId);
  if (tab === undefined) {
    return state;
  }

  let displayTitle = title;
  if (displayTitle.trim() === "") {
    displayTitle = url;
  }
  if (tab.url === url && tab.title === displayTitle) {
    return state;
  }

  const tabs = updateTab(state.tabs, tabId, { url: url, title: displayTitle });
  return { ...state, tabs: tabs };
}

/**
 * Returns the id of the most recently used tab in a Space, or null when the Space has no tabs.
 * Used to pick a new selection after the selected tab leaves the sidebar.
 */
function findMostRecentlyUsedTabId(tabs: Tab[], spaceId: SpaceId): TabId | null {
  let mostRecentTab: Tab | null = null;
  for (const tab of tabs) {
    if (tab.spaceId !== spaceId) {
      continue;
    }
    if (mostRecentTab === null || tab.lastActiveAt > mostRecentTab.lastActiveAt) {
      mostRecentTab = tab;
    }
  }

  if (mostRecentTab === null) {
    return null;
  }
  return mostRecentTab.id;
}

/**
 * Removes tabs from the sidebar and adds them to the top of the archive with a reason.
 * In any Space whose selected tab was removed, the most recently used remaining tab becomes selected.
 * Used by closeTab, clearTodayTabs and the auto-archive sweeper, so the rules live in one place.
 */
export function moveTabsToArchive(state: BrowserState, tabIds: TabId[], now: number, reason: ArchiveReason): BrowserState {
  if (tabIds.length === 0) {
    return state;
  }

  const idsToArchive = new Set(tabIds);
  const remainingTabs: Tab[] = [];
  const newArchiveEntries: ArchivedTab[] = [];
  for (const tab of state.tabs) {
    if (idsToArchive.has(tab.id)) {
      newArchiveEntries.push({ tab: tab, archivedAt: now, reason: reason });
    } else {
      remainingTabs.push(tab);
    }
  }

  const selectedTabIdBySpace: Record<SpaceId, TabId | null> = {};
  for (const space of state.spaces) {
    // "?? null" turns a missing entry (undefined) into null, so both mean "nothing selected".
    const selectedTabId = state.selectedTabIdBySpace[space.id] ?? null;
    const needsNewSelection = selectedTabId === null || idsToArchive.has(selectedTabId);
    if (needsNewSelection) {
      selectedTabIdBySpace[space.id] = findMostRecentlyUsedTabId(remainingTabs, space.id);
    } else {
      selectedTabIdBySpace[space.id] = selectedTabId;
    }
  }

  return {
    ...state,
    tabs: remainingTabs,
    selectedTabIdBySpace: selectedTabIdBySpace,
    archive: [...newArchiveEntries, ...state.archive],
  };
}

/**
 * Closing a tab archives it with reason "manual", so it can be found again like in Arc.
 */
export function closeTab(state: BrowserState, tabId: TabId, now: number): BrowserState {
  return moveTabsToArchive(state, [tabId], now, "manual");
}

/**
 * Archives every unpinned tab in the active Space with reason "clear-button".
 */
export function clearTodayTabs(state: BrowserState, now: number): BrowserState {
  const todayTabIds: TabId[] = [];
  for (const tab of state.tabs) {
    const isInActiveSpace = tab.spaceId === state.activeSpaceId;
    if (isInActiveSpace && !tab.isPinned) {
      todayTabIds.push(tab.id);
    }
  }
  return moveTabsToArchive(state, todayTabIds, now, "clear-button");
}

/**
 * Takes a tab out of the archive, puts it back unpinned at the top of its Space's today tabs and selects it.
 * Its lastActiveAt is set to now. If its Space no longer exists, it goes to the active Space.
 */
export function restoreArchivedTab(state: BrowserState, tabId: TabId, now: number): BrowserState {
  const archivedEntry = state.archive.find((entry) => entry.tab.id === tabId);
  if (archivedEntry === undefined) {
    return state;
  }

  let spaceId = state.activeSpaceId;
  const originalSpaceExists = state.spaces.some((space) => space.id === archivedEntry.tab.spaceId);
  if (originalSpaceExists) {
    spaceId = archivedEntry.tab.spaceId;
  }

  const restoredTab: Tab = { ...archivedEntry.tab, spaceId: spaceId, isPinned: false, homeUrl: null, lastActiveAt: now };
  const remainingArchive = state.archive.filter((entry) => entry.tab.id !== tabId);
  const stateWithRestoredTab: BrowserState = {
    ...state,
    tabs: [restoredTab, ...state.tabs],
    archive: remainingArchive,
  };
  return selectTab(stateWithRestoredTab, restoredTab.id, now);
}

/**
 * Changes the "Archive tabs after" setting. Null turns auto-archive off.
 */
export function setArchiveAfter(state: BrowserState, archiveAfterMs: number | null): BrowserState {
  if (state.settings.archiveAfterMs === archiveAfterMs) {
    return state;
  }
  return { ...state, settings: { ...state.settings, archiveAfterMs: archiveAfterMs } };
}
