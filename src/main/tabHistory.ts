/**
 * WHY this file exists:
 *   After a restart, and above all after a crash, each tab's page should come back where it was: scrolled to the same
 *   place, with its back/forward list. Chromium keeps that in each navigation entry (its page state, the same thing
 *   a sleeping tab wakes with: tabViews.ts). Bow saves those lists every few seconds (tabHistoryStore.ts), so a
 *   crash loses at most that much. This file decides what is kept and checks what is read back.
 *
 * Data source:
 *   Loaded tabs' navigation entries (url, title, Chromium's page state), and the file an earlier run wrote.
 *
 * Data flow:
 *   tabViews.ts collectTabHistories() → trimHistory() → tabHistoryStore.ts → tab-history.json
 *   start → checkSavedHistories() → tabViews.ts setRestoredHistories() → the tab's first view restores it
 *
 * Rules: pure.
 */

/** A navigation entry as kept on disk (Electron's NavigationEntry, page state included). */
export interface SavedEntry {
  url: string;
  title: string;
  pageState?: string;
}

/** A tab's back/forward list and which entry is on screen. */
export interface SavedHistory {
  entries: SavedEntry[];
  activeIndex: number;
}

/** Entries kept before and after the one on screen. Our choice: enough to go back a while, a small file. */
const ENTRIES_BEFORE = 10;
const ENTRIES_AFTER = 5;

/** Largest page state kept for one entry. Our choice: scroll and form values are far smaller; huge ones are left. */
const MAX_PAGE_STATE_LENGTH = 128 * 1024;

/** Longest address or title kept. Our choice. */
const MAX_TEXT_LENGTH = 8192;

/** Most tabs read back from a file. Our choice: well above a busy setup. */
const MAX_TABS = 2000;

/**
 * An entry as kept: its address and title (cut), and its page state when it is not too large.
 */
function keepEntry(entry: { url: string; title: string; pageState?: string }): SavedEntry {
  const kept: SavedEntry = { url: entry.url.slice(0, MAX_TEXT_LENGTH), title: entry.title.slice(0, MAX_TEXT_LENGTH) };
  if (entry.pageState !== undefined && entry.pageState.length <= MAX_PAGE_STATE_LENGTH) {
    kept.pageState = entry.pageState;
  }
  return kept;
}

/**
 * A history cut to the entries around the one on screen, for saving. Null when it has no entry on screen.
 * Example: 30 entries, on screen the 25th → entries 15 to 30, on screen the 11th of those
 */
export function trimHistory(entries: { url: string; title: string; pageState?: string }[], activeIndex: number): SavedHistory | null {
  if (activeIndex < 0 || activeIndex >= entries.length) {
    return null;
  }
  const first = Math.max(0, activeIndex - ENTRIES_BEFORE);
  const last = Math.min(entries.length, activeIndex + ENTRIES_AFTER + 1);
  const kept = entries.slice(first, last).map((entry) => keepEntry(entry));
  return { entries: kept, activeIndex: activeIndex - first };
}

/**
 * The histories read from a file: whole, well-formed ones only, on web addresses, at most MAX_TABS.
 */
export function checkSavedHistories(raw: unknown): Map<string, SavedHistory> {
  const histories = new Map<string, SavedHistory>();
  const record = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  for (const [tabId, value] of Object.entries(record).slice(0, MAX_TABS)) {
    const history = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const entries = Array.isArray(history.entries) ? history.entries : [];
    const isEntryList = entries.length > 0 && entries.every((entry) => isSavedEntry(entry));
    const activeIndex = history.activeIndex;
    const isIndex = typeof activeIndex === "number" && Number.isInteger(activeIndex) && activeIndex >= 0 && activeIndex < entries.length;
    if (isEntryList && isIndex) {
      histories.set(tabId, trimHistory(entries as SavedEntry[], activeIndex as number) as SavedHistory);
    }
  }
  return histories;
}

/**
 * Whether a value is an entry Bow could have written: a web address, a title, an optional page state.
 */
function isSavedEntry(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  const isWebAddress = typeof entry.url === "string" && /^https?:\/\//i.test(entry.url);
  const isPageState = entry.pageState === undefined || typeof entry.pageState === "string";
  return isWebAddress && typeof entry.title === "string" && isPageState;
}
