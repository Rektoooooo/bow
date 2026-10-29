/**
 * WHY this file exists:
 *   Bow remembers what the user types in ordinary form fields (email, name, address) and suggests it again, like
 *   Chrome's autofill. What is remembered is the risky part: a one-time code, a PIN, a card number or a password
 *   must never end up in the vault's form entries. These pure functions decide that and keep the entries.
 *
 * Data source:
 *   Values that a submitted form held, labelled with a FormFieldKind by the page script; the vault's formEntries.
 *
 * Data flow:
 *   form submit → rememberEntries() (filters with isRememberableValue) → vault saved
 *   user focuses a field → suggestEntries() → overlay list; Library → forgetEntry() / forgetAllEntries()
 */
import type { FormFieldKind } from "../shared/passwords";
import type { FormEntry, PasswordVault } from "./passwords";

/** Most remembered values. Our choice: years of typing; bounds the vault file. Least recently used go first. */
export const MAX_FORM_ENTRIES = 2_000;

/** Most suggestions shown under a field. Our choice: a list that fits beside the field without scrolling. */
export const MAX_FORM_SUGGESTIONS = 6;

/** Longest remembered value. Our choice: names and addresses are short; long text is a message, not a form entry. */
export const MAX_REMEMBERED_VALUE_LENGTH = 200;

/** Card numbers have 13 to 19 digits (ISO/IEC 7812). */
export const CARD_NUMBER_MIN_DIGITS = 13;
export const CARD_NUMBER_MAX_DIGITS = 19;

/** One-time codes and PINs are 4 to 8 digits; such a value is a secret and is not remembered. */
export const SHORT_CODE_MIN_DIGITS = 4;
export const SHORT_CODE_MAX_DIGITS = 8;

/** Luhn check (ISO/IEC 7812): every second digit from the right is doubled, and doubled values above 9 lose 9. */
const LUHN_DOUBLED_DIGIT_LIMIT = 9;
const LUHN_MODULUS = 10;

const SPACES_AND_DASHES = /[ -]/g;
const ONLY_DIGITS = /^\d+$/;

/** True when the digits pass the Luhn check that every real card number passes. */
function passesLuhnCheck(digits: string): boolean {
  let sum = 0;
  let shouldDouble = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index]);
    if (shouldDouble) {
      digit *= 2;
      digit = digit > LUHN_DOUBLED_DIGIT_LIMIT ? digit - LUHN_DOUBLED_DIGIT_LIMIT : digit;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % LUHN_MODULUS === 0;
}

/** Whether a typed value may be stored. Secrets (passwords, card numbers, codes) never may. */
export function isRememberableValue(kind: FormFieldKind, value: string, passwordsInForm: readonly string[]): boolean {
  const trimmedValue = value.trim();
  if (trimmedValue === "" || trimmedValue.length > MAX_REMEMBERED_VALUE_LENGTH) {
    return false;
  }
  if (passwordsInForm.includes(value) || passwordsInForm.includes(trimmedValue)) {
    return false;
  }
  const digits = trimmedValue.replace(SPACES_AND_DASHES, "");
  if (!ONLY_DIGITS.test(digits)) {
    return true;
  }
  const isCardNumber =
    digits.length >= CARD_NUMBER_MIN_DIGITS && digits.length <= CARD_NUMBER_MAX_DIGITS && passesLuhnCheck(digits);
  if (isCardNumber) {
    return false;
  }
  // A short number is a code or PIN, except in a postal code field, where it is the very thing to remember.
  const isShortCode = digits.length >= SHORT_CODE_MIN_DIGITS && digits.length <= SHORT_CODE_MAX_DIGITS;
  return !isShortCode || kind === "postalCode";
}

/** Emails are not case-sensitive in practice; everything else (names, streets) is compared exactly. */
function isSameEntryValue(kind: FormFieldKind, firstValue: string, secondValue: string): boolean {
  if (kind === "email") {
    return firstValue.toLowerCase() === secondValue.toLowerCase();
  }
  return firstValue === secondValue;
}

/** Remembers what a submitted form held. Same vault when nothing was remembered. */
export function rememberEntries(
  vault: PasswordVault,
  entries: readonly { kind: FormFieldKind; value: string }[],
  passwordsInForm: readonly string[],
  now: number,
): PasswordVault {
  let formEntries = vault.formEntries;
  for (const entry of entries) {
    if (!isRememberableValue(entry.kind, entry.value, passwordsInForm)) {
      continue;
    }
    const value = entry.value.trim();
    const existing = formEntries.find(
      (candidate) => candidate.kind === entry.kind && isSameEntryValue(entry.kind, candidate.value, value),
    );
    if (existing) {
      const used: FormEntry = { ...existing, timesUsed: existing.timesUsed + 1, lastUsedAt: now };
      formEntries = formEntries.map((candidate) => (candidate === existing ? used : candidate));
      continue;
    }
    formEntries = [...formEntries, { kind: entry.kind, value, timesUsed: 1, lastUsedAt: now }];
  }
  if (formEntries === vault.formEntries) {
    return vault;
  }
  if (formEntries.length > MAX_FORM_ENTRIES) {
    const newestFirst = [...formEntries].sort((first, second) => second.lastUsedAt - first.lastUsedAt);
    formEntries = newestFirst.slice(0, MAX_FORM_ENTRIES);
  }
  return { ...vault, formEntries };
}

/** Values of the kind that start with what the user typed so far, the most used first. */
export function suggestEntries(vault: PasswordVault, kind: FormFieldKind, typed: string): string[] {
  const typedStart = typed.trimStart().toLowerCase();
  const matching = vault.formEntries.filter((entry) => {
    const lowerValue = entry.value.toLowerCase();
    return entry.kind === kind && lowerValue.startsWith(typedStart) && lowerValue !== typedStart;
  });
  const ranked = matching.sort((first, second) => {
    const byUse = second.timesUsed - first.timesUsed;
    return byUse !== 0 ? byUse : second.lastUsedAt - first.lastUsedAt;
  });
  return ranked.slice(0, MAX_FORM_SUGGESTIONS).map((entry) => entry.value);
}

/** Removes one remembered value (Shift+Delete in the suggestion list). */
export function forgetEntry(vault: PasswordVault, kind: FormFieldKind, value: string): PasswordVault {
  const trimmedValue = value.trim();
  const formEntries = vault.formEntries.filter(
    (entry) => !(entry.kind === kind && isSameEntryValue(kind, entry.value, trimmedValue)),
  );
  return formEntries.length === vault.formEntries.length ? vault : { ...vault, formEntries };
}

/** Forgets every remembered value (the Library's "Forget all"). */
export function forgetAllEntries(vault: PasswordVault): PasswordVault {
  return vault.formEntries.length === 0 ? vault : { ...vault, formEntries: [] };
}

/** How many values are remembered, for the Library. */
export function countEntries(vault: PasswordVault): number {
  return vault.formEntries.length;
}
