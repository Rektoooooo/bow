/**
 * WHY this file exists:
 *   Reader view: an article without the site around it (menus, ads, sidebars), in a calm column of text. A script in
 *   the page finds the part of the page that holds the most paragraph text and reads it as plain blocks (headings,
 *   paragraphs, list items, quotes, code, images), leaving out what is not the article: navigation and menus (lists
 *   that are mostly links too: languages, contents, categories), sidebars, footers, tables inside the article
 *   (infoboxes) and whatever the page hides. checkReaderArticle() shows the title once and drops headings left with
 *   nothing under them; the sidebar page draws the blocks in the card (renderer/readerView.ts).
 *   Our own rules, not a library: the page's text comes out as text only, never as markup.
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

import {
  READER_ARTICLE_MIN_PARAGRAPHS,
  READER_ARTICLE_MIN_TEXT,
  READER_ARTICLE_PARAGRAPH_LENGTH,
  READER_COUNTED_PARAGRAPH_LENGTH,
  READER_IMAGE_MIN_WIDTH,
  READER_LANDMARK_MIN_TEXT,
  READER_LINK_LIST_SHARE,
} from "../shared/settings";
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

/** What a page's title puts between the article's title and the site's name ("A story - The Paper"). Our choice. */
const TITLE_SEPARATORS = [" - ", " – ", " — ", " | ", " · "] as const;

/**
 * What Reader view leaves out wherever it is on the page: navigation and menus, sidebars, the site's header and
 * footer, forms and buttons, code and style sheets, and parts hidden from everyone.
 */
const LEFT_OUT_SELECTOR = [
  "nav",
  "[role='navigation']",
  "[role='menu']",
  "[role='menubar']",
  "aside",
  "[role='complementary']",
  "[role='banner']",
  "footer",
  "[role='contentinfo']",
  "form",
  "button",
  "script",
  "style",
  "noscript",
  "template",
  "[aria-hidden='true']",
  "[hidden]",
].join(", ");

/**
 * Runs in the page: whether it looks like an article (enough real paragraphs that are shown, outside menus and
 * sidebars, and enough text). Cheap, so it can run after every load.
 */
export const READER_PROBE_SCRIPT = `(() => {
  const leftOut = ${JSON.stringify(LEFT_OUT_SELECTOR)};
  let count = 0;
  let total = 0;
  for (const paragraph of document.querySelectorAll("p")) {
    if (paragraph.closest(leftOut) || !paragraph.checkVisibility({ visibilityProperty: true })) continue;
    const length = paragraph.textContent.trim().length;
    if (length >= ${READER_ARTICLE_PARAGRAPH_LENGTH}) {
      count += 1;
      total += length;
    }
  }
  return count >= ${READER_ARTICLE_MIN_PARAGRAPHS} && total >= ${READER_ARTICLE_MIN_TEXT};
})()`;

/**
 * Runs in the page: the article as plain data. The container is the article or main element with the most
 * paragraph text, else the element whose own paragraphs hold the most text; its blocks are read in document order,
 * a block inside another (a paragraph in a quote) only once. Left out: menus, sidebars, forms, hidden parts (also
 * by style: display none, visibility hidden), lists that are mostly links, and tables inside the container. The text
 * is read as shown (innerText: no style sheet text, nothing hidden). The page's og:title and its own heading come
 * back as they are; checkReaderArticle() picks the title from them.
 */
export const READER_EXTRACT_SCRIPT = `(() => {
  const leftOut = ${JSON.stringify(LEFT_OUT_SELECTOR)};
  const clean = (text) => text.replace(/\\s+/g, " ").trim();
  const lengthWithoutSpaces = (text) => text.replace(/\\s+/g, "").length;
  const isLinkListByList = new Map();
  // A list that is mostly links is a menu (languages, contents, categories, "See also"), not the article's text.
  const isLinkList = (list) => {
    if (isLinkListByList.has(list)) return isLinkListByList.get(list);
    let linkLength = 0;
    for (const link of list.querySelectorAll("a[href]")) linkLength += lengthWithoutSpaces(link.innerText);
    const listLength = lengthWithoutSpaces(list.innerText);
    const isMenu = listLength > 0 && linkLength >= listLength * ${READER_LINK_LIST_SHARE};
    isLinkListByList.set(list, isMenu);
    return isMenu;
  };
  const isLeftOut = (element) => {
    if (element.closest(leftOut) !== null) return true;
    if (!element.checkVisibility({ visibilityProperty: true })) return true;
    const list = element.closest("ul, ol, menu");
    return list !== null && isLinkList(list);
  };
  // A table inside the container is an infobox or a data table: Reader view draws text, not tables. (A page laid out
  // with a table holds the container instead, and stays.)
  const isInTable = (element, container) => {
    const table = element.closest("table");
    return table !== null && container.contains(table);
  };
  const paragraphText = (container) => {
    let total = 0;
    for (const paragraph of container.querySelectorAll("p")) {
      if (isLeftOut(paragraph) || isInTable(paragraph, container)) continue;
      const length = clean(paragraph.innerText).length;
      if (length >= ${READER_COUNTED_PARAGRAPH_LENGTH}) total += length;
    }
    return total;
  };
  let best = null;
  let bestScore = 0;
  for (const candidate of document.querySelectorAll("article, main, [role='main'], [itemprop='articleBody']")) {
    const score = paragraphText(candidate);
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  if (best === null || bestScore < ${READER_LANDMARK_MIN_TEXT}) {
    const byParent = new Map();
    for (const paragraph of document.querySelectorAll("p")) {
      if (!paragraph.parentElement || isLeftOut(paragraph)) continue;
      const length = clean(paragraph.innerText).length;
      if (length < ${READER_COUNTED_PARAGRAPH_LENGTH}) continue;
      byParent.set(paragraph.parentElement, (byParent.get(paragraph.parentElement) || 0) + length);
    }
    for (const [parent, score] of byParent) {
      if (score > bestScore) { best = parent; bestScore = score; }
    }
  }
  if (best === null) return null;
  const readImage = (image) => {
    const source = image.currentSrc || image.src;
    // An image further down that has not loaded yet (loading="lazy") counts by its laid-out width.
    const width = Math.max(image.naturalWidth, image.width);
    if (!source || width < ${READER_IMAGE_MIN_WIDTH} || image.closest("pre")) return null;
    return { kind: "image", src: source, alt: clean(image.alt || "") };
  };
  const readBlock = (element) => {
    const tag = element.tagName;
    if (tag === "IMG") return readImage(element);
    const container = element.parentElement ? element.parentElement.closest("p, li, blockquote, pre") : null;
    if (container && best.contains(container)) return null;
    if (tag === "PRE") return { kind: "code", text: element.textContent };
    const text = clean(element.innerText);
    if (text === "") return null;
    if (tag[0] === "H") return { kind: "heading", level: Number(tag[1]), text: text };
    if (tag === "P") return { kind: "paragraph", text: text };
    if (tag === "LI") return { kind: "listItem", text: text };
    if (tag === "BLOCKQUOTE") return { kind: "quote", text: text };
    return { kind: "caption", text: text };
  };
  const blocks = [];
  for (const element of best.querySelectorAll("h1, h2, h3, h4, p, li, blockquote, pre, img, figcaption")) {
    if (blocks.length >= ${MAX_BLOCKS}) break;
    if (isLeftOut(element) || isInTable(element, best)) continue;
    const block = readBlock(element);
    if (block !== null) blocks.push(block);
  }
  const meta = (selector) => {
    const element = document.querySelector(selector);
    return element ? clean(element.getAttribute("content") || "") : "";
  };
  const findHeading = (root) => {
    for (const heading of root.querySelectorAll("h1")) {
      if (!isLeftOut(heading)) return clean(heading.innerText);
    }
    return "";
  };
  return {
    metaTitle: meta("meta[property='og:title']"),
    heading: findHeading(best) || findHeading(document),
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
 * Text compared loosely: lower case, spaces collapsed ("Web  Browser" and "web browser" are the same).
 */
function looseText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * A name compared loosely: lower case, letters and digits only ("The Verge" → "theverge").
 */
function compactName(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Whether the text is the site's name: its og:site_name, or a part of its host ("Wikipedia" on en.wikipedia.org).
 */
function namesSite(text: string, siteName: string, host: string): boolean {
  const name = compactName(text);
  if (name === "") {
    return false;
  }
  if (name === compactName(siteName)) {
    return true;
  }
  return host.split(".").includes(name);
}

/**
 * The title without " - Site name" at its end, when that is the site's name; else the title as it is.
 * Example: ("Web browser - Wikipedia", "", "en.wikipedia.org") → "Web browser"
 */
function removeSiteName(title: string, siteName: string, host: string): string {
  for (const separator of TITLE_SEPARATORS) {
    const separatorIndex = title.lastIndexOf(separator);
    if (separatorIndex <= 0) {
      continue;
    }
    const ending = title.slice(separatorIndex + separator.length);
    if (namesSite(ending, siteName, host)) {
      return title.slice(0, separatorIndex).trim();
    }
  }
  return title;
}

/**
 * Whether the title is the page's heading with more after a separator ("Web browser - Wikipedia" over "Web browser").
 */
function isHeadingWithMore(title: string, heading: string): boolean {
  const looseTitle = looseText(title);
  const looseHeading = looseText(heading);
  return TITLE_SEPARATORS.some((separator) => looseTitle.startsWith(looseHeading + separator));
}

/**
 * The title Reader view shows: the page's og:title, else its heading, else its title; the page's own heading when
 * the title is that heading with more after it (unless the heading is the site's name, like a logo's), else without
 * the site's name at its end.
 * Example: ("Web browser - Wikipedia", "Web browser", …) → "Web browser"
 */
function chooseTitle(metaTitle: string, heading: string, pageTitle: string, siteName: string, host: string): string {
  const title = metaTitle || heading || pageTitle;
  const isArticleHeading = heading !== "" && !namesSite(heading, siteName, host);
  if (isArticleHeading && isHeadingWithMore(title, heading)) {
    return heading;
  }
  return removeSiteName(title, siteName, host);
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
 * The blocks Reader view draws, checked one by one, within the limits.
 */
function checkBlocks(rawBlocks: unknown): ReaderBlock[] {
  const blocks: ReaderBlock[] = [];
  let totalLength = 0;
  for (const rawBlock of Array.isArray(rawBlocks) ? rawBlocks : []) {
    const block = blocks.length < MAX_BLOCKS ? checkBlock(rawBlock) : null;
    const length = block !== null && block.kind !== "image" ? block.text.length : 0;
    if (block === null || totalLength + length > MAX_ARTICLE_LENGTH) {
      continue;
    }
    blocks.push(block);
    totalLength += length;
  }
  return blocks;
}

/**
 * The blocks without the article's first heading when it repeats the title, which Reader view shows on top already.
 */
function withoutTitleHeading(blocks: ReaderBlock[], title: string): ReaderBlock[] {
  const headingIndex = blocks.findIndex((block) => block.kind === "heading");
  const heading = blocks[headingIndex];
  if (heading === undefined || heading.kind !== "heading" || looseText(heading.text) !== looseText(title)) {
    return blocks;
  }
  const kept = blocks.slice();
  kept.splice(headingIndex, 1);
  return kept;
}

/**
 * Whether a block belongs under a heading of that level: anything but a heading as high or higher.
 */
function isUnderHeading(block: ReaderBlock | undefined, level: number): boolean {
  if (block === undefined) {
    return false;
  }
  return block.kind !== "heading" || block.level > level;
}

/**
 * The blocks without headings that have nothing left under them ("See also" over a list of links Reader view left
 * out). Read from the end, so a section whose only subsection was empty goes too.
 */
function withoutEmptySections(blocks: ReaderBlock[]): ReaderBlock[] {
  const keptFromEnd: ReaderBlock[] = [];
  const blocksFromEnd = blocks.slice().reverse();
  for (const block of blocksFromEnd) {
    const nextBlock = keptFromEnd[keptFromEnd.length - 1];
    if (block.kind !== "heading" || isUnderHeading(nextBlock, block.level)) {
      keptFromEnd.push(block);
    }
  }
  return keptFromEnd.reverse();
}

/**
 * The words in the blocks' text, for the reading time.
 */
function countWords(blocks: ReaderBlock[]): number {
  let wordCount = 0;
  for (const block of blocks) {
    wordCount += block.kind === "image" ? 0 : block.text.split(/\s+/).length;
  }
  return wordCount;
}

/**
 * The article the extract script returned, checked: plain text and web images only, within the limits, the title
 * once; null when it found no article (no paragraph).
 * Example: { metaTitle: "A story", blocks: [{ kind: "paragraph", text: "Once…" }] } → an article of one paragraph
 */
export function checkReaderArticle(raw: unknown, pageUrl: string, pageTitle: string): ReaderArticle | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const article = raw as Record<string, unknown>;
  const checkedBlocks = checkBlocks(article.blocks);
  const hasText = checkedBlocks.some((block) => block.kind === "paragraph");
  if (!hasText) {
    return null;
  }
  const host = readHost(pageUrl);
  const siteName = readText(article.siteName, MAX_LINE_LENGTH);
  const metaTitle = readText(article.metaTitle, MAX_LINE_LENGTH);
  const heading = readText(article.heading, MAX_LINE_LENGTH);
  const title = chooseTitle(metaTitle, heading, readText(pageTitle, MAX_LINE_LENGTH), siteName, host);
  const blocksUnderTitle = withoutTitleHeading(checkedBlocks, title);
  const blocks = withoutEmptySections(blocksUnderTitle);
  return {
    title: title,
    byline: readText(article.byline, MAX_LINE_LENGTH),
    siteName: siteName || host,
    url: pageUrl,
    blocks: blocks,
    minutesToRead: Math.max(1, Math.round(countWords(blocks) / READING_WORDS_PER_MINUTE)),
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
