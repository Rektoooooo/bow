/**
 * WHY this file exists:
 *   Decides where the list under a form field goes, in window coordinates. The field's place comes from the web page,
 *   so it cannot be trusted: a page could report a field far outside its own area to move Bow's list over the toolbar
 *   or the sidebar. The list therefore always lies entirely inside the tab's own view, and is not shown at all when it
 *   fits neither below nor above the field.
 *
 * Data source:
 *   The field's rectangle in the page's CSS pixels (shared/forms.ts FieldRect), the page's zoom factor and the tab
 *   view's bounds in the window.
 *
 * Data flow:
 *   autofillPopup.ts → computePopupBounds() → the list's view bounds and whether it sits above the field, or null
 */
import type { AutofillItem } from "../shared/autofill";
import type { FieldRect } from "../shared/forms";

/** A rectangle in window coordinates (or in a page's CSS pixels for a FieldRect). */
export interface PlacementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Sizes of the list. They MUST MATCH src/autofill/popup.css (the card's margins, padding and row heights); the page
 * draws the card inside the view, and a mismatch would clip it or leave a gap. Our choice: they follow the look of the
 * overlay's panels and a native Mac menu.
 */
export const POPUP_MIN_WIDTH_PX = 240;
export const POPUP_MAX_WIDTH_PX = 380;
/** Room left and right of the card for its shadow. */
export const POPUP_SIDE_MARGIN_PX = 12;
/** Room between the field and the card (on the side of the field). Small, so the list reads as the field's own. */
export const POPUP_NEAR_MARGIN_PX = 4;
/** Room on the far side of the card for its shadow. */
export const POPUP_FAR_MARGIN_PX = 14;
/** Padding above the first and below the last row, and the card's border (one hairline each side). */
export const POPUP_CARD_PADDING_PX = 4;
export const POPUP_CARD_BORDER_PX = 1;
/** A login shows two lines (username and dots), a remembered value one. */
export const POPUP_LOGIN_ROW_HEIGHT_PX = 44;
export const POPUP_VALUE_ROW_HEIGHT_PX = 30;

/** Where the list goes. */
export interface PopupPlacement {
  bounds: PlacementBox;
  isAbove: boolean;
}

/** The view's height for these rows, with the card's margins. */
export function computePopupHeight(items: readonly AutofillItem[]): number {
  let rowsHeight = 0;
  for (const item of items) {
    rowsHeight += item.kind === "login" ? POPUP_LOGIN_ROW_HEIGHT_PX : POPUP_VALUE_ROW_HEIGHT_PX;
  }
  const cardHeight = rowsHeight + 2 * POPUP_CARD_PADDING_PX + 2 * POPUP_CARD_BORDER_PX;
  return cardHeight + POPUP_NEAR_MARGIN_PX + POPUP_FAR_MARGIN_PX;
}

function isInside(inner: PlacementBox, outer: PlacementBox): boolean {
  const isInsideHorizontally = inner.x >= outer.x && inner.x + inner.width <= outer.x + outer.width;
  const isInsideVertically = inner.y >= outer.y && inner.y + inner.height <= outer.y + outer.height;
  return isInsideHorizontally && isInsideVertically;
}

function overlaps(first: PlacementBox, second: PlacementBox): boolean {
  const overlapsHorizontally = first.x < second.x + second.width && second.x < first.x + first.width;
  const overlapsVertically = first.y < second.y + second.height && second.y < first.y + first.height;
  return overlapsHorizontally && overlapsVertically;
}

/**
 * The list's bounds below the field, or above it when there is no room below; null when it fits neither, or when the
 * field is outside the tab's view. The view's own edge sits at the field's edge, so it never covers the field.
 */
export function computePopupPlacement(
  fieldRect: FieldRect,
  zoomFactor: number,
  tabViewBounds: PlacementBox,
  items: readonly AutofillItem[],
): PopupPlacement | null {
  const field: PlacementBox = {
    x: tabViewBounds.x + fieldRect.x * zoomFactor,
    y: tabViewBounds.y + fieldRect.y * zoomFactor,
    width: fieldRect.width * zoomFactor,
    height: fieldRect.height * zoomFactor,
  };
  if (!overlaps(field, tabViewBounds)) {
    return null;
  }
  const cardWidth = Math.min(Math.max(field.width, POPUP_MIN_WIDTH_PX), POPUP_MAX_WIDTH_PX);
  const width = Math.round(cardWidth) + 2 * POPUP_SIDE_MARGIN_PX;
  const height = computePopupHeight(items);
  const furthestLeft = tabViewBounds.x + tabViewBounds.width - width;
  if (furthestLeft < tabViewBounds.x) {
    return null;
  }
  const x = Math.round(Math.min(Math.max(field.x - POPUP_SIDE_MARGIN_PX, tabViewBounds.x), furthestLeft));

  const below: PlacementBox = { x: x, y: Math.round(field.y + field.height), width: width, height: height };
  if (isInside(below, tabViewBounds)) {
    return { bounds: below, isAbove: false };
  }
  const above: PlacementBox = { x: x, y: Math.round(field.y) - height, width: width, height: height };
  if (isInside(above, tabViewBounds)) {
    return { bounds: above, isAbove: true };
  }
  return null;
}
