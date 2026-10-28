/**
 * WHY this file exists:
 *   The Command Bar (⌘T, ⌘L) turns a few typed letters into the right destination: an open tab to switch to, a page
 *   from history, a search, an address, or a browser action. Arc ranks these with per-feature match scores plus
 *   boosts (docs/research/arc-findings.md §3, "Command Bar"); this is our own, simpler version of that idea.
 *
 * Data source:
 *   The typed query, the BrowserState (open tabs, Favorites), browsing history, search suggestions, the action list,
 *   the current page's address and the recently used tabs.
 *
 * Data flow:
 *   overlay sends a query → main.ts → rankCommandBarResults() → up to RESULTS_LIMIT results → overlay shows them
 *
 * Scoring (higher wins):
 *   text match: exact 100, prefix 80, a word starts with the query 60, contains 40, contains every word 30
 *   address match: exact host 100, host prefix 90, address contains 40
 *   boosts: open tab +15, Favorite +10, recently used tab up to +10, history visits up to +10, recent visit up to +10
 *   penalty: the page you are on −50 (Arc also ranks the current page down)
 *   what you typed: an address scores 75, a search 70, so only strong matches (prefix or better) beat it
 */
import type { CommandBarResultKind } from "../shared/overlay";
import { DAY_MS } from "../shared/settings";
import type { BrowserState, ItemId, TabItem } from "../shared/types";
import type { HistoryEntry } from "./history";
import { looksLikeWebAddress, normalizeTypedInput } from "./urls";
import { buildSearchUrl, findSearchEngine } from "../shared/searchEngines";
import { matchSearchKeyword } from "../shared/searchKeywords";
import { describeSpaceIconAsText } from "../shared/spaceIcons";
import { findSpaceIdOfItem } from "./tree";

/** One line in the Command Bar. */
export interface CommandBarResult {
  /** Stable id; the overlay sends it back when the user picks the line. */
  id: string;
  kind: CommandBarResultKind;
  title: string;
  subtitle: string;
  /** Where navigate / search / history results go. */
  url: string | null;
  /** The tab a "tab" result switches to. */
  tabId: ItemId | null;
  /** The action an "action" result runs. */
  actionId: string | null;
  faviconUrl: string | null;
}

/** A browser action the Command Bar can run, such as "New Space". */
export interface CommandBarAction {
  id: string;
  title: string;
  /** Extra words that should find it, such as "sidebar" for "Toggle Sidebar". */
  keywords: string[];
}

/** Everything one ranking needs. */
export interface CommandBarInput {
  query: string;
  state: BrowserState;
  history: HistoryEntry[];
  suggestions: string[];
  actions: CommandBarAction[];
  currentUrl: string | null;
  recentTabIds: ItemId[];
}

/** Most lines shown. Arc shows about this many before scrolling. */
export const RESULTS_LIMIT = 8;

/** Most tabs tab search (⇧⌘A) lists; the list scrolls. Our choice. */
export const TAB_SEARCH_LIMIT = 100;

/** Open tabs listed when nothing is typed yet. The user's Arc lists five lines (shot 3). */
const EMPTY_QUERY_TAB_COUNT = 5;

const OPEN_TAB_BOOST = 15;
const FAVORITE_BOOST = 10;
const RECENT_TAB_MAX_BOOST = 10;
const VISIT_COUNT_MAX_BOOST = 10;
const RECENT_VISIT_BOOST_DAY = 10;
const RECENT_VISIT_BOOST_WEEK = 5;
const CURRENT_PAGE_PENALTY = 50;
const TYPED_ADDRESS_SCORE = 75;
const TYPED_SEARCH_SCORE = 70;
const SUGGESTION_BASE_SCORE = 25;
const ACTION_BOOST = 5;
const WEEK_MS = 7 * DAY_MS;

/** A result with its score, before sorting. */
interface ScoredResult {
  result: CommandBarResult;
  score: number;
  /** Results with the same key are duplicates; the best-scoring one stays. */
  dedupeKey: string;
}

/**
 * Scores how well a text matches the query (both compared in lower case).
 * Example: scoreTextMatch("GitHub Pull Requests", "pull") → 60 (a word starts with "pull")
 */
export function scoreTextMatch(text: string, query: string): number {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  if (lowerQuery === "") {
    return 0;
  }
  if (lowerText === lowerQuery) {
    return 100;
  }
  if (lowerText.startsWith(lowerQuery)) {
    return 80;
  }
  const words = lowerText.split(/[\s\-_/.|·—:]+/);
  if (words.some((word) => word.startsWith(lowerQuery))) {
    return 60;
  }
  if (lowerText.includes(lowerQuery)) {
    return 40;
  }
  const queryWords = lowerQuery.split(/\s+/).filter((word) => word !== "");
  const containsEveryWord = queryWords.length > 1 && queryWords.every((word) => lowerText.includes(word));
  return containsEveryWord ? 30 : 0;
}

/**
 * Returns an address without its scheme and "www.", for matching what people type.
 * Example: "https://www.github.com/x" → "github.com/x"
 */
function stripAddress(url: string): string {
  const withoutScheme = url.replace(/^[a-z]+:\/\//i, "");
  return withoutScheme.replace(/^www\./i, "");
}

/**
 * Scores how well an address matches the query: its host first, then anywhere in it.
 * Example: scoreAddressMatch("https://github.com/x", "git") → 90
 */
export function scoreAddressMatch(url: string, query: string): number {
  const lowerQuery = query.toLowerCase().trim();
  if (lowerQuery === "") {
    return 0;
  }
  const stripped = stripAddress(url).toLowerCase();
  const host = stripped.split("/")[0] ?? "";
  if (host === lowerQuery) {
    return 100;
  }
  if (host.startsWith(lowerQuery)) {
    return 90;
  }
  return stripped.includes(lowerQuery) ? 40 : 0;
}

/**
 * The key under which two results count as the same destination: the address without scheme, "www." and a
 * trailing slash.
 */
export function toDedupeKey(url: string): string {
  const stripped = stripAddress(url).toLowerCase();
  return stripped.endsWith("/") ? stripped.slice(0, -1) : stripped;
}

/**
 * Returns the host shown under a result.
 */
function getHost(url: string): string {
  const stripped = stripAddress(url);
  return stripped.split("/")[0] ?? stripped;
}

/**
 * Lists every tab in the state with whether it is a Favorite.
 */
function listAllTabs(state: BrowserState): { tab: TabItem; isFavorite: boolean }[] {
  const favoriteIds = new Set(state.profiles.flatMap((profile) => profile.favoriteIds));
  const tabs: { tab: TabItem; isFavorite: boolean }[] = [];
  for (const item of Object.values(state.items)) {
    if (item.kind === "tab") {
      tabs.push({ tab: item, isFavorite: favoriteIds.has(item.id) });
    }
  }
  return tabs;
}

/**
 * Builds the "Switch to Tab" result for a tab.
 */
function createTabResult(tab: TabItem): CommandBarResult {
  return {
    id: `tab:${tab.id}`,
    kind: "tab",
    title: tab.customTitle ?? tab.title,
    subtitle: getHost(tab.url),
    url: tab.url,
    tabId: tab.id,
    actionId: null,
    faviconUrl: tab.faviconUrl,
  };
}

/** What tab search (⇧⌘A) ranks: the query, the tabs, and the tabs on screen in another window. */
export interface TabSearchInput {
  query: string;
  state: BrowserState;
  tabIdsInOtherWindows: ItemId[];
}

/**
 * Where a tab lives, for tab search: its Space ("🏠 Home"), or Favorites, and whether another window shows it.
 */
function describeTabPlace(input: TabSearchInput, tabId: ItemId): string {
  const spaceId = findSpaceIdOfItem(input.state, tabId);
  const space = input.state.spaces.find((candidate) => candidate.id === spaceId);
  const place = space === undefined ? "Favorites" : `${describeSpaceIconAsText(space.icon)} ${space.name}`;
  return input.tabIdsInOtherWindows.includes(tabId) ? `${place} · open in another window` : place;
}

/**
 * Tab search (⇧⌘A): every tab in every Space, matching tabs first and the most recently used first, each with where
 * it lives. Nothing typed lists them all.
 * Example: query "mail" → [{ title: "Inbox", subtitle: "💼 Work" }, …]
 */
export function rankTabSearchResults(input: TabSearchInput): CommandBarResult[] {
  const query = input.query.trim();
  const ranked: { result: CommandBarResult; score: number; lastActiveAt: number }[] = [];
  for (const { tab } of listAllTabs(input.state)) {
    const name = tab.customTitle ?? tab.title;
    const matchScore = query === "" ? 0 : Math.max(scoreTextMatch(name, query), scoreAddressMatch(tab.url, query));
    if (query !== "" && matchScore === 0) {
      continue;
    }
    const result: CommandBarResult = { ...createTabResult(tab), subtitle: describeTabPlace(input, tab.id) };
    ranked.push({ result: result, score: matchScore, lastActiveAt: tab.lastActiveAt });
  }
  ranked.sort((first, second) => (second.score !== first.score ? second.score - first.score : second.lastActiveAt - first.lastActiveAt));
  return ranked.slice(0, TAB_SEARCH_LIMIT).map((entry) => entry.result);
}

/**
 * Scores the open tabs against the query.
 */
function scoreTabs(input: CommandBarInput): ScoredResult[] {
  const scored: ScoredResult[] = [];
  for (const { tab, isFavorite } of listAllTabs(input.state)) {
    const name = tab.customTitle ?? tab.title;
    const matchScore = Math.max(scoreTextMatch(name, input.query), scoreAddressMatch(tab.url, input.query));
    if (matchScore === 0) {
      continue;
    }
    const recentIndex = input.recentTabIds.indexOf(tab.id);
    const recencyBoost = recentIndex === -1 ? 0 : Math.max(RECENT_TAB_MAX_BOOST - recentIndex, 0);
    const favoriteBoost = isFavorite ? FAVORITE_BOOST : 0;
    const currentPenalty = tab.url === input.currentUrl ? CURRENT_PAGE_PENALTY : 0;
    const score = matchScore + OPEN_TAB_BOOST + favoriteBoost + recencyBoost - currentPenalty;
    scored.push({ result: createTabResult(tab), score: score, dedupeKey: toDedupeKey(tab.url) });
  }
  return scored;
}

/**
 * Scores history entries against the query.
 */
function scoreHistory(input: CommandBarInput, now: number): ScoredResult[] {
  const scored: ScoredResult[] = [];
  for (const entry of input.history) {
    const matchScore = Math.max(scoreTextMatch(entry.title, input.query), scoreAddressMatch(entry.url, input.query));
    if (matchScore === 0) {
      continue;
    }
    const visitBoost = Math.min(entry.visitCount, VISIT_COUNT_MAX_BOOST);
    const age = now - entry.lastVisitAt;
    const recencyBoost = age < DAY_MS ? RECENT_VISIT_BOOST_DAY : age < WEEK_MS ? RECENT_VISIT_BOOST_WEEK : 0;
    const currentPenalty = entry.url === input.currentUrl ? CURRENT_PAGE_PENALTY : 0;
    const result: CommandBarResult = {
      id: `history:${entry.url}`,
      kind: "history",
      title: entry.title === "" ? entry.url : entry.title,
      subtitle: getHost(entry.url),
      url: entry.url,
      tabId: null,
      actionId: null,
      faviconUrl: null,
    };
    scored.push({ result: result, score: matchScore + visitBoost + recencyBoost - currentPenalty, dedupeKey: toDedupeKey(entry.url) });
  }
  return scored;
}

/**
 * Scores the browser actions against the query (title and keywords).
 */
function scoreActions(input: CommandBarInput): ScoredResult[] {
  const scored: ScoredResult[] = [];
  for (const action of input.actions) {
    const keywordScores = action.keywords.map((keyword) => scoreTextMatch(keyword, input.query));
    const matchScore = Math.max(scoreTextMatch(action.title, input.query), ...keywordScores);
    if (matchScore === 0) {
      continue;
    }
    const result: CommandBarResult = {
      id: `action:${action.id}`,
      kind: "action",
      title: action.title,
      subtitle: "Action",
      url: null,
      tabId: null,
      actionId: action.id,
      faviconUrl: null,
    };
    scored.push({ result: result, score: matchScore + ACTION_BOOST, dedupeKey: `action:${action.id}` });
  }
  return scored;
}

/**
 * Builds the "what you typed" result (open the address, or search for the words) and the search suggestions.
 */
function scoreTypedAndSuggestions(input: CommandBarInput): ScoredResult[] {
  const query = input.query.trim();
  const scored: ScoredResult[] = [];
  const searchEngine = findSearchEngine(input.state.settings.searchEngine);
  const keywordMatch = matchSearchKeyword(query, input.state.searchKeywords ?? []);
  const typedUrl = normalizeTypedInput(query, searchEngine, input.state.searchKeywords);
  const isAddress = keywordMatch === null && looksLikeWebAddress(query);
  const searchName = keywordMatch === null ? searchEngine.name : keywordMatch.keyword.name;
  scored.push({
    result: {
      id: `typed:${typedUrl}`,
      kind: isAddress ? "navigate" : "search",
      title: query,
      subtitle: isAddress ? "Open address" : `Search ${searchName}`,
      url: typedUrl,
      tabId: null,
      actionId: null,
      faviconUrl: null,
    },
    score: isAddress ? TYPED_ADDRESS_SCORE : TYPED_SEARCH_SCORE,
    dedupeKey: isAddress ? toDedupeKey(typedUrl) : `search:${query.toLowerCase()}`,
  });

  input.suggestions.forEach((suggestion, index) => {
    const suggestionUrl = buildSearchUrl(searchEngine, suggestion);
    scored.push({
      result: { id: `search:${suggestion}`, kind: "search", title: suggestion, subtitle: "Search suggestion", url: suggestionUrl, tabId: null, actionId: null, faviconUrl: null },
      score: SUGGESTION_BASE_SCORE - index,
      dedupeKey: `search:${suggestion.toLowerCase()}`,
    });
  });
  return scored;
}

/**
 * Keeps the best-scoring result per destination. An open tab wins a tie against history, because switching to a
 * tab you have is better than opening the page again.
 */
function removeDuplicates(scored: ScoredResult[]): ScoredResult[] {
  const bestByKey = new Map<string, ScoredResult>();
  for (const candidate of scored) {
    const existing = bestByKey.get(candidate.dedupeKey);
    const candidateWins =
      existing === undefined || candidate.score > existing.score || (candidate.score === existing.score && candidate.result.kind === "tab");
    if (candidateWins) {
      bestByKey.set(candidate.dedupeKey, candidate);
    }
  }
  return Array.from(bestByKey.values());
}

/**
 * The results for an empty query: the most recently used tabs, except the one on screen.
 */
function listRecentTabs(input: CommandBarInput): CommandBarResult[] {
  const tabs = listAllTabs(input.state)
    .map((entry) => entry.tab)
    .filter((tab) => tab.url !== input.currentUrl);
  tabs.sort((first, second) => second.lastActiveAt - first.lastActiveAt);
  return tabs.slice(0, EMPTY_QUERY_TAB_COUNT).map(createTabResult);
}

/**
 * Ranks everything for a query and returns the best RESULTS_LIMIT results, best first.
 * Example: query "git" with an open GitHub tab → first result "Switch to Tab: GitHub"
 */
export function rankCommandBarResults(input: CommandBarInput, now: number): CommandBarResult[] {
  if (input.query.trim() === "") {
    return listRecentTabs(input);
  }
  const allScored = [...scoreTypedAndSuggestions(input), ...scoreTabs(input), ...scoreHistory(input, now), ...scoreActions(input)];
  const uniqueScored = removeDuplicates(allScored);
  // A stable sort keeps the order above (typed first) between equal scores.
  uniqueScored.sort((first, second) => second.score - first.score);
  return uniqueScored.slice(0, RESULTS_LIMIT).map((scored) => scored.result);
}
