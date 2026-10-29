/**
 * WHY this file exists:
 *   Once a browser's things are in Bow, its saved passwords are the one thing left behind: browsers keep them
 *   behind their own lock, so Bow cannot read them. The user exports them to a CSV file; this block, under the "Done"
 *   note of "Bring your things." (importScene.ts and profilesImport.ts both show it), says where that export is in
 *   that browser, lets the user choose the file, tells how the import went, and offers to move the file (which holds
 *   every password in plain text) to the Trash.
 *
 * Data source:
 *   shared/passwords.ts (the steps per browser, the sentences for each outcome) and the answers of
 *   window.onboardingApi.importPasswords / trashImportedPasswords (counts only; main reads the file).
 *
 * Data flow:
 *   a scene reaches its done state → update(browserId) → the block shows that browser's steps
 *   "Choose the file…" → onboardingApi.importPasswords() → outcome → describeImportOutcome() shown
 *   "Move the file to the Trash" → onboardingApi.trashImportedPasswords() → "Moved to the Trash."
 */
import { describeImportOutcome, describePasswordExport, isImportedFileTrashable } from "../shared/passwords.js";
import { createElement, createTextButton } from "../renderer/dom.js";
import { reveal } from "./sceneParts.js";

const TRASHED_TEXT = "Moved to the Trash.";
const TRASH_FAILED_TEXT = "Bow couldn't move the file to the Trash. You can move it yourself.";

/** The block and the one call a scene makes. */
export interface PasswordsBlock {
  element: HTMLElement;
  /** Shows the block for this browser (a scene that is done), or hides it (null). Safe to call on every redraw. */
  update(browserId: string | null): void;
}

/**
 * Builds the block, hidden until a scene is done.
 */
export function createPasswordsBlock(): PasswordsBlock {
  const element = createElement("div", "passwords-block");
  element.hidden = true;
  const title = createElement("h2", "passwords-title", "Your passwords");
  const steps = createElement("p", "passwords-steps");
  const chooseButton = createTextButton("Choose the file…", "passwords-choose", () => chooseFile());
  const trashButton = createTextButton("Move the file to the Trash", "passwords-trash", () => trashFile());
  trashButton.hidden = true;
  const buttons = createElement("div", "passwords-buttons");
  buttons.append(chooseButton, trashButton);
  const result = createElement("p", "passwords-result");
  result.setAttribute("aria-live", "polite");
  element.append(title, steps, buttons, result);

  let shownBrowserId: string | null = null;

  const chooseFile = (): void => {
    chooseButton.disabled = true;
    window.onboardingApi
      .importPasswords()
      .then((outcome) => {
        if (outcome.kind === "cancelled") {
          return;
        }
        result.textContent = describeImportOutcome(outcome);
        result.classList.toggle("is-problem", outcome.kind !== "imported");
        trashButton.hidden = !isImportedFileTrashable(outcome);
      })
      .catch((error) => console.error("Importing passwords failed:", error instanceof Error ? error.name : ""))
      .finally(() => {
        chooseButton.disabled = false;
      });
  };

  const trashFile = (): void => {
    trashButton.disabled = true;
    window.onboardingApi
      .trashImportedPasswords()
      .then((isTrashed) => {
        result.textContent = isTrashed ? TRASHED_TEXT : TRASH_FAILED_TEXT;
        result.classList.toggle("is-problem", !isTrashed);
        trashButton.hidden = isTrashed;
      })
      .catch((error) => console.error("Moving the file to the Trash failed:", error instanceof Error ? error.name : ""))
      .finally(() => {
        trashButton.disabled = false;
      });
  };

  const update = (browserId: string | null): void => {
    if (browserId === shownBrowserId) {
      return;
    }
    shownBrowserId = browserId;
    element.hidden = browserId === null;
    result.textContent = "";
    result.classList.remove("is-problem");
    trashButton.hidden = true;
    if (browserId === null) {
      return;
    }
    steps.textContent = describePasswordExport(browserId);
    reveal(element, 0);
  };

  return { element: element, update: update };
}
