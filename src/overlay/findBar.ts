/**
 * WHY this file exists:
 *   Find in page (⌘F): a small bar in the top-right corner of the page with a search field, "n of m", previous /
 *   next and close. Its overlay is only as big as the bar, so the page stays usable while it is open.
 *
 * Data source:
 *   What the user types, and "found-in-page" progress from overlayController.ts.
 *
 * Data flow:
 *   typing → overlayApi.find(text) → page highlights matches → onFindProgress → "3 of 12"
 */
import { createElement, createIconButton } from "../renderer/dom.js";

/** Text in the search field when the progress arrives. */
let counter: HTMLElement | null = null;

/**
 * Builds the Find bar.
 */
export function renderFindBar(host: HTMLElement): void {
  const panel = createElement("div", "panel find-bar");
  panel.setAttribute("role", "search");
  const input = document.createElement("input");
  input.className = "find-input";
  input.type = "text";
  input.placeholder = "Find in page";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Find in page");
  counter = createElement("span", "find-counter", "");

  const findAgain = (forward: boolean): void => {
    window.overlayApi.find(input.value, forward, false);
  };
  input.addEventListener("input", () => window.overlayApi.find(input.value, true, true));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      findAgain(!event.shiftKey);
    }
  });

  const previousButton = createIconButton("chevronDown", "Previous match (⇧⌘G)", "find-button find-previous", () => findAgain(false));
  const nextButton = createIconButton("chevronDown", "Next match (⌘G)", "find-button", () => findAgain(true));
  const closeButton = createIconButton("close", "Close (Esc)", "find-button", () => window.overlayApi.close());
  panel.append(input, counter, previousButton, nextButton, closeButton);
  host.replaceChildren(panel);
  requestAnimationFrame(() => input.focus());
}

/**
 * Shows "n of m" (or nothing when the field is empty).
 */
function showProgress(activeMatch: number, matches: number): void {
  if (counter === null) {
    return;
  }
  counter.textContent = matches === 0 ? "0 of 0" : `${activeMatch} of ${matches}`;
}

window.overlayApi.onFindProgress((progress) => showProgress(progress.activeMatch, progress.matches));
