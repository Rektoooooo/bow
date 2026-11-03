/**
 * WHY this file exists:
 *   A page view shows its background color until the page paints. Peek, Little Windows and popups all want the one
 *   a page without a background has, so nothing flashes black before a light page (or white before a dark one).
 *
 * Data source:
 *   The system's appearance (nativeTheme).
 *
 * Data flow:
 *   a page view is made → view.setBackgroundColor(getPageBackgroundColor())
 */
import { nativeTheme } from "electron";

/**
 * The page's color before it paints, also Peek's empty card that grows in: black in dark mode, like Arc's in the
 * user's recording; white in light mode (no light capture exists; it is what a page without a background shows).
 */
const PAGE_COLOR_DARK = "#000000";
const PAGE_COLOR_LIGHT = "#ffffff";

/**
 * The page's color before it paints: it follows the system's appearance, as pages do.
 */
export function getPageBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? PAGE_COLOR_DARK : PAGE_COLOR_LIGHT;
}
