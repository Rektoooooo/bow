/**
 * WHY this file exists:
 *   History by date in the Command Bar: type "yesterday", "monday", "last friday", "3 days ago", "this week" or
 *   "last week", alone or with words ("yesterday github"), and it lists the pages you visited then, newest first.
 *
 * Data source:
 *   The typed query and now (calendar days in the Mac's time zone).
 *
 * Data flow:
 *   commandBar.ts rankCommandBarResults → readDatePhrase(query, now) → the range and the other words → that time's
 *   history lines
 *
 * Rules: pure. History keeps each page's last visit only, so a page shows on the day you last opened it.
 */
import { WEEK_START_DAY } from "../shared/settings";
import { startOfDay } from "../shared/timeAgo";

/** A span of time from the query. */
export interface DateRange {
  /** Inclusive, milliseconds since 1970. */
  start: number;
  /** Exclusive. */
  end: number;
}

/** A query that names a time: the time, and the words to look for in it ("" for every page). */
export interface DatedQuery {
  range: DateRange;
  words: string;
}

/** Weekday names, in Date.getDay() order. */
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const DAYS_IN_WEEK = 7;

/** "3 days ago", "1 day ago". At most a year back: history is not kept longer in practice. */
const DAYS_AGO_PATTERN = /^([0-9]{1,3}) days? ago$/;

/** The most words a time phrase has ("3 days ago"). */
const LONGEST_PHRASE_WORDS = 3;

/**
 * The start of the calendar day a number of days after a day's start (before it when negative). Done with the
 * calendar, not by adding hours: a day with a daylight-saving change is 23 or 25 hours long.
 */
function shiftDay(dayStart: number, days: number): number {
  const date = new Date(dayStart);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}

/**
 * One whole calendar day.
 */
function wholeDay(dayStart: number): DateRange {
  return { start: dayStart, end: shiftDay(dayStart, 1) };
}

/**
 * The weekday phrase's day: "monday" is the latest Monday (today when it is one), "last monday" the one before
 * today. Null when the phrase is not a weekday.
 */
function readWeekday(phrase: string, today: number): DateRange | null {
  const isLast = phrase.startsWith("last ");
  const name = isLast ? phrase.slice("last ".length) : phrase;
  const weekday = WEEKDAY_NAMES.indexOf(name);
  if (weekday === -1) {
    return null;
  }
  const todayWeekday = new Date(today).getDay();
  const daysBackWithin = (todayWeekday - weekday + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  const daysBack = isLast && daysBackWithin === 0 ? DAYS_IN_WEEK : daysBackWithin;
  return wholeDay(shiftDay(today, -daysBack));
}

/**
 * The time a phrase names, or null.
 * Example (on Wednesday 28 October): "yesterday" → 27 October, "last week" → Monday 19 to Sunday 25 October
 */
function readPhrase(phrase: string, now: number): DateRange | null {
  const today = startOfDay(now);
  if (phrase === "today") {
    return wholeDay(today);
  }
  if (phrase === "yesterday") {
    return wholeDay(shiftDay(today, -1));
  }
  const daysAgo = DAYS_AGO_PATTERN.exec(phrase);
  if (daysAgo !== null) {
    return wholeDay(shiftDay(today, -Number(daysAgo[1])));
  }
  const daysIntoWeek = (new Date(today).getDay() - WEEK_START_DAY + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  const weekStart = shiftDay(today, -daysIntoWeek);
  if (phrase === "this week") {
    return { start: weekStart, end: shiftDay(weekStart, DAYS_IN_WEEK) };
  }
  if (phrase === "last week") {
    return { start: shiftDay(weekStart, -DAYS_IN_WEEK), end: weekStart };
  }
  return readWeekday(phrase, today);
}

/**
 * The time a query names at its start or end, and its other words; null when it names none.
 * Example: "yesterday github" → yesterday, "github"; "pizza recipes" → null
 */
export function readDatePhrase(query: string, now: number): DatedQuery | null {
  const words = query.trim().toLowerCase().split(/\s+/).filter((word) => word !== "");
  // Longest phrases first: "last monday" before "monday".
  for (let length = Math.min(LONGEST_PHRASE_WORDS, words.length); length >= 1; length--) {
    const leading = readPhrase(words.slice(0, length).join(" "), now);
    if (leading !== null) {
      return { range: leading, words: words.slice(length).join(" ") };
    }
    const trailing = readPhrase(words.slice(words.length - length).join(" "), now);
    if (trailing !== null) {
      return { range: trailing, words: words.slice(0, words.length - length).join(" ") };
    }
  }
  return null;
}
