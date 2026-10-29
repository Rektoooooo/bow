/**
 * WHY this file exists:
 *   Bow Passwords needs one small helper inside web pages (src/preload/formsPreload.ts) to notice sign-in fields and
 *   submitted forms, and to fill a login the user picked. This is the contract between that helper and the main
 *   process: the channel names and the shape of every message. Main never trusts a message: it checks each one with
 *   the parse functions in formsMessages.ts and takes the site from the sending frame, never from the message.
 *
 * Data source:
 *   Our choice (no browser API to follow). The limits match passwords.ts and formMemory.ts.
 *
 * Data flow:
 *   page helper → FORMS_CHANNELS.fieldFocused / fieldLeft / submitted / loginFinished → main (formsBridge.ts)
 *   main → FORMS_CHANNELS.fill / fillValue → the page helper of that one frame
 */
import type { FormFieldKind } from "./passwords";

/** Channel names. The sandboxed helper cannot import our files, so it repeats them typed as `typeof FORMS_CHANNELS`. */
export const FORMS_CHANNELS = {
  fieldFocused: "forms:field-focused",
  fieldLeft: "forms:field-left",
  submitted: "forms:submitted",
  loginFinished: "forms:login-finished",
  fill: "forms:fill",
  fillValue: "forms:fill-value",
} as const;

/** What the field the user is in is for: a sign-in field, or one of the remembered kinds. */
export type FieldRole = "username" | "password" | "newPassword" | FormFieldKind;

/** A field's place in the page's viewport, in CSS pixels (getBoundingClientRect). */
export interface FieldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The user clicked, tabbed or typed into a field Bow can help with. Only after real input: a page that moves focus by
 * script sends nothing. `typed` is what the field holds now (to narrow suggestions); `hasPasswordField` says whether
 * the field's form also has a password field (so a pick fills both).
 */
export interface FieldFocusedMessage {
  role: FieldRole;
  typed: string;
  rect: FieldRect;
  hasPasswordField: boolean;
}

/** One remembered-kind field of a submitted form, with what the user typed into it. */
export interface SubmittedEntry {
  kind: FormFieldKind;
  value: string;
}

/**
 * A form was sent (submit, Return in it, or a click on its button). `password` is empty for forms without one.
 * `wasTyped` is true only when the user typed or pasted the password themselves (not a page script, not Bow's fill).
 * `entries` holds only remembered-kind fields the user typed into.
 */
export interface SubmittedMessage {
  username: string;
  password: string;
  isNewPassword: boolean;
  wasTyped: boolean;
  entries: SubmittedEntry[];
}

/** Main → helper: fill the sign-in form of the field the user is in. */
export interface FillMessage {
  username: string;
  password: string;
}

/** Main → helper: put a remembered value into the field the user is in. */
export interface FillValueMessage {
  value: string;
}

/** Longest `typed` text sent while the user types. Our choice: same as the longest remembered value. */
export const MAX_TYPED_LENGTH = 200;

/** Most entries in one submitted form. Our choice: a long address form has about 15 fields. */
export const MAX_SUBMITTED_ENTRIES = 50;
