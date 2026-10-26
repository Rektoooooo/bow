/**
 * WHY this file exists:
 *   The Command Bar suggests pages you visited before, and the Library lists them. That needs a browsing history:
 *   one entry per address with its title, how often and when it was last visited. These pure functions keep it.
 *
 * Data source:
 *   Page navigations reported by tabViews.ts (address and title), and the clock passed in as `now`.
 *
 * Data flow:
 *   page navigates → main.ts recordVisit() → historyStore.ts saves history.json (debounced)
 *   Command Bar query → commandBar.ts reads the entries
 */

/** One visited address. */
export interface HistoryEntry {
  url: string;
  title: string;
  visitCount: number;
  /** Milliseconds since 1970. */
  lastVisitAt: number;
}

/** Most entries kept. Our choice: enough for months of browsing, small enough to search on every keystroke. */
export const HISTORY_LIMIT = 5000;

/**
 * True for addresses worth remembering: web pages only (not about:, file: or data: pages).
 */
export function isRecordableUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}

/**
 * Records a visit: the entry moves to the front with one more visit, or a new entry is added at the front.
 * The oldest entries fall off past HISTORY_LIMIT. Returns the same list for addresses that are not recorded.
 * Example: recordVisit([], "https://a.example/", "A", now) → [{ url, title: "A", visitCount: 1, lastVisitAt: now }]
 */
export function recordVisit(entries: HistoryEntry[], url: string, title: string, now: number): HistoryEntry[] {
  if (!isRecordableUrl(url)) {
    return entries;
  }
  const existingEntry = entries.find((entry) => entry.url === url);
  const otherEntries = entries.filter((entry) => entry.url !== url);
  const visitCount = existingEntry === undefined ? 1 : existingEntry.visitCount + 1;
  const displayTitle = title.trim() === "" && existingEntry !== undefined ? existingEntry.title : title;
  const visitedEntry: HistoryEntry = { url: url, title: displayTitle, visitCount: visitCount, lastVisitAt: now };
  return [visitedEntry, ...otherEntries].slice(0, HISTORY_LIMIT);
}

/**
 * Updates the title of an address after the page reports it (titles often arrive after the navigation).
 * Returns the same list when nothing changed.
 */
export function updateHistoryTitle(entries: HistoryEntry[], url: string, title: string): HistoryEntry[] {
  const trimmedTitle = title.trim();
  const entryIndex = entries.findIndex((entry) => entry.url === url);
  const entry = entries[entryIndex];
  if (entry === undefined || trimmedTitle === "" || entry.title === trimmedTitle) {
    return entries;
  }
  const updatedEntries = [...entries];
  updatedEntries[entryIndex] = { ...entry, title: trimmedTitle };
  return updatedEntries;
}

/**
 * Returns the entries whose title or address contains every word of the query, newest first.
 * An empty query returns the newest entries.
 */
export function searchHistory(entries: HistoryEntry[], query: string, limit: number): HistoryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  const matches: HistoryEntry[] = [];
  for (const entry of entries) {
    const searchableText = `${entry.title} ${entry.url}`.toLowerCase();
    const matchesAllWords = words.every((word) => searchableText.includes(word));
    if (matchesAllWords) {
      matches.push(entry);
    }
    if (matches.length >= limit) {
      break;
    }
  }
  return matches;
}
