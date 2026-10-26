/**
 * WHY this file exists:
 *   Every timing and layout number gets a name and a reason here, so the code has no magic values.
 *
 * Data source:
 *   The "Archive tabs after" choices copy the option list Arc offers (found in Arc 1.170.0's binary).
 *   The auto-archive timings match what Arc does, measured from a real user's Arc files on 2026-10-26
 *   (docs/research/arc-findings.md §2). Layout values are our own choice.
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

/** Default for a fresh install. Same as Arc: 12 hours (help center + measured idle times at archive). */
export const DEFAULT_ARCHIVE_AFTER_MS = 12 * HOUR_MS;

/** How often visible, audible and picture-in-picture tabs get their last-active time refreshed. Arc refreshes the visible tab every 60 s (measured). */
export const IN_USE_REFRESH_INTERVAL_MS = 1 * MINUTE_MS;

/** How often the sweeper looks for tabs to archive. Same as Arc: its archive batches are exactly 5 minutes apart. */
export const ARCHIVE_SWEEP_INTERVAL_MS = 5 * MINUTE_MS;

/** How often the archive is trimmed to ARCHIVE_LIMIT (archiving also trims it). Our choice. */
export const ARCHIVE_PRUNE_INTERVAL_MS = 1 * HOUR_MS;

/** How many archived tabs are kept; older ones are deleted. Same as Arc: a real user's archive held exactly 250. */
export const ARCHIVE_LIMIT = 250;

/** A Little Window left alone this long is archived and closed. Same as Arc's Little Arc default (6 h, measured). */
export const LITTLE_WINDOW_ARCHIVE_AFTER_MS = 6 * HOUR_MS;

/** Most Favorites a profile can have. Same as Arc (help center: raised from 8 to 12 in 2023). */
export const FAVORITES_LIMIT = 12;

/** Most panes in one split view. Same as Arc (help center shortcuts page: up to 4). */
export const SPLIT_PANES_LIMIT = 4;

/** The profile every new install starts with. Its pages use the session partition "persist:profile-default". */
export const DEFAULT_PROFILE_ID = "profile-default";

/** Default sidebar width in pixels (the sidebar page sets --sidebar-width from the saved width). */
export const SIDEBAR_WIDTH_PX = 240;

/** Narrowest and widest sidebar the edge can be dragged to. Our choice; Arc's limits are compiled constants. */
export const SIDEBAR_MIN_WIDTH_PX = 180;
export const SIDEBAR_MAX_WIDTH_PX = 420;

/** Letting go of the edge below this width hides the sidebar, like dragging Arc's sidebar fully to the left. */
export const SIDEBAR_COLLAPSE_WIDTH_PX = 130;

/** Gap between the window edge and the web page card, in pixels. Must match --card-inset in sidebar.css. */
export const CARD_INSET_PX = 8;

/** Height of the toolbar above the card (back, forward, reload, address, site controls). Must match --toolbar-height in sidebar.css. */
export const TOOLBAR_HEIGHT_PX = 40;

/** Gap between the panes of a split view, in pixels. Our choice; Arc's panes sit a few pixels apart. */
export const SPLIT_GAP_PX = 6;

/** Corner radius of the web page card, in pixels. */
export const CARD_RADIUS_PX = 10;
