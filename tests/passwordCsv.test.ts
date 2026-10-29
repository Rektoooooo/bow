/**
 * WHY this file exists:
 *   Importing passwords reads files other programs wrote. These tests pin down the CSV rules (quotes, line breaks,
 *   byte order mark), each program's header, which rows are skipped, and that merging never overwrites Bow's copy.
 *
 * Data source:
 *   CSV text written by hand below in the shape of each browser's export. Synthetic data only.
 *
 * Data flow:
 *   CSV text → parseCsv() / readLoginsFromCsv() → logins; logins + vault → mergeImportedLogins() → counts
 */
import { describe, expect, it } from "vitest";
import { mergeImportedLogins, parseCsv, readLoginsFromCsv } from "../src/main/passwordCsv";
import { createEmptyVault, MAX_LOGIN_FIELD_LENGTH, MAX_SAVED_LOGINS, type PasswordVault } from "../src/main/passwords";

const NOW = 7_000;

describe("parseCsv", () => {
  it("splits plain rows and ignores blank lines and a final line break", () => {
    expect(parseCsv("a,b\n\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("")).toEqual([]);
  });

  it("reads CRLF line ends", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("reads quoted commas, doubled quotes and line breaks inside quotes", () => {
    const text = 'name,note\r\n"Example, Inc.","she said ""hi""\nsecond line"\n';
    expect(parseCsv(text)).toEqual([
      ["name", "note"],
      ["Example, Inc.", 'she said "hi"\nsecond line'],
    ]);
  });

  it("removes a leading byte order mark", () => {
    expect(parseCsv("\uFEFFa,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps empty cells and a quoted empty field", () => {
    expect(parseCsv('a,,c\n"",x')).toEqual([["a", "", "c"], ["", "x"]]);
  });
});

describe("readLoginsFromCsv", () => {
  it("reads the Chrome family's export", () => {
    const text = "name,url,username,password,note\nExample,https://example.com/login,alex@example.com,pw-1,\n";
    expect(readLoginsFromCsv(text)).toEqual({
      isRecognized: true,
      logins: [{ origin: "https://example.com", username: "alex@example.com", password: "pw-1" }],
      skippedCount: 0,
    });
  });

  it("reads Safari's export with the OTPAuth column", () => {
    const text = "Title,URL,Username,Password,Notes,OTPAuth\nExample,https://www.example.org/,sam,pw-2,,\n";
    expect(readLoginsFromCsv(text).logins).toEqual([{ origin: "https://www.example.org", username: "sam", password: "pw-2" }]);
  });

  it("reads Firefox's quoted header", () => {
    const text =
      '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n' +
      '"https://example.com","alex","pw-3",,"https://example.com","{guid}","1","2","3"\n';
    expect(readLoginsFromCsv(text).logins).toEqual([{ origin: "https://example.com", username: "alex", password: "pw-3" }]);
  });

  it("reads Bitwarden's header", () => {
    const text = "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n" +
      ",,login,Example,,,0,https://example.com,alex,pw-4,\n";
    expect(readLoginsFromCsv(text).logins).toEqual([{ origin: "https://example.com", username: "alex", password: "pw-4" }]);
  });

  it("matches headers ignoring case and spaces", () => {
    const text = " URL , Password ,User\nhttps://example.com,pw,alex\n";
    expect(readLoginsFromCsv(text).logins).toEqual([{ origin: "https://example.com", username: "alex", password: "pw" }]);
  });

  it("is not recognized without a url and a password column", () => {
    const noPassword = readLoginsFromCsv("url,username\nhttps://example.com,alex\n");
    expect(noPassword).toEqual({ isRecognized: false, logins: [], skippedCount: 0 });
    expect(readLoginsFromCsv("hello\nworld").isRecognized).toBe(false);
    expect(readLoginsFromCsv("").isRecognized).toBe(false);
  });

  it("counts skipped rows: no web address, empty password, over-long fields", () => {
    const text = [
      "url,username,password",
      "android://abc@com.example.app,alex,pw",
      "https://example.com,alex,",
      `https://example.com,alex,${"x".repeat(MAX_LOGIN_FIELD_LENGTH + 1)}`,
      "https://example.org,,pw-ok",
    ].join("\n");
    const result = readLoginsFromCsv(text);
    expect(result.skippedCount).toBe(3);
    expect(result.logins).toEqual([{ origin: "https://example.org", username: "", password: "pw-ok" }]);
  });

  it("accepts rows shorter than the header", () => {
    const result = readLoginsFromCsv("url,password,username\nhttps://example.com,pw\n");
    expect(result.logins).toEqual([{ origin: "https://example.com", username: "", password: "pw" }]);
  });
});

describe("mergeImportedLogins", () => {
  let counter = 0;
  const makeId = () => `import-${counter++}`;

  it("adds new logins with the import time", () => {
    counter = 0;
    const result = mergeImportedLogins(
      createEmptyVault(),
      [{ origin: "https://example.com", username: "alex", password: "pw" }],
      makeId,
      NOW,
    );
    expect(result).toMatchObject({ addedCount: 1, alreadySavedCount: 0, keptDifferentCount: 0, skippedCount: 0 });
    expect(result.vault.logins).toEqual([
      { id: "import-0", origin: "https://example.com", username: "alex", password: "pw", createdAt: NOW, changedAt: NOW },
    ]);
  });

  it("counts same login as already saved, and a different password as kept (Bow's copy stays)", () => {
    counter = 0;
    const first = mergeImportedLogins(
      createEmptyVault(),
      [{ origin: "https://example.com", username: "alex", password: "bow-pw" }],
      makeId,
      NOW,
    );
    const result = mergeImportedLogins(
      first.vault,
      [
        { origin: "https://www.example.com", username: "alex", password: "bow-pw" },
        { origin: "https://example.com", username: "alex", password: "old-pw" },
      ],
      makeId,
      NOW + 1,
    );
    expect(result).toMatchObject({ addedCount: 0, alreadySavedCount: 1, keptDifferentCount: 1 });
    expect(result.vault).toBe(first.vault);
  });

  it("handles duplicates inside the same file", () => {
    counter = 0;
    const result = mergeImportedLogins(
      createEmptyVault(),
      [
        { origin: "https://example.com", username: "alex", password: "pw" },
        { origin: "https://example.com", username: "alex", password: "pw" },
        { origin: "https://example.com", username: "alex", password: "other" },
        { origin: "https://example.com", username: "sam", password: "pw" },
      ],
      makeId,
      NOW,
    );
    expect(result).toMatchObject({ addedCount: 2, alreadySavedCount: 1, keptDifferentCount: 1 });
    expect(result.vault.logins).toHaveLength(2);
  });

  it("returns the same vault when nothing is added", () => {
    const vault = createEmptyVault();
    expect(mergeImportedLogins(vault, [], makeId, NOW).vault).toBe(vault);
  });

  it("skips the rest at the limit without evicting existing logins", () => {
    counter = 0;
    const logins = [];
    for (let index = 0; index < MAX_SAVED_LOGINS - 1; index++) {
      logins.push({
        id: `id-${index}`,
        origin: "https://example.com",
        username: `user${index}`,
        password: "pw",
        createdAt: 1,
        changedAt: 1,
      });
    }
    const nearlyFull: PasswordVault = { ...createEmptyVault(), logins };
    const result = mergeImportedLogins(
      nearlyFull,
      [
        { origin: "https://example.org", username: "one", password: "pw" },
        { origin: "https://example.org", username: "two", password: "pw" },
        { origin: "https://example.org", username: "three", password: "pw" },
      ],
      makeId,
      NOW,
    );
    expect(result).toMatchObject({ addedCount: 1, skippedCount: 2 });
    expect(result.vault.logins).toHaveLength(MAX_SAVED_LOGINS);
    expect(result.vault.logins[0].id).toBe("id-0");
  });
});
