/**
 * WHY this file exists:
 *   Library › Privacy: what Bow's blocker stopped in the last 7 days, like Safari's privacy report. The week's
 *   total, one bar per day, and the sites and tracker hosts with the most blocks (main/privacyReport.ts).
 *
 * Data source:
 *   LibraryData.privacy (overlayController.ts buildLibraryData).
 *
 * Data flow:
 *   Library › Privacy → renderPrivacySection() → the report; with blocking off, a button that turns it on
 */
import type { LibraryData } from "../shared/overlay";
import { createElement, createTextButton, dispatch } from "../renderer/dom.js";

/**
 * A day's one-letter name under its bar ("M" for "2026-10-26"), from its calendar date.
 */
function describeWeekday(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  return date.toLocaleDateString("en-GB", { weekday: "narrow" });
}

/**
 * One column of names with their counts: "Sites" or "Trackers".
 */
function createCountList(title: string, entries: { name: string; count: number }[]): HTMLElement {
  const column = createElement("section", "privacy-list");
  column.append(createElement("h3", "privacy-list-title", title));
  for (const entry of entries) {
    const row = createElement("div", "privacy-row");
    row.append(createElement("span", "privacy-row-name", entry.name), createElement("span", "privacy-row-count", String(entry.count)));
    column.append(row);
  }
  return column;
}

/**
 * The week as bars, each as tall as its day's share of the busiest day.
 */
function createBars(byDay: { day: string; count: number }[]): HTMLElement {
  const bars = createElement("div", "privacy-bars");
  const busiest = Math.max(1, ...byDay.map((day) => day.count));
  for (const day of byDay) {
    const column = createElement("div", "privacy-bar-column");
    column.title = `${day.count} blocked`;
    const bar = createElement("div", "privacy-bar");
    bar.style.height = `${Math.round((day.count / busiest) * 100)}%`;
    column.append(bar, createElement("span", "privacy-bar-label", describeWeekday(day.day)));
    bars.append(column);
  }
  return bars;
}

/**
 * Builds the Privacy section: the report, or, with blocking off, why it is empty and how to start it.
 */
export function renderPrivacySection(body: HTMLElement, data: LibraryData, emptyState: HTMLElement, extraGroups: HTMLElement[]): void {
  const section = createElement("div", "library-settings library-privacy");
  const report = createElement("section", "privacy-report");
  if (!data.privacy.isAdBlockOn) {
    emptyState.append(createTextButton("Turn On Blocking", "library-chip is-active privacy-turn-on", () => dispatch({ type: "setAdBlock", isOn: true })));
    report.append(emptyState);
  } else {
    const summary = data.privacy.summary;
    const headline = createElement("div", "privacy-headline");
    headline.append(createElement("span", "privacy-total", String(summary.total)), createElement("span", "privacy-total-label", summary.total === 1 ? "tracker blocked in the last 7 days" : "trackers blocked in the last 7 days"));
    const lists = createElement("div", "privacy-lists");
    lists.append(createCountList("Sites", summary.topSites), createCountList("Trackers", summary.topTrackers));
    report.append(headline, createBars(summary.byDay));
    if (summary.total === 0) {
      report.append(createElement("p", "library-setting-note", "Nothing blocked yet this week."));
    } else {
      report.append(lists);
    }
  }
  section.append(report, ...extraGroups);
  body.replaceChildren(section);
}
