/**
 * WHY this file exists:
 *   Reader view: an article without the site around it (menus, ads, sidebars), in a calm column of text. A script in
 *   the page finds the part of the page that holds the most paragraph text and reads it as plain blocks (headings,
 *   paragraphs, list items, quotes, code, images); the sidebar page draws them in the card (renderer/readerView.ts).
 *   Our own heuristic, not a library: the page's text comes out as text only, never as markup.
 *
 * Data source:
 *   The page's document, read in an isolated world (page scripts cannot see or change what is read). Untrusted:
 *   checkReaderArticle() keeps only plain text, web image addresses and sizes within the limits below.
 *
 * Data flow:
 *   page loaded → READER_PROBE_SCRIPT → "looks like an article" → the toolbar's Reader button
 *   Reader View → READER_EXTRACT_SCRIPT → checkReaderArticle() → readerController.ts → sidebar page draws it
 *
 * Rules: pure (the scripts are text that runs in the page).
 */

import type { ReaderArticle, ReaderBlock } from "../shared/types";

/** Most blocks kept. Our choice: a very long article is well below it. */
const MAX_BLOCKS = 3000;

/** Most characters in one block, and in the whole article. Our choice. */
const MAX_BLOCK_LENGTH = 20000;
const MAX_ARTICLE_LENGTH = 400000;

/** Longest title, byline or site name kept. Our choice. */
const MAX_LINE_LENGTH = 300;

/** Words read per minute, for "6 min read". A common estimate for reading on screen. */
const READING_WORDS_PER_MINUTE = 230;

/** The block kinds the script may return that are plain text. */
const TEXT_BLOCK_KINDS = ["paragraph", "listItem", "quote", "code", "caption"] as const;

/**
 * Runs in the page: whether it looks like an article (at least three real paragraphs outside menus and sidebars, and
 * enough text). Cheap, so it can run after every load.
 */
export const READER_PROBE_SCRIPT = `(() => {
  let count = 0;
  let total = 0;
  for (const paragraph of document.querySelectorAll("p")) {
    if (paragraph.closest("nav, aside, footer, form, [aria-hidden='true']")) continue;
    const length = paragraph.textContent.trim().length;
    if (length >= 80) {
      count += 1;
      total += length;
    }
  }
  return count >= 3 && total >= 1000;
})()`;

/**
 * Runs in the page: the article as plain data. The container is the article or main element with the most
 * paragraph text, else the element whose own paragraphs hold the most text; its blocks are read in document order,
 * a block inside another (a paragraph in a quote) only once, nothing from menus, sidebars, forms or hidden parts.
 */
export const READER_EXTRACT_SCRIPT = `(() => {
  const SKIPPED = "nav, aside, footer, form, button, script, style, noscript, [aria-hidden='true'], [hidden]";
  const paragraphText = (element) => {
    let total = 0;
    for (const paragraph of element.querySelectorAll("p")) {
      const length = paragraph.textContent.trim().length;
      if (length >= 40 && !paragraph.closest(SKIPPED)) total += length;
    }
    return total;
  };
  let best = null;
  let bestScore = 0;
  for (const candidate of document.querySelectorAll("article, main, [role='main'], [itemprop='articleBody']")) {
    const score = paragraphText(candidate);
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  if (best === null || bestScore < 500) {
    const byParent = new Map();
    for (const paragraph of document.querySelectorAll("p")) {
      const length = paragraph.textContent.trim().length;
      if (length < 40 || paragraph.closest(SKIPPED) || !paragraph.parentElement) continue;
      byParent.set(paragraph.parentElement, (byParent.get(paragraph.parentElement) || 0) + length);
    }
    for (const [parent, score] of byParent) {
      if (score > bestScore) { best = parent; bestScore = score; }
    }
  }
  if (best === null) return null;
  const clean = (text) => text.replace(/\\s+/g, " ").trim();
  const blocks = [];
  for (const element of best.querySelectorAll("h1, h2, h3, h4, p, li, blockquote, pre, img, figcaption")) {
    if (blocks.length >= 3000) break;
    if (element.closest(SKIPPED)) continue;
    const tag = element.tagName;
    if (tag === "IMG") {
      if (element.closest("pre")) continue;
      const source = element.currentSrc || element.src;
      if (source && element.naturalWidth >= 120) blocks.push({ kind: "image", src: source, alt: clean(element.alt || "") });
      continue;
    }
    const container = element.parentElement ? element.parentElement.closest("p, li, blockquote, pre") : null;
    if (container && best.contains(container)) continue;
    if (tag === "PRE") { blocks.push({ kind: "code", text: element.textContent }); continue; }
    const text = clean(element.textContent);
    if (text === "") continue;
    if (tag[0] === "H") blocks.push({ kind: "heading", level: Number(tag[1]), text: text });
    else if (tag === "P") blocks.push({ kind: "paragraph", text: text });
    else if (tag === "LI") blocks.push({ kind: "listItem", text: text });
    else if (tag === "BLOCKQUOTE") blocks.push({ kind: "quote", text: text });
    else blocks.push({ kind: "caption", text: text });
  }
  const meta = (selector) => {
    const element = document.querySelector(selector);
    return element ? clean(element.getAttribute("content") || "") : "";
  };
  const heading = document.querySelector("h1");
  return {
    title: meta("meta[property='og:title']") || (heading ? clean(heading.textContent) : "") || document.title,
    byline: meta("meta[name='author']") || meta("meta[property='article:author']"),
    siteName: meta("meta[property='og:site_name']"),
    blocks: blocks,
  };
})()`;

/**
 * Plain text from the script, cut to a length; "" for anything that is not text.
 */
function readText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/**
 * One block from the script, or null when it is not one Reader view draws.
 */
function checkBlock(raw: unknown): ReaderBlock | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const block = raw as Record<string, unknown>;
  if (block.kind === "image") {
    const isWebImage = typeof block.src === "string" && /^https?:\/\//i.test(block.src) && block.src.length <= MAX_BLOCK_LENGTH;
    return isWebImage ? { kind: "image", src: block.src as string, alt: readText(block.alt, MAX_LINE_LENGTH) } : null;
  }
  const text = block.kind === "code" && typeof block.text === "string" ? block.text.slice(0, MAX_BLOCK_LENGTH) : readText(block.text, MAX_BLOCK_LENGTH);
  if (text === "") {
    return null;
  }
  if (block.kind === "heading") {
    const level = typeof block.level === "number" && block.level >= 1 && block.level <= 4 ? Math.round(block.level) : 2;
    return { kind: "heading", level: level, text: text };
  }
  const textKind = TEXT_BLOCK_KINDS.find((kind) => kind === block.kind);
  return textKind === undefined ? null : { kind: textKind, text: text };
}

/**
 * The article the extract script returned, checked: plain text and web images only, within the limits; null when it
 * found no article (no blocks with text).
 * Example: { title: "A story", blocks: [{ kind: "paragraph", text: "Once…" }] } → an article of one paragraph
 */
export function checkReaderArticle(raw: unknown, pageUrl: string, pageTitle: string): ReaderArticle | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const article = raw as Record<string, unknown>;
  const blocks: ReaderBlock[] = [];
  let totalLength = 0;
  let wordCount = 0;
  for (const rawBlock of Array.isArray(article.blocks) ? article.blocks : []) {
    const block = blocks.length < MAX_BLOCKS ? checkBlock(rawBlock) : null;
    const length = block !== null && block.kind !== "image" ? block.text.length : 0;
    if (block === null || totalLength + length > MAX_ARTICLE_LENGTH) {
      continue;
    }
    blocks.push(block);
    totalLength += length;
    wordCount += block.kind === "image" ? 0 : block.text.split(/\s+/).length;
  }
  const hasText = blocks.some((block) => block.kind === "paragraph");
  if (!hasText) {
    return null;
  }
  const title = readText(article.title, MAX_LINE_LENGTH) || pageTitle.trim().slice(0, MAX_LINE_LENGTH);
  // The page's own first heading is usually the title, which Reader view shows on top already.
  const firstBlock = blocks[0];
  if (firstBlock !== undefined && firstBlock.kind === "heading" && firstBlock.text === title) {
    blocks.shift();
  }
  const siteName = readText(article.siteName, MAX_LINE_LENGTH) || readHost(pageUrl);
  return {
    title: title,
    byline: readText(article.byline, MAX_LINE_LENGTH),
    siteName: siteName,
    url: pageUrl,
    blocks: blocks,
    minutesToRead: Math.max(1, Math.round(wordCount / READING_WORDS_PER_MINUTE)),
  };
}

/**
 * A page's host without "www.", or "" for an address that is not one.
 */
function readHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
