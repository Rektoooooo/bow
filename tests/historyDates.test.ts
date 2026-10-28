/**
 * WHY this file exists:
 *   Typing a time in the Command Bar ("yesterday", "last week github") lists the history of that time. These tests pin
 *   down which calendar days each phrase means, on a fixed Wednesday, in the test machine's own time zone (built with
 *   local dates, so they hold on a Mac in Prague and on a runner in UTC alike).
 */
import { describe, expect, it } from "vitest";
import { readDatePhrase } from "../src/main/historyDates";

/** Wednesday 28 October 2026, 14:00 local time. */
const NOW = new Date(2026, 9, 28, 14, 0).getTime();
const day = (date: number): number => new Date(2026, 9, date).getTime();

describe("history dates", () => {
  it("read today, yesterday and days ago as whole calendar days", () => {
    expect(readDatePhrase("today", NOW)).toEqual({ range: { start: day(28), end: day(29) }, words: "" });
    expect(readDatePhrase("Yesterday", NOW)).toEqual({ range: { start: day(27), end: day(28) }, words: "" });
    expect(readDatePhrase("3 days ago", NOW)?.range).toEqual({ start: day(25), end: day(26) });
    expect(readDatePhrase("1 day ago", NOW)?.range).toEqual({ start: day(27), end: day(28) });
  });

  it("read a weekday as the latest one (today included) and 'last' as the one before today", () => {
    expect(readDatePhrase("monday", NOW)?.range).toEqual({ start: day(26), end: day(27) });
    expect(readDatePhrase("wednesday", NOW)?.range).toEqual({ start: day(28), end: day(29) });
    expect(readDatePhrase("last wednesday", NOW)?.range).toEqual({ start: day(21), end: day(22) });
    expect(readDatePhrase("thursday", NOW)?.range).toEqual({ start: day(22), end: day(23) });
  });

  it("read weeks from Monday, across a daylight-saving change", () => {
    expect(readDatePhrase("this week", NOW)?.range).toEqual({ start: day(26), end: new Date(2026, 10, 2).getTime() });
    expect(readDatePhrase("last week", NOW)?.range).toEqual({ start: day(19), end: day(26) });
  });

  it("keep the other words, before or after the time", () => {
    expect(readDatePhrase("yesterday github", NOW)?.words).toBe("github");
    expect(readDatePhrase("github  pull requests last week", NOW)).toEqual({ range: { start: day(19), end: day(26) }, words: "github pull requests" });
    expect(readDatePhrase("last monday docs", NOW)).toEqual({ range: { start: day(26), end: day(27) }, words: "docs" });
  });

  it("find no time in other queries", () => {
    for (const query of ["", "pizza recipes", "last", "weekly report", "mondays", "today's news", "1000 days ago"]) {
      expect(readDatePhrase(query, NOW), query).toBeNull();
    }
  });
});
