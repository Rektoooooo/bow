/**
 * WHY this file exists:
 *   Chrome, Arc, Dia, Brave, Edge, Vivaldi, Opera and Chromium keep saved passwords encrypted in their `Login Data`
 *   database, all with the same scheme on macOS. Reading them directly (instead of asking the user to export a CSV
 *   file) needs exactly this: the key from the browser's Keychain secret, and the decryption of one value.
 *
 * Data source:
 *   None. Values in, values out. The scheme is Chromium's os_crypt on macOS (components/os_crypt/sync/
 *   os_crypt_mac.mm): AES-128-CBC, an IV of 16 spaces, a key from PBKDF2-HMAC-SHA1 over the Keychain secret with the
 *   salt "saltysalt" and 1003 rounds, and a "v10" prefix on every stored value.
 *
 * Data flow:
 *   chromiumPasswordsImport.ts reads the secret → deriveChromiumKey(secret) → chromiumPasswords.ts
 *   readChromiumLogins() → decryptChromiumPassword(value, key) for every row
 *
 * Rules: never throws; a value that cannot be decrypted gives null. Nothing here logs.
 */
import { createDecipheriv, pbkdf2Sync } from "node:crypto";

/** Chromium's os_crypt on macOS: the fixed salt, the number of rounds and the key length (AES-128) of the key. */
const KEY_SALT = "saltysalt";
const KEY_ROUNDS = 1003;
const KEY_LENGTH_BYTES = 16;

/** Chromium's os_crypt on macOS: the IV is 16 spaces (0x20), the same for every value. */
const IV_LENGTH_BYTES = 16;
const IV_FILL_BYTE = 0x20;

/** Chromium's os_crypt: the prefix of an encrypted value. "v11" is the same scheme with a different key store. */
const VALUE_PREFIXES = ["v10", "v11"];
const PREFIX_LENGTH_BYTES = 3;

const CIPHER_NAME = "aes-128-cbc";
const AES_BLOCK_BYTES = 16;

/** A wrong key sometimes decrypts to bytes with valid padding; text that is not UTF-8 shows that, so it is refused. */
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

/**
 * The key that decrypts a browser's values, from the secret of its "<Name> Safe Storage" Keychain item.
 */
export function deriveChromiumKey(keychainSecret: string): Buffer {
  return pbkdf2Sync(keychainSecret, KEY_SALT, KEY_ROUNDS, KEY_LENGTH_BYTES, "sha1");
}

/**
 * The password in one `password_value` of a `logins` row, or null when it is empty, has another prefix, is cut or
 * garbled, or the key is wrong.
 */
export function decryptChromiumPassword(encryptedValue: Buffer, key: Buffer): string | null {
  if (encryptedValue.length <= PREFIX_LENGTH_BYTES) {
    return null;
  }
  const prefix = encryptedValue.subarray(0, PREFIX_LENGTH_BYTES).toString("latin1");
  if (!VALUE_PREFIXES.includes(prefix)) {
    return null;
  }
  const cipherText = encryptedValue.subarray(PREFIX_LENGTH_BYTES);
  if (cipherText.length % AES_BLOCK_BYTES !== 0) {
    return null;
  }
  try {
    const decipher = createDecipheriv(CIPHER_NAME, key, Buffer.alloc(IV_LENGTH_BYTES, IV_FILL_BYTE));
    const plainBytes = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return STRICT_UTF8_DECODER.decode(plainBytes);
  } catch {
    return null;
  }
}
