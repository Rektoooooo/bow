/**
 * WHY this file exists:
 *   A live folder can follow a feed: the newest posts of a blog or news site become its tabs. Sites publish feeds in
 *   three shapes (RSS 2.0, Atom, and the older RDF/RSS 1.0, all XML; plus JSON Feed). The main process has no XML
 *   parser, and a feed only needs two things per post (its address and title), so this file reads them with
 *   patterns, tolerant of the many small ways real feeds differ. It also finds a page's own feed ("Feed from This
 *   Page"): the `<link rel="alternate">` sites put in their pages.
 *
 * Data source:
 *   The feed text liveFolderRefresher.ts fetched, and the links of the page on screen. Both untrusted: only http(s)
 *   addresses and plain text come out.
 *
 * Data flow:
 *   liveFolderRefresher.ts fetches the feed → parseFeed(text, feedUrl) → entries → liveFolders.ts
 *   "Feed from This Page" → the page's alternate links → pickFeedLink() → a new live folder
 */
import type { LiveFolderEntry } from "./liveFolders";
import { decodeEntities, toPlainText } from "./markupText";

/** A feed's title and its posts, newest first (the order feeds list them in). */
export interface ParsedFeed {
  title: string | null;
  entries: LiveFolderEntry[];
}

/** One `<link rel="alternate">` of a page: where it points, its type and its title. */
export interface PageFeedLink {
  href: string;
  type: string;
  title: string;
}

/** The feed a page offers, and the name the site gave it. */
export interface FoundFeed {
  url: string;
  title: string | null;
}

/** Media types of feeds that pages link to. */
const FEED_TYPES = ["application/rss+xml", "application/atom+xml", "application/rdf+xml", "application/feed+json"];

/** Media types a page on screen has when it is a feed itself (Chromium shows XML as a tree). */
const FEED_DOCUMENT_TYPES = [...FEED_TYPES, "application/xml", "text/xml"];

/** Words that only appear at the top of an XML feed. */
const XML_FEED_MARKERS = /<(rss|feed|rdf:RDF)[\s>]/i;

/** A post: RSS and RDF call it `item`, Atom `entry`. */
const ENTRY_PATTERN = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;

/** A `<title>` element and its content. */
const TITLE_PATTERN = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title\s*>/i;

/** Every `<link …>` tag (Atom's links carry the address in `href`). */
const LINK_TAG_PATTERN = /<link\b[^>]*>/gi;

/** RSS's `<link>address</link>`. */
const LINK_ELEMENT_PATTERN = /<link(?:\s[^>]*)?>([\s\S]*?)<\/link\s*>/i;

/** FeedBurner's address of the original post, which feeds passed through FeedBurner carry next to their own link. */
const ORIGINAL_LINK_PATTERN = /<feedburner:origLink>([\s\S]*?)<\/feedburner:origLink\s*>/i;

/** RSS's `<guid>`, which is the post's address unless it says `isPermaLink="false"`. */
const GUID_PATTERN = /<guid(\s[^>]*)?>([\s\S]*?)<\/guid\s*>/i;

/** JSON Feed's `version` value starts with this. */
const JSON_FEED_VERSION_PREFIX = "https://jsonfeed.org/version/";

/** How much of a post's text names a JSON Feed post that has no title. Our choice. */
const UNTITLED_TEXT_LENGTH = 80;

/**
 * Reads one attribute of a tag, decoded.
 * Example: readAttribute('<link rel="alternate" href="/a?b=1&amp;c=2">', "href") → "/a?b=1&c=2"
 */
function readAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const match = pattern.exec(tag);
  if (match === null) {
    return null;
  }
  const value = match[2] ?? match[3] ?? "";
  return decodeEntities(value);
}

/**
 * An address made absolute against the feed's own, or null when it is not a web address.
 */
function toWebAddress(address: string, baseUrl: string): string | null {
  const trimmed = address.trim();
  if (trimmed === "") {
    return null;
  }
  try {
    const url = new URL(trimmed, baseUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The address of a post, in the order of trust: FeedBurner's original, Atom's alternate link, RSS's link, a
 * permalink guid.
 */
function findEntryAddress(body: string): string | null {
  const originalMatch = ORIGINAL_LINK_PATTERN.exec(body);
  if (originalMatch !== null) {
    return toPlainText(originalMatch[1] ?? "");
  }
  for (const tag of body.match(LINK_TAG_PATTERN) ?? []) {
    const href = readAttribute(tag, "href");
    // An Atom link without rel is the alternate one.
    const relation = readAttribute(tag, "rel") ?? "alternate";
    if (href !== null && relation === "alternate") {
      return href;
    }
  }
  const linkMatch = LINK_ELEMENT_PATTERN.exec(body);
  if (linkMatch !== null && toPlainText(linkMatch[1] ?? "") !== "") {
    return toPlainText(linkMatch[1] ?? "");
  }
  const guidMatch = GUID_PATTERN.exec(body);
  if (guidMatch === null) {
    return null;
  }
  const guidAttributes = guidMatch[1] ?? "";
  const isPermalink = !/isPermaLink\s*=\s*["']false["']/i.test(guidAttributes);
  return isPermalink ? toPlainText(guidMatch[2] ?? "") : null;
}

/**
 * Reads an XML feed (RSS 2.0, RDF, Atom). Posts without a web address are skipped; posts without a title are named
 * by their address.
 */
function parseXmlFeed(text: string, feedUrl: string): ParsedFeed {
  const entries: LiveFolderEntry[] = [];
  let firstEntryStart = text.length;
  for (const match of text.matchAll(ENTRY_PATTERN)) {
    firstEntryStart = Math.min(firstEntryStart, match.index);
    const body = match[2] ?? "";
    const rawAddress = findEntryAddress(body);
    const address = rawAddress === null ? null : toWebAddress(rawAddress, feedUrl);
    if (address === null) {
      continue;
    }
    const titleMatch = TITLE_PATTERN.exec(body);
    const title = titleMatch === null ? "" : toPlainText(titleMatch[1] ?? "");
    entries.push({ url: address, title: title === "" ? address : title });
  }
  // The feed's own title comes before its first post.
  const header = text.slice(0, firstEntryStart);
  const feedTitleMatch = TITLE_PATTERN.exec(header);
  const feedTitle = feedTitleMatch === null ? "" : toPlainText(feedTitleMatch[1] ?? "");
  return { title: feedTitle === "" ? null : feedTitle, entries: entries };
}

/**
 * Reads a JSON Feed (jsonfeed.org). Returns null when the text is not one.
 */
function parseJsonFeed(text: string, feedUrl: string): ParsedFeed | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const feed = parsed as Record<string, unknown>;
  const isJsonFeed = typeof feed.version === "string" && feed.version.startsWith(JSON_FEED_VERSION_PREFIX);
  if (!isJsonFeed || !Array.isArray(feed.items)) {
    return null;
  }
  const entries: LiveFolderEntry[] = [];
  for (const rawItem of feed.items) {
    if (typeof rawItem !== "object" || rawItem === null) {
      continue;
    }
    const item = rawItem as Record<string, unknown>;
    const ownAddress = typeof item.url === "string" ? item.url : null;
    const externalAddress = typeof item.external_url === "string" ? item.external_url : "";
    const address = toWebAddress(ownAddress ?? externalAddress, feedUrl);
    if (address === null) {
      continue;
    }
    const ownTitle = typeof item.title === "string" ? item.title : null;
    const textStart = typeof item.content_text === "string" ? item.content_text.slice(0, UNTITLED_TEXT_LENGTH) : "";
    const title = toPlainText(ownTitle ?? textStart);
    entries.push({ url: address, title: title === "" ? address : title });
  }
  const feedTitle = typeof feed.title === "string" ? toPlainText(feed.title) : "";
  return { title: feedTitle === "" ? null : feedTitle, entries: entries };
}

/**
 * Reads a feed of any of the four shapes. Returns null when the text is not a feed (an HTML page, an error page).
 * Example: parseFeed('<rss><channel><title>Blog</title><item><title>Hi</title><link>https://a.example/1</link></item>…',
 *   "https://a.example/feed") → { title: "Blog", entries: [{ url: "https://a.example/1", title: "Hi" }] }
 */
export function parseFeed(text: string, feedUrl: string): ParsedFeed | null {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) {
    return parseJsonFeed(trimmed, feedUrl);
  }
  if (!XML_FEED_MARKERS.test(text)) {
    return null;
  }
  return parseXmlFeed(text, feedUrl);
}

/**
 * The feed a page offers: the page itself when it is a feed, otherwise its first alternate link of a feed type.
 * Returns null when the page has none.
 * Example: pickFeedLink("text/html", [{ href: "/feed.xml", type: "application/rss+xml", title: "Blog" }],
 *   "https://a.example/") → { url: "https://a.example/feed.xml", title: "Blog" }
 */
export function pickFeedLink(contentType: string, links: PageFeedLink[], pageUrl: string): FoundFeed | null {
  const pageType = contentType.trim().toLowerCase();
  if (FEED_DOCUMENT_TYPES.includes(pageType)) {
    const pageAddress = toWebAddress(pageUrl, pageUrl);
    return pageAddress === null ? null : { url: pageAddress, title: null };
  }
  for (const link of links) {
    const linkType = link.type.trim().toLowerCase();
    if (!FEED_TYPES.includes(linkType)) {
      continue;
    }
    const address = toWebAddress(link.href, pageUrl);
    if (address === null) {
      continue;
    }
    const title = link.title.trim();
    return { url: address, title: title === "" ? null : title };
  }
  return null;
}
