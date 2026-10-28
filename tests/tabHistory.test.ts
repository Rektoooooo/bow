/**
 * WHY this file exists:
 *   Each tab's back/forward list (with Chromium's page state: the scroll position) is saved so a crash loses little.
 *   These tests pin down what is kept around the entry on screen, and what a damaged file may bring back.
 */
import { describe, expect, it } from "vitest";
import { checkSavedHistories, trimHistory } from "../src/main/tabHistory";

const entry = (number: number, pageState?: string) => ({ url: `https://example.com/${number}`, title: `Page ${number}`, pageState: pageState });

describe("saved tab histories", () => {
  it("keep the entries around the one on screen, with their page state", () => {
    const entries = Array.from({ length: 30 }, (_, index) => entry(index, `state-${index}`));
    const trimmed = trimHistory(entries, 24);
    expect(trimmed?.entries[0]?.url).toBe("https://example.com/14");
    expect(trimmed?.entries.at(-1)?.url).toBe("https://example.com/29");
    expect(trimmed?.entries[trimmed.activeIndex]).toEqual({ url: "https://example.com/24", title: "Page 24", pageState: "state-24" });
    expect(trimHistory([], 0)).toBeNull();
  });

  it("leave out a page state too large to keep", () => {
    const trimmed = trimHistory([entry(1, "x".repeat(200 * 1024))], 0);
    expect(trimmed?.entries[0]).toEqual({ url: "https://example.com/1", title: "Page 1" });
  });

  it("read back only whole histories on web addresses", () => {
    const histories = checkSavedHistories({
      "tab-1": { entries: [entry(1, "s")], activeIndex: 0 },
      "tab-2": { entries: [{ url: "javascript:alert(1)", title: "x" }], activeIndex: 0 },
      "tab-3": { entries: [entry(3)], activeIndex: 5 },
      "tab-4": "nonsense",
    });
    expect(Array.from(histories.keys())).toEqual(["tab-1"]);
    expect(histories.get("tab-1")?.entries[0]?.pageState).toBe("s");
  });
});
