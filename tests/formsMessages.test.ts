import { describe, expect, it } from "vitest";
import { MAX_SUBMITTED_ENTRIES, MAX_TYPED_LENGTH } from "../src/shared/forms";
import {
  MAX_RECT_COORDINATE,
  parseFieldFocusedMessage,
  parseFrameLocatedMessage,
  parseSubmittedMessage,
} from "../src/main/formsMessages";
import { MAX_LOGIN_FIELD_LENGTH } from "../src/main/passwords";
import { MAX_FIELD_KEY_LENGTH } from "../src/shared/passwords";

const goodFocused = { role: "username", typed: "ann", rect: { x: 1, y: 2, width: 3, height: 4 }, hasPasswordField: true, frameKey: "", fieldKey: "" };
const goodFieldFocused = { ...goodFocused, role: "field", fieldKey: "vat number", hasPasswordField: false };
const FRAME_KEY = "0123456789abcdef0123456789abcdef";
const goodLocated = { requestId: 7, x: 120, y: -40.5, frameKey: FRAME_KEY };
const goodSubmitted = { username: "ann", password: "pw", isNewPassword: false, wasTyped: true, entries: [{ kind: "email", value: "a@b.c" }] };

describe("parseFieldFocusedMessage", () => {
  it("accepts a good message and drops extra properties", () => {
    const parsed = parseFieldFocusedMessage({ ...goodFocused, extra: "x", rect: { ...goodFocused.rect, more: 1 } });
    expect(parsed).toEqual(goodFocused);
  });

  it("accepts every sign-in role and remembered kind", () => {
    for (const role of ["username", "password", "newPassword", "email", "postalCode"]) {
      expect(parseFieldFocusedMessage({ ...goodFocused, role })).not.toBeNull();
    }
  });

  it("refuses anything that is not an object", () => {
    for (const value of [null, undefined, 5, "x", [], [goodFocused]]) {
      expect(parseFieldFocusedMessage(value)).toBeNull();
    }
  });

  it("refuses unknown or wrongly typed roles", () => {
    for (const role of ["admin", "", 3, null, undefined]) {
      expect(parseFieldFocusedMessage({ ...goodFocused, role })).toBeNull();
    }
  });

  it("refuses typed text that is not a string or too long", () => {
    expect(parseFieldFocusedMessage({ ...goodFocused, typed: 4 })).toBeNull();
    expect(parseFieldFocusedMessage({ ...goodFocused, typed: "a".repeat(MAX_TYPED_LENGTH + 1) })).toBeNull();
    expect(parseFieldFocusedMessage({ ...goodFocused, typed: "a".repeat(MAX_TYPED_LENGTH) })).not.toBeNull();
  });

  it("accepts an embedded frame's key and refuses anything else in its place", () => {
    expect(parseFieldFocusedMessage({ ...goodFocused, frameKey: FRAME_KEY })?.frameKey).toBe(FRAME_KEY);
    for (const frameKey of [undefined, null, 5, "abc", FRAME_KEY.toUpperCase(), `${FRAME_KEY}0`, `${FRAME_KEY.slice(1)}g`]) {
      expect(parseFieldFocusedMessage({ ...goodFocused, frameKey })).toBeNull();
    }
  });

  it("accepts the role 'field' with its field key", () => {
    expect(parseFieldFocusedMessage(goodFieldFocused)).toEqual(goodFieldFocused);
  });

  it("refuses the role 'field' without a good key, and a key with any other role", () => {
    for (const fieldKey of ["", undefined, null, 5, "VAT", "vat_number", "vat  number", " vat", "123", "x".repeat(MAX_FIELD_KEY_LENGTH + 1)]) {
      expect(parseFieldFocusedMessage({ ...goodFieldFocused, fieldKey }), String(fieldKey)).toBeNull();
    }
    for (const role of ["username", "password", "email", "city"]) {
      expect(parseFieldFocusedMessage({ ...goodFocused, role, fieldKey: "vat number" }), role).toBeNull();
      expect(parseFieldFocusedMessage({ ...goodFocused, role, fieldKey: undefined }), role).toBeNull();
    }
  });

  it("refuses a hasPasswordField that is not a boolean", () => {
    expect(parseFieldFocusedMessage({ ...goodFocused, hasPasswordField: "yes" })).toBeNull();
    expect(parseFieldFocusedMessage({ ...goodFocused, hasPasswordField: undefined })).toBeNull();
  });

  it("refuses a bad rectangle", () => {
    const badRects = [
      null,
      "x",
      { x: 1, y: 2, width: 3 },
      { x: "1", y: 2, width: 3, height: 4 },
      { x: NaN, y: 2, width: 3, height: 4 },
      { x: Infinity, y: 2, width: 3, height: 4 },
      { x: 1, y: 2, width: -1, height: 4 },
      { x: 1, y: 2, width: 3, height: -0.5 },
      { x: MAX_RECT_COORDINATE + 1, y: 2, width: 3, height: 4 },
      { x: 1, y: -MAX_RECT_COORDINATE - 1, width: 3, height: 4 },
      { x: 1, y: 2, width: MAX_RECT_COORDINATE + 1, height: 4 },
    ];
    for (const rect of badRects) {
      expect(parseFieldFocusedMessage({ ...goodFocused, rect })).toBeNull();
    }
  });
});

describe("parseSubmittedMessage", () => {
  it("accepts a good message and drops extra properties", () => {
    const parsed = parseSubmittedMessage({ ...goodSubmitted, extra: 1, entries: [{ kind: "email", value: "a@b.c", more: true }] });
    expect(parsed).toEqual(goodSubmitted);
  });

  it("accepts field-key entries next to kinds, with only their known properties", () => {
    const entries = [
      { kind: "field", field: "vat number", value: "CZ12345678", extra: 1 },
      { kind: "email", value: "a@b.c", field: "ignored for a kind" },
    ];
    const parsed = parseSubmittedMessage({ ...goodSubmitted, password: "", entries });
    expect(parsed?.entries).toEqual([
      { kind: "field", field: "vat number", value: "CZ12345678" },
      { kind: "email", value: "a@b.c" },
    ]);
  });

  it("accepts an empty password and no entries", () => {
    expect(parseSubmittedMessage({ ...goodSubmitted, password: "", entries: [] })).not.toBeNull();
  });

  it("refuses anything that is not an object", () => {
    for (const value of [null, undefined, 1, "x", [], [goodSubmitted]]) {
      expect(parseSubmittedMessage(value)).toBeNull();
    }
  });

  it("refuses a username or password of the wrong type or length", () => {
    expect(parseSubmittedMessage({ ...goodSubmitted, username: 1 })).toBeNull();
    expect(parseSubmittedMessage({ ...goodSubmitted, password: null })).toBeNull();
    expect(parseSubmittedMessage({ ...goodSubmitted, username: "a".repeat(MAX_LOGIN_FIELD_LENGTH + 1) })).toBeNull();
    expect(parseSubmittedMessage({ ...goodSubmitted, password: "a".repeat(MAX_LOGIN_FIELD_LENGTH + 1) })).toBeNull();
    expect(parseSubmittedMessage({ ...goodSubmitted, password: "a".repeat(MAX_LOGIN_FIELD_LENGTH) })).not.toBeNull();
  });

  it("refuses flags that are not booleans", () => {
    expect(parseSubmittedMessage({ ...goodSubmitted, isNewPassword: 0 })).toBeNull();
    expect(parseSubmittedMessage({ ...goodSubmitted, wasTyped: "true" })).toBeNull();
    expect(parseSubmittedMessage({ ...goodSubmitted, wasTyped: undefined })).toBeNull();
  });

  it("refuses entries that are not an array or are too many", () => {
    expect(parseSubmittedMessage({ ...goodSubmitted, entries: undefined })).toBeNull();
    expect(parseSubmittedMessage({ ...goodSubmitted, entries: {} })).toBeNull();
    const tooMany = Array.from({ length: MAX_SUBMITTED_ENTRIES + 1 }, () => ({ kind: "email", value: "a" }));
    expect(parseSubmittedMessage({ ...goodSubmitted, entries: tooMany })).toBeNull();
    const maximum = Array.from({ length: MAX_SUBMITTED_ENTRIES }, () => ({ kind: "email", value: "a" }));
    expect(parseSubmittedMessage({ ...goodSubmitted, entries: maximum })).not.toBeNull();
  });

  it("refuses one bad entry, even among good ones", () => {
    const badEntries = [
      null,
      "x",
      { kind: "password", value: "a" },
      { kind: "username", value: "a" },
      { kind: 3, value: "a" },
      { kind: "email", value: "" },
      { kind: "email", value: 5 },
      { kind: "email", value: "a".repeat(MAX_TYPED_LENGTH + 1) },
      { kind: "field", value: "a" },
      { kind: "field", field: "", value: "a" },
      { kind: "field", field: "Vat", value: "a" },
      { kind: "field", field: "123", value: "a" },
      { kind: "field", field: "vat number", value: "" },
      { kind: "field", field: "vat number", value: "a".repeat(MAX_TYPED_LENGTH + 1) },
    ];
    for (const badEntry of badEntries) {
      const entries = [{ kind: "email", value: "ok" }, badEntry];
      expect(parseSubmittedMessage({ ...goodSubmitted, entries })).toBeNull();
    }
  });
});

describe("parseFrameLocatedMessage", () => {
  it("accepts a good answer and drops extra properties", () => {
    expect(parseFrameLocatedMessage({ ...goodLocated, extra: true })).toEqual(goodLocated);
    expect(parseFrameLocatedMessage({ ...goodLocated, frameKey: "" })).toEqual({ ...goodLocated, frameKey: "" });
  });

  it("refuses a bad request id", () => {
    for (const requestId of [0, -1, 1.5, "7", NaN, Number.MAX_SAFE_INTEGER + 2, undefined]) {
      expect(parseFrameLocatedMessage({ ...goodLocated, requestId })).toBeNull();
    }
  });

  it("refuses a bad place or key", () => {
    expect(parseFrameLocatedMessage({ ...goodLocated, x: Infinity })).toBeNull();
    expect(parseFrameLocatedMessage({ ...goodLocated, y: MAX_RECT_COORDINATE + 1 })).toBeNull();
    expect(parseFrameLocatedMessage({ ...goodLocated, x: "1" })).toBeNull();
    expect(parseFrameLocatedMessage({ ...goodLocated, frameKey: "nope" })).toBeNull();
    expect(parseFrameLocatedMessage(null)).toBeNull();
    expect(parseFrameLocatedMessage([goodLocated])).toBeNull();
  });
});
