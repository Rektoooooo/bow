/**
 * WHY this file exists:
 *   Counting and reading a Chromium profile's saved logins must follow the browsers' real files: two login files, a
 *   "never save" flag, empty passwords for federated logins, values encrypted with the browser's key. These tests
 *   build real SQLite files with /usr/bin/sqlite3 in a temporary folder and check what comes out.
 *
 * Data source:
 *   Made-up logins on example.com / example.org and a made-up secret. No real browser data.
 *
 * Data flow:
 *   sqlite3 builds "Login Data" files → countChromiumLogins() / readChromiumLogins() → counts and decrypted logins
 */
import { execFileSync } from "node:child_process";
import { createCipheriv } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveChromiumKey } from "../src/main/chromiumPasswordCrypto";
import { countChromiumLogins, readChromiumLogins } from "../src/main/chromiumPasswords";

const SECRET = "made-up-safe-storage-secret";

interface FakeLogin {
  url: string;
  username: string;
  /** The text to encrypt; null stores an empty value (a federated login). */
  password: string | null;
  isNeverSave?: boolean;
  /** Store this value instead of encrypting `password` (a value from another key or scheme). */
  rawHex?: string;
}

function encryptHex(plainText: string, secret: string): string {
  const cipher = createCipheriv("aes-128-cbc", deriveChromiumKey(secret), Buffer.alloc(16, 0x20));
  const cipherText = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("v10", "latin1"), cipherText]).toString("hex");
}

/** Writes a Chromium-style login file with these rows. */
function writeLoginFile(filePath: string, logins: FakeLogin[]): void {
  const rows = logins.map((login) => {
    const valueHex = login.rawHex ?? (login.password === null ? "" : encryptHex(login.password, SECRET));
    const neverSave = login.isNeverSave === true ? 1 : 0;
    return `('${login.url}', '${login.username}', X'${valueHex}', ${neverSave})`;
  });
  const statements = ["CREATE TABLE logins (origin_url TEXT, username_value TEXT, password_value BLOB, blacklisted_by_user INTEGER);"];
  if (rows.length > 0) {
    statements.push(`INSERT INTO logins VALUES ${rows.join(", ")};`);
  }
  execFileSync("/usr/bin/sqlite3", [filePath, statements.join("\n")]);
}

let profileFolder = "";

beforeEach(() => {
  profileFolder = fs.mkdtempSync(path.join(os.tmpdir(), "bow-logins-test-"));
});

afterEach(() => {
  fs.rmSync(profileFolder, { recursive: true, force: true });
});

describe("countChromiumLogins", () => {
  it("counts different logins over both files, leaving out never-save rows, other schemes and duplicates", async () => {
    writeLoginFile(path.join(profileFolder, "Login Data"), [
      { url: "https://example.com/login", username: "ana", password: "one" },
      { url: "https://example.com/other", username: "ana", password: "one" },
      { url: "https://example.org/", username: "ben", password: "two" },
      { url: "https://never.example.net/", username: "", password: null, isNeverSave: true },
      { url: "android://hash@com.example.app/", username: "cy", password: "three" },
    ]);
    writeLoginFile(path.join(profileFolder, "Login Data For Account"), [
      { url: "https://example.com/", username: "ana", password: "one" },
      { url: "https://example.net/", username: "dee", password: "four" },
    ]);
    expect(await countChromiumLogins(profileFolder)).toBe(3);
  });

  it("is zero without login files or for an unreadable one", async () => {
    expect(await countChromiumLogins(profileFolder)).toBe(0);
    fs.writeFileSync(path.join(profileFolder, "Login Data"), "not a database");
    expect(await countChromiumLogins(profileFolder)).toBe(0);
  });
});

describe("readChromiumLogins", () => {
  const key = deriveChromiumKey(SECRET);

  it("decrypts the logins and normalizes their sites, the first of a duplicate winning", async () => {
    writeLoginFile(path.join(profileFolder, "Login Data"), [
      { url: "https://Example.com/login?next=1", username: "ana", password: "pässword-1" },
      { url: "https://example.org/", username: "ben", password: "two" },
    ]);
    writeLoginFile(path.join(profileFolder, "Login Data For Account"), [
      { url: "https://example.com/", username: "ana", password: "from-the-account-file" },
      { url: "https://example.net/", username: "dee", password: "four" },
    ]);
    const read = await readChromiumLogins(profileFolder, key);
    expect(read.logins).toEqual([
      { origin: "https://example.com", username: "ana", password: "pässword-1" },
      { origin: "https://example.org", username: "ben", password: "two" },
      { origin: "https://example.net", username: "dee", password: "four" },
    ]);
    expect(read.neverSaveOrigins).toEqual([]);
    expect(read.unreadableCount).toBe(0);
  });

  it("keeps never-save sites apart, skips federated logins and counts what it cannot decrypt", async () => {
    writeLoginFile(path.join(profileFolder, "Login Data"), [
      { url: "https://never.example.net/signin", username: "", password: null, isNeverSave: true },
      { url: "https://federated.example.com/", username: "eve", password: null },
      { url: "https://example.com/", username: "ana", password: "one" },
      { url: "https://garbled.example.com/", username: "fay", password: null, rawHex: "7631300000" },
      { url: "https://other-key.example.com/", username: "gus", password: null, rawHex: encryptHex("secret", "another-secret") },
    ]);
    const read = await readChromiumLogins(profileFolder, key);
    expect(read.logins).toEqual([{ origin: "https://example.com", username: "ana", password: "one" }]);
    expect(read.neverSaveOrigins).toEqual(["https://never.example.net"]);
    expect(read.unreadableCount).toBe(2);
  });

  it("gives nothing for a profile without login files", async () => {
    expect(await readChromiumLogins(profileFolder, key)).toEqual({ logins: [], neverSaveOrigins: [], unreadableCount: 0 });
  });
});
