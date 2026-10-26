/**
 * WHY this file exists:
 *   Pinned tabs in Arc show short, clean names ("Inbox" rather than "(3) Inbox - someone@example.com - Mail"). Ours
 *   come from a few general rules of our own, not from a list per site: drop a leading count like "(3) ", split the
 *   title at the usual separators, leave out the parts that only name the site, keep the first part that is left.
 *
 * Data source:
 *   A tab's page title and address.
 *
 * Data flow:
 *   rows.ts (pinned tabs and Favorites without a name of the user's own) → tidyTitle(title, url) → the row's name
 */

/** Separators sites put between the page's name and their own. */
const TITLE_SEPARATORS = [" - ", " | ", " — ", " – ", " · ", " • ", " :: "];

/** A count of new things in front of a title: "(3) Inbox", "[12] Feed". */
const LEADING_COUNT_PATTERN = /^\s*[([]\d+\+?[)\]]\s*/;

/** Parts shorter than this are not worth keeping alone (a lone "|", a stray letter). Our choice. */
const MIN_PART_LENGTH = 2;

/**
 * The words that name a site: its host without "www." and the top-level domain, split at dots and dashes.
 * Example: "https://www.github.com/x" → ["github"]; "https://news.ycombinator.com" → ["news", "ycombinator"]
 */
function getSiteWords(url: string): string[] {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return [];
  }
  const labels = hostname.split(".").filter((label) => label !== "" && label !== "www");
  const withoutTopLevel = labels.length > 1 ? labels.slice(0, -1) : labels;
  return withoutTopLevel.flatMap((label) => label.split("-")).filter((word) => word.length >= MIN_PART_LENGTH);
}

/**
 * Letters and digits only, lower case: "Hacker News" → "hackernews".
 */
function squash(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Site words shorter than this only count when a part is exactly that word ("en" must not match "Garden"). */
const MIN_CONTAINED_WORD_LENGTH = 4;

/**
 * True when a part of a title only names the site ("GitHub" on github.com, "Hacker News" on news.ycombinator.com).
 */
function isSiteName(part: string, siteWords: string[]): boolean {
  const squashedPart = squash(part);
  if (squashedPart === "") {
    return true;
  }
  for (const word of siteWords) {
    const isExact = squashedPart === word;
    const containsWord = word.length >= MIN_CONTAINED_WORD_LENGTH && squashedPart.includes(word);
    const isInsideWord = squashedPart.length >= MIN_CONTAINED_WORD_LENGTH && word.includes(squashedPart);
    if (isExact || containsWord || isInsideWord) {
      return true;
    }
  }
  return false;
}

/**
 * Splits a title at every known separator.
 */
function splitTitle(title: string): string[] {
  let parts = [title];
  for (const separator of TITLE_SEPARATORS) {
    parts = parts.flatMap((part) => part.split(separator));
  }
  return parts.map((part) => part.trim()).filter((part) => part.length >= MIN_PART_LENGTH);
}

/**
 * A short, clean name for a pinned tab. Returns the title unchanged when no rule applies.
 * Examples: ("(3) Inbox - Mail", "https://mail.example.com") → "Inbox";
 *           ("sidebar-browser · GitHub", "https://github.com/x/sidebar-browser") → "sidebar-browser"
 */
export function tidyTitle(title: string, url: string): string {
  const withoutCount = title.replace(LEADING_COUNT_PATTERN, "");
  const parts = splitTitle(withoutCount);
  if (parts.length === 0) {
    return title;
  }
  const siteWords = getSiteWords(url);
  const pageParts = parts.filter((part) => !isSiteName(part, siteWords));
  const chosen = pageParts[0] ?? parts[0];
  return chosen === undefined || chosen === "" ? title : chosen;
}
