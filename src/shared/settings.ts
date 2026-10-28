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

/** Longest command chain name. Our choice: a Command Bar line shows about this much. */
export const CHAIN_NAME_MAX_LENGTH = 60;

/** Most steps in one command chain. Our choice: a chain is a few things in a row, not a program. */
export const CHAIN_STEPS_LIMIT = 20;

/** Most command chains kept. Our choice. */
export const CHAINS_LIMIT = 50;

/**
 * The shortcuts that can bring Bow up from any app (Library › Settings), as Electron accelerators with how macOS
 * writes them. Our choice: none is one of macOS's own (⌘Space is Spotlight, ⌃Space switches input sources); ⌥Space
 * is also Alfred's and Raycast's, so the setting starts off.
 */
export const GLOBAL_SHORTCUT_CHOICES = [
  { accelerator: "Alt+Space", label: "⌥Space" },
  { accelerator: "Alt+Command+Space", label: "⌥⌘Space" },
  { accelerator: "Control+Alt+Space", label: "⌃⌥Space" },
  { accelerator: "Shift+Alt+Space", label: "⇧⌥Space" },
  { accelerator: "Control+Alt+Command+B", label: "⌃⌥⌘B" },
] as const;

/** Reader view's text sizes (A− / A+ step through them), in pixels. Our choice: comfortable reading sizes. */
export const READER_TEXT_SIZES = [15, 17, 19, 21, 24] as const;

/** Reader view's text size until the user changes it. Our choice. */
export const READER_DEFAULT_TEXT_SIZE = 19;

/** How long the "no secure version · Open with HTTP" offer stays. Our choice: time to read and decide. */
export const HTTPS_FALLBACK_NOTICE_MS = 30 * 1000;

/** Most Space templates kept. Our choice. */
export const SPACE_TEMPLATES_LIMIT = 30;

/** Most Pinned items (tabs and folders) one template keeps. Our choice: well above a busy Space's Pinned section. */
export const SPACE_TEMPLATE_ITEMS_LIMIT = 300;

/** Deepest folder nesting a template keeps. Our choice: deeper than anyone nests by hand. */
export const SPACE_TEMPLATE_DEPTH_LIMIT = 8;

/**
 * The pause between the steps of a command chain, so a step's new Space, window or tab is in place before the next
 * one acts on it. Our choice.
 */
export const COMMAND_CHAIN_STEP_DELAY_MS = 250;

/** The day a week starts on, as Date.getDay() numbers it (0 = Sunday): Monday, as ISO 8601 weeks do. Our choice. */
export const WEEK_START_DAY = 1;

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

/**
 * A Today tab's row says "archives in 20 min" for the last hour before it goes, or the last quarter of a shorter
 * timing (autoArchive.ts findTabsArchivingSoon). Our choice: Arc gives no warning.
 */
export const ARCHIVE_SOON_MS = 1 * HOUR_MS;
export const ARCHIVE_SOON_SHARE = 4;

/**
 * How long the sidebar's notice stays: "Undo" after the sweep or Clear archived tabs (archiveUndoController.ts), "Open
 * Another" after switching to a tab already open (tabActions.ts). Our choice.
 */
export const SIDEBAR_NOTICE_SHOWN_MS = 8000;

/**
 * The "Sleep unused tabs after" menu (main/tabSleep.ts): a page left alone this long closes its renderer and wakes
 * where it was when the tab is shown again. Our choice of steps; null means pages never sleep.
 */
export const TAB_SLEEP_OPTIONS: ArchiveThresholdOption[] = [
  { label: "15 minutes", valueMs: 15 * MINUTE_MS },
  { label: "30 minutes", valueMs: 30 * MINUTE_MS },
  { label: "1 hour", valueMs: 1 * HOUR_MS },
  { label: "2 hours", valueMs: 2 * HOUR_MS },
  { label: "Never", valueMs: null },
];

/**
 * Pages sleep after this by default. Our choice: measured 2026-10-27, each awake page costs about 80 MB, and twenty
 * pages looked at once kept 1.6 GB until they were closed. Edge's sleeping tabs default to 2 hours; 30 minutes keeps
 * a long session's memory near what is on screen.
 */
export const DEFAULT_TAB_SLEEP_AFTER_MS = 30 * MINUTE_MS;

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

/**
 * Arc's Peek, measured in the user's screenshot and recording (2026-10-28, 1 px per pt): the card starts 10 pt below
 * the window's top (rounded corners, a faint rim), its toolbar row is 33 pt tall, so the page starts 43 pt down;
 * the page ends 11 pt above the window's bottom. main/peek.ts places the page, overlay/peekFrame.ts draws the card.
 */
export const PEEK_TOP_SPACE_PX = 10;
export const PEEK_TOOLBAR_HEIGHT_PX = 33;
export const PEEK_BOTTOM_SPACE_PX = 11;

/**
 * Arc's Peek motion, measured frame by frame in the user's recording (2026-10-28, 60 fps). Opening: the dim fades in
 * over about 90 ms while an empty card (its toolbar row over a blank page) grows out of the clicked link from about
 * 80 ms on, for about 190 ms on an ease-out curve (width progress fits a cubic ease-out); the page shows once it has
 * grown. Closing: a picture of the page shrinks back into the link in about 88 ms, close to linearly, then fades in
 * about 35 ms, while the dim is gone after about 60 ms.
 */
export const PEEK_DIM_IN_MS = 90;
export const PEEK_GROW_DELAY_MS = 80;
export const PEEK_GROW_MS = 190;
export const PEEK_GROW_EASING = "cubic-bezier(0.33, 1, 0.68, 1)";
export const PEEK_SHRINK_MS = 88;
export const PEEK_SHRINK_FADE_MS = 35;
export const PEEK_DIM_OUT_MS = 60;

/**
 * Without a link to grow from or shrink back into (opened with no pointer over the window), the card grows from and
 * shrinks to this share of its size, about its middle. Our choice.
 */
export const PEEK_START_SCALE = 0.94;

/**
 * How long opening waits to learn where the clicked link is in its page, and closing for a picture of the page,
 * before they animate without (from the pointer, or a plain card). Our choice: short enough not to be felt.
 */
export const PEEK_LINK_LOOKUP_MS = 50;
export const PEEK_PICTURE_WAIT_MS = 100;

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

/** Smallest a split pane can be dragged, in pixels. Our choice: a page still reads at this width. */
export const SPLIT_MIN_PANE_PX = 160;

/**
 * Corner radius of the web page card, in pixels (= sidebar.css --card-radius). The page view itself is square; the
 * corner masks (cornerMasks.ts) are this big.
 */
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

/**
 * Where Bow's update feeds live: GitHub serves the newest published release's files at this address (drafts and
 * pre-releases are skipped). tools/release-mac.sh attaches update-darwin-<arch>.json to each release.
 */
export const APP_UPDATE_FEED_BASE_URL = "https://github.com/Rektoooooo/bow/releases/latest/download";

/** The first app update check runs this long after startup, so the start stays quick. Our choice. */
export const APP_UPDATE_FIRST_CHECK_MS = 2 * 60 * 1000;

/** Then Bow looks for a new version this often. Our choice: a few times a day, a small file each time. */
export const APP_UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * A change reaches browser-state.json at most this long after it happened, so a burst (page titles while a page
 * loads, a drag, typing a name) costs one write instead of one per change. Quitting writes at once. Our choice:
 * measured 2026-10-27, 20 renames wrote the file 21 times.
 */
export const STATE_SAVE_DELAY_MS = 500;

/**
 * A Dock icon other than the bundle's own (an alternate icon, or Glass's dark twin) is drawn this long after the first
 * window has loaded: drawing it blocks the main process for about 230 ms (measured 2026-10-27), which used to delay
 * the sidebar's first picture. Our choice.
 */
export const APP_ICON_DRAW_DELAY_MS = 500;

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
 * width (the user's sidebar was 254). Ours is wider, 560 pt: at 410 Settings and Extensions wrapped into narrow
 * columns (the user, 2026-10-27).
 */
export const LIBRARY_COLUMN_WIDTH_PX = 560;
export const LIBRARY_RAIL_WIDTH_PX = 112;

/*
 * Library › Spaces lays every Space out as a column of its pinned items, with a round + after the last one, and the
 * Library's column widens to hold them (Arc's, the user's screenshot 2026-10-27: about 160 pt columns 16 pt apart;
 * ours are wider so titles fit). The page keeps at least LIBRARY_MIN_PAGE_WIDTH_PX; more Spaces scroll sideways.
 */
export const LIBRARY_SPACE_COLUMN_WIDTH_PX = 190;
export const LIBRARY_SPACE_COLUMN_GAP_PX = 12;
export const LIBRARY_ADD_SPACE_ROOM_PX = 56;
export const LIBRARY_MIN_PAGE_WIDTH_PX = 360;

/*
 * Arc's list of a closed folder's tabs (the user's recording, frame f0023): 245 pt wide, 4 pt right of the sidebar, a
 * 48 pt search row, 45 pt rows, at most 316 pt tall, centered on the folder's row but kept 18 pt from the window's
 * edges. It opens when the pointer rests on the folder and closes once the pointer has been away from the row and the
 * list for a moment (both delays our choice).
 */
export const FOLDER_LIST_WIDTH_PX = 245;
export const FOLDER_LIST_GAP_PX = 4;
export const FOLDER_LIST_SEARCH_HEIGHT_PX = 48;
export const FOLDER_LIST_ROW_HEIGHT_PX = 45;
export const FOLDER_LIST_MAX_HEIGHT_PX = 316;
export const FOLDER_LIST_EDGE_PX = 18;
export const FOLDER_LIST_DELAY_MS = 500;
export const FOLDER_LIST_CLOSE_DELAY_MS = 300;

/** Bow keeps an automatic copy of the setup this often while it changes (backupController.ts). Our choice. */
export const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Automatic copies kept: the newest this many, then one per day for this many days. Our choice: half a day of hourly
 * undo and a week of daily ones, about 20 files.
 */
export const SNAPSHOTS_HOURLY_KEPT = 12;
export const SNAPSHOTS_DAILY_KEPT = 7;

/** Copies kept from before a restore (each restore makes one). Our choice. */
export const BEFORE_RESTORE_SNAPSHOTS_KEPT = 5;

/** Sync writes this Mac's file this long after the last change (changes come in bursts). Our choice. */
export const SYNC_WRITE_DELAY_MS = 2000;

/** Sync reads the folder this long after it changed (a file is often written in several steps). Our choice. */
export const SYNC_READ_DELAY_MS = 500;

/** Sync also reads the folder this often, for network drives that don't report changes. Our choice. */
export const SYNC_POLL_MS = 60 * 1000;

/** A file operation on the sync folder that takes longer than this is given up (a drive that stopped answering). */
export const SYNC_FILE_TIMEOUT_MS = 10 * 1000;

/** Library › Task Manager measures the pages again this often while it is shown (Activity Monitor's default: 2 s). */
export const TASK_MANAGER_REFRESH_MS = 2000;
