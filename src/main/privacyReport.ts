/**
 * WHY this file exists:
 *   The privacy report (Library › Privacy): how many trackers Bow's blocker stopped, on which sites, from which
 *   tracker hosts, day by day, like Safari's report. Counts only: no page addresses, no times within a day, nothing
 *   from private windows. Kept 30 days.
 *
 * Data source:
 *   Each request the blocker cancels (adBlock.ts): the site of the page it came from and the tracker's host.
 *
 * Data flow:
 *   adBlock.ts blocks → privacyReportStore.ts noteBlockedRequest() → recordBlocked() → file
 *   Library › Privacy → summarizePrivacy(report, now) → the week's total, bars, top sites and trackers
 *
 * Rules: pure; `now` is a parameter. Days are calendar days in the Mac's time zone.
 */
import { DAY_MS } from "../shared/settings";
import type { PrivacySummary } from "../shared/types";

/** One day's counts. */
export interface PrivacyDay {
  /** "2026-10-28", the Mac's calendar day. */
  day: string;
  /** Requests blocked on each site's pages. */
  sites: Record<string, number>;
  /** Requests blocked to each tracker host. */
  trackers: Record<string, number>;
}

/** Every kept day, oldest first. */
export interface PrivacyReport {
  days: PrivacyDay[];
}

/** Days kept. Our choice: a month, like Safari's 30-day report. */
export const PRIVACY_REPORT_DAYS = 30;

/** Days the Library shows. */
export const PRIVACY_SUMMARY_DAYS = 7;

/** Most sites and tracker hosts counted in one day; more are left out. Our choice: a busy day is well below. */
const MAX_NAMES_PER_DAY = 400;

/** Most sites and trackers the Library lists. Our choice. */
const TOP_LIST_LENGTH = 10;

/** A host or site name as the report keeps it: letters, digits, dots, dashes, and an optional port. */
const NAME_PATTERN = /^[a-z0-9.-]{1,253}(:[0-9]{1,5})?$/;

/** An empty report. */
export const EMPTY_PRIVACY_REPORT: PrivacyReport = { days: [] };

/**
 * A time's calendar day in the Mac's time zone: "2026-10-28".
 */
export function toDayKey(time: number): string {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Adds one to a name's count, unless the day already counts MAX_NAMES_PER_DAY names and this is a new one.
 */
function addOne(counts: Record<string, number>, name: string): Record<string, number> {
  const isKnown = Object.hasOwn(counts, name);
  if (!isKnown && Object.keys(counts).length >= MAX_NAMES_PER_DAY) {
    return counts;
  }
  return { ...counts, [name]: (isKnown ? (counts[name] as number) : 0) + 1 };
}

/**
 * The report with one more blocked request: the page's site and the tracker's host, on today's date. Days older
 * than PRIVACY_REPORT_DAYS go.
 * Example: recordBlocked(empty, "news.example", "tracker.example", now) → today: { sites: { "news.example": 1 }, … }
 */
export function recordBlocked(report: PrivacyReport, site: string, trackerHost: string, now: number): PrivacyReport {
  if (!NAME_PATTERN.test(site) || !NAME_PATTERN.test(trackerHost)) {
    return report;
  }
  const today = toDayKey(now);
  const oldestKept = toDayKey(now - (PRIVACY_REPORT_DAYS - 1) * DAY_MS);
  const keptDays = report.days.filter((day) => day.day >= oldestKept && day.day !== today);
  const current = report.days.find((day) => day.day === today) ?? { day: today, sites: {}, trackers: {} };
  const updated: PrivacyDay = { day: today, sites: addOne(current.sites, site), trackers: addOne(current.trackers, trackerHost) };
  return { days: [...keptDays, updated] };
}

/**
 * Adds a day's counts into running totals.
 */
function addCounts(totals: Map<string, number>, counts: Record<string, number>): void {
  for (const [name, count] of Object.entries(counts)) {
    totals.set(name, (totals.get(name) ?? 0) + count);
  }
}

/**
 * The biggest counts, largest first (ties by name).
 */
function topOf(totals: Map<string, number>): { name: string; count: number }[] {
  const entries = Array.from(totals, ([name, count]) => ({ name: name, count: count }));
  entries.sort((first, second) => second.count - first.count || first.name.localeCompare(second.name));
  return entries.slice(0, TOP_LIST_LENGTH);
}

/**
 * What the Library shows: the last PRIVACY_SUMMARY_DAYS days' total, one count per day (oldest first, today last,
 * days without blocks as 0), and the sites and trackers with the most blocks.
 */
export function summarizePrivacy(report: PrivacyReport, now: number): PrivacySummary {
  const siteTotals = new Map<string, number>();
  const trackerTotals = new Map<string, number>();
  const byDay: { day: string; count: number }[] = [];
  for (let daysAgo = PRIVACY_SUMMARY_DAYS - 1; daysAgo >= 0; daysAgo--) {
    // Noon keeps the step a whole calendar day across a daylight-saving change.
    const noon = new Date(now);
    noon.setHours(12, 0, 0, 0);
    const dayKey = toDayKey(noon.getTime() - daysAgo * DAY_MS);
    const day = report.days.find((candidate) => candidate.day === dayKey);
    const sites = day?.sites ?? {};
    addCounts(siteTotals, sites);
    addCounts(trackerTotals, day?.trackers ?? {});
    const count = Object.values(sites).reduce((sum, value) => sum + value, 0);
    byDay.push({ day: dayKey, count: count });
  }
  const total = byDay.reduce((sum, day) => sum + day.count, 0);
  return { total: total, byDay: byDay, topSites: topOf(siteTotals), topTrackers: topOf(trackerTotals) };
}

/**
 * A report read from its file, checked: well-formed days with names and whole counts only; anything else is left out.
 */
export function checkPrivacyReport(raw: unknown): PrivacyReport {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const days: PrivacyDay[] = [];
  for (const entry of Array.isArray(record.days) ? record.days.slice(-PRIVACY_REPORT_DAYS) : []) {
    const day = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    if (typeof day.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day.day)) {
      continue;
    }
    days.push({ day: day.day, sites: checkCounts(day.sites), trackers: checkCounts(day.trackers) });
  }
  return { days: days };
}

/**
 * Counts from a file: names in NAME_PATTERN with positive whole counts, at most MAX_NAMES_PER_DAY.
 */
function checkCounts(raw: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  for (const [name, count] of Object.entries(record).slice(0, MAX_NAMES_PER_DAY)) {
    if (NAME_PATTERN.test(name) && typeof count === "number" && Number.isInteger(count) && count > 0) {
      counts[name] = count;
    }
  }
  return counts;
}
