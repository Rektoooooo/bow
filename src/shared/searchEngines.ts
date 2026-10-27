/**
 * WHY this file exists:
 *   Words typed into the address field or the Command Bar become a search. The user picks which engine searches
 *   (Library › Settings, the user's request 2026-10-27: "what if i wanna use google"). This file lists the engines:
 *   where each one searches, and where its search suggestions come from, so typed text only goes to the engine the
 *   user chose.
 *
 * Data source:
 *   Each engine's public search address and its suggestion service. All suggestion services here answer in the
 *   OpenSearch shape ["query", ["suggestion 1", …]] (each checked by hand, 2026-10-27).
 *
 * Data flow:
 *   BrowserState.settings.searchEngine → findSearchEngine() → urls.ts normalizeTypedInput(), the Command Bar's
 *   search lines and suggestions, the page menu's "Search for …"
 */

/** A search engine the browser can use. */
export interface SearchEngine {
  id: SearchEngineId;
  /** Shown in Settings and on the Command Bar's search line: "Search Google". */
  name: string;
  /** The search address with "%s" where the words go. */
  searchUrl: string;
  /** The suggestion service with "%s" where the typed text goes. */
  suggestUrl: string;
}

/** The engines, in the order Settings lists them. */
export const SEARCH_ENGINE_IDS = ["google", "duckduckgo", "bing", "brave", "kagi"] as const;

export type SearchEngineId = (typeof SEARCH_ENGINE_IDS)[number];

/** Our choice before there was a setting; a saved state without one keeps it. */
export const DEFAULT_SEARCH_ENGINE_ID: SearchEngineId = "duckduckgo";

export const SEARCH_ENGINES: Record<SearchEngineId, SearchEngine> = {
  google: {
    id: "google",
    name: "Google",
    searchUrl: "https://www.google.com/search?q=%s",
    suggestUrl: "https://suggestqueries.google.com/complete/search?client=firefox&q=%s",
  },
  duckduckgo: {
    id: "duckduckgo",
    name: "DuckDuckGo",
    searchUrl: "https://duckduckgo.com/?q=%s",
    suggestUrl: "https://duckduckgo.com/ac/?type=list&q=%s",
  },
  bing: {
    id: "bing",
    name: "Bing",
    searchUrl: "https://www.bing.com/search?q=%s",
    suggestUrl: "https://api.bing.com/osjson.aspx?query=%s",
  },
  brave: {
    id: "brave",
    name: "Brave Search",
    searchUrl: "https://search.brave.com/search?q=%s",
    suggestUrl: "https://search.brave.com/api/suggest?q=%s",
  },
  kagi: {
    id: "kagi",
    name: "Kagi",
    searchUrl: "https://kagi.com/search?q=%s",
    suggestUrl: "https://kagi.com/api/autosuggest?q=%s",
  },
};

/**
 * True for the id of an engine in the list (IPC checks what a page sends with this).
 */
export function isSearchEngineId(value: unknown): value is SearchEngineId {
  return typeof value === "string" && (SEARCH_ENGINE_IDS as readonly string[]).includes(value);
}

/**
 * The engine a saved setting names; the default one when it names none (or one this version does not know).
 * Example: findSearchEngine("google").name → "Google"; findSearchEngine(undefined).name → "DuckDuckGo"
 */
export function findSearchEngine(engineId: string | undefined): SearchEngine {
  const knownId = isSearchEngineId(engineId) ? engineId : DEFAULT_SEARCH_ENGINE_ID;
  return SEARCH_ENGINES[knownId];
}

/**
 * The address that searches an engine for some words.
 * Example: buildSearchUrl(Google, "best pizza") → "https://www.google.com/search?q=best%20pizza"
 */
export function buildSearchUrl(engine: SearchEngine, words: string): string {
  return engine.searchUrl.replace("%s", encodeURIComponent(words));
}

/**
 * The address that asks an engine for suggestions for typed text.
 */
export function buildSuggestUrl(engine: SearchEngine, typedText: string): string {
  return engine.suggestUrl.replace("%s", encodeURIComponent(typedText));
}
