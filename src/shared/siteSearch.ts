/**
 * WHY this file exists:
 *   Arc's Command Bar lets you search a site directly: type "youtube", press Tab, type what you want, Enter. This file
 *   is our list of sites that can be searched that way (their public search addresses) and the rule that decides
 *   which site the typed text means.
 *
 * Data source:
 *   Each site's own public search address (what its search box opens). Our choice of sites; add more here.
 *
 * Data flow:
 *   Command Bar typing → findSiteSearch(text) → "Tab: Search YouTube" hint → Tab → site search mode
 *   → Enter → buildSiteSearchUrl(site, query) → opened like a typed address
 */

/** A site that can be searched from the Command Bar. */
export interface SiteSearch {
  id: string;
  /** Shown in the hint and the chip: "Search YouTube". */
  name: string;
  /** Words that pick this site, typed in full or from the start: the name, the host, other names. */
  keywords: string[];
  /** The search address with "%s" where the query goes. */
  searchUrl: string;
}

/** The searchable sites, most used first: when two sites match the typed text, the earlier one wins. */
export const SITE_SEARCHES: SiteSearch[] = [
  { id: "google", name: "Google", keywords: ["google", "google.com"], searchUrl: "https://www.google.com/search?q=%s" },
  { id: "youtube", name: "YouTube", keywords: ["youtube", "youtube.com", "yt"], searchUrl: "https://www.youtube.com/results?search_query=%s" },
  { id: "wikipedia", name: "Wikipedia", keywords: ["wikipedia", "wikipedia.org", "wiki"], searchUrl: "https://en.wikipedia.org/w/index.php?search=%s" },
  { id: "github", name: "GitHub", keywords: ["github", "github.com", "gh"], searchUrl: "https://github.com/search?q=%s" },
  { id: "reddit", name: "Reddit", keywords: ["reddit", "reddit.com"], searchUrl: "https://www.reddit.com/search/?q=%s" },
  { id: "x", name: "X", keywords: ["x", "x.com", "twitter"], searchUrl: "https://x.com/search?q=%s" },
  { id: "amazon", name: "Amazon", keywords: ["amazon", "amazon.com"], searchUrl: "https://www.amazon.com/s?k=%s" },
  { id: "maps", name: "Google Maps", keywords: ["maps", "googlemaps"], searchUrl: "https://www.google.com/maps/search/%s" },
  { id: "duckduckgo", name: "DuckDuckGo", keywords: ["duckduckgo", "duckduckgo.com", "ddg"], searchUrl: "https://duckduckgo.com/?q=%s" },
  { id: "claude", name: "Claude", keywords: ["claude", "claude.ai"], searchUrl: "https://claude.ai/new?q=%s" },
  { id: "chatgpt", name: "ChatGPT", keywords: ["chatgpt", "chatgpt.com"], searchUrl: "https://chatgpt.com/?q=%s" },
  { id: "perplexity", name: "Perplexity", keywords: ["perplexity", "perplexity.ai"], searchUrl: "https://www.perplexity.ai/search?q=%s" },
  { id: "stackoverflow", name: "Stack Overflow", keywords: ["stackoverflow", "stackoverflow.com"], searchUrl: "https://stackoverflow.com/search?q=%s" },
  { id: "mdn", name: "MDN", keywords: ["mdn", "developer.mozilla.org"], searchUrl: "https://developer.mozilla.org/search?q=%s" },
  { id: "npm", name: "npm", keywords: ["npm", "npmjs.com"], searchUrl: "https://www.npmjs.com/search?q=%s" },
  { id: "twitch", name: "Twitch", keywords: ["twitch", "twitch.tv"], searchUrl: "https://www.twitch.tv/search?term=%s" },
  { id: "steam", name: "Steam", keywords: ["steam", "store.steampowered.com"], searchUrl: "https://store.steampowered.com/search/?term=%s" },
];

/** Fewest letters that pick a site by the start of a keyword ("yo" → YouTube); a full keyword like "x" always counts. */
const MIN_PREFIX_LENGTH = 2;

/**
 * Returns the site the typed text names, or null. A full keyword wins over a site whose keyword only starts with the
 * text; text with a space is a search, not a site name.
 * Examples: "yout" → YouTube, "x" → X, "github.c" → GitHub, "best pizza" → null, "g" → null
 */
export function findSiteSearch(typedText: string): SiteSearch | null {
  const text = typedText.trim().toLowerCase();
  if (text === "" || text.includes(" ")) {
    return null;
  }
  const exactMatch = SITE_SEARCHES.find((site) => site.keywords.includes(text));
  if (exactMatch !== undefined) {
    return exactMatch;
  }
  if (text.length < MIN_PREFIX_LENGTH) {
    return null;
  }
  return SITE_SEARCHES.find((site) => site.keywords.some((keyword) => keyword.startsWith(text))) ?? null;
}

/**
 * Builds the address that searches a site for a query.
 * Example: buildSiteSearchUrl(YouTube, "lofi beats") → "https://www.youtube.com/results?search_query=lofi%20beats"
 */
export function buildSiteSearchUrl(site: SiteSearch, query: string): string {
  return site.searchUrl.replace("%s", encodeURIComponent(query.trim()));
}
