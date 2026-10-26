/**
 * WHY this file exists:
 *   Every timing and layout number gets a name and a reason here, so the code has no magic values.
 *
 * Data source:
 *   The "Archive tabs after" choices copy the option list Arc offers (found in Arc 1.170.0's binary).
 *   Every other value is our own choice; Arc's timer intervals are still unknown.
 *
 * Data flow:
 *   main.ts (timers, window layout) and sidebar.ts (settings menu) import these constants
 */

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** One entry in the "Archive tabs after" menu. A null value means never archive. */
export interface ArchiveThresholdOption {
  label: string;
  valueMs: number | null;
}

/** The "Archive tabs after" menu. Same choices Arc offers. */
export const ARCHIVE_THRESHOLD_OPTIONS: ArchiveThresholdOption[] = [
  { label: "1 hour", valueMs: 1 * HOUR_MS },
  { label: "6 hours", valueMs: 6 * HOUR_MS },
  { label: "12 hours", valueMs: 12 * HOUR_MS },
  { label: "24 hours", valueMs: 24 * HOUR_MS },
  { label: "7 days", valueMs: 7 * DAY_MS },
  { label: "30 days", valueMs: 30 * DAY_MS },
  { label: "Never", valueMs: null },
];

/** Default for a fresh install. Our choice: long enough to last a workday. */
export const DEFAULT_ARCHIVE_AFTER_MS = 12 * HOUR_MS;

/** How often visible, audible and picture-in-picture tabs get their last-active time refreshed. Our choice. */
export const IN_USE_REFRESH_INTERVAL_MS = 1 * MINUTE_MS;

/** How often the sweeper looks for tabs to archive. Our choice; checking more often buys nothing at a 1-hour minimum. */
export const ARCHIVE_SWEEP_INTERVAL_MS = 5 * MINUTE_MS;

/** How often old archive entries are deleted. Our choice. */
export const ARCHIVE_PRUNE_INTERVAL_MS = 1 * HOUR_MS;

/** How long archived tabs are kept before they are deleted. Our choice. */
export const ARCHIVE_RETENTION_MS = 30 * DAY_MS;

/** Sidebar width in pixels. Must match --sidebar-width in sidebar.css. */
export const SIDEBAR_WIDTH_PX = 240;

/** Gap between the window edge and the web page card, in pixels. Must match --card-inset in sidebar.css. */
export const CARD_INSET_PX = 8;

/** Corner radius of the web page card, in pixels. */
export const CARD_RADIUS_PX = 10;
