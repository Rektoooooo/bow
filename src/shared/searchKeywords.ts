/**
 * WHY this file exists:
 *   Search keywords: the user names a search page ("yt" → YouTube's search, "w" → Wikipedia's) and typing "yt cats"
 *   in the address field or the Command Bar searches there instead of the default engine. Chrome calls them site
 *   search shortcuts; Arc has none.
 *
 * Data source:
 *   BrowserState.searchKeywords (added in Library › Settings) and what the user typed.
 *
 * Data flow:
 *   typed text → main/urls.ts normalizeTypedInput → matchSearchKeyword → the search page's address
 *   Library › Settings → isValidSearchKeyword → action addSearchKeyword (main/ipc.ts checks it again)
 *
 * Rules: pure.
 */
import type { SearchKeyword } from "./types";

/** A keyword: one short word, lowercase letters, digits, dot, dash or underscore. Our choice. */
export const SEARCH_KEYWORD_PATTERN = /^[a-z0-9._-]{1,20}$/;

/** Where the typed words go in a keyword's address. */
export const SEARCH_PLACEHOLDER = "%s";

/** Longest name and address kept. Our choice: real search addresses are far shorter. */
export const MAX_KEYWORD_NAME_LENGTH = 60;
export const MAX_KEYWORD_URL_LENGTH = 2000;

/**
 * Whether a keyword's address can be used: a web address (http or https) with %s where the words go.
 */
export function isValidKeywordUrl(url: string): boolean {
  if (url.length > MAX_KEYWORD_URL_LENGTH || !url.includes(SEARCH_PLACEHOLDER)) {
    return false;
  }
  try {
    const parsed = new URL(url.replaceAll(SEARCH_PLACEHOLDER, "test"));
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Whether a whole keyword entry can be saved.
 */
export function isValidSearchKeyword(entry: SearchKeyword): boolean {
  const name = entry.name.trim();
  const isNameValid = name !== "" && name.length <= MAX_KEYWORD_NAME_LENGTH;
  return SEARCH_KEYWORD_PATTERN.test(entry.keyword) && isNameValid && isValidKeywordUrl(entry.url);
}

/**
 * The keyword search typed text asks for: its first word is a keyword and words follow. Null otherwise. A keyword
 * whose address is not a web address is ignored, so this never gives anything but http or https.
 * Example: ("yt cats", [yt → https://www.youtube.com/results?search_query=%s]) → { …, url: "…?search_query=cats" }
 */
export function matchSearchKeyword(typedText: string, keywords: SearchKeyword[]): { keyword: SearchKeyword; url: string } | null {
  const text = typedText.trim();
  const spaceIndex = text.indexOf(" ");
  if (spaceIndex <= 0) {
    return null;
  }
  const firstWord = text.slice(0, spaceIndex).toLowerCase();
  const words = text.slice(spaceIndex + 1).trim();
  const keyword = keywords.find((candidate) => candidate.keyword === firstWord && isValidKeywordUrl(candidate.url));
  if (keyword === undefined || words === "") {
    return null;
  }
  return { keyword: keyword, url: keyword.url.replaceAll(SEARCH_PLACEHOLDER, encodeURIComponent(words)) };
}
