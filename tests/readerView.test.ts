/**
 * WHY this file exists:
 *   Reader view draws what a script read from a page, which is untrusted. These tests pin down what is kept (plain
 *   text blocks and web images), what is dropped, and the article's facts (title, site, reading time).
 */
import { describe, expect, it } from "vitest";
import { checkReaderArticle } from "../src/main/readerView";

const PAGE_URL = "https://www.news.example/2026/10/a-story";
const words = (count: number): string => Array.from({ length: count }, () => "word").join(" ");

describe("Reader view articles", () => {
  it("keep text blocks and web images, with the title, byline and reading time", () => {
    const article = checkReaderArticle(
      {
        title: "A story",
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
        title: "",
        blocks: [
          { kind: "paragraph", text: "Kept." },
          { kind: "image", src: "javascript:alert(1)", alt: "" },
          { kind: "image", src: "data:image/png;base64,AAAA", alt: "" },
          { kind: "script", text: "alert(1)" },
          { kind: "paragraph", text: 42 },
          { kind: "heading", level: 9, text: "Too deep" },
          "nonsense",
        ],
      },
      PAGE_URL,
      "Page title",
    );
    expect(article?.title).toBe("Page title");
    expect(article?.blocks).toEqual([
      { kind: "paragraph", text: "Kept." },
      { kind: "heading", level: 2, text: "Too deep" },
    ]);
  });

  it("find no article without a paragraph", () => {
    expect(checkReaderArticle({ title: "Menu", blocks: [{ kind: "listItem", text: "Home" }] }, PAGE_URL, "Menu")).toBeNull();
    expect(checkReaderArticle(null, PAGE_URL, "Nothing")).toBeNull();
  });
});
