/**
 * WHY this file exists:
 *   The two choices under the "This connection isn't private" page: "Back to Safety" and "Visit <site> Anyway", in
 *   the same small card place as the permission prompt. They are on a card, not on the page, because a page cannot
 *   be trusted to talk to the main process, and a card can.
 *
 * Data source:
 *   The "certificateWarning" panel from certificateErrors.ts (the site and the request id).
 *
 * Data flow:
 *   "overlay:show" (certificateWarning) → renderCertificateWarning() → dispatch answerCertificateWarning.
 *   Escape or a click outside closes the card and leaves the page as it is (main decides).
 */
import type { OverlayPanel } from "../shared/overlay";
import { createElement, createTextButton, dispatch } from "../renderer/dom.js";

/**
 * Builds the card.
 */
export function renderCertificateWarning(host: HTMLElement, panel: Extract<OverlayPanel, { kind: "certificateWarning" }>): void {
  const card = createElement("div", "panel permission-prompt certificate-warning");
  card.setAttribute("role", "alertdialog");
  card.setAttribute("aria-label", "Connection not private");
  const title = createElement("p", "permission-title");
  title.append(createElement("strong", "permission-host", panel.host), "'s certificate can't be trusted");
  const answer = (isVisitAnyway: boolean): void => dispatch({ type: "answerCertificateWarning", requestId: panel.requestId, isVisitAnyway: isVisitAnyway });
  const buttons = createElement("div", "permission-buttons certificate-buttons");
  buttons.append(
    createTextButton("Back to Safety", "permission-button is-primary", () => answer(false)),
    createTextButton(`Visit ${panel.host} Anyway`, "permission-button", () => answer(true)),
  );
  const text = createElement("div", "permission-text");
  text.append(title);
  card.append(text, buttons);
  host.replaceChildren(card);
}
