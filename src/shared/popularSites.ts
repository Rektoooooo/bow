/**
 * WHY this file exists:
 *   Arc's Command Bar completes "you" to youtube.com even before you have been there. Ours uses this short list of
 *   widely used sites (our own pick of well-known public sites, in no particular source's order) as the last
 *   candidates for inline completion, after your tabs and history.
 *
 * Data source:
 *   Our choice: sites most people know; kept short so a completion is rarely a surprise.
 *
 * Data flow:
 *   overlay.ts showInlineCompletion() → POPULAR_SITE_URLS after the Command Bar's own results
 */
export const POPULAR_SITE_URLS: string[] = [
  "https://google.com/",
  "https://youtube.com/",
  "https://wikipedia.org/",
  "https://github.com/",
  "https://gmail.com/",
  "https://maps.google.com/",
  "https://drive.google.com/",
  "https://docs.google.com/",
  "https://calendar.google.com/",
  "https://amazon.com/",
  "https://reddit.com/",
  "https://x.com/",
  "https://facebook.com/",
  "https://instagram.com/",
  "https://linkedin.com/",
  "https://netflix.com/",
  "https://spotify.com/",
  "https://twitch.tv/",
  "https://apple.com/",
  "https://icloud.com/",
  "https://microsoft.com/",
  "https://outlook.com/",
  "https://office.com/",
  "https://notion.so/",
  "https://figma.com/",
  "https://slack.com/",
  "https://discord.com/",
  "https://zoom.us/",
  "https://dropbox.com/",
  "https://stackoverflow.com/",
  "https://developer.mozilla.org/",
  "https://news.ycombinator.com/",
  "https://duckduckgo.com/",
  "https://bing.com/",
  "https://openai.com/",
  "https://claude.ai/",
  "https://paypal.com/",
  "https://ebay.com/",
  "https://imdb.com/",
  "https://weather.com/",
  "https://bbc.com/",
  "https://nytimes.com/",
  "https://medium.com/",
  "https://vercel.com/",
  "https://npmjs.com/",
];
