/**
 * WHY this file exists:
 *   Bow remembers what the user types into ordinary forms (emails, names, phone numbers, addresses) and offers it
 *   again in the same kind of field on any site, like Chrome's autofill. This connects sent forms to the profile's
 *   vault. What may be remembered was already narrowed twice: the page helper sends only allow-listed fields the user
 *   typed into, and formMemory.ts refuses card numbers, codes and passwords before anything is stored.
 *
 * Data source:
 *   Forms sent in a profile's tabs (formsBridge.ts onFormSubmitted; private windows never report) and the
 *   "Remember what I type in forms" setting (BrowserSettings.remembersFormEntries, missing means on).
 *
 * Data flow:
 *   form sent → formsBridge → rememberSentForm() → formMemory.ts rememberEntries() → passwordVault.ts changeVault()
 *   → the encrypted vault; autofillPopup.ts suggests the values later
 */
import { getState } from "./browserCore";
import { rememberEntries } from "./formMemory";
import { onFormSubmitted } from "./formsBridge";
import type { SubmittedReport } from "./formsBridge";
import { changeVault } from "./passwordVault";

/**
 * Keeps the typed values of one sent form, unless the user turned form memory off.
 */
function rememberSentForm(report: SubmittedReport): void {
  if (getState().settings.remembersFormEntries === false) {
    return;
  }
  const entries = report.message.entries;
  if (entries.length === 0) {
    return;
  }
  // A value equal to the form's password is never kept, even in an allowed field.
  const passwordsInForm = report.message.password === "" ? [] : [report.message.password];
  const now = Date.now();
  changeVault(report.profileId, (vault) => rememberEntries(vault, entries, passwordsInForm, now)).catch((error) => {
    console.error("Could not remember the form's values:", error instanceof Error ? error.name : "");
  });
}

/**
 * Starts remembering sent forms. Runs once at startup.
 */
export function initializeFormMemory(): void {
  onFormSubmitted(rememberSentForm);
}
