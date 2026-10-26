/**
 * WHY this file exists:
 *   Chrome extensions describe themselves in a `manifest.json`. Both the Arc extension scan and the code that loads
 *   extensions into our browser need the same few facts (name, version, icon, popup), so one reader serves both.
 *
 * Data source:
 *   `<extension folder>/manifest.json` and, for translated names, `<extension folder>/_locales/<locale>/messages.json`.
 *
 * Data flow:
 *   arcExtensionsImport.ts → readExtensionManifestInfo(folder) → ExtensionManifestInfo (or null)
 *
 * Rules: synchronous and defensive; bad or missing data gives null or a fallback, never an exception.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface ExtensionManifestInfo {
  /** The manifest "name", with a "__MSG_key__" placeholder resolved. */
  name: string;
  version: string;
  manifestVersion: number;
  /** Path relative to the folder of the best icon for 16-32 px menus, or null when there is none. */
  iconPath: string | null;
  /** action.default_popup (MV3) or browser_action.default_popup (MV2), or null. */
  popupPath: string | null;
}

type JsonObject = Record<string, unknown>;

const MANIFEST_FILE_NAME = "manifest.json";
const LOCALES_FOLDER_NAME = "_locales";
const MESSAGES_FILE_NAME = "messages.json";
/** Chrome's own fallback language when a manifest names no default locale. */
const FALLBACK_LOCALE = "en";
/** Icons are shown in 16-32 px menus, so the smallest icon that is at least this big looks sharpest. */
const PREFERRED_ICON_SIZE = 32;
/** A manifest without a "manifest_version" is treated as the old format. */
const FALLBACK_MANIFEST_VERSION = 2;

const MESSAGE_PLACEHOLDER = /^__MSG_(.+)__$/;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a JSON file that must hold an object. Returns null when it is missing, unreadable or not an object. */
function readJsonObjectFile(filePath: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Looks up one message in a locale's messages.json. Chrome treats message keys as case-insensitive. */
function lookupLocaleMessage(folderPath: string, locale: string, key: string): string | null {
  const messagesPath = path.join(folderPath, LOCALES_FOLDER_NAME, locale, MESSAGES_FILE_NAME);
  const messages = readJsonObjectFile(messagesPath);
  if (messages === null) {
    return null;
  }
  const wantedKey = key.toLowerCase();
  for (const [messageKey, entry] of Object.entries(messages)) {
    if (messageKey.toLowerCase() !== wantedKey || !isJsonObject(entry)) {
      continue;
    }
    const message = entry["message"];
    return typeof message === "string" ? message : null;
  }
  return null;
}

/**
 * Turns "__MSG_key__" into the translated text from `_locales`. Text without the wrapper is returned unchanged.
 * When the key cannot be found in the default locale or in "en", the bare key is returned.
 */
export function resolveLocalizedText(folderPath: string, defaultLocale: string | null, text: string): string {
  const match = MESSAGE_PLACEHOLDER.exec(text);
  if (match === null) {
    return text;
  }
  const key = match[1] ?? text;
  const localesToTry = defaultLocale === null ? [FALLBACK_LOCALE] : [defaultLocale, FALLBACK_LOCALE];
  for (const locale of localesToTry) {
    const message = lookupLocaleMessage(folderPath, locale, key);
    if (message !== null) {
      return message;
    }
  }
  return key;
}

/** Picks the smallest icon of at least 32 px, otherwise the largest one. Accepts a size→path map or a single path. */
function pickIconPath(iconSource: unknown): string | null {
  if (typeof iconSource === "string") {
    return iconSource.length > 0 ? iconSource : null;
  }
  if (!isJsonObject(iconSource)) {
    return null;
  }
  let smallestBigEnough: { size: number; iconPath: string } | null = null;
  let largest: { size: number; iconPath: string } | null = null;
  for (const [sizeText, iconPath] of Object.entries(iconSource)) {
    const size = Number(sizeText);
    if (!Number.isFinite(size) || typeof iconPath !== "string" || iconPath.length === 0) {
      continue;
    }
    if (largest === null || size > largest.size) {
      largest = { size: size, iconPath: iconPath };
    }
    const isBigEnough = size >= PREFERRED_ICON_SIZE;
    if (isBigEnough && (smallestBigEnough === null || size < smallestBigEnough.size)) {
      smallestBigEnough = { size: size, iconPath: iconPath };
    }
  }
  const chosen = smallestBigEnough ?? largest;
  return chosen === null ? null : chosen.iconPath;
}

/** The toolbar button sections: "action" in manifest v3, "browser_action" in v2. */
function readActionSections(manifest: JsonObject): JsonObject[] {
  const sections: JsonObject[] = [];
  for (const sectionName of ["action", "browser_action"]) {
    const section = manifest[sectionName];
    if (isJsonObject(section)) {
      sections.push(section);
    }
  }
  return sections;
}

function readIconPath(manifest: JsonObject): string | null {
  const fromIcons = pickIconPath(manifest["icons"]);
  if (fromIcons !== null) {
    return fromIcons;
  }
  for (const section of readActionSections(manifest)) {
    const fromAction = pickIconPath(section["default_icon"]);
    if (fromAction !== null) {
      return fromAction;
    }
  }
  return null;
}

function readPopupPath(manifest: JsonObject): string | null {
  for (const section of readActionSections(manifest)) {
    const popup = section["default_popup"];
    if (typeof popup === "string" && popup.length > 0) {
      return popup;
    }
  }
  return null;
}

/**
 * Reads the manifest of an unpacked extension folder. Returns null when manifest.json is missing, is not JSON, or
 * has no text name and version.
 */
export function readExtensionManifestInfo(folderPath: string): ExtensionManifestInfo | null {
  const manifest = readJsonObjectFile(path.join(folderPath, MANIFEST_FILE_NAME));
  if (manifest === null) {
    return null;
  }
  const rawName = manifest["name"];
  const version = manifest["version"];
  if (typeof rawName !== "string" || typeof version !== "string") {
    return null;
  }
  const defaultLocale = manifest["default_locale"];
  const manifestVersion = manifest["manifest_version"];
  return {
    name: resolveLocalizedText(folderPath, typeof defaultLocale === "string" ? defaultLocale : null, rawName),
    version: version,
    manifestVersion: typeof manifestVersion === "number" ? manifestVersion : FALLBACK_MANIFEST_VERSION,
    iconPath: readIconPath(manifest),
    popupPath: readPopupPath(manifest),
  };
}
