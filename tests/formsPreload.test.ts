/**
 * WHY this file exists:
 *   The page helper decides which fields Bow may remember. These tests pin that allow-list: what the page declares in
 *   autocomplete, the input type, the name heuristics, the deny words that must always win, and the field keys that
 *   remember any other plain text field by its own name (and must look exactly as main checks them).
 *
 * Data source:
 *   Made-up field descriptions (no DOM: only the pure functions of src/preload/formsPreload.ts run in Node).
 *
 * Data flow:
 *   field description → fieldKindFor() / fieldKeyFor() / roleForFacts() / pickUsernameCandidate() → asserted kind,
 *   key, role or index
 */
import { describe, expect, it } from "vitest";
import {
  autocompleteFieldName,
  fieldKeyFor,
  fieldKindFor,
  KNOWN_FIELD_KINDS,
  pickUsernameCandidate,
  roleForFacts,
} from "../src/preload/formsPreload";
import { FORM_FIELD_KINDS, isFieldKey, MAX_FIELD_KEY_LENGTH } from "../src/shared/passwords";

function kindOf(parts: { autocomplete?: string; type?: string; name?: string; id?: string }) {
  return fieldKindFor({ autocomplete: "", type: "text", name: "", id: "", ...parts });
}

interface KeyParts {
  autocomplete?: string;
  type?: string;
  name?: string;
  id?: string;
  isFormMemoryOff?: boolean;
  isInSearchArea?: boolean;
}

function keyOf(parts: KeyParts) {
  return fieldKeyFor({ autocomplete: "", type: "text", name: "", id: "", isFormMemoryOff: false, isInSearchArea: false, ...parts });
}

describe("the helper's repeated kind list", () => {
  it("matches the shared allow-list", () => {
    expect([...KNOWN_FIELD_KINDS]).toEqual([...FORM_FIELD_KINDS]);
  });
});

describe("autocomplete", () => {
  const mappings: Array<[string, string]> = [
    ["email", "email"],
    ["name", "name"],
    ["given-name", "givenName"],
    ["family-name", "familyName"],
    ["tel", "tel"],
    ["tel-national", "tel"],
    ["organization", "organization"],
    ["street-address", "streetAddress"],
    ["address-line1", "streetAddress"],
    ["address-line2", "addressLine2"],
    ["address-level2", "city"],
    ["address-level1", "region"],
    ["postal-code", "postalCode"],
    ["country", "country"],
    ["country-name", "country"],
  ];

  it.each(mappings)("maps %s to %s", (autocomplete, expected) => {
    expect(kindOf({ autocomplete })).toBe(expected);
  });

  it("ignores section, shipping, billing and similar leading words", () => {
    expect(kindOf({ autocomplete: "section-blue shipping postal-code" })).toBe("postalCode");
    expect(kindOf({ autocomplete: "billing address-level2" })).toBe("city");
    expect(kindOf({ autocomplete: "work email" })).toBe("email");
    expect(kindOf({ autocomplete: "SHIPPING Given-Name" })).toBe("givenName");
  });

  it("returns null for anything the page named that is not in the map", () => {
    for (const autocomplete of [
      "off",
      "one-time-code",
      "cc-number",
      "cc-exp",
      "new-password",
      "current-password",
      "username",
      "username webauthn",
      "transaction-amount",
      "bday",
      "something-unknown",
    ]) {
      expect(kindOf({ autocomplete, name: "email" })).toBeNull();
    }
  });

  it("goes on to the type and name rules for 'on' and empty values", () => {
    expect(kindOf({ autocomplete: "on", type: "email" })).toBe("email");
    expect(kindOf({ autocomplete: "shipping", name: "city" })).toBe("city");
    // "webauthn" alone names no field (the standard puts it after one), like "shipping" alone.
    expect(kindOf({ autocomplete: "webauthn", name: "email" })).toBe("email");
  });

  it("never returns a kind for password or hidden fields", () => {
    expect(kindOf({ autocomplete: "email", type: "password" })).toBeNull();
    expect(kindOf({ autocomplete: "email", type: "hidden" })).toBeNull();
  });
});

describe("input type", () => {
  it("reads email and tel types", () => {
    expect(kindOf({ type: "email" })).toBe("email");
    expect(kindOf({ type: "TEL" })).toBe("tel");
  });

  it("treats an empty type as text", () => {
    expect(kindOf({ type: "", name: "city" })).toBe("city");
  });

  it("returns null for other types", () => {
    for (const type of ["search", "password", "number", "url", "date", "hidden", "checkbox", "file"]) {
      expect(kindOf({ type, name: "city" })).toBeNull();
    }
  });
});

describe("name and id heuristics", () => {
  const cases: Array<[string, string]> = [
    ["email", "email"],
    ["user_email", "email"],
    ["e-mail", "email"],
    ["first_name", "givenName"],
    ["firstName", "givenName"],
    ["fname", "givenName"],
    ["given-name", "givenName"],
    ["last_name", "familyName"],
    ["lastName", "familyName"],
    ["surname", "familyName"],
    ["lname", "familyName"],
    ["full_name", "name"],
    ["fullName", "name"],
    ["name", "name"],
    ["your-name", "name"],
    ["phone", "tel"],
    ["phone_number", "tel"],
    ["mobile", "tel"],
    ["tel", "tel"],
    ["zip", "postalCode"],
    ["zipCode", "postalCode"],
    ["postal_code", "postalCode"],
    ["postcode", "postalCode"],
    ["post-code", "postalCode"],
    ["city", "city"],
    ["town", "city"],
    ["state", "region"],
    ["province", "region"],
    ["region", "region"],
    ["county", "region"],
    ["country", "country"],
    ["company", "organization"],
    ["organisation", "organization"],
    ["organization", "organization"],
    ["business_name", "organization"],
    ["address2", "addressLine2"],
    ["address_line_2", "addressLine2"],
    ["addressLine2", "addressLine2"],
    ["apartment", "addressLine2"],
    ["suite", "addressLine2"],
    ["apt", "addressLine2"],
    ["street", "streetAddress"],
    ["address", "streetAddress"],
    ["address1", "streetAddress"],
    ["streetAddress", "streetAddress"],
  ];

  it.each(cases)("reads name %s as %s", (name, expected) => {
    expect(kindOf({ name })).toBe(expected);
  });

  it("also reads the id", () => {
    expect(kindOf({ name: "", id: "billing-city" })).toBe("city");
  });

  it("lets deny words win over every mapping", () => {
    for (const name of [
      "card_number",
      "cardholder_name",
      "ccnum",
      "cc-num",
      "cvv",
      "cvc",
      "csc",
      "security_code",
      "expiry",
      "iban",
      "account_number",
      "routing_number",
      "ssn",
      "social_security",
      "tax_id",
      "passport_number",
      "otp_code",
      "one-time-code",
      "onetime_phone",
      "verification_email",
      "2fa_phone",
      "mfa_code",
      "token",
      "pin",
      "passcode",
      "captcha",
      "password",
      "passwd",
      "search",
      "search_city",
      "query",
      "q",
      "comment",
      "message",
      "subject",
      "coupon",
      "promo_code",
    ]) {
      expect(kindOf({ name }), name).toBeNull();
    }
  });

  it("applies the deny words to the id too", () => {
    expect(kindOf({ name: "city", id: "card-city" })).toBeNull();
  });

  it("keeps words that only contain a deny word as a part", () => {
    expect(kindOf({ name: "pine_city" })).toBe("city");
  });

  it("returns null for unknown names", () => {
    for (const name of ["", "foo", "field_17", "nickname", "age", "website"]) {
      expect(kindOf({ name }), name).toBeNull();
    }
  });

  it("only ever returns kinds from the shared allow-list", () => {
    const allNames = cases.map(([name]) => name);
    const allAutocompletes = ["email", "name", "tel", "country-name", "address-level1", "foo", "off", ""];
    const results = [
      ...allNames.map((name) => kindOf({ name })),
      ...allAutocompletes.map((autocomplete) => kindOf({ autocomplete })),
      kindOf({ type: "email" }),
      kindOf({ type: "tel" }),
    ];
    for (const result of results) {
      if (result !== null) {
        expect(FORM_FIELD_KINDS).toContain(result);
      }
    }
  });
});

describe("autocompleteFieldName", () => {
  it("returns the last meaningful word, or an empty string", () => {
    expect(autocompleteFieldName("section-a billing street-address")).toBe("street-address");
    expect(autocompleteFieldName("")).toBe("");
    expect(autocompleteFieldName("shipping")).toBe("");
  });

  it("reads past the webauthn word a passkey-ready field ends with (Apple's sign-in)", () => {
    expect(autocompleteFieldName("username webauthn")).toBe("username");
    expect(autocompleteFieldName("current-password webauthn")).toBe("current-password");
    expect(autocompleteFieldName("section-login email webauthn")).toBe("email");
    expect(kindOf({ autocomplete: "email webauthn" })).toBe("email");
  });
});

describe("pickUsernameCandidate", () => {
  it("prefers a declared username or email, nearest the password", () => {
    const index = pickUsernameCandidate([
      { autocompleteName: "username", type: "text" },
      { autocompleteName: "", type: "email" },
      { autocompleteName: "email", type: "text" },
    ]);
    expect(index).toBe(2);
  });

  it("then the email type, then the last one, and -1 for none", () => {
    expect(
      pickUsernameCandidate([
        { autocompleteName: "", type: "email" },
        { autocompleteName: "", type: "text" },
      ]),
    ).toBe(0);
    expect(
      pickUsernameCandidate([
        { autocompleteName: "", type: "text" },
        { autocompleteName: "", type: "tel" },
      ]),
    ).toBe(1);
    expect(pickUsernameCandidate([])).toBe(-1);
  });
});

describe("roleForFacts", () => {
  const baseFacts = { type: "text", autocompleteName: "", isUsernameField: false, isNewPasswordForm: false, fieldKind: null, fieldKey: null };

  it("tells password from new password", () => {
    expect(roleForFacts({ ...baseFacts, type: "password" })).toBe("password");
    expect(roleForFacts({ ...baseFacts, type: "password", isNewPasswordForm: true })).toBe("newPassword");
  });

  it("calls the username field a username in a sign-in form", () => {
    expect(roleForFacts({ ...baseFacts, isUsernameField: true, fieldKind: "email" })).toBe("username");
  });

  it("calls it a username in a sign-up form only when the page says so", () => {
    expect(roleForFacts({ ...baseFacts, isUsernameField: true, isNewPasswordForm: true, fieldKind: "email" })).toBe("email");
    expect(
      roleForFacts({ ...baseFacts, isUsernameField: true, isNewPasswordForm: true, autocompleteName: "username" }),
    ).toBe("username");
  });

  it("falls back to the remembered kind, or null", () => {
    expect(roleForFacts({ ...baseFacts, fieldKind: "city" })).toBe("city");
    expect(roleForFacts(baseFacts)).toBeNull();
  });

  it("calls a field with only a field key a 'field', and lets kinds and sign-in roles win over a key", () => {
    expect(roleForFacts({ ...baseFacts, fieldKey: "vat number" })).toBe("field");
    expect(roleForFacts({ ...baseFacts, fieldKind: "city", fieldKey: "town or village" })).toBe("city");
    expect(roleForFacts({ ...baseFacts, isUsernameField: true, fieldKey: "login" })).toBe("username");
    expect(roleForFacts({ ...baseFacts, type: "password", fieldKey: "pin" })).toBe("password");
  });
});

describe("fieldKeyFor", () => {
  it("names a plain text field by its normalized name, else by its id", () => {
    expect(keyOf({ name: "vat_number" })).toBe("vat number");
    expect(keyOf({ name: "nickName" })).toBe("nick name");
    expect(keyOf({ name: "Customer-Reference" })).toBe("customer reference");
    expect(keyOf({ name: "user[profile][website]" })).toBe("user profile website");
    expect(keyOf({ name: "", id: "nickname" })).toBe("nickname");
    expect(keyOf({ name: "__", id: "member_no" })).toBe("member no");
    expect(keyOf({ name: "nick", id: "other" })).toBe("nick");
  });

  it("takes text, email and tel fields (an empty type is text), nothing else", () => {
    for (const type of ["text", "", "TEXT", "email", "tel"]) {
      expect(keyOf({ type, name: "nickname" }), type).toBe("nickname");
    }
    for (const type of ["password", "hidden", "search", "number", "url", "date", "checkbox", "file", "textarea"]) {
      expect(keyOf({ type, name: "nickname" }), type).toBeNull();
    }
  });

  it("refuses a field whose page or form turned memory off", () => {
    expect(keyOf({ name: "nickname", autocomplete: "off" })).toBeNull();
    expect(keyOf({ name: "nickname", autocomplete: "OFF" })).toBeNull();
    expect(keyOf({ name: "nickname", autocomplete: "section-a off" })).toBeNull();
    expect(keyOf({ name: "nickname", isFormMemoryOff: true })).toBeNull();
    expect(keyOf({ name: "nickname", autocomplete: "on" })).toBe("nickname");
  });

  it("refuses sign-in names, passwords, one-time codes and payment fields the page declares", () => {
    for (const autocomplete of [
      "username",
      "username webauthn",
      "current-password",
      "new-password",
      "one-time-code",
      "cc-number",
      "cc-name",
      "cc-exp",
      "billing cc-csc",
    ]) {
      expect(keyOf({ name: "nickname", autocomplete }), autocomplete).toBeNull();
    }
  });

  it("keeps other declared fields by their name (the page's word is not a kind Bow knows)", () => {
    expect(keyOf({ name: "nick", autocomplete: "nickname" })).toBe("nick");
    expect(keyOf({ name: "job", autocomplete: "organization-title" })).toBe("job");
  });

  it("refuses search boxes: by role or search area, by the whole names q and s, and by the deny words", () => {
    expect(keyOf({ name: "destination", isInSearchArea: true })).toBeNull();
    for (const name of ["q", "s", "search", "searchTerm", "site_search", "query", "keywords", "keyword"]) {
      expect(keyOf({ name }), name).toBeNull();
    }
    expect(keyOf({ name: "", id: "s" })).toBeNull();
  });

  it("refuses everything the deny words deny, on the name or the id", () => {
    for (const name of [
      "card_number",
      "cvv",
      "security_code",
      "iban",
      "account_number",
      "ssn",
      "tax_id",
      "passport_number",
      "otp",
      "verification",
      "2fa",
      "token",
      "pin",
      "passcode",
      "captcha",
      "password",
      "passwd",
      "comment",
      "message",
      "subject",
      "coupon",
      "promo",
      "security_question",
      "securityAnswer",
      "answer1",
      "question",
      "secret",
      "client_secret",
      "password_hint",
      "hint",
      "mnemonic",
      "passphrase",
      "pass_phrase",
      "private_key",
      "apiKey",
    ]) {
      expect(keyOf({ name }), name).toBeNull();
    }
    expect(keyOf({ name: "nickname", id: "secret-nickname" })).toBeNull();
  });

  it("refuses short secret words as whole words, digits after them included", () => {
    for (const name of ["code", "sms_code", "inviteCode", "discount-code", "code2", "key", "license_key", "pwd", "pw", "pass", "pass2", "auth", "auth_code"]) {
      expect(keyOf({ name }), name).toBeNull();
    }
    for (const [name, expected] of [
      ["keyboard_layout", "keyboard layout"],
      ["passenger", "passenger"],
      ["codename", "codename"],
      ["author", "author"],
    ]) {
      expect(keyOf({ name }), name).toBe(expected);
    }
  });

  it("leaves the known kinds alone: the short words are only for fields without a kind", () => {
    expect(kindOf({ name: "zip_code" })).toBe("postalCode");
    expect(kindOf({ name: "postal-code" })).toBe("postalCode");
    expect(kindOf({ name: "country_code" })).toBe("country");
  });

  it("refuses a key without a letter or longer than the limit", () => {
    expect(keyOf({ name: "" })).toBeNull();
    expect(keyOf({ name: "12345" })).toBeNull();
    expect(keyOf({ name: "--" })).toBeNull();
    expect(keyOf({ name: "a".repeat(MAX_FIELD_KEY_LENGTH) })).toBe("a".repeat(MAX_FIELD_KEY_LENGTH));
    expect(keyOf({ name: "a".repeat(MAX_FIELD_KEY_LENGTH + 1) })).toBeNull();
  });

  it("makes only keys that main accepts (else main drops the whole sent form, a sign-in's offer with it)", () => {
    const rawNames = [
      "vat_number",
      "VATNumber",
      "nickName",
      "  spaced   out  ",
      "first--second__third",
      "user[profile][0][website]",
      "a1b2c3",
      "Příjmení",
      "ÄÖÜ_field",
      "field.name",
      "x".repeat(MAX_FIELD_KEY_LENGTH),
      "x ".repeat(MAX_FIELD_KEY_LENGTH / 2),
      "9lives",
    ];
    const keys = rawNames.map((name) => keyOf({ name }));
    for (const key of keys) {
      if (key !== null) {
        expect(isFieldKey(key), key).toBe(true);
      }
    }
    expect(keys.filter((key) => key !== null).length).toBeGreaterThan(10);
  });
});
