/**
 * WHY this file exists:
 *   Bow Passwords remembers a short, fixed list of form field kinds (email, name, address parts). The main process
 *   (what is stored) and, later, the overlay (what is offered) must agree on that list, so it lives here once.
 *
 * Data source:
 *   Our choice: only fields that are the same on every site and are not secrets. Passwords are stored separately
 *   as logins; card numbers, codes and everything else are never stored.
 *
 * Data flow:
 *   formMemory.ts / passwords.ts (main) and the overlay pages → isFormFieldKind() → FormFieldKind
 *
 * Importing passwords from a CSV file also lives here, because three places word it the same way (the Library, the
 * File menu's message, the onboarding): the outcome of an import and the sentences that describe it and tell where
 * each browser keeps its export. Nothing here sees a password.
 */
import { SUPPORTED_BROWSERS } from "./onboarding.js";

/** The kinds of form fields Bow remembers (an allow-list; everything else is never stored). */
export const FORM_FIELD_KINDS = [
  "email",
  "name",
  "givenName",
  "familyName",
  "tel",
  "organization",
  "streetAddress",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "country",
] as const;

export type FormFieldKind = (typeof FORM_FIELD_KINDS)[number];

/** True when the value is one of the kinds in the allow-list. Used for data that comes from disk or a page. */
export function isFormFieldKind(value: unknown): value is FormFieldKind {
  return FORM_FIELD_KINDS.some((kind) => kind === value);
}

/** The largest passwords export Bow reads. A real export is a few hundred KB; ten times the biggest anyone has. Our choice. */
export const MAX_PASSWORD_CSV_BYTES = 10 * 1024 * 1024;

/** How an import from a file went. Never carries a password or the file's contents. */
export type PasswordImportOutcome =
  | { kind: "cancelled" }
  | { kind: "tooLarge" }
  | { kind: "unrecognized" }
  | { kind: "vaultUnavailable" }
  | { kind: "imported"; addedCount: number; alreadySavedCount: number; keptDifferentCount: number; skippedCount: number };

function formatPasswordCount(count: number): string {
  return count === 1 ? "1 password" : `${count} passwords`;
}

/**
 * The sentence(s) that tell the user how an import went. No dashes: the onboarding shows it too.
 */
export function describeImportOutcome(outcome: PasswordImportOutcome): string {
  if (outcome.kind === "cancelled") {
    return "";
  }
  if (outcome.kind === "unrecognized") {
    return "This file doesn't look like a passwords export. Choose the CSV file your browser saved.";
  }
  if (outcome.kind === "tooLarge") {
    return "This file is too large to be a passwords export.";
  }
  if (outcome.kind === "vaultUnavailable") {
    return "Bow can't open its saved passwords right now.";
  }
  const sentences: string[] = [];
  if (outcome.addedCount > 0) {
    sentences.push(`Imported ${formatPasswordCount(outcome.addedCount)}.`);
  } else {
    const knownCount = outcome.alreadySavedCount + outcome.keptDifferentCount;
    sentences.push(knownCount === 0 ? "No new passwords." : `No new passwords: all ${knownCount} were already in Bow.`);
  }
  if (outcome.keptDifferentCount > 0) {
    const verb = outcome.keptDifferentCount === 1 ? "was" : "were";
    sentences.push(`${outcome.keptDifferentCount} ${verb} already in Bow with another password and stayed as ${outcome.keptDifferentCount === 1 ? "it was" : "they were"}.`);
  }
  if (outcome.skippedCount > 0) {
    const rowWord = outcome.skippedCount === 1 ? "row" : "rows";
    sentences.push(`${outcome.skippedCount} ${rowWord} had no web address or password.`);
  }
  return sentences.join(" ");
}

/** True when the file held logins worth offering to move to the Trash (it holds passwords in plain text). */
export function isImportedFileTrashable(outcome: PasswordImportOutcome): boolean {
  return outcome.kind === "imported" && outcome.addedCount + outcome.alreadySavedCount + outcome.keptDifferentCount > 0;
}

/** Browsers that share Chrome's export (Settings, Passwords, Export passwords). */
const CHROMIUM_FAMILY_IDS = ["chrome", "arc", "dia", "brave", "edge", "vivaldi", "opera", "chromium"];

/**
 * Where a browser keeps its passwords export, for the onboarding's "Your passwords" block.
 */
export function describePasswordExport(browserId: string): string {
  const browserName = SUPPORTED_BROWSERS.find((browser) => browser.id === browserId)?.name ?? browserId;
  if (browserId === "safari") {
    return "Open the Passwords app (on macOS 14, Safari), choose File, then Export All Passwords. Then choose the file it saved.";
  }
  if (browserId === "firefox") {
    return "In Firefox, open Passwords, click the three dots and choose Export Passwords. Then choose the file it saved.";
  }
  if (CHROMIUM_FAMILY_IDS.includes(browserId)) {
    return `In ${browserName}, open Settings, find Passwords and choose Export passwords. Then choose the file it saved.`;
  }
  return "Export your passwords as a CSV file from the app that has them. Then choose the file it saved.";
}
