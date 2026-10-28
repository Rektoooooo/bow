/**
 * WHY this file exists:
 *   The privacy report counts what the blocker stopped, per day, for a month. These tests pin down the counting, the
 *   week's summary (calendar days in the Mac's own time zone, built from local dates so they hold in any zone), the
 *   cleanup of old days, and what a damaged file may bring in.
 */
import { describe, expect, it } from "vitest";
import { checkPrivacyReport, EMPTY_PRIVACY_REPORT, PRIVACY_REPORT_DAYS, recordBlocked, summarizePrivacy, toDayKey } from "../src/main/privacyReport";
import { DAY_MS } from "../src/shared/settings";

/** Wednesday 28 October 2026, 14:00 local time. */
const NOW = new Date(2026, 9, 28, 14, 0).getTime();

describe("privacy report", () => {
  it("counts blocks per site and tracker on the day they happen", () => {
    let report = recordBlocked(EMPTY_PRIVACY_REPORT, "news.example", "ads.tracker.example", NOW);
    report = recordBlocked(report, "news.example", "pixel.example", NOW);
    report = recordBlocked(report, "shop.example", "ads.tracker.example", NOW);
    expect(report.days).toEqual([{ day: "2026-10-28", sites: { "news.example": 2, "shop.example": 1 }, trackers: { "ads.tracker.example": 2, "pixel.example": 1 } }]);
  });

  it("summarizes the last 7 days, oldest first, with the top sites and trackers", () => {
    let report = recordBlocked(EMPTY_PRIVACY_REPORT, "news.example", "ads.tracker.example", new Date(2026, 9, 22, 9).getTime());
    report = recordBlocked(report, "news.example", "ads.tracker.example", NOW);
    report = recordBlocked(report, "shop.example", "pixel.example", NOW);
    const summary = summarizePrivacy(report, NOW);
    expect(summary.total).toBe(3);
    expect(summary.byDay.map((day) => day.day)).toEqual(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"]);
    expect(summary.byDay.map((day) => day.count)).toEqual([1, 0, 0, 0, 0, 0, 2]);
    expect(summary.topSites[0]).toEqual({ name: "news.example", count: 2 });
    expect(summary.topTrackers[0]).toEqual({ name: "ads.tracker.example", count: 2 });
  });

  it("forgets days older than a month, and ignores names that are not hosts", () => {
    const old = recordBlocked(EMPTY_PRIVACY_REPORT, "news.example", "ads.tracker.example", NOW - PRIVACY_REPORT_DAYS * DAY_MS);
    const fresh = recordBlocked(old, "news.example", "ads.tracker.example", NOW);
    expect(fresh.days.map((day) => day.day)).toEqual([toDayKey(NOW)]);
    expect(recordBlocked(fresh, "<script>", "ads.tracker.example", NOW)).toBe(fresh);
  });

  it("reads only well-formed days and counts from a file", () => {
    const report = checkPrivacyReport({ days: [{ day: "2026-10-28", sites: { "news.example": 3, "bad name": 2, "x.example": -1 }, trackers: { "t.example": 1.5 } }, { day: "yesterday" }, "nonsense"] });
    expect(report.days).toEqual([{ day: "2026-10-28", sites: { "news.example": 3 }, trackers: {} }]);
    expect(checkPrivacyReport(null).days).toEqual([]);
  });
});
