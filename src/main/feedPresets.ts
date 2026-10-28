/**
 * WHY this file exists:
 *   Live folders anyone can start with one click (Hacker News), and the feeds of sites that offer one without saying
 *   so in their pages: a subreddit's posts are at /r/<name>/.rss, which "Feed from This Page" uses when the page names
 *   no feed of its own.
 *
 * Data source:
 *   The preset list below (our choice of sites) and the address of the page on screen.
 *
 * Data flow:
 *   New Live Folder › Hacker News → FEED_PRESETS → a feed live folder
 *   Feed from This Page → (no feed in the page) → findKnownFeed(page address) → a feed live folder
 *
 * Rules: pure.
 */

/** A feed to make a live folder of, and the folder's name. */
export interface KnownFeed {
  url: string;
  title: string;
}

/** Ready-made feed folders, by id. Hacker News publishes its front page as RSS at /rss. */
export const FEED_PRESETS = {
  hackerNews: { url: "https://news.ycombinator.com/rss", title: "Hacker News" },
} as const satisfies Record<string, KnownFeed>;

export type FeedPresetId = keyof typeof FEED_PRESETS;

/** Reddit's hosts (www, old, new, the bare domain). */
const REDDIT_HOSTS = ["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com"];

/** A subreddit's name in a path: /r/<name>/… (letters, digits and underscores, as Reddit allows). */
const SUBREDDIT_PATTERN = /^\/r\/([A-Za-z0-9_]{2,21})(\/|$)/;

/**
 * The feed of a page whose site has one at a known address: a subreddit's posts, Hacker News' front page. Null for
 * any other page.
 * Example: "https://www.reddit.com/r/typescript/top/" → { url: "https://www.reddit.com/r/typescript/.rss", title: "r/typescript" }
 */
export function findKnownFeed(pageUrl: string): KnownFeed | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "news.ycombinator.com") {
    return FEED_PRESETS.hackerNews;
  }
  const subreddit = REDDIT_HOSTS.includes(host) ? SUBREDDIT_PATTERN.exec(url.pathname) : null;
  if (subreddit === null) {
    return null;
  }
  const name = subreddit[1] as string;
  return { url: `https://www.reddit.com/r/${name}/.rss`, title: `r/${name}` };
}
