/**
 * WHY this file exists:
 *   The page card sits right of the sidebar, inset from the window edges, like Arc's: the toolbar at its top (drawn
 *   by the sidebar page), the web page below it. computeCardBounds() returns where the web page goes. A split view
 *   divides that area into panes. The arithmetic lives here, without Electron, so it can be tested.
 *
 * Data source:
 *   The window's content size and the layout constants in shared/settings.ts.
 *
 * Data flow:
 *   tabViews.ts → computeCardBounds() → computePaneBounds() → WebContentsView.setBounds()
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
  SPLIT_GAP_PX,
  TOOLBAR_HEIGHT_PX,
} from "../shared/settings";
import type { LibrarySection } from "../shared/overlay";
import type { SplitOrientation } from "../shared/types";

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
  /** The sidebar's width; SIDEBAR_WIDTH_PX when not given. */
  sidebarWidth?: number;
  /** The selected page's site is in Developer Mode: its toolbar is taller. */
  isDeveloperToolbar?: boolean;
  /** The Library is open in the sidebar column (Arc's), sidebar or not. */
  isLibraryOpen?: boolean;
  /** How wide the Library's column is while open (computeLibraryWidth); LIBRARY_COLUMN_WIDTH_PX when not given. */
  libraryWidth?: number;
}

/**
 * Returns where the web page goes inside the card: below the card's toolbar, inset from the window edges, right of
 * the sidebar. With the sidebar hidden the card fills the window minus the inset.
 * Sizes never go below zero, because Electron rejects negative sizes.
 * Example: content 1280×820, sidebar and toolbar visible → { x: 254, y: 43, width: 1016, height: 767 }
 */
export function computeCardBounds(contentWidth: number, contentHeight: number, options: CardLayoutOptions): Bounds {
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
  return { x: left + peekOffset, y: top, width: Math.max(width, 0), height: Math.max(height, 0) };
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

/**
 * Divides the card into equal panes with a gap between them: side by side for "horizontal", stacked for "vertical".
 * The last pane takes the rounding leftovers so the panes fill the card exactly.
 * Example: card width 1000, 2 panes, gap 6 → widths 497 and 497
 */
export function computePaneBounds(card: Bounds, paneCount: number, orientation: SplitOrientation): Bounds[] {
  if (paneCount <= 1) {
    return [card];
  }

  const totalGap = SPLIT_GAP_PX * (paneCount - 1);
  const availableLength = orientation === "horizontal" ? card.width - totalGap : card.height - totalGap;
  const paneLength = Math.floor(Math.max(availableLength, 0) / paneCount);

  const panes: Bounds[] = [];
  for (let index = 0; index < paneCount; index++) {
    const offset = index * (paneLength + SPLIT_GAP_PX);
    const isLastPane = index === paneCount - 1;
    const length = isLastPane ? Math.max(availableLength - paneLength * (paneCount - 1), 0) : paneLength;
    if (orientation === "horizontal") {
      panes.push({ x: card.x + offset, y: card.y, width: length, height: card.height });
    } else {
      panes.push({ x: card.x, y: card.y + offset, width: card.width, height: length });
    }
  }
  return panes;
}
