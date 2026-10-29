/**
 * WHY this file exists:
 *   The list under a form field (saved logins, remembered emails and addresses) is drawn by a small page of our own
 *   (src/autofill) above the web page. This is the contract between main (autofillPopup.ts) and that page: the channel
 *   names and what main may send. A password never goes to the page: it only ever draws titles. What is filled in
 *   is looked up again in main when the user picks.
 *
 * Data source:
 *   Our choice (no browser API to follow).
 *
 * Data flow:
 *   autofillPopup.ts → AUTOFILL_CHANNELS.show → autofillPopupPreload.ts → popup.ts draws the rows
 *   popup.ts (pointer down on a row) → AUTOFILL_CHANNELS.choose(index) → autofillPopup.ts fills the field
 */

/** Channel names. The sandboxed preload cannot import our files, so it repeats them typed as `typeof AUTOFILL_CHANNELS`. */
export const AUTOFILL_CHANNELS = {
  show: "autofill:show",
  choose: "autofill:choose",
} as const;

/** One row. `title` is a login's username ("No username" for none) or the remembered value itself. Never a password. */
export type AutofillItem = { kind: "login"; title: string } | { kind: "value"; title: string };

/**
 * What the list shows. `highlightedIndex` is -1 while nothing is highlighted. `isAbove` is true when the list sits
 * above its field (its shadow room is then at the top).
 */
export interface AutofillShowMessage {
  items: AutofillItem[];
  highlightedIndex: number;
  isDark: boolean;
  isAbove: boolean;
}
