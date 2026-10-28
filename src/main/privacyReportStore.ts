/**
 * WHY this file exists:
 *   Keeps the privacy report (privacyReport.ts) in its own file, privacy-report.json, written a few seconds after a
 *   change and when Bow quits. Blocks in private windows are never counted (adBlock.ts asks only for persistent
 *   sessions).
 *
 * Data source:
 *   <userData>/privacy-report.json, and each request the blocker cancels.
 *
 * Data flow:
 *   adBlock.ts → noteBlockedRequest(pageUrl, requestUrl) → recordBlocked() → saveSoon() → the file
 *   Library › Privacy → getPrivacySummary(now)
 */
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { getSiteKey } from "../shared/siteKey";
import type { PrivacySummary } from "../shared/types";
import { checkPrivacyReport, EMPTY_PRIVACY_REPORT, recordBlocked, summarizePrivacy } from "./privacyReport";
import type { PrivacyReport } from "./privacyReport";

const REPORT_FILE_NAME = "privacy-report.json";

/** Write this long after the last block. Our choice: a page blocks dozens at once; one write covers them. */
const SAVE_DELAY_MS = 5000;

let reportFilePath = "";
let report: PrivacyReport = EMPTY_PRIVACY_REPORT;
let saveTimer: NodeJS.Timeout | null = null;

/**
 * Reads the report from its file (an unreadable file starts an empty report).
 */
export function loadPrivacyReport(): void {
  reportFilePath = path.join(app.getPath("userData"), REPORT_FILE_NAME);
  if (!fs.existsSync(reportFilePath)) {
    return;
  }
  try {
    report = checkPrivacyReport(JSON.parse(fs.readFileSync(reportFilePath, "utf8")));
  } catch (error) {
    console.warn("Could not read the privacy report; starting an empty one:", error);
    report = EMPTY_PRIVACY_REPORT;
  }
}

/**
 * Writes the report now, through a temporary file so a crash never leaves half a file.
 */
export function savePrivacyReportNow(): void {
  if (reportFilePath === "" || saveTimer === null) {
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = null;
  const temporaryPath = `${reportFilePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(report), "utf8");
  fs.renameSync(temporaryPath, reportFilePath);
}

/**
 * Counts one blocked request: the site of the page it came from and the tracker's host.
 */
export function noteBlockedRequest(pageUrl: string, requestUrl: string): void {
  const site = getSiteKey(pageUrl);
  let trackerHost: string;
  try {
    trackerHost = new URL(requestUrl).hostname;
  } catch {
    return;
  }
  if (site === null) {
    return;
  }
  report = recordBlocked(report, site, trackerHost, Date.now());
  if (saveTimer === null) {
    saveTimer = setTimeout(savePrivacyReportNow, SAVE_DELAY_MS);
  }
}

/**
 * The week's numbers for the Library.
 */
export function getPrivacySummary(now: number): PrivacySummary {
  return summarizePrivacy(report, now);
}
