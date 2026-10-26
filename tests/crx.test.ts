/**
 * WHY this file exists:
 *   Installing from the Chrome Web Store runs code from a download, so the checks must hold: these tests build
 *   synthetic CRX3 files (own keys, own zip) and pin down that only a file signed by the requested extension's key is
 *   unpacked, that nothing escapes the extensions folder, and how update answers and Web Store addresses are read.
 */
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extensionIdFromPublicKey, isExtensionId, verifyCrx } from "../src/main/crx";
import { compareExtensionVersions, deleteExtensionCopyIfUnused, parseUpdateResponse, unpackCrx } from "../src/main/webStoreInstall";
import { findWebStoreExtensionId } from "../src/shared/webStore";

const temporaryFolders: string[] = [];
afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

function makeTemporaryFolder(): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "crx-test-"));
  temporaryFolders.push(folder);
  return folder;
}

/** A made-up RSA key pair, as a Web Store developer (or the store itself) would have. */
function makeSigner(): { publicKeyDer: Buffer; privateKey: crypto.KeyObject } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { publicKeyDer: publicKey.export({ type: "spki", format: "der" }), privateKey: privateKey };
}

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 128) {
    bytes.push((remaining % 128) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

/** A length-delimited protobuf field. */
function encodeField(fieldNumber: number, bytes: Buffer): Buffer {
  return Buffer.concat([encodeVarint(fieldNumber * 8 + 2), encodeVarint(bytes.length), bytes]);
}

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function idBytes(extensionId: string): Buffer {
  return Buffer.from(Array.from(extensionId, (letter) => (letter.charCodeAt(0) - 97).toString(16)).join(""), "hex");
}

/** Builds a CRX3 file the way the Web Store does: header data naming the id, a proof per signer, then the zip. */
function buildCrx(archive: Buffer, signers: ReturnType<typeof makeSigner>[], headerExtensionId: string): Buffer {
  const signedHeaderData = encodeField(1, idBytes(headerExtensionId));
  const signedData = Buffer.concat([Buffer.from("CRX3 SignedData\0", "latin1"), uint32(signedHeaderData.length), signedHeaderData, archive]);
  const proofs = signers.map((signer) =>
    encodeField(2, Buffer.concat([encodeField(1, signer.publicKeyDer), encodeField(2, crypto.sign("sha256", signedData, signer.privateKey))])),
  );
  const header = Buffer.concat([...proofs, encodeField(10000, signedHeaderData)]);
  return Buffer.concat([Buffer.from("Cr24", "latin1"), uint32(3), uint32(header.length), header, archive]);
}

/** Zips a folder of made-up extension files with the system's zip (-y keeps symbolic links as links). */
function zipExtension(files: Record<string, string>, symbolicLinks: Record<string, string> = {}): Buffer {
  const folder = makeTemporaryFolder();
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(folder, name), text);
  }
  for (const [name, target] of Object.entries(symbolicLinks)) {
    fs.symlinkSync(target, path.join(folder, name));
  }
  execFileSync("/usr/bin/zip", ["-q", "-r", "-y", "-X", "extension.zip", "."], { cwd: folder });
  return fs.readFileSync(path.join(folder, "extension.zip"));
}

const MANIFEST = JSON.stringify({ manifest_version: 3, name: "Made-up Extension", version: "1.2.3" });

describe("CRX verification", () => {
  it("derives a 32-letter a–p id from a key", () => {
    const signer = makeSigner();
    expect(isExtensionId(extensionIdFromPublicKey(signer.publicKeyDer))).toBe(true);
  });

  it("accepts a file signed by the extension's own key, next to the store's signature", () => {
    const developer = makeSigner();
    const store = makeSigner();
    const extensionId = extensionIdFromPublicKey(developer.publicKeyDer);
    const archive = zipExtension({ "manifest.json": MANIFEST });
    const verified = verifyCrx(buildCrx(archive, [store, developer], extensionId), extensionId);

    expect(verified.archive.equals(archive)).toBe(true);
    expect(verified.publicKey.equals(developer.publicKeyDer)).toBe(true);
  });

  it("refuses a changed archive, another extension, a file without the developer's signature, and non-CRX data", () => {
    const developer = makeSigner();
    const stranger = makeSigner();
    const extensionId = extensionIdFromPublicKey(developer.publicKeyDer);
    const otherId = extensionIdFromPublicKey(stranger.publicKeyDer);
    const crx = buildCrx(zipExtension({ "manifest.json": MANIFEST }), [developer], extensionId);
    const tampered = Buffer.from(crx);
    tampered[tampered.length - 30] = (tampered[tampered.length - 30] ?? 0) ^ 0xff;

    expect(() => verifyCrx(tampered, extensionId)).toThrow(/signature/);
    expect(() => verifyCrx(crx, otherId)).toThrow(/different extension/);
    expect(() => verifyCrx(buildCrx(zipExtension({ "manifest.json": MANIFEST }), [stranger], extensionId), extensionId)).toThrow(/not signed/);
    expect(() => verifyCrx(Buffer.from("PK\u0003\u0004 not a crx"), extensionId)).toThrow(/not an extension file/);
  });
});

describe("unpacking", () => {
  it("unpacks into Extensions/<id>/<version> with the developer key in the manifest", async () => {
    const developer = makeSigner();
    const extensionId = extensionIdFromPublicKey(developer.publicKeyDer);
    const extensionsFolder = makeTemporaryFolder();
    const unpacked = await unpackCrx(buildCrx(zipExtension({ "manifest.json": MANIFEST, "content.js": "// hi" }), [developer], extensionId), extensionId, extensionsFolder);

    expect(unpacked).toEqual({ folder: path.join(extensionsFolder, extensionId, "1.2.3"), name: "Made-up Extension", version: "1.2.3" });
    const manifest = JSON.parse(fs.readFileSync(path.join(unpacked.folder, "manifest.json"), "utf8"));
    expect(extensionIdFromPublicKey(Buffer.from(manifest.key, "base64"))).toBe(extensionId);
    expect(fs.existsSync(path.join(unpacked.folder, "content.js"))).toBe(true);
  });

  it("refuses symbolic links and versions that are not Chrome versions, leaving the folder untouched", async () => {
    const developer = makeSigner();
    const extensionId = extensionIdFromPublicKey(developer.publicKeyDer);
    const extensionsFolder = makeTemporaryFolder();
    fs.writeFileSync(path.join(extensionsFolder, "keep.txt"), "still here");
    const withLink = buildCrx(zipExtension({ "manifest.json": MANIFEST }, { "escape": "/etc" }), [developer], extensionId);
    const dotDotVersion = buildCrx(zipExtension({ "manifest.json": JSON.stringify({ manifest_version: 3, name: "X", version: ".." }) }), [developer], extensionId);

    await expect(unpackCrx(withLink, extensionId, extensionsFolder)).rejects.toThrow(/symbolic link/);
    await expect(unpackCrx(dotDotVersion, extensionId, extensionsFolder)).rejects.toThrow(/version/);
    expect(fs.readdirSync(extensionsFolder)).toEqual(["keep.txt"]);
  });

  it("deletes only our own copies that nothing uses", () => {
    const extensionsFolder = makeTemporaryFolder();
    const elsewhere = makeTemporaryFolder();
    const used = path.join(extensionsFolder, "a".repeat(32), "2.0");
    const oldVersion = path.join(extensionsFolder, "a".repeat(32), "1.0");
    const onlyVersion = path.join(extensionsFolder, "b".repeat(32), "1.0");
    for (const folder of [used, oldVersion, onlyVersion]) {
      fs.mkdirSync(folder, { recursive: true });
    }
    expect(deleteExtensionCopyIfUnused(extensionsFolder, used, [used])).toBe(false);
    expect(deleteExtensionCopyIfUnused(extensionsFolder, oldVersion, [used])).toBe(true);
    expect(deleteExtensionCopyIfUnused(extensionsFolder, onlyVersion, [used])).toBe(true);
    expect(deleteExtensionCopyIfUnused(extensionsFolder, elsewhere, [])).toBe(false);
    expect(deleteExtensionCopyIfUnused(extensionsFolder, extensionsFolder, [])).toBe(false);
    expect(deleteExtensionCopyIfUnused(extensionsFolder, path.join(extensionsFolder, "a".repeat(32)), [])).toBe(false);
    expect(fs.existsSync(used) && fs.existsSync(elsewhere)).toBe(true);
    expect(fs.existsSync(oldVersion)).toBe(false);
    expect(fs.existsSync(path.dirname(onlyVersion))).toBe(false);
  });
});

describe("Web Store addresses and update answers", () => {
  const darkReaderLikeId = "abcdefghijklmnopabcdefghijklmnop";

  it("reads the extension id from Web Store pages only", () => {
    expect(findWebStoreExtensionId(`https://chromewebstore.google.com/detail/some-name/${darkReaderLikeId}?hl=en`)).toBe(darkReaderLikeId);
    expect(findWebStoreExtensionId(`https://chrome.google.com/webstore/detail/some-name/${darkReaderLikeId}`)).toBe(darkReaderLikeId);
    expect(findWebStoreExtensionId(`https://chromewebstore.google.com/detail/${darkReaderLikeId}`)).toBe(darkReaderLikeId);
    expect(findWebStoreExtensionId(`https://example.com/detail/some-name/${darkReaderLikeId}`)).toBeNull();
    expect(findWebStoreExtensionId("https://chromewebstore.google.com/category/extensions")).toBeNull();
    expect(findWebStoreExtensionId(`http://chromewebstore.google.com/detail/x/${darkReaderLikeId}`)).toBeNull();
  });

  it("reads an update, and no update", () => {
    const update = `<?xml version="1.0"?><gupdate xmlns="http://www.google.com/update2/response" protocol="2.0"><app appid="${darkReaderLikeId}" status="ok"><updatecheck codebase="https://clients2.googleusercontent.com/crx/blobs/x/extension.crx?a=1&amp;b=2" hash_sha256="ab12" status="ok" version="4.9.134"/></app></gupdate>`;
    const noUpdate = `<gupdate><app appid="${darkReaderLikeId}" status="ok"><updatecheck status="noupdate"/></app></gupdate>`;

    expect(parseUpdateResponse(update, darkReaderLikeId)).toEqual({ version: "4.9.134", codebase: "https://clients2.googleusercontent.com/crx/blobs/x/extension.crx?a=1&b=2", sha256: "ab12" });
    expect(parseUpdateResponse(noUpdate, darkReaderLikeId)).toBeNull();
    expect(parseUpdateResponse(update, "p".repeat(32))).toBeNull();
  });

  it("compares versions part by part", () => {
    expect(compareExtensionVersions("4.9.133", "4.9.134")).toBeLessThan(0);
    expect(compareExtensionVersions("4.10", "4.9.134")).toBeGreaterThan(0);
    expect(compareExtensionVersions("1.0", "1.0.0")).toBe(0);
  });
});
