/**
 * WHY this file exists:
 *   Reader view draws what a script read from a page, which is untrusted. These tests pin down what is kept (plain
 *   text blocks and web images), what is dropped, and the article's facts (title, site, reading time): the title is
 *   shown once, without the site's name after it, and headings left with nothing under them go.
 */
import { describe, expect, it } from "vitest";
import { checkReaderArticle } from "../src/main/readerView";

const PAGE_URL = "https://www.news.example/2026/10/a-story";
const WIKI_URL = "https://en.wikipedia.org/wiki/Web_browser";
const words = (count: number): string => Array.from({ length: count }, () => "word").join(" ");
const paragraph = { kind: "paragraph", text: "Some text." };

describe("Reader view articles", () => {
  it("keep text blocks and web images, with the title, byline and reading time", () => {
    const article = checkReaderArticle(
      {
        metaTitle: "A story",
        byline: "Ann Example",
        siteName: "",
        blocks: [
          { kind: "heading", level: 1, text: "A story" },
          { kind: "paragraph", text: `  ${words(460)}  ` },
          { kind: "heading", level: 2, text: "Part two" },
          { kind: "image", src: "https://cdn.news.example/photo.jpg", alt: "A photo" },
          { kind: "listItem", text: "One" },
          { kind: "code", text: "  indented code\n" },
        ],
      },
      PAGE_URL,
      "A story - News",
    );
    expect(article).toMatchObject({ title: "A story", byline: "Ann Example", siteName: "news.example", url: PAGE_URL, minutesToRead: 2 });
    expect(article?.blocks.map((block) => block.kind)).toEqual(["paragraph", "heading", "image", "listItem", "code"]);
    expect(article?.blocks[4]).toEqual({ kind: "code", text: "  indented code\n" });
  });

  it("drop what is not a text block or a web image", () => {
    const article = checkReaderArticle(
      {
        metaTitle: "",
        blocks: [
          { kind: "heading", level: 9, text: "Too deep" },
          { kind: "paragraph", text: "Kept." },
          { kind: "image", src: "javascript:alert(1)", alt: "" },
          { kind: "image", src: "data:image/png;base64,AAAA", alt: "" },
          { kind: "script", text: "alert(1)" },
          { kind: "paragraph", text: 42 },
          "nonsense",
        ],
      },
      PAGE_URL,
      "Page title",
    );
    expect(article?.title).toBe("Page title");
    expect(article?.blocks).toEqual([
      { kind: "heading", level: 2, text: "Too deep" },
      { kind: "paragraph", text: "Kept." },
    ]);
  });

  it("find no article without a paragraph", () => {
    expect(checkReaderArticle({ metaTitle: "Menu", blocks: [{ kind: "listItem", text: "Home" }] }, PAGE_URL, "Menu")).toBeNull();
    expect(checkReaderArticle(null, PAGE_URL, "Nothing")).toBeNull();
  });
});

describe("Reader view titles", () => {
  it("show a Wikipedia article's title once: its heading, without the site's name", () => {
    const article = checkReaderArticle(
      { metaTitle: "Web browser - Wikipedia", heading: "Web browser", siteName: "", blocks: [{ kind: "heading", level: 1, text: "Web browser" }, paragraph] },
      WIKI_URL,
      "Web browser - Wikipedia",
    );
    expect(article?.title).toBe("Web browser");
    expect(article?.siteName).toBe("en.wikipedia.org");
    expect(article?.blocks).toEqual([paragraph]);
  });

  it("leave out the site's name at the end when the site names itself or its host names it", () => {
    const named = checkReaderArticle({ metaTitle: "A story | The Paper", siteName: "The Paper", blocks: [paragraph] }, PAGE_URL, "");
    const byHost = checkReaderArticle({ metaTitle: "", blocks: [paragraph] }, WIKI_URL, "Web browser – Wikipedia");
    const byCompactHost = checkReaderArticle({ metaTitle: "Phones, reviewed - The Verge", blocks: [paragraph] }, "https://www.theverge.com/phones", "");
    expect(named?.title).toBe("A story");
    expect(byHost?.title).toBe("Web browser");
    expect(byCompactHost?.title).toBe("Phones, reviewed");
  });

  it("keep an ending that is not the site's name", () => {
    const article = checkReaderArticle({ metaTitle: "Cats - a short history", siteName: "The Paper", blocks: [paragraph] }, PAGE_URL, "");
    expect(article?.title).toBe("Cats - a short history");
  });

  it("use the page's heading when the title is that heading with more after it", () => {
    const article = checkReaderArticle(
      { metaTitle: "", heading: "Paper boats", blocks: [{ kind: "heading", level: 1, text: "Paper boats" }, paragraph] },
      PAGE_URL,
      "Paper boats — The Daily Planet",
    );
    expect(article?.title).toBe("Paper boats");
    expect(article?.blocks).toEqual([paragraph]);
  });

  it("never take a heading that is the site's name (a logo) for the title", () => {
    const logo = checkReaderArticle({ metaTitle: "The Paper | Paper boats", heading: "The Paper", siteName: "The Paper", blocks: [paragraph] }, PAGE_URL, "");
    const aboutTheSite = checkReaderArticle({ metaTitle: "Wikipedia - Wikipedia", heading: "Wikipedia", blocks: [paragraph] }, "https://en.wikipedia.org/wiki/Wikipedia", "");
    expect(logo?.title).toBe("The Paper | Paper boats");
    expect(aboutTheSite?.title).toBe("Wikipedia");
  });

  it("drop the first heading when it repeats the title, ignoring case and spaces, and keep a different one", () => {
    const repeated = checkReaderArticle(
      { metaTitle: "Web browser", blocks: [{ kind: "image", src: "https://cdn.news.example/lead.jpg", alt: "" }, { kind: "heading", level: 1, text: "Web  Browser" }, paragraph] },
      PAGE_URL,
      "",
    );
    const different = checkReaderArticle({ metaTitle: "A story", blocks: [{ kind: "heading", level: 1, text: "Chapter one" }, paragraph] }, PAGE_URL, "");
    expect(repeated?.blocks.map((block) => block.kind)).toEqual(["image", "paragraph"]);
    expect(different?.blocks.map((block) => block.kind)).toEqual(["heading", "paragraph"]);
  });
});

describe("Reader view sections", () => {
  it("drop headings left with nothing under them, also a section whose only subsection was empty", () => {
    const article = checkReaderArticle(
      {
        metaTitle: "A story",
        blocks: [
          paragraph,
          { kind: "heading", level: 2, text: "History" },
          { kind: "heading", level: 3, text: "Early boats" },
          paragraph,
          { kind: "heading", level: 2, text: "See also" },
          { kind: "heading", level: 3, text: "Related" },
          { kind: "heading", level: 2, text: "References" },
          { kind: "listItem", text: "A book." },
          { kind: "heading", level: 2, text: "External links" },
        ],
      },
      PAGE_URL,
      "",
    );
    const headings = article?.blocks.flatMap((block) => (block.kind === "heading" ? [block.text] : []));
    expect(headings).toEqual(["History", "Early boats", "References"]);
  });
});
