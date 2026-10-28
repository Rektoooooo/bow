/**
 * WHY this file exists:
 *   The page card sits right of the sidebar, inset from the window edges, like Arc's: the toolbar at its top (drawn
 *   by the sidebar page), the web page below it. computeCardBounds() returns where the web page goes; a split view
 *   divides that area into panes (shared/splitLayout.ts, which the sidebar page uses too). The arithmetic lives here,
 *   without Electron, so it can be tested.
 *
 * Data source:
 *   The window's content size and the layout constants in shared/settings.ts.
 *
 * Data flow:
 *   tabViews.ts → computeCardBounds() → shared/splitLayout.ts computePaneBounds() → WebContentsView.setBounds()
 */
import {
  CARD_GAP_PX,
  CARD_INSET_PX,
  DEVELOPER_TOOLBAR_HEIGHT_PX,
  LIBRARY_ADD_SPACE_ROOM_PX,
  LIBRARY_COLUMN_WIDTH_PX,
  LIBRARY_MIN_PAGE_WIDTH_PX,
  LIBRARY_RAIL_WIDTH_PX,
  LIBRARY_SPACE_COLUMN_GAP_PX,
  LIBRARY_SPACE_COLUMN_WIDTH_PX,
  SIDEBAR_WIDTH_PX,
  TOOLBAR_HEIGHT_PX,
} from "../shared/settings";
import type { LibrarySection } from "../shared/overlay";

/** A rectangle in window content coordinates, in pixels. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the card's position depends on. */
export interface CardLayoutOptions {
  isSidebarVisible: boolean;
  isToolbarVisible: boolean;
  /** The hidden sidebar is showing for a moment (mouse at the left edge): the card slides right without resizing. */
  isSidebarPeeking?: boolean;
  /** The hidden toolbar is showing for a moment (mouse at the top edge): the page slides down without resizing. */
  isToolbarPeeking?: boolean;
  /** Focus Mode: the page fills the window, no sidebar, toolbar or frame (unless the Library is open). */
  isFocusMode?: boolean;
  /** The sidebar's width; SIDEBAR_WIDTH_PX when not given. */
  sidebarWidth?: number;
  /** The selected page's site is in Developer Mode: its toolbar is taller. */
  isDeveloperToolbar?: boolean;
  /** The Library is open in the sidebar column (Arc's), sidebar or not. */
  isLibraryOpen?: boolean;
  /** How wide the Library's column is while open (computeLibraryWidth); LIBRARY_COLUMN_WIDTH_PX when not given. */
  libraryWidth?: number;
  /** A split divider being dragged: its sizes, shown before they are saved (shared/splitLayout.ts). */
  paneSizesPreview?: { splitId: string; sizes: number[] };
}

/**
 * Returns where the web page goes inside the card: below the card's toolbar, inset from the window edges, right of
 * the sidebar. With the sidebar hidden the card fills the window minus the inset; with the toolbar hidden the page
 * starts at the top inset; in Focus Mode the page fills the window.
 * Sizes never go below zero, because Electron rejects negative sizes.
 * Example: content 1280×820, sidebar and toolbar visible → { x: 254, y: 43, width: 1016, height: 767 }
 */
export function computeCardBounds(contentWidth: number, contentHeight: number, options: CardLayoutOptions): Bounds {
  if (options.isFocusMode === true && options.isLibraryOpen !== true) {
    return { x: 0, y: 0, width: Math.max(contentWidth, 0), height: Math.max(contentHeight, 0) };
  }
  const sidebarWidth = options.sidebarWidth ?? SIDEBAR_WIDTH_PX;
  const sidebarLeft = options.isSidebarVisible ? sidebarWidth + CARD_GAP_PX : CARD_INSET_PX;
  const libraryWidth = options.libraryWidth ?? LIBRARY_COLUMN_WIDTH_PX;
  const left = options.isLibraryOpen === true ? libraryWidth + CARD_GAP_PX : sidebarLeft;
  const toolbarHeight = options.isDeveloperToolbar === true ? DEVELOPER_TOOLBAR_HEIGHT_PX : TOOLBAR_HEIGHT_PX;
  const top = options.isToolbarVisible ? CARD_INSET_PX + toolbarHeight : CARD_INSET_PX;
  const width = contentWidth - left - CARD_INSET_PX;
  const height = contentHeight - top - CARD_INSET_PX;
  // Sliding instead of shrinking keeps the page from re-laying out while the sidebar is only peeking.
  const isPeekSliding = !options.isSidebarVisible && options.isSidebarPeeking === true && options.isLibraryOpen !== true;
  const peekOffset = isPeekSliding ? sidebarWidth : 0;
  const isToolbarSliding = !options.isToolbarVisible && options.isToolbarPeeking === true;
  const toolbarOffset = isToolbarSliding ? toolbarHeight : 0;
  return { x: left + peekOffset, y: top + toolbarOffset, width: Math.max(width, 0), height: Math.max(height, 0) };
}

/**
 * How wide the Library's column is: LIBRARY_COLUMN_WIDTH_PX, except in Spaces, which holds a column per Space and
 * the + after them, as far as the page keeps LIBRARY_MIN_PAGE_WIDTH_PX beside it (more Spaces scroll sideways).
 * Example: Spaces with 3 Spaces in a 1440 pt window → 112 + 12 + 3 × 202 + 56 = 786
 */
export function computeLibraryWidth(section: LibrarySection, spaceCount: number, contentWidth: number): number {
  if (section !== "spaces") {
    return LIBRARY_COLUMN_WIDTH_PX;
  }
  const columnsWidth = LIBRARY_SPACE_COLUMN_GAP_PX + spaceCount * (LIBRARY_SPACE_COLUMN_WIDTH_PX + LIBRARY_SPACE_COLUMN_GAP_PX);
  const wantedWidth = LIBRARY_RAIL_WIDTH_PX + columnsWidth + LIBRARY_ADD_SPACE_ROOM_PX;
  const widestWidth = contentWidth - CARD_GAP_PX - CARD_INSET_PX - LIBRARY_MIN_PAGE_WIDTH_PX;
  return Math.max(LIBRARY_COLUMN_WIDTH_PX, Math.min(wantedWidth, widestWidth));
}
