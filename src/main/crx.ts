/**
 * WHY this file exists:
 *   Chrome Web Store extensions come as CRX3 files: a signed header, then a zip archive. Before anything is
 *   unpacked, this file checks that the file really is the extension we asked for: the signed header names that
 *   extension id, and the developer key whose hash is that id signed the archive. It also turns keys into ids.
 *
 * Data source:
 *   CRX3 bytes. The layout is Chromium's (components/crx_file/crx3.proto): "Cr24", version 3, header size, a
 *   CrxFileHeader protobuf, the zip. Signatures cover "CRX3 SignedData\0" + header-data size + header data + zip.
 *
 * Data flow:
 *   download → verifyCrx(bytes, expected id) → { archive, publicKey } → webStoreInstall.ts unpacks the archive and
 *   writes publicKey into the manifest as "key" (so Electron gives the extension its Web Store id)
 */
import * as crypto from "node:crypto";

const CRX_MAGIC = "Cr24";
const CRX_FORMAT_VERSION = 3;
/** "Cr24", the format version and the header size, 4 bytes each. */
const CRX_PREAMBLE_BYTES = 12;
const SIGNED_DATA_PREFIX = Buffer.from("CRX3 SignedData\0", "latin1");

/** Field numbers in crx3.proto. */
const HEADER_FIELD_SHA256_WITH_RSA = 2;
const HEADER_FIELD_SIGNED_HEADER_DATA = 10000;
const PROOF_FIELD_PUBLIC_KEY = 1;
const PROOF_FIELD_SIGNATURE = 2;
const SIGNED_DATA_FIELD_CRX_ID = 1;

/** An extension id is 32 letters a–p: the first 16 bytes of a SHA-256, one letter per hex digit. */
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const EXTENSION_ID_BYTES = 16;

/** Protobuf wire types (https://protobuf.dev/programming-guides/encoding/). */
const WIRE_TYPE_VARINT = 0;
const WIRE_TYPE_FIXED64 = 1;
const WIRE_TYPE_LENGTH_DELIMITED = 2;
const WIRE_TYPE_FIXED32 = 5;

/** A length-delimited protobuf field: its number and its bytes. Other fields are skipped. */
interface ProtobufField {
  fieldNumber: number;
  bytes: Buffer;
}

/** What a verified CRX holds. */
export interface VerifiedCrx {
  /** The zip archive with the extension's files. */
  archive: Buffer;
  /** The developer's public key (DER, SubjectPublicKeyInfo); its hash is the extension id. */
  publicKey: Buffer;
}

/**
 * True for text shaped like an extension id.
 */
export function isExtensionId(text: string): boolean {
  return EXTENSION_ID_PATTERN.test(text);
}

/**
 * Derives the extension id Chromium gives a public key.
 * Example: a Web Store extension's manifest "key" (base64 DER) → its 32-letter Web Store id
 */
export function extensionIdFromPublicKey(publicKeyDer: Buffer): string {
  const hash = crypto.createHash("sha256").update(publicKeyDer).digest();
  const hexDigits = hash.subarray(0, EXTENSION_ID_BYTES).toString("hex");
  return Array.from(hexDigits, (digit) => String.fromCharCode("a".charCodeAt(0) + parseInt(digit, 16))).join("");
}

/**
 * Turns an extension id back into its 16 bytes.
 */
function extensionIdToBytes(extensionId: string): Buffer {
  const hexDigits = Array.from(extensionId, (letter) => (letter.charCodeAt(0) - "a".charCodeAt(0)).toString(16)).join("");
  return Buffer.from(hexDigits, "hex");
}

/**
 * Reads a protobuf varint at an offset. Returns the value and where the next field starts.
 */
function readVarint(buffer: Buffer, offset: number): { value: number; next: number } {
  let value = 0;
  let multiplier = 1;
  let position = offset;
  for (;;) {
    const byte = buffer[position];
    if (byte === undefined || multiplier > 2 ** 49) {
      throw new Error("The CRX header is damaged.");
    }
    value = value + (byte & 0x7f) * multiplier;
    position = position + 1;
    if ((byte & 0x80) === 0) {
      return { value: value, next: position };
    }
    multiplier = multiplier * 128;
  }
}

/**
 * Reads the length-delimited fields of a protobuf message (the only kind CRX headers use for what we need).
 */
function readProtobufFields(message: Buffer): ProtobufField[] {
  const fields: ProtobufField[] = [];
  let offset = 0;
  while (offset < message.length) {
    const tag = readVarint(message, offset);
    offset = tag.next;
    const fieldNumber = Math.floor(tag.value / 8);
    const wireType = tag.value % 8;
    if (wireType === WIRE_TYPE_VARINT) {
      offset = readVarint(message, offset).next;
    } else if (wireType === WIRE_TYPE_FIXED64) {
      offset = offset + 8;
    } else if (wireType === WIRE_TYPE_FIXED32) {
      offset = offset + 4;
    } else if (wireType === WIRE_TYPE_LENGTH_DELIMITED) {
      const length = readVarint(message, offset);
      const end = length.next + length.value;
      if (end > message.length) {
        throw new Error("The CRX header is damaged.");
      }
      fields.push({ fieldNumber: fieldNumber, bytes: message.subarray(length.next, end) });
      offset = end;
    } else {
      throw new Error("The CRX header is damaged.");
    }
  }
  return fields;
}

/**
 * Checks a CRX3 file for the expected extension and returns its archive and developer key. Throws with a short
 * reason when the file is not a CRX3, names another extension, or lacks a valid signature by that extension's key.
 */
export function verifyCrx(crx: Buffer, expectedExtensionId: string): VerifiedCrx {
  if (!isExtensionId(expectedExtensionId)) {
    throw new Error("That is not an extension id.");
  }
  if (crx.length < CRX_PREAMBLE_BYTES || crx.toString("latin1", 0, 4) !== CRX_MAGIC) {
    throw new Error("The download is not an extension file (CRX).");
  }
  if (crx.readUInt32LE(4) !== CRX_FORMAT_VERSION) {
    throw new Error("Only CRX version 3 extension files are supported.");
  }
  const headerEnd = CRX_PREAMBLE_BYTES + crx.readUInt32LE(8);
  if (headerEnd > crx.length) {
    throw new Error("The CRX header is damaged.");
  }
  const headerFields = readProtobufFields(crx.subarray(CRX_PREAMBLE_BYTES, headerEnd));
  const archive = crx.subarray(headerEnd);

  const signedHeaderData = headerFields.find((field) => field.fieldNumber === HEADER_FIELD_SIGNED_HEADER_DATA)?.bytes;
  const crxId = signedHeaderData === undefined ? undefined : readProtobufFields(signedHeaderData).find((field) => field.fieldNumber === SIGNED_DATA_FIELD_CRX_ID)?.bytes;
  if (signedHeaderData === undefined || crxId === undefined || !crxId.equals(extensionIdToBytes(expectedExtensionId))) {
    throw new Error("The file is for a different extension.");
  }

  const headerDataSize = Buffer.alloc(4);
  headerDataSize.writeUInt32LE(signedHeaderData.length);
  const signedData = Buffer.concat([SIGNED_DATA_PREFIX, headerDataSize, signedHeaderData, archive]);
  for (const proofField of headerFields.filter((field) => field.fieldNumber === HEADER_FIELD_SHA256_WITH_RSA)) {
    const proof = readProtobufFields(proofField.bytes);
    const publicKey = proof.find((field) => field.fieldNumber === PROOF_FIELD_PUBLIC_KEY)?.bytes;
    const signature = proof.find((field) => field.fieldNumber === PROOF_FIELD_SIGNATURE)?.bytes;
    if (publicKey === undefined || signature === undefined || extensionIdFromPublicKey(publicKey) !== expectedExtensionId) {
      // Another signer (the Web Store's own key also signs); the developer's proof is the one that must hold.
      continue;
    }
    const isValid = crypto.verify("sha256", signedData, { key: publicKey, format: "der", type: "spki" }, signature);
    if (!isValid) {
      throw new Error("The extension's signature does not match the file.");
    }
    return { archive: archive, publicKey: Buffer.from(publicKey) };
  }
  throw new Error("The file is not signed by the extension's developer.");
}
