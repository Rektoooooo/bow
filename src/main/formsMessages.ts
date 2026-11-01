/**
 * WHY this file exists:
 *   Messages from the page helper (src/preload/formsPreload.ts) come from a web page, so they are untrusted: a page
 *   can send anything on these channels from a frame we do not control. These functions accept only exactly the
 *   shapes in shared/forms.ts and return fresh objects with the known fields only. Pure (no Electron) so tests can
 *   run every refusal.
 *
 * Data source:
 *   Whatever arrived over IPC (unknown). Limits come from shared/forms.ts and passwords.ts.
 *
 * Data flow:
 *   formsBridge.ts → parseFieldFocusedMessage / parseSubmittedMessage / parseFrameLocatedMessage → a clean message,
 *   or null (then dropped)
 */
import { FRAME_KEY_LENGTH, MAX_SUBMITTED_ENTRIES, MAX_TYPED_LENGTH } from "../shared/forms";
import type {
  FieldFocusedMessage,
  FieldRect,
  FieldRole,
  FrameLocatedMessage,
  SubmittedEntry,
  SubmittedMessage,
} from "../shared/forms";
import { isFormFieldKind } from "../shared/passwords";
import { MAX_LOGIN_FIELD_LENGTH } from "./passwords";

/**
 * Largest distance from the viewport's corner a field's rectangle may have, in CSS pixels. Our choice: far beyond
 * any real page (scrolled or zoomed), small enough that later math on it cannot overflow.
 */
export const MAX_RECT_COORDINATE = 100_000;

const SIGN_IN_ROLES = ["username", "password", "newPassword"];

/** A frame key as the helper makes it: lower-case hex of exactly FRAME_KEY_LENGTH digits. */
const FRAME_KEY_PATTERN = new RegExp(`^[0-9a-f]{${FRAME_KEY_LENGTH}}$`);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowedRole(value: unknown): value is FieldRole {
  return SIGN_IN_ROLES.includes(value as string) || isFormFieldKind(value);
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_RECT_COORDINATE;
}

function isSize(value: unknown): value is number {
  return isCoordinate(value) && value >= 0;
}

/** A frame key, or "" for a tab's top frame. */
function isFrameKeyOrEmpty(value: unknown): value is string {
  return value === "" || (typeof value === "string" && FRAME_KEY_PATTERN.test(value));
}

function parseRect(value: unknown): FieldRect | null {
  if (!isRecord(value)) {
    return null;
  }
  const { x, y, width, height } = value;
  if (!isCoordinate(x) || !isCoordinate(y) || !isSize(width) || !isSize(height)) {
    return null;
  }
  return { x: x, y: y, width: width, height: height };
}

/**
 * The clean "user is in a field" message, or null when anything is off.
 */
export function parseFieldFocusedMessage(value: unknown): FieldFocusedMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  const { role, typed, hasPasswordField, frameKey } = value;
  if (!isAllowedRole(role)) {
    return null;
  }
  if (typeof typed !== "string" || typed.length > MAX_TYPED_LENGTH) {
    return null;
  }
  if (typeof hasPasswordField !== "boolean" || !isFrameKeyOrEmpty(frameKey)) {
    return null;
  }
  const rect = parseRect(value.rect);
  if (rect === null) {
    return null;
  }
  return { role: role, typed: typed, rect: rect, hasPasswordField: hasPasswordField, frameKey: frameKey };
}

/**
 * The clean "the child frame is here" answer, or null when anything is off.
 */
export function parseFrameLocatedMessage(value: unknown): FrameLocatedMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  const { requestId, x, y, frameKey } = value;
  if (typeof requestId !== "number" || !Number.isSafeInteger(requestId) || requestId < 1) {
    return null;
  }
  if (!isCoordinate(x) || !isCoordinate(y) || !isFrameKeyOrEmpty(frameKey)) {
    return null;
  }
  return { requestId: requestId, x: x, y: y, frameKey: frameKey };
}

function parseEntry(value: unknown): SubmittedEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const { kind, value: entryValue } = value;
  if (!isFormFieldKind(kind)) {
    return null;
  }
  if (typeof entryValue !== "string" || entryValue === "" || entryValue.length > MAX_TYPED_LENGTH) {
    return null;
  }
  return { kind: kind, value: entryValue };
}

function parseEntries(value: unknown): SubmittedEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_SUBMITTED_ENTRIES) {
    return null;
  }
  const entries: SubmittedEntry[] = [];
  for (const rawEntry of value) {
    const entry = parseEntry(rawEntry);
    if (entry === null) {
      return null;
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * The clean "a form was sent" message, or null when anything is off.
 */
export function parseSubmittedMessage(value: unknown): SubmittedMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  const { username, password, isNewPassword, wasTyped } = value;
  if (typeof username !== "string" || username.length > MAX_LOGIN_FIELD_LENGTH) {
    return null;
  }
  if (typeof password !== "string" || password.length > MAX_LOGIN_FIELD_LENGTH) {
    return null;
  }
  if (typeof isNewPassword !== "boolean" || typeof wasTyped !== "boolean") {
    return null;
  }
  const entries = parseEntries(value.entries);
  if (entries === null) {
    return null;
  }
  return { username: username, password: password, isNewPassword: isNewPassword, wasTyped: wasTyped, entries: entries };
}
