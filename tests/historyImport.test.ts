/**
 * WHY this file exists:
 *   History from another browser arrives as Chromium database rows with a different clock and sometimes odd
 *   values. These tests pin down the time conversion, the filtering and how imported history merges with ours.
 *
 * Data source:
 *   Rows and entries written by hand below. No real browsing data.
 *
 * Data flow:
 *   rows → convertChromiumHistoryRows() → entries → mergeHistory() with existing entries → checks
 */
import { describe, expect, it } from "vitest";
import { convertChromiumHistoryRows, HISTORY_LIMIT, mergeHistory } from "../src/main/history";
import type { HistoryEntry } from "../src/main/history";
import { ONE_PM } from "./builders";

/** Chromium counts microseconds from 1601; the Unix epoch (1970) is 11644473600000 ms later. */
const CHROMIUM_EPOCH_OFFSET_MILLISECONDS = 11644473600000;
const ONE_PM_CHROMIUM_MICROSECONDS = (ONE_PM + CHROMIUM_EPOCH_OFFSET_MILLISECONDS) * 1000;

function createEntry(url: string, title: string, visitCount: number, lastVisitAt: number): HistoryEntry {
  return { url: url, title: title, visitCount: visitCount, lastVisitAt: lastVisitAt };
}

describe("convertChromiumHistoryRows", () => {
  it("converts microseconds since 1601 into Unix milliseconds", () => {
    const rows = [{ url: "https://a.example/", title: "A", visit_count: 3, last_visit_time: ONE_PM_CHROMIUM_MICROSECONDS }];
    expect(convertChromiumHistoryRows(rows)).toEqual([createEntry("https://a.example/", "A", 3, ONE_PM)]);
  });

  it("maps the Unix epoch to zero", () => {
    const rows = [{ url: "https://a.example/", title: "A", visit_count: 1, last_visit_time: 11644473600000000 }];
    expect(convertChromiumHistoryRows(rows)[0]?.lastVisitAt).toBe(0);
  });

  it("leaves out addresses that are not web pages", () => {
    const rows = [
      { url: "chrome://settings", title: "S", visit_count: 1, last_visit_time: ONE_PM_CHROMIUM_MICROSECONDS },
      { url: "file:///tmp/x.html", title: "F", visit_count: 1, last_visit_time: ONE_PM_CHROMIUM_MICROSECONDS },
      { url: "http://ok.example/", title: "OK", visit_count: 1, last_visit_time: ONE_PM_CHROMIUM_MICROSECONDS },
    ];
    expect(convertChromiumHistoryRows(rows).map((entry) => entry.url)).toEqual(["http://ok.example/"]);
  });

  it("leaves out malformed rows and accepts a missing title", () => {
    const rows = [
      null,
      "text",
      { title: "no url", visit_count: 1, last_visit_time: 1 },
      { url: "https://a.example/", title: "A", visit_count: "many", last_visit_time: 1 },
      { url: "https://b.example/", title: "B", visit_count: 1, last_visit_time: "yesterday" },
      { url: "https://c.example/", visit_count: 2, last_visit_time: ONE_PM_CHROMIUM_MICROSECONDS },
    ];
    expect(convertChromiumHistoryRows(rows)).toEqual([createEntry("https://c.example/", "", 2, ONE_PM)]);
  });

  it("returns nothing when the input is not a list", () => {
    expect(convertChromiumHistoryRows({})).toEqual([]);
    expect(convertChromiumHistoryRows(null)).toEqual([]);
  });
});

describe("mergeHistory", () => {
  it("returns the same array when nothing is imported", () => {
    const entries = [createEntry("https://a.example/", "A", 1, ONE_PM)];
    expect(mergeHistory(entries, [])).toBe(entries);
  });

  it("keeps one entry per address, adds the visit counts and keeps the newest visit and title", () => {
    const entries = [createEntry("https://a.example/", "Old title", 2, 1000)];
    const imported = [createEntry("https://a.example/", "New title", 5, 2000)];
    expect(mergeHistory(entries, imported)).toEqual([createEntry("https://a.example/", "New title", 7, 2000)]);
  });

  it("keeps our newer title when the imported visit is older", () => {
    const entries = [createEntry("https://a.example/", "Ours", 1, 2000)];
    const imported = [createEntry("https://a.example/", "Theirs", 1, 1000)];
    expect(mergeHistory(entries, imported)[0]?.title).toBe("Ours");
  });

  it("keeps the older title when the newest entry has none", () => {
    const entries = [createEntry("https://a.example/", "Known", 1, 1000)];
    const imported = [createEntry("https://a.example/", "", 1, 2000)];
    expect(mergeHistory(entries, imported)).toEqual([createEntry("https://a.example/", "Known", 2, 2000)]);
  });

  it("sorts newest first", () => {
    const entries = [createEntry("https://b.example/", "B", 1, 2000)];
    const imported = [createEntry("https://a.example/", "A", 1, 1000), createEntry("https://c.example/", "C", 1, 3000)];
    const urls = mergeHistory(entries, imported).map((entry) => entry.url);
    expect(urls).toEqual(["https://c.example/", "https://b.example/", "https://a.example/"]);
  });

  it("keeps at most HISTORY_LIMIT entries, the newest", () => {
    const imported: HistoryEntry[] = [];
    for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) {
      imported.push(createEntry(`https://site${index}.example/`, "S", 1, index));
    }
    const merged = mergeHistory([], imported);
    expect(merged).toHaveLength(HISTORY_LIMIT);
    expect(merged[0]?.lastVisitAt).toBe(HISTORY_LIMIT + 4);
    expect(merged[HISTORY_LIMIT - 1]?.lastVisitAt).toBe(5);
  });
});
