/**
 * WHY this file exists:
 *   The page helper decides which fields Bow may remember. These tests pin that allow-list: what the page declares in
 *   autocomplete, the input type, the name heuristics, and the deny words that must always win.
 *
 * Data source:
 *   Made-up field descriptions (no DOM: only the pure functions of src/preload/formsPreload.ts run in Node).
 *
 * Data flow:
 *   field description → fieldKindFor() / roleForFacts() / pickUsernameCandidate() → asserted kind, role or index
 */
import { describe, expect, it } from "vitest";
import {
  autocompleteFieldName,
  fieldKindFor,
  KNOWN_FIELD_KINDS,
  pickUsernameCandidate,
  roleForFacts,
} from "../src/preload/formsPreload";
import { FORM_FIELD_KINDS } from "../src/shared/passwords";

function kindOf(parts: { autocomplete?: string; type?: string; name?: string; id?: string }) {
  return fieldKindFor({ autocomplete: "", type: "text", name: "", id: "", ...parts });
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
      "webauthn",
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
  const baseFacts = { type: "text", autocompleteName: "", isUsernameField: false, isNewPasswordForm: false, fieldKind: null };

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
});
