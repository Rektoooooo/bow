// Day headings over History: today, yesterday, a weekday within the last week, then a date (with the year when it
// differs). Dates are built in the Mac's own time zone, as describeDay works in it.
import { describe, expect, it } from "vitest";
import { describeDay } from "../src/shared/timeAgo";

/** Wednesday 28 October 2026, 09:30 local time. */
const NOW = new Date(2026, 9, 28, 9, 30).getTime();

describe("describeDay", () => {
  it("names today and yesterday by the calendar, not by 24 hours", () => {
    expect(describeDay(new Date(2026, 9, 28, 0, 5).getTime(), NOW)).toBe("Today");
    expect(describeDay(new Date(2026, 9, 27, 23, 55).getTime(), NOW)).toBe("Yesterday");
    expect(describeDay(new Date(2026, 9, 27, 0, 1).getTime(), NOW)).toBe("Yesterday");
  });

  it("uses the weekday within the last week", () => {
    expect(describeDay(new Date(2026, 9, 26, 12, 0).getTime(), NOW)).toBe("Monday");
    expect(describeDay(new Date(2026, 9, 22, 12, 0).getTime(), NOW)).toBe("Thursday");
  });

  it("uses the date for older days, with the year only when it is another year", () => {
    expect(describeDay(new Date(2026, 9, 21, 12, 0).getTime(), NOW)).toBe("21 October");
    expect(describeDay(new Date(2025, 11, 31, 12, 0).getTime(), NOW)).toBe("31 December 2025");
  });

  it("calls a time later than now today", () => {
    expect(describeDay(NOW + 60 * 60 * 1000, NOW)).toBe("Today");
  });
});
