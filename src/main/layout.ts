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
import { CARD_GAP_PX, CARD_INSET_PX, SIDEBAR_WIDTH_PX, SPLIT_GAP_PX, TOOLBAR_HEIGHT_PX } from "../shared/settings";
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
}

/**
 * Returns where the web page goes inside the card: below the card's toolbar, inset from the window edges, right of
 * the sidebar. With the sidebar hidden the card fills the window minus the inset.
 * Sizes never go below zero, because Electron rejects negative sizes.
 * Example: content 1280×820, sidebar and toolbar visible → { x: 254, y: 43, width: 1016, height: 767 }
 */
export function computeCardBounds(contentWidth: number, contentHeight: number, options: CardLayoutOptions): Bounds {
  const sidebarWidth = options.sidebarWidth ?? SIDEBAR_WIDTH_PX;
  const left = options.isSidebarVisible ? sidebarWidth + CARD_GAP_PX : CARD_INSET_PX;
  const top = options.isToolbarVisible ? CARD_INSET_PX + TOOLBAR_HEIGHT_PX : CARD_INSET_PX;
  const width = contentWidth - left - CARD_INSET_PX;
  const height = contentHeight - top - CARD_INSET_PX;
  // Sliding instead of shrinking keeps the page from re-laying out while the sidebar is only peeking.
  const peekOffset = !options.isSidebarVisible && options.isSidebarPeeking === true ? sidebarWidth : 0;
  return { x: left + peekOffset, y: top, width: Math.max(width, 0), height: Math.max(height, 0) };
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
