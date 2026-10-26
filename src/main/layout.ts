/**
 * WHY this file exists:
 *   The page "card" sits right of the sidebar and below the toolbar, inset from the window edges. A split view
 *   divides that card into panes. The arithmetic lives here, without Electron, so it can be tested.
 *
 * Data source:
 *   The window's content size and the layout constants in shared/settings.ts.
 *
 * Data flow:
 *   tabViews.ts → computeCardBounds() → computePaneBounds() → WebContentsView.setBounds()
 */
import { CARD_INSET_PX, SIDEBAR_WIDTH_PX, SPLIT_GAP_PX, TOOLBAR_HEIGHT_PX } from "../shared/settings";
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
}

/**
 * Returns where the page card goes. With the sidebar hidden the card fills the window minus the inset.
 * Sizes never go below zero, because Electron rejects negative sizes.
 * Example: content 1280×820, sidebar and toolbar visible → { x: 248, y: 40, width: 1024, height: 772 }
 */
export function computeCardBounds(contentWidth: number, contentHeight: number, options: CardLayoutOptions): Bounds {
  const left = options.isSidebarVisible ? SIDEBAR_WIDTH_PX + CARD_INSET_PX : CARD_INSET_PX;
  const top = options.isToolbarVisible ? TOOLBAR_HEIGHT_PX : CARD_INSET_PX;
  const width = contentWidth - left - CARD_INSET_PX;
  const height = contentHeight - top - CARD_INSET_PX;
  return { x: left, y: top, width: Math.max(width, 0), height: Math.max(height, 0) };
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
