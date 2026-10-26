/**
 * WHY this file exists:
 *   Installs and updates Chrome Web Store extensions the way Chrome does, without Electron: the pieces that need no
 *   network. Unpacking a verified CRX (crx.ts) safely into <data folder>/Extensions/<id>/<version>/, writing the
 *   developer key into the manifest (so Electron gives the extension its Web Store id), reading Google's update
 *   answers, and deleting a copy nothing uses any more.
 *
 * Data source:
 *   CRX bytes; Google's extension update server (the Omaha "gupdate" XML answer); the system's /usr/bin/unzip.
 *
 * Data flow:
 *   extensionsController.ts downloads → unpackCrx() → folder, name, version → addExtension / updateExtensionFolder
 *   update check → buildUpdateCheckUrl() → server → parseUpdateResponse() → newer version? download again
 */
import { execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { extensionIdFromPublicKey, verifyCrx } from "./crx";
import { readExtensionManifestInfo } from "./extensionManifest";

const execFileAsync = promisify(execFile);

/** Google's extension update and download server, as Chrome uses it. */
export const WEB_STORE_UPDATE_URL = "https://clients2.google.com/service/update2/crx";

/** The unzip that ships with macOS. It strips "../" from entry names; symlinks are refused after unpacking. */
const UNZIP_COMMAND = "/usr/bin/unzip";

/** Chrome's extension version format: one to four whole numbers separated by dots ("4.9.133"). */
const CHROME_VERSION_PATTERN = /^\d{1,9}(\.\d{1,9}){0,3}$/;

/** Largest extension file accepted. Our choice: far above real extensions; bounds what we hold in memory. */
export const MAX_CRX_BYTES = 100 * 1024 * 1024;

/** What an update check found. */
export interface ExtensionUpdate {
  version: string;
  /** Where to download the new CRX. */
  codebase: string;
  /** The CRX file's SHA-256 (hex), when the server sends it. */
  sha256: string | null;
}

/** An unpacked, verified extension. */
export interface UnpackedExtension {
  folder: string;
  name: string;
  version: string;
}

/**
 * The address that downloads an extension's current CRX, like Chrome's "Add to Chrome".
 */
export function buildDownloadUrl(extensionId: string, chromeVersion: string): string {
  const query = new URLSearchParams({ response: "redirect", acceptformat: "crx3", prodversion: chromeVersion, x: `id=${extensionId}&installsource=ondemand&uc` });
  return `${WEB_STORE_UPDATE_URL}?${query.toString()}`;
}

/**
 * The address that asks whether a newer version than ours exists.
 */
export function buildUpdateCheckUrl(extensionId: string, currentVersion: string, chromeVersion: string): string {
  const query = new URLSearchParams({ response: "updatecheck", acceptformat: "crx3", prodversion: chromeVersion, x: `id=${extensionId}&v=${currentVersion}&uc` });
  return `${WEB_STORE_UPDATE_URL}?${query.toString()}`;
}

/**
 * Reads an attribute from one XML tag's text. Null when it is missing.
 */
function readXmlAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match?.[1] ?? null;
}

/**
 * Reads Google's update answer for one extension. Null when there is no update (status "noupdate") or the answer
 * does not mention the extension.
 * Example: <app appid="ID" status="ok"><updatecheck status="ok" codebase="https://…crx" version="4.9.134"/></app>
 */
export function parseUpdateResponse(xml: string, extensionId: string): ExtensionUpdate | null {
  const appTags = xml.match(/<app\s[^>]*>[\s\S]*?<\/app>/g) ?? [];
  const appTag = appTags.find((tag) => readXmlAttribute(tag.slice(0, tag.indexOf(">")), "appid") === extensionId);
  const updateTag = appTag?.match(/<updatecheck\s[^>]*>/)?.[0];
  if (updateTag === undefined || readXmlAttribute(updateTag, "status") !== "ok") {
    return null;
  }
  const version = readXmlAttribute(updateTag, "version");
  const codebase = readXmlAttribute(updateTag, "codebase");
  if (version === null || codebase === null || !codebase.startsWith("https://")) {
    return null;
  }
  return { version: version, codebase: codebase.replaceAll("&amp;", "&"), sha256: readXmlAttribute(updateTag, "hash_sha256") };
}

/**
 * Compares two extension versions ("4.9.133" < "4.9.134" < "4.10"). Negative when left is older.
 */
export function compareExtensionVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * True when a downloaded file matches the SHA-256 the update server announced.
 */
export function matchesSha256(bytes: Buffer, expectedSha256: string): boolean {
  return crypto.createHash("sha256").update(bytes).digest("hex") === expectedSha256.toLowerCase();
}

/**
 * True when a folder holds a symbolic link anywhere (an unpacked extension never needs one, and a link could point
 * a later file outside the folder).
 */
function containsSymbolicLink(folder: string): boolean {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const entryPath = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) {
      return true;
    }
    if (entry.isDirectory() && containsSymbolicLink(entryPath)) {
      return true;
    }
  }
  return false;
}

/**
 * Verifies a CRX and unpacks it into <extensionsFolder>/<id>/<version>/. Everything happens in a temporary folder
 * first; only a verified, complete extension is moved into place (replacing the same version if it is there).
 */
export async function unpackCrx(crx: Buffer, extensionId: string, extensionsFolder: string): Promise<UnpackedExtension> {
  if (crx.length > MAX_CRX_BYTES) {
    throw new Error("The extension file is too large.");
  }
  const verified = verifyCrx(crx, extensionId);
  const workFolder = fs.mkdtempSync(path.join(os.tmpdir(), "sidebar-browser-crx-"));
  try {
    const zipPath = path.join(workFolder, "extension.zip");
    const unpackFolder = path.join(workFolder, "unpacked");
    fs.writeFileSync(zipPath, verified.archive);
    fs.mkdirSync(unpackFolder);
    await execFileAsync(UNZIP_COMMAND, ["-q", zipPath, "-d", unpackFolder]);
    if (containsSymbolicLink(unpackFolder)) {
      throw new Error("The extension contains a symbolic link, which extensions never need.");
    }

    const manifestPath = path.join(unpackFolder, "manifest.json");
    const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
      throw new Error("The extension's manifest is not readable.");
    }
    const manifestWithKey = { ...manifest, key: verified.publicKey.toString("base64") };
    fs.writeFileSync(manifestPath, JSON.stringify(manifestWithKey, null, 2));
    if (extensionIdFromPublicKey(Buffer.from(manifestWithKey.key, "base64")) !== extensionId) {
      throw new Error("The extension's key does not match its id.");
    }
    const info = readExtensionManifestInfo(unpackFolder);
    // The version becomes a folder name: only Chrome's version format (1 to 4 numbers with dots), never "..".
    if (info === null || !CHROME_VERSION_PATTERN.test(info.version)) {
      throw new Error("The extension's manifest has no valid name or version.");
    }

    const finalFolder = path.join(extensionsFolder, extensionId, info.version);
    fs.mkdirSync(path.dirname(finalFolder), { recursive: true });
    fs.rmSync(finalFolder, { recursive: true, force: true });
    fs.cpSync(unpackFolder, finalFolder, { recursive: true });
    return { folder: finalFolder, name: info.name, version: info.version };
  } finally {
    fs.rmSync(workFolder, { recursive: true, force: true });
  }
}

/**
 * Deletes one extension copy we made (an older version after an update, or a removed extension) when no extension
 * still uses it. Never touches a folder outside extensionsFolder (unpacked extensions live where the user keeps
 * them). Returns true when it deleted the folder.
 */
export function deleteExtensionCopyIfUnused(extensionsFolder: string, folder: string, usedFolders: string[]): boolean {
  const resolvedFolder = path.resolve(folder);
  const resolvedRoot = path.resolve(extensionsFolder);
  const isOurCopy = resolvedFolder.startsWith(resolvedRoot + path.sep) && path.relative(resolvedRoot, resolvedFolder).split(path.sep).length === 2;
  const isUsed = usedFolders.some((usedFolder) => path.resolve(usedFolder) === resolvedFolder);
  if (!isOurCopy || isUsed || !fs.existsSync(resolvedFolder)) {
    return false;
  }
  fs.rmSync(resolvedFolder, { recursive: true, force: true });
  const idFolder = path.dirname(resolvedFolder);
  if (fs.readdirSync(idFolder).length === 0) {
    fs.rmdirSync(idFolder);
  }
  return true;
}
