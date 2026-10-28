/**
 * WHY this file exists:
 *   Reader view in the card: the article main read from the page (main/readerView.ts) as one calm column of text,
 *   with the site's name and reading time on top and text size buttons. The page itself stays loaded, hidden under
 *   it. Everything comes in as plain text and goes out with textContent: nothing from the page runs here.
 *
 * Data source:
 *   RuntimeState.readerTabIds (which tabs show Reader view) and the article (browserApi.readReaderArticle).
 *
 * Data flow:
 *   sidebar.ts renderAll → renderReaderView() → readReaderArticle(tabId) → the article in #card-slot
 *   A− / A+ → setReaderTextSize; Done or Escape → toggleReaderView (main shows the page again)
 */
import { READER_DEFAULT_TEXT_SIZE, READER_TEXT_SIZES } from "../shared/settings.js";
import type { BrowserState, ItemId, ReaderArticle, ReaderBlock, RuntimeState } from "../shared/types";
import { createElement, createTextButton, dispatch } from "./dom.js";

/** The tab whose article is drawn (or being read), or null. */
let shownTabId: ItemId | null = null;

/** The text size now, for the A− / A+ buttons. */
let textSize: number = READER_DEFAULT_TEXT_SIZE;

/**
 * The next text size up (+1) or down (−1), staying within READER_TEXT_SIZES.
 */
function stepTextSize(offset: number): number {
  const sizes: readonly number[] = READER_TEXT_SIZES;
  const index = sizes.indexOf(textSize);
  const currentIndex = index === -1 ? sizes.indexOf(READER_DEFAULT_TEXT_SIZE) : index;
  const nextIndex = Math.min(Math.max(currentIndex + offset, 0), sizes.length - 1);
  return sizes[nextIndex] as number;
}

/**
 * One block as an element. List items are gathered into lists by drawArticle().
 */
function createBlock(block: ReaderBlock): HTMLElement {
  if (block.kind === "image") {
    const image = document.createElement("img");
    image.className = "reader-image";
    image.src = block.src;
    image.alt = block.alt;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    return image;
  }
  if (block.kind === "heading") {
    // The article's title is the h1; its own headings start one level below.
    const level = Math.min(block.level + 1, 4);
    return createElement(`h${level}`, "reader-heading", block.text);
  }
  const tagByKind: Record<typeof block.kind, string> = { paragraph: "p", listItem: "li", quote: "blockquote", code: "pre", caption: "p" };
  return createElement(tagByKind[block.kind], `reader-${block.kind}`, block.text);
}

/**
 * The article's blocks in order, consecutive list items in one list.
 */
function createBlocks(blocks: ReaderBlock[]): HTMLElement[] {
  const elements: HTMLElement[] = [];
  let list: HTMLElement | null = null;
  for (const block of blocks) {
    if (block.kind !== "listItem") {
      list = null;
      elements.push(createBlock(block));
      continue;
    }
    if (list === null) {
      list = createElement("ul", "reader-list");
      elements.push(list);
    }
    list.append(createBlock(block));
  }
  return elements;
}

/**
 * Draws an article into the card, over the hidden page, and takes the keyboard (Escape leaves, arrows scroll).
 */
function drawArticle(cardSlot: HTMLElement, article: ReaderArticle): void {
  const view = createElement("article", "reader-view");
  view.tabIndex = -1;
  const bar = createElement("div", "reader-bar");
  const facts = createElement("span", "reader-facts", `${article.siteName} · ${article.minutesToRead} min read`);
  const smaller = createTextButton("A−", "reader-button reader-smaller", () => dispatch({ type: "setReaderTextSize", size: stepTextSize(-1) }));
  smaller.title = "Smaller text";
  const larger = createTextButton("A+", "reader-button reader-larger", () => dispatch({ type: "setReaderTextSize", size: stepTextSize(1) }));
  larger.title = "Larger text";
  const done = createTextButton("Done", "reader-button reader-done", () => dispatch({ type: "toggleReaderView" }));
  done.title = "Back to the page (⌃⌘R)";
  bar.append(facts, smaller, larger, done);
  const column = createElement("div", "reader-column");
  column.append(createElement("h1", "reader-title", article.title));
  if (article.byline !== "") {
    column.append(createElement("p", "reader-byline", article.byline));
  }
  column.append(...createBlocks(article.blocks));
  view.append(bar, column);
  view.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dispatch({ type: "toggleReaderView" });
    }
  });
  cardSlot.querySelector(".reader-view")?.remove();
  cardSlot.append(view);
  view.focus();
}

/**
 * Shows the selected tab's article while it is in Reader view, and takes it away otherwise.
 */
export function renderReaderView(cardSlot: HTMLElement, state: BrowserState, runtime: RuntimeState, selectedTabId: ItemId | null): void {
  textSize = state.settings.readerTextSize ?? READER_DEFAULT_TEXT_SIZE;
  cardSlot.style.setProperty("--reader-text-size", `${textSize}px`);
  const isReader = selectedTabId !== null && runtime.readerTabIds.includes(selectedTabId);
  if (!isReader) {
    shownTabId = null;
    cardSlot.querySelector(".reader-view")?.remove();
    return;
  }
  if (shownTabId === selectedTabId) {
    return;
  }
  shownTabId = selectedTabId;
  window.browserApi
    .readReaderArticle(selectedTabId)
    .then((article) => {
      // Another tab may have been selected while the article was on its way.
      if (article !== null && shownTabId === selectedTabId) {
        drawArticle(cardSlot, article);
      }
    })
    .catch(() => undefined);
}
