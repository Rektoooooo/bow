/**
 * WHY this file exists:
 *   The vault rules decide which logins a page may get and when Bow offers to save; a mistake leaks a password to
 *   the wrong site or nags the user. These tests pin down site matching, the offer decision and every vault change.
 *
 * Data source:
 *   Synthetic logins on example.com / example.org. No real data.
 *
 * Data flow:
 *   hand-built vaults → functions from passwords.ts → checks (including "same object when nothing changed")
 */
import { describe, expect, it } from "vitest";
import { isFormFieldKind } from "../src/shared/passwords";
import {
  addNeverSave,
  createEmptyVault,
  decideOffer,
  editLogin,
  findLoginsForOrigin,
  isNeverSave,
  isSameLoginSite,
  markLoginUsed,
  MAX_LOGIN_FIELD_LENGTH,
  MAX_NEVER_SAVE_ORIGINS,
  MAX_SAVED_LOGINS,
  normalizeLoginOrigin,
  parseVault,
  removeLogin,
  removeNeverSave,
  saveLogin,
  siteKeyFor,
  updateLoginPassword,
  type PasswordVault,
  type SavedLogin,
} from "../src/main/passwords";

const EXAMPLE = "https://example.com";
const NOW = 1_000_000;

function vaultWith(...logins: Array<Partial<SavedLogin> & { id: string }>): PasswordVault {
  const vault = createEmptyVault();
  vault.logins = logins.map((login) => ({
    origin: EXAMPLE,
    username: "alex@example.com",
    password: "secret-one",
    createdAt: 100,
    changedAt: 100,
    ...login,
  }));
  return vault;
}

describe("form field kinds", () => {
  it("accept only the allow-list", () => {
    expect(isFormFieldKind("email")).toBe(true);
    expect(isFormFieldKind("postalCode")).toBe(true);
    expect(isFormFieldKind("password")).toBe(false);
    expect(isFormFieldKind(42)).toBe(false);
  });
});

describe("parseVault", () => {
  it("returns null for garbage and for another version", () => {
    expect(parseVault(null)).toBeNull();
    expect(parseVault("text")).toBeNull();
    expect(parseVault([])).toBeNull();
    expect(parseVault({ version: 2, logins: [], neverSaveOrigins: [], formEntries: [] })).toBeNull();
    expect(parseVault({ version: 1, logins: {}, neverSaveOrigins: [], formEntries: [] })).toBeNull();
    expect(parseVault({ version: 1, logins: [], formEntries: [] })).toBeNull();
  });

  it("keeps good entries and drops malformed ones", () => {
    const good = { id: "a", origin: EXAMPLE, username: "alex", password: "pw", createdAt: 1, changedAt: 2, timesUsed: 3 };
    const parsed = parseVault({
      version: 1,
      logins: [
        good,
        { ...good, id: "b", origin: "" },
        { ...good, id: "c", password: 5 },
        { ...good, id: "d", username: "x".repeat(MAX_LOGIN_FIELD_LENGTH + 1) },
        { ...good, id: "e", createdAt: "yesterday" },
        "nope",
      ],
      neverSaveOrigins: ["https://example.org", 7, ""],
      formEntries: [
        { kind: "email", value: "alex@example.com", timesUsed: 2, lastUsedAt: 5 },
        { kind: "password", value: "x", timesUsed: 1, lastUsedAt: 5 },
        { kind: "city", value: "Oslo", timesUsed: "many", lastUsedAt: 5 },
        { kind: "city", value: "y".repeat(201), timesUsed: 1, lastUsedAt: 5 },
      ],
    });
    expect(parsed?.logins).toEqual([good]);
    expect(parsed?.neverSaveOrigins).toEqual(["https://example.org"]);
    expect(parsed?.formEntries).toEqual([{ kind: "email", value: "alex@example.com", timesUsed: 2, lastUsedAt: 5 }]);
  });
});

describe("sites", () => {
  it("normalizes http(s) addresses to their origin", () => {
    expect(normalizeLoginOrigin("https://Example.com:443/login?x")).toBe("https://example.com");
    expect(normalizeLoginOrigin("http://example.com:8080/a")).toBe("http://example.com:8080");
    expect(normalizeLoginOrigin("android://abc@com.example.app")).toBeNull();
    expect(normalizeLoginOrigin("ftp://example.com")).toBeNull();
    expect(normalizeLoginOrigin("null")).toBeNull();
    expect(normalizeLoginOrigin("")).toBeNull();
  });

  it("treats www and non-www as one site, in both directions, and nothing else", () => {
    expect(siteKeyFor("https://www.example.com")).toBe("https://example.com");
    expect(isSameLoginSite("https://www.example.com", "https://example.com")).toBe(true);
    expect(isSameLoginSite("https://example.com", "https://www.example.com")).toBe(true);
    expect(isSameLoginSite("https://login.example.com", "https://example.com")).toBe(false);
    expect(isSameLoginSite("http://example.com", "https://example.com")).toBe(false);
    expect(isSameLoginSite("https://example.com:8443", "https://example.com")).toBe(false);
    expect(siteKeyFor("not a url")).toBe("not a url");
  });

  it("finds logins by site, most recently used first, then A to Z", () => {
    const vault = vaultWith(
      { id: "old", username: "zed", createdAt: 10 },
      { id: "used", username: "mia", createdAt: 5, lastUsedAt: 500 },
      { id: "tie", username: "ann", createdAt: 10 },
      { id: "www", origin: "https://www.example.com", username: "bob", createdAt: 400 },
      { id: "other", origin: "https://example.org", username: "other" },
      { id: "sub", origin: "https://login.example.com", username: "sub" },
    );
    const ids = findLoginsForOrigin(vault, EXAMPLE).map((login) => login.id);
    expect(ids).toEqual(["used", "www", "tie", "old"]);
  });
});

describe("never save", () => {
  it("is per site, keeps no duplicates and returns the same vault when nothing changes", () => {
    const empty = createEmptyVault();
    const added = addNeverSave(empty, "https://www.example.com/login");
    expect(added.neverSaveOrigins).toEqual(["https://example.com"]);
    expect(isNeverSave(added, "https://example.com")).toBe(true);
    expect(isNeverSave(added, "https://example.org")).toBe(false);
    expect(addNeverSave(added, "https://example.com")).toBe(added);
    expect(removeNeverSave(added, "https://example.org")).toBe(added);
    expect(removeNeverSave(added, "https://www.example.com").neverSaveOrigins).toEqual([]);
  });

  it("drops the oldest at the cap", () => {
    let vault = createEmptyVault();
    for (let index = 0; index < MAX_NEVER_SAVE_ORIGINS + 1; index++) {
      vault = addNeverSave(vault, `https://site${index}.example.com`);
    }
    expect(vault.neverSaveOrigins).toHaveLength(MAX_NEVER_SAVE_ORIGINS);
    expect(vault.neverSaveOrigins[0]).toBe("https://site1.example.com");
  });
});

describe("decideOffer", () => {
  const vault = vaultWith({ id: "one" });

  it("saves a new login", () => {
    expect(decideOffer(createEmptyVault(), EXAMPLE, "alex@example.com", "pw")).toEqual({ kind: "save" });
    expect(decideOffer(vault, "https://example.org", "alex@example.com", "pw")).toEqual({ kind: "save" });
    expect(decideOffer(vault, EXAMPLE, "other@example.com", "pw")).toEqual({ kind: "save" });
  });

  it("stays quiet without a password or with over-long fields", () => {
    expect(decideOffer(vault, EXAMPLE, "alex", "")).toEqual({ kind: "nothing" });
    expect(decideOffer(vault, EXAMPLE, "alex", "x".repeat(MAX_LOGIN_FIELD_LENGTH + 1))).toEqual({ kind: "nothing" });
    expect(decideOffer(vault, EXAMPLE, "x".repeat(MAX_LOGIN_FIELD_LENGTH + 1), "pw")).toEqual({ kind: "nothing" });
  });

  it("stays quiet on a never-save site", () => {
    const blocked = addNeverSave(createEmptyVault(), "https://www.example.com");
    expect(decideOffer(blocked, EXAMPLE, "alex", "pw")).toEqual({ kind: "nothing" });
  });

  it("stays quiet when the same login with the same password is saved", () => {
    expect(decideOffer(vault, "https://www.example.com", "  alex@example.com ", "secret-one")).toEqual({ kind: "nothing" });
  });

  it("offers to update when the password differs", () => {
    expect(decideOffer(vault, EXAMPLE, "alex@example.com", "new-secret")).toEqual({ kind: "update", loginId: "one" });
  });

  it("compares the username exactly, apart from the edges", () => {
    expect(decideOffer(vault, EXAMPLE, "Alex@example.com", "secret-one")).toEqual({ kind: "save" });
  });

  it("with no username, stays quiet when the site already has this password, else saves", () => {
    expect(decideOffer(vault, EXAMPLE, "", "secret-one")).toEqual({ kind: "nothing" });
    expect(decideOffer(vault, EXAMPLE, "", "another")).toEqual({ kind: "save" });
  });
});

describe("saveLogin", () => {
  it("adds a login with ids and times", () => {
    const saved = saveLogin(createEmptyVault(), { origin: EXAMPLE, username: " alex ", password: "pw" }, "id-1", NOW);
    expect(saved.logins).toEqual([
      { id: "id-1", origin: EXAMPLE, username: "alex", password: "pw", createdAt: NOW, changedAt: NOW },
    ]);
  });

  it("updates the password for the same site and username", () => {
    const vault = vaultWith({ id: "one" });
    const updated = saveLogin(vault, { origin: "https://www.example.com", username: "alex@example.com", password: "new" }, "id-2", NOW);
    expect(updated.logins).toHaveLength(1);
    expect(updated.logins[0]).toMatchObject({ id: "one", password: "new", changedAt: NOW, createdAt: 100 });
  });

  it("returns the same vault for an identical password", () => {
    const vault = vaultWith({ id: "one" });
    const result = saveLogin(vault, { origin: EXAMPLE, username: "alex@example.com", password: "secret-one" }, "id-2", NOW);
    expect(result).toBe(vault);
  });

  it("drops the least recently used login when full", () => {
    const logins: SavedLogin[] = [];
    for (let index = 0; index < MAX_SAVED_LOGINS; index++) {
      logins.push({
        id: `id-${index}`,
        origin: EXAMPLE,
        username: `user${index}`,
        password: "pw",
        createdAt: 1,
        changedAt: 10 + index,
      });
    }
    logins[5].lastUsedAt = 5; // the oldest touch of all
    const full: PasswordVault = { ...createEmptyVault(), logins };
    const result = saveLogin(full, { origin: EXAMPLE, username: "newcomer", password: "pw" }, "fresh", NOW);
    expect(result.logins).toHaveLength(MAX_SAVED_LOGINS);
    expect(result.logins.some((login) => login.id === "id-5")).toBe(false);
    expect(result.logins.some((login) => login.id === "fresh")).toBe(true);
  });
});

describe("changing logins", () => {
  const vault = vaultWith({ id: "one" });

  it("updateLoginPassword changes the password and its time, or returns the same vault", () => {
    const updated = updateLoginPassword(vault, "one", "new", NOW);
    expect(updated.logins[0]).toMatchObject({ password: "new", changedAt: NOW });
    expect(updateLoginPassword(vault, "one", "secret-one", NOW)).toBe(vault);
    expect(updateLoginPassword(vault, "missing", "new", NOW)).toBe(vault);
  });

  it("editLogin changes username and password from the Library", () => {
    const renamed = editLogin(vault, "one", { username: " alex2 ", password: "secret-one" }, NOW);
    expect(renamed.logins[0]).toMatchObject({ username: "alex2", changedAt: 100 });
    const repassworded = editLogin(vault, "one", { username: "alex@example.com", password: "new" }, NOW);
    expect(repassworded.logins[0]).toMatchObject({ password: "new", changedAt: NOW });
  });

  it("editLogin refuses bad input and returns the same vault when nothing changes", () => {
    expect(editLogin(vault, "one", { username: "alex@example.com", password: "secret-one" }, NOW)).toBe(vault);
    expect(editLogin(vault, "missing", { username: "a", password: "b" }, NOW)).toBe(vault);
    expect(editLogin(vault, "one", { username: "a", password: "" }, NOW)).toBe(vault);
    expect(editLogin(vault, "one", { username: "a", password: "x".repeat(MAX_LOGIN_FIELD_LENGTH + 1) }, NOW)).toBe(vault);
    expect(editLogin(vault, "one", { username: "x".repeat(MAX_LOGIN_FIELD_LENGTH + 1), password: "pw" }, NOW)).toBe(vault);
  });

  it("removeLogin removes, or returns the same vault for an unknown id", () => {
    expect(removeLogin(vault, "one").logins).toEqual([]);
    expect(removeLogin(vault, "missing")).toBe(vault);
  });

  it("markLoginUsed counts uses, or returns the same vault for an unknown id", () => {
    const once = markLoginUsed(vault, "one", NOW);
    expect(once.logins[0]).toMatchObject({ lastUsedAt: NOW, timesUsed: 1 });
    const twice = markLoginUsed(once, "one", NOW + 1);
    expect(twice.logins[0]).toMatchObject({ lastUsedAt: NOW + 1, timesUsed: 2 });
    expect(markLoginUsed(vault, "missing", NOW)).toBe(vault);
  });
});
