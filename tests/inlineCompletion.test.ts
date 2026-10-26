/**
 * WHY this file exists:
 *   The Command Bar's inline completion must only finish addresses the user is clearly typing, and finish them to
 *   the right length; these tests pin that down.
 */
import { describe, expect, it } from "vitest";
import { findInlineCompletion, toCompletionText } from "../src/shared/inlineCompletion";

const candidates = [
  { lineId: "search", url: "https://duckduckgo.com/?q=git" },
  { lineId: "github", url: "https://github.com/" },
  { lineId: "wiki", url: "https://en.wikipedia.org/wiki/Web_browser" },
];

describe("inline completion", () => {
  it("finishes the site's name from the best matching result", () => {
    expect(findInlineCompletion("git", candidates)).toEqual({ lineId: "github", text: "github.com" });
    expect(findInlineCompletion("en.wik", candidates)).toEqual({ lineId: "wiki", text: "en.wikipedia.org" });
  });

  it("finishes the whole address once a path is being typed", () => {
    expect(findInlineCompletion("en.wikipedia.org/wiki/W", candidates)?.text).toBe("en.wikipedia.org/wiki/Web_browser");
  });

  it("keeps what was typed, scheme and capitals included", () => {
    expect(findInlineCompletion("https://Git", candidates)?.text).toBe("https://Github.com");
  });

  it("does not complete searches, single letters, finished addresses or other schemes", () => {
    expect(findInlineCompletion("git hub", candidates)).toBeNull();
    expect(findInlineCompletion("g", candidates)).toBeNull();
    expect(findInlineCompletion("github.com", candidates)).toBeNull();
    expect(toCompletionText("file:///etc/hosts")).toBeNull();
    expect(toCompletionText("https://www.example.com/")).toBe("example.com");
  });
});
