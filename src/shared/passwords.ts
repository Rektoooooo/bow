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
 */

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
