// Search keywords: "yt cats" searches the page the user named "yt", from the address field and the Command Bar.
import { describe, expect, it } from "vitest";
import { addSearchKeyword, createInitialState, removeSearchKeyword } from "../src/main/state";
import { normalizeTypedInput } from "../src/main/urls";
import { findSearchEngine } from "../src/shared/searchEngines";
import { isValidSearchKeyword, matchSearchKeyword } from "../src/shared/searchKeywords";
import type { SearchKeyword } from "../src/shared/types";

const youtube: SearchKeyword = { keyword: "yt", name: "YouTube", url: "https://www.youtube.com/results?search_query=%s" };
const engine = findSearchEngine("duckduckgo");

describe("search keywords", () => {
  it("send the words after a keyword to its page, encoded", () => {
    expect(normalizeTypedInput("yt cats & dogs", engine, [youtube])).toBe("https://www.youtube.com/results?search_query=cats%20%26%20dogs");
    expect(normalizeTypedInput("YT cats", engine, [youtube])).toBe("https://www.youtube.com/results?search_query=cats");
  });

  it("leave everything else to the address or the default engine", () => {
    expect(normalizeTypedInput("yt", engine, [youtube])).toContain("duckduckgo.com");
    expect(normalizeTypedInput("ytube cats", engine, [youtube])).toContain("duckduckgo.com");
    expect(normalizeTypedInput("example.com", engine, [youtube])).toBe("https://example.com");
  });

  it("never use a keyword whose address is not a web page", () => {
    const sneaky: SearchKeyword = { keyword: "x", name: "X", url: "javascript:alert('%s')" };
    expect(matchSearchKeyword("x hello", [sneaky])).toBeNull();
    expect(normalizeTypedInput("x hello", engine, [sneaky])).toContain("duckduckgo.com");
  });

  it("only valid entries can be saved", () => {
    expect(isValidSearchKeyword(youtube)).toBe(true);
    expect(isValidSearchKeyword({ ...youtube, keyword: "two words" })).toBe(false);
    expect(isValidSearchKeyword({ ...youtube, url: "https://www.youtube.com/" })).toBe(false);
    expect(isValidSearchKeyword({ ...youtube, name: " " })).toBe(false);
    expect(isValidSearchKeyword({ ...youtube, url: "file:///etc/%s" })).toBe(false);
  });
});

describe("keeping search keywords", () => {
  it("adds a keyword cleaned up, replaces one with the same keyword, refuses broken ones and removes", () => {
    const start = createInitialState();
    const added = addSearchKeyword(start, { keyword: " YT ", name: " YouTube ", url: youtube.url });
    expect(added.searchKeywords).toEqual([youtube]);
    const replaced = addSearchKeyword(added, { ...youtube, name: "Videos" });
    expect(replaced.searchKeywords).toEqual([{ ...youtube, name: "Videos" }]);
    expect(addSearchKeyword(added, { ...youtube, url: "https://no-placeholder.example/" })).toBe(added);
    expect(removeSearchKeyword(added, "yt").searchKeywords).toEqual([]);
    expect(removeSearchKeyword(added, "nope")).toBe(added);
  });
});
