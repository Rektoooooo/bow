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

/** Chromium stores visit times as microseconds since 1601-01-01 UTC (Windows FILETIME epoch). */
const MICROSECONDS_PER_MILLISECOND = 1000;
/** Milliseconds between 1601-01-01 and 1970-01-01: 11644473600 seconds. */
const CHROMIUM_EPOCH_OFFSET_MILLISECONDS = 11644473600000;

/**
 * Merges imported history into the existing one: one entry per address, visit counts added up, the newest visit
 * kept together with the title of the newest entry that has one. Newest first, capped at HISTORY_LIMIT.
 * Returns the same list when there is nothing to import.
 */
export function mergeHistory(entries: HistoryEntry[], imported: HistoryEntry[]): HistoryEntry[] {
  if (imported.length === 0) {
    return entries;
  }
  const entryByUrl = new Map<string, HistoryEntry>();
  for (const entry of [...entries, ...imported]) {
    const knownEntry = entryByUrl.get(entry.url);
    if (knownEntry === undefined) {
      entryByUrl.set(entry.url, entry);
      continue;
    }
    const newerEntry = entry.lastVisitAt > knownEntry.lastVisitAt ? entry : knownEntry;
    const olderEntry = newerEntry === entry ? knownEntry : entry;
    const title = newerEntry.title.trim() === "" ? olderEntry.title : newerEntry.title;
    entryByUrl.set(entry.url, {
      url: entry.url,
      title: title,
      visitCount: knownEntry.visitCount + entry.visitCount,
      lastVisitAt: newerEntry.lastVisitAt,
    });
  }
  const mergedEntries = [...entryByUrl.values()];
  mergedEntries.sort((first, second) => second.lastVisitAt - first.lastVisitAt);
  return mergedEntries.slice(0, HISTORY_LIMIT);
}

/**
 * Turns rows of Chromium's `urls` table ({ url, title, visit_count, last_visit_time }) into history entries.
 * Rows that are not web pages or are malformed are left out.
 * Example: last_visit_time 13400000000000000 µs → 13400000000000 ms − 11644473600000 = 1755526400000 (Unix ms)
 */
export function convertChromiumHistoryRows(rows: unknown): HistoryEntry[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  const convertedEntries: HistoryEntry[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) {
      continue;
    }
    const { url, title, visit_count: visitCount, last_visit_time: lastVisitTime } = row as Record<string, unknown>;
    const hasValidFields =
      typeof url === "string" &&
      typeof visitCount === "number" &&
      Number.isFinite(visitCount) &&
      typeof lastVisitTime === "number" &&
      Number.isFinite(lastVisitTime);
    if (!hasValidFields || !isRecordableUrl(url)) {
      continue;
    }
    convertedEntries.push({
      url: url,
      title: typeof title === "string" ? title : "",
      visitCount: Math.max(1, visitCount),
      lastVisitAt: lastVisitTime / MICROSECONDS_PER_MILLISECOND - CHROMIUM_EPOCH_OFFSET_MILLISECONDS,
    });
  }
  return convertedEntries;
}
