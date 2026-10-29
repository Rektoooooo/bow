/**
 * WHY this file exists:
 *   The "Save password for example.com?" card, in the same small place as the permission prompt (the page's top left):
 *   the site, the account that signed in with its password hidden, and the answers. For a changed password it reads
 *   "Update password" and offers no "Never for this site". The card never gets the password itself, only the site
 *   and the username, so nothing a page does to the overlay's memory can show it.
 *
 * Data source:
 *   The "savePassword" panel from passwordOffers.ts (site, username, whether it is an update, the offer id).
 *
 * Data flow:
 *   "overlay:show" (savePassword) → renderPasswordPrompt() → Save / Not now / Never for this site
 *   → dispatch answerPasswordOffer. Escape or a click outside closes it: Not now (decided in main).
 */
import type { OverlayPanel } from "../shared/overlay";
import { createElement, createTextButton, dispatch } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";

/** What stands where the password is. Always the same length, so the card does not tell how long the password is. */
const HIDDEN_PASSWORD = "••••••••";

/**
 * Builds the card.
 */
export function renderPasswordPrompt(host: HTMLElement, panel: Extract<OverlayPanel, { kind: "savePassword" }>): void {
  const answer = (choice: "save" | "never" | "notNow"): void => dispatch({ type: "answerPasswordOffer", offerId: panel.offerId, answer: choice });
  const card = createElement("div", "panel permission-prompt password-prompt");
  card.setAttribute("role", "alertdialog");
  card.setAttribute("aria-label", panel.isUpdate ? "Update password" : "Save password");
  const title = createElement("p", "permission-title");
  title.append(panel.isUpdate ? "Update password for " : "Save password for ", createElement("strong", "permission-host", panel.host), "?");
  const hasUsername = panel.username !== "";
  const account = createElement("div", "permission-request");
  account.append(
    createIcon("key", "icon permission-icon"),
    createElement("span", hasUsername ? "permission-wish" : "permission-wish password-muted", hasUsername ? panel.username : "No username"),
    createElement("span", "password-muted", HIDDEN_PASSWORD),
  );
  const buttons = createElement("div", "permission-buttons");
  if (!panel.isUpdate) {
    buttons.append(createTextButton("Never for this site", "permission-button password-never-button", () => answer("never")));
  }
  buttons.append(
    createTextButton("Not now", "permission-button", () => answer("notNow")),
    createTextButton(panel.isUpdate ? "Update" : "Save", "permission-button is-primary", () => answer("save")),
  );
  const text = createElement("div", "permission-text");
  text.append(title, account);
  card.append(text, buttons);
  host.replaceChildren(card);
}
