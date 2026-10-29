/**
 * WHY this file exists:
 *   Decrypting a Chromium browser's saved passwords must work exactly as the browsers encrypt them, and must refuse
 *   (not guess, not throw) on a wrong key or damaged data. The vectors are made here with the same scheme.
 *
 * Data source:
 *   A made-up secret and made-up passwords; the scheme of Chromium's os_crypt on macOS (see the module under test).
 *
 * Data flow:
 *   encryptLikeChromium(text, secret) → decryptChromiumPassword(bytes, deriveChromiumKey(secret)) → the text or null
 */
import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptChromiumPassword, deriveChromiumKey } from "../src/main/chromiumPasswordCrypto";

const SECRET = "made-up-safe-storage-secret";
const OTHER_SECRET = "another-made-up-secret";

/** Chromium's os_crypt on macOS, written out again: prefix + AES-128-CBC with an IV of 16 spaces. */
function encryptLikeChromium(plainText: string, secret: string, prefix = "v10"): Buffer {
  const cipher = createCipheriv("aes-128-cbc", deriveChromiumKey(secret), Buffer.alloc(16, 0x20));
  const cipherText = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from(prefix, "latin1"), cipherText]);
}

describe("deriveChromiumKey", () => {
  it("makes a 16 byte key that depends on the secret", () => {
    expect(deriveChromiumKey(SECRET)).toHaveLength(16);
    expect(deriveChromiumKey(SECRET).equals(deriveChromiumKey(SECRET))).toBe(true);
    expect(deriveChromiumKey(SECRET).equals(deriveChromiumKey(OTHER_SECRET))).toBe(false);
  });

  it("matches a known PBKDF2 vector (salt saltysalt, 1003 rounds, SHA-1)", () => {
    // Computed independently: python3 -c "import hashlib; print(hashlib.pbkdf2_hmac('sha1', b'peanuts', b'saltysalt', 1003, 16).hex())"
    expect(deriveChromiumKey("peanuts").toString("hex")).toBe("d9a09d499b4e1b7461f28e67972c6dbd");
  });
});

describe("decryptChromiumPassword", () => {
  const key = deriveChromiumKey(SECRET);

  it("reads a v10 value", () => {
    expect(decryptChromiumPassword(encryptLikeChromium("hunter2", SECRET), key)).toBe("hunter2");
  });

  it("reads a v11 value the same way", () => {
    expect(decryptChromiumPassword(encryptLikeChromium("hunter2", SECRET, "v11"), key)).toBe("hunter2");
  });

  it("reads long and non ASCII passwords", () => {
    const longPassword = "pässwörd-日本語-".repeat(20);
    expect(decryptChromiumPassword(encryptLikeChromium(longPassword, SECRET), key)).toBe(longPassword);
  });

  it("gives null for the wrong key", () => {
    const encrypted = encryptLikeChromium("hunter2", SECRET);
    expect(decryptChromiumPassword(encrypted, deriveChromiumKey(OTHER_SECRET))).toBeNull();
  });

  it("gives null for cut or garbled data", () => {
    const encrypted = encryptLikeChromium("hunter2", SECRET);
    expect(decryptChromiumPassword(encrypted.subarray(0, encrypted.length - 5), key)).toBeNull();
    const garbled = Buffer.from(encrypted);
    garbled[garbled.length - 1] = (garbled[garbled.length - 1] ?? 0) ^ 0xff;
    expect(decryptChromiumPassword(garbled, key)).toBeNull();
  });

  it("gives null for another prefix, a bare prefix and nothing", () => {
    expect(decryptChromiumPassword(encryptLikeChromium("hunter2", SECRET, "v20"), key)).toBeNull();
    expect(decryptChromiumPassword(Buffer.from("v10", "latin1"), key)).toBeNull();
    expect(decryptChromiumPassword(Buffer.alloc(0), key)).toBeNull();
  });
});
