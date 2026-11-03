/**
 * WHY this file exists:
 *   Form memory must never keep a secret (password, card number, one-time code) and must suggest the right values in
 *   the right order. These tests pin down what is refused, what counts as the same entry (kind and field key), and
 *   the suggestion order.
 *
 * Data source:
 *   Synthetic values (example.com addresses, made-up names, the well-known test card number 4111 1111 1111 1111).
 *
 * Data flow:
 *   values → isRememberableValue() / rememberEntries() / suggestEntries() / forgetEntry() → checks
 */
import { describe, expect, it } from "vitest";
import {
  countEntries,
  forgetAllEntries,
  forgetEntry,
  isRememberableValue,
  MAX_FORM_ENTRIES,
  MAX_FORM_SUGGESTIONS,
  MAX_REMEMBERED_VALUE_LENGTH,
  rememberEntries,
  suggestEntries,
} from "../src/main/formMemory";
import { createEmptyVault, type PasswordVault } from "../src/main/passwords";

const NOW = 5_000;

describe("isRememberableValue", () => {
  it("accepts ordinary values", () => {
    expect(isRememberableValue("email", "alex@example.com", [])).toBe(true);
    expect(isRememberableValue("name", "Alex Example", [])).toBe(true);
    expect(isRememberableValue("tel", "+47 555 12 345", [])).toBe(true);
  });

  it("refuses empty and over-long values", () => {
    expect(isRememberableValue("name", "   ", [])).toBe(false);
    expect(isRememberableValue("name", "a".repeat(MAX_REMEMBERED_VALUE_LENGTH + 1), [])).toBe(false);
    expect(isRememberableValue("name", "a".repeat(MAX_REMEMBERED_VALUE_LENGTH), [])).toBe(true);
  });

  it("refuses a value equal to a password in the same form", () => {
    expect(isRememberableValue("name", "hunter22", ["hunter22"])).toBe(false);
    expect(isRememberableValue("name", " hunter22 ", ["hunter22"])).toBe(false);
    expect(isRememberableValue("name", "hunter22", ["other"])).toBe(true);
  });

  it("refuses card numbers (Luhn) for every kind, with spaces or dashes", () => {
    expect(isRememberableValue("name", "4111 1111 1111 1111", [])).toBe(false);
    expect(isRememberableValue("tel", "4111-1111-1111-1111", [])).toBe(false);
    expect(isRememberableValue("postalCode", "4111111111111111", [])).toBe(false);
    expect(isRememberableValue("tel", "4111 1111 1111 1112", [])).toBe(true);
  });

  it("refuses a short code or a year for a field key, like for every kind but a postal code", () => {
    expect(isRememberableValue("field", "2026", [])).toBe(false);
    expect(isRememberableValue("field", "48213", [])).toBe(false);
    expect(isRememberableValue("field", "4111 1111 1111 1111", [])).toBe(false);
    expect(isRememberableValue("field", "secret-pass-1", ["secret-pass-1"])).toBe(false);
    expect(isRememberableValue("field", "CZ12345678", [])).toBe(true);
  });

  it("refuses 4 to 8 digit codes except in a postal code", () => {
    expect(isRememberableValue("email", "123456", [])).toBe(false);
    expect(isRememberableValue("tel", "123456", [])).toBe(false);
    expect(isRememberableValue("tel", "1234", [])).toBe(false);
    expect(isRememberableValue("tel", "12345678", [])).toBe(false);
    expect(isRememberableValue("postalCode", "10115", [])).toBe(true);
    expect(isRememberableValue("tel", "123", [])).toBe(true);
    expect(isRememberableValue("tel", "123456789", [])).toBe(true);
  });
});

describe("rememberEntries", () => {
  it("adds new entries with one use", () => {
    const vault = rememberEntries(createEmptyVault(), [{ kind: "email", value: " alex@example.com " }], [], NOW);
    expect(vault.formEntries).toEqual([{ kind: "email", value: "alex@example.com", timesUsed: 1, lastUsedAt: NOW }]);
  });

  it("counts a repeat as a use, ignoring case only for emails", () => {
    const first = rememberEntries(
      createEmptyVault(),
      [
        { kind: "email", value: "alex@example.com" },
        { kind: "city", value: "Oslo" },
      ],
      [],
      NOW,
    );
    const second = rememberEntries(
      first,
      [
        { kind: "email", value: "ALEX@example.com" },
        { kind: "city", value: "oslo" },
      ],
      [],
      NOW + 1,
    );
    expect(second.formEntries).toEqual([
      { kind: "email", value: "alex@example.com", timesUsed: 2, lastUsedAt: NOW + 1 },
      { kind: "city", value: "Oslo", timesUsed: 1, lastUsedAt: NOW },
      { kind: "city", value: "oslo", timesUsed: 1, lastUsedAt: NOW + 1 },
    ]);
  });

  it("skips secrets and returns the same vault when nothing was remembered", () => {
    const vault = createEmptyVault();
    const result = rememberEntries(
      vault,
      [
        { kind: "name", value: "hunter22" },
        { kind: "tel", value: "123456" },
        { kind: "name", value: "" },
      ],
      ["hunter22"],
      NOW,
    );
    expect(result).toBe(vault);
  });

  it("files a field key's values under that key only, apart from the kinds and other keys", () => {
    const vault = rememberEntries(
      createEmptyVault(),
      [
        { kind: "field", field: "vat number", value: "CZ12345678" },
        { kind: "field", field: "customer reference", value: "CZ12345678" },
        { kind: "organization", value: "CZ12345678" },
      ],
      [],
      NOW,
    );
    expect(vault.formEntries).toEqual([
      { kind: "field", field: "vat number", value: "CZ12345678", timesUsed: 1, lastUsedAt: NOW },
      { kind: "field", field: "customer reference", value: "CZ12345678", timesUsed: 1, lastUsedAt: NOW },
      { kind: "organization", value: "CZ12345678", timesUsed: 1, lastUsedAt: NOW },
    ]);
    const again = rememberEntries(vault, [{ kind: "field", field: "vat number", value: " CZ12345678 " }], [], NOW + 1);
    expect(again.formEntries[0]).toEqual({ kind: "field", field: "vat number", value: "CZ12345678", timesUsed: 2, lastUsedAt: NOW + 1 });
    expect(again.formEntries).toHaveLength(3);
  });

  it("compares a field key's values exactly, as for every kind but email", () => {
    const first = rememberEntries(createEmptyVault(), [{ kind: "field", field: "nickname", value: "Ally" }], [], NOW);
    const second = rememberEntries(first, [{ kind: "field", field: "nickname", value: "ally" }], [], NOW + 1);
    expect(second.formEntries.map((entry) => entry.value)).toEqual(["Ally", "ally"]);
  });

  it("keeps only the key's own fields, whatever else the entry it comes from carries", () => {
    const entry = { kind: "field" as const, field: "nickname", value: "Ally", extra: "page data" };
    const vault = rememberEntries(createEmptyVault(), [entry], [], NOW);
    expect(Object.keys(vault.formEntries[0]).sort()).toEqual(["field", "kind", "lastUsedAt", "timesUsed", "value"]);
  });

  it("drops the least recently used entries over the cap, field keys and kinds together", () => {
    const formEntries = [];
    for (let index = 0; index < MAX_FORM_ENTRIES; index++) {
      formEntries.push({ kind: "field" as const, field: "nickname", value: `Nick${index}`, timesUsed: 1, lastUsedAt: 100 + index });
    }
    const full: PasswordVault = { ...createEmptyVault(), formEntries };
    const result = rememberEntries(full, [{ kind: "city", value: "Newtown" }], [], NOW);
    expect(result.formEntries).toHaveLength(MAX_FORM_ENTRIES);
    expect(result.formEntries.some((entry) => entry.value === "Nick0")).toBe(false);
    expect(result.formEntries.some((entry) => entry.value === "Newtown")).toBe(true);
  });

  it("drops the least recently used entries over the cap", () => {
    const formEntries = [];
    for (let index = 0; index < MAX_FORM_ENTRIES; index++) {
      formEntries.push({ kind: "city" as const, value: `City${index}`, timesUsed: 1, lastUsedAt: 100 + index });
    }
    const full: PasswordVault = { ...createEmptyVault(), formEntries };
    const result = rememberEntries(full, [{ kind: "city", value: "Newtown" }], [], NOW);
    expect(result.formEntries).toHaveLength(MAX_FORM_ENTRIES);
    expect(result.formEntries.some((entry) => entry.value === "City0")).toBe(false);
    expect(result.formEntries.some((entry) => entry.value === "Newtown")).toBe(true);
  });
});

describe("suggestEntries", () => {
  function vaultOfCities(cities: Array<[string, number, number]>): PasswordVault {
    const vault = createEmptyVault();
    vault.formEntries = cities.map(([value, timesUsed, lastUsedAt]) => ({ kind: "city", value, timesUsed, lastUsedAt }));
    vault.formEntries.push({ kind: "name", value: "Oslofjord Person", timesUsed: 9, lastUsedAt: 9 });
    return vault;
  }

  it("matches by prefix, ignoring case and leading spaces, only for the kind", () => {
    const vault = vaultOfCities([["Oslo", 1, 1], ["Osaka", 1, 2], ["Bergen", 5, 3]]);
    expect(suggestEntries(vault, { kind: "city" }, "  os")).toEqual(["Osaka", "Oslo"]);
    expect(suggestEntries(vault, { kind: "city" }, "OSL")).toEqual(["Oslo"]);
    expect(suggestEntries(vault, { kind: "city" }, "x")).toEqual([]);
  });

  it("suggests a field key's values for that key only, not for a kind or another key", () => {
    const vault = createEmptyVault();
    vault.formEntries = [
      { kind: "field", field: "vat number", value: "CZ111", timesUsed: 1, lastUsedAt: 1 },
      { kind: "field", field: "vat number", value: "CZ222", timesUsed: 4, lastUsedAt: 2 },
      { kind: "field", field: "vat", value: "CZ333", timesUsed: 9, lastUsedAt: 3 },
      { kind: "organization", value: "CZ444", timesUsed: 9, lastUsedAt: 4 },
    ];
    expect(suggestEntries(vault, { kind: "field", field: "vat number" }, "")).toEqual(["CZ222", "CZ111"]);
    expect(suggestEntries(vault, { kind: "field", field: "vat number" }, "cz1")).toEqual(["CZ111"]);
    expect(suggestEntries(vault, { kind: "field", field: "vat" }, "")).toEqual(["CZ333"]);
    expect(suggestEntries(vault, { kind: "organization" }, "")).toEqual(["CZ444"]);
  });

  it("leaves out a value equal to what was typed", () => {
    const vault = vaultOfCities([["Oslo", 1, 1], ["Oslofjord", 1, 2]]);
    expect(suggestEntries(vault, { kind: "city" }, "oslo")).toEqual(["Oslofjord"]);
  });

  it("orders by use, then by recency, and shows at most six", () => {
    const vault = vaultOfCities([
      ["C1", 1, 10],
      ["C2", 3, 1],
      ["C3", 3, 2],
      ["C4", 1, 40],
      ["C5", 1, 30],
      ["C6", 1, 20],
      ["C7", 1, 5],
    ]);
    const suggestions = suggestEntries(vault, { kind: "city" }, "");
    expect(suggestions).toEqual(["C3", "C2", "C4", "C5", "C6", "C1"]);
    expect(suggestions).toHaveLength(MAX_FORM_SUGGESTIONS);
  });
});

describe("forgetting", () => {
  const vault = rememberEntries(
    createEmptyVault(),
    [
      { kind: "email", value: "alex@example.com" },
      { kind: "city", value: "Oslo" },
      { kind: "field", field: "nickname", value: "Oslo" },
    ],
    [],
    NOW,
  );

  it("forgetEntry removes one entry with the same comparison as remembering", () => {
    expect(forgetEntry(vault, { kind: "email" }, "ALEX@example.com").formEntries.map((entry) => entry.value)).toEqual(["Oslo", "Oslo"]);
    expect(forgetEntry(vault, { kind: "city" }, "oslo")).toBe(vault);
    expect(forgetEntry(vault, { kind: "name" }, "Oslo")).toBe(vault);
  });

  it("forgetEntry removes a field key's value only under that key", () => {
    const forgotten = forgetEntry(vault, { kind: "field", field: "nickname" }, "Oslo");
    expect(forgotten.formEntries).toEqual([
      { kind: "email", value: "alex@example.com", timesUsed: 1, lastUsedAt: NOW },
      { kind: "city", value: "Oslo", timesUsed: 1, lastUsedAt: NOW },
    ]);
    expect(forgetEntry(vault, { kind: "field", field: "other" }, "Oslo")).toBe(vault);
  });

  it("forgetAllEntries empties the list, or returns the same vault when empty", () => {
    const emptied = forgetAllEntries(vault);
    expect(emptied.formEntries).toEqual([]);
    expect(forgetAllEntries(emptied)).toBe(emptied);
  });

  it("countEntries counts", () => {
    expect(countEntries(vault)).toBe(3);
    expect(countEntries(createEmptyVault())).toBe(0);
  });
});
