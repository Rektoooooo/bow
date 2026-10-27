/**
 * WHY this file exists:
 *   Arc labels how long ago a tab was used in words ("1 minute ago", "18 hours ago", "2 weeks ago"; the list a closed
 *   folder shows on hover, in the user's recording). This turns a time into that wording, in one place.
 *
 * Data source:
 *   A time and "now", both in milliseconds since 1970 (the caller passes now: no clock in here).
 *
 * Data flow:
 *   overlay/folderList.ts → describeTimeAgo(tab.lastActiveAt, Date.now()) → the line under the tab's title
 */
import { DAY_MS, HOUR_MS, MINUTE_MS } from "./settings.js";

const WEEK_MS = 7 * DAY_MS;

/** Arc counts months of 30 days and years of 365 (our choice; only the order of magnitude shows). */
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/** The steps from the largest down: a time falls into the first whose length it reaches. */
const STEPS: { lengthMs: number; unit: string }[] = [
  { lengthMs: YEAR_MS, unit: "year" },
  { lengthMs: MONTH_MS, unit: "month" },
  { lengthMs: WEEK_MS, unit: "week" },
  { lengthMs: DAY_MS, unit: "day" },
  { lengthMs: HOUR_MS, unit: "hour" },
  { lengthMs: MINUTE_MS, unit: "minute" },
];

/**
 * How long ago a time was, in Arc's words. Under a minute (or in the future) is "Just now".
 * Examples: 61 s → "1 minute ago"; 18 h → "18 hours ago"; 8 days → "1 week ago"
 */
export function describeTimeAgo(time: number, now: number): string {
  const elapsed = now - time;
  for (const step of STEPS) {
    if (elapsed < step.lengthMs) {
      continue;
    }
    const count = Math.floor(elapsed / step.lengthMs);
    const unit = count === 1 ? step.unit : `${step.unit}s`;
    return `${count} ${unit} ago`;
  }
  return "Just now";
}
