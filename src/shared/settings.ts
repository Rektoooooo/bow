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

/** The id of the first main window (and of the one window files saved before version 3 had). Our choice. */
export const FIRST_WINDOW_ID = "window-1";

/**
 * Default sidebar width in pixels, from the window edge to the right edge of the sidebar's content (the sidebar page
 * sets --sidebar-width from the saved width). Measured on the user's Arc (1 px per pt): rows span 7…241.5 pt and the page card starts at 248.5 pt, so 7 pt
 * padding + 235 pt of content.
 */
export const SIDEBAR_WIDTH_PX = 242;

/** Narrowest and widest sidebar the edge can be dragged to. Our choice; Arc's limits are compiled constants. */
export const SIDEBAR_MIN_WIDTH_PX = 180;
export const SIDEBAR_MAX_WIDTH_PX = 420;

/** Letting go of the edge below this width hides the sidebar, like dragging Arc's sidebar fully to the left. */
export const SIDEBAR_COLLAPSE_WIDTH_PX = 130;

/**
 * Gap between the window edge and the page card (top, right, bottom, and left while the sidebar is hidden).
 * Measured on the user's Arc: about 10 pt. Must match --card-inset in sidebar.css.
 */
export const CARD_INSET_PX = 10;

/** Gap between the sidebar's content and the page card. Measured on the user's Arc: 7 pt. Must match --card-gap. */
export const CARD_GAP_PX = 7;

/**
 * Height of the toolbar at the top of the page card (back, forward, reload, address, site controls), including the
 * 1 px hairline under it. Measured on the user's Arc: card top at about 9.5 pt, hairline at 41, page from 42, so
 * 31 pt + hairline. Must match --toolbar-height in sidebar.css.
 */
export const TOOLBAR_HEIGHT_PX = 32;

/**
 * The toolbar of a site in Developer Mode is taller, with the full address. Measured on the user's Arc (shot 5):
 * the page starts at 48 pt instead of 42. Must match --developer-toolbar-height in sidebar.css.
 */
export const DEVELOPER_TOOLBAR_HEIGHT_PX = 38;

/** Gap between the panes of a split view, in pixels. Our choice; Arc's panes sit a few pixels apart. */
export const SPLIT_GAP_PX = 6;

/** Corner radius of the web page card, in pixels. */
export const CARD_RADIUS_PX = 10;

/**
 * How long the page card takes to move when the layout changes (⌘S, the sidebar peeking in, split panes). The main
 * process glides the page view along a cubic ease-out, 1 − (1 − t)³; the sidebar page moves its card with the same
 * duration and curve (--motion-layout in sidebar.css). Our choice, close to Arc's sidebar slide.
 */
export const LAYOUT_MOTION_MS = 260;

/** The first extension update check runs this long after startup, so it never slows the start. Our choice. */
export const EXTENSION_UPDATE_FIRST_CHECK_MS = 60 * 1000;

/** Then extensions are checked for updates this often. Chrome's default interval is about 5 hours. */
export const EXTENSION_UPDATE_INTERVAL_MS = 5 * 60 * 60 * 1000;

/** Live folders refresh this often. Our choice; Arc does not document its interval. */
export const LIVE_FOLDER_REFRESH_MS = 10 * 60 * 1000;

/** The first refresh of every live folder runs this long after startup, so it never slows the start. Our choice. */
export const LIVE_FOLDER_FIRST_REFRESH_MS = 15 * 1000;

/** A live folder shows at most this many items, newest first. Our choice: a feed can list hundreds. */
export const LIVE_FOLDER_ITEM_LIMIT = 30;

/** A live folder remembers at most this many removed addresses (the newest). Our choice, keeps the saved file small. */
export const LIVE_FOLDER_HIDDEN_LIMIT = 200;

/*
 * Arc's tab tooltip (the user's recording, 2026-10-27): resting the pointer on a tab row shows a small black box beside
 * the pointer with the tab's title, and "Double-click to rename" under it on the selected tab. Measured: 29 pt tall
 * with one line, 44 pt with two, 10 pt of padding inside a 1 pt rim on each side, 11–13 pt right of and 6–12 pt below
 * the pointer.
 */
export const TAB_TOOLTIP_OFFSET_X_PX = 12;
export const TAB_TOOLTIP_OFFSET_Y_PX = 9;
export const TAB_TOOLTIP_ONE_LINE_HEIGHT_PX = 29;
export const TAB_TOOLTIP_TWO_LINE_HEIGHT_PX = 44;

/** Padding plus rim on each side of the tooltip's text. */
export const TAB_TOOLTIP_SIDE_PX = 11;

/** The widest tooltip; a longer title ends in "…". Our choice. */
export const TAB_TOOLTIP_MAX_WIDTH_PX = 320;

/** The fonts overlay.css draws the two lines in (.tab-tooltip-title / -hint); the sidebar sizes the box with them. */
export const TAB_TOOLTIP_TITLE_FONT = "600 13.5px -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
export const TAB_TOOLTIP_HINT_FONT = "400 12.5px -apple-system, BlinkMacSystemFont, system-ui, sans-serif";

/** The second line, on the selected tab only (Arc's other tabs show the title alone). */
export const TAB_TOOLTIP_RENAME_HINT = "Double-click to rename";

/** How long the pointer rests on a row before its tooltip shows. Our choice; Arc's appeared within about 0.9 s. */
export const TAB_TOOLTIP_DELAY_MS = 600;

/*
 * Arc's Library lives in the sidebar column (the user's recording, 2026-10-27, frames f0177–f0243): the column widens
 * to a rail of sections (112 pt, then a 1 pt line) and a list beside it, and the page card moves to x = 417 pt. In
 * our terms (the card starts CARD_GAP_PX after the sidebar's width) that is a 410 pt column, the same at any sidebar
 * width (the user's sidebar was 254).
 */
export const LIBRARY_COLUMN_WIDTH_PX = 410;
export const LIBRARY_RAIL_WIDTH_PX = 112;
