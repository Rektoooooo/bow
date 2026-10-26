/**
 * WHY this file exists:
 *   The extension scan reads Chromium folders we do not control. These tests pin down which extensions are found,
 *   which are skipped and how names, icons and popups are read from their manifests.
 *
 * Data source:
 *   A synthetic Arc folder with made-up extension ids and names, built in a temporary folder. No real Arc data.
 *
 * Data flow:
 *   fixture builders → temporary Arc folder → findArcExtensions() / readExtensionManifestInfo() → checks
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { arcProfileFolderToProfileId, findArcExtensions } from "../src/main/arcExtensionsImport";
import { readExtensionManifestInfo } from "../src/main/extensionManifest";
import { DEFAULT_PROFILE_ID } from "../src/shared/settings";

const FIRST_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECOND_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const THIRD_ID = "cccccccccccccccccccccccccccccccc";
const WEB_STORE_LOCATION = 1;
const COMPONENT_LOCATION = 5;

let temporaryFolder = "";
let arcFolder = "";

function writeJson(filePath: string, content: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(content));
}

/** Creates a profile folder with the History file the profile finder looks for, and returns its path. */
function createProfile(profileFolderName: string): string {
  const profileFolder = path.join(arcFolder, "User Data", profileFolderName);
  fs.mkdirSync(profileFolder, { recursive: true });
  fs.writeFileSync(path.join(profileFolder, "History"), "");
  return profileFolder;
}

function writeSettings(profileFolder: string, settings: Record<string, unknown>): void {
  writeJson(path.join(profileFolder, "Secure Preferences"), { extensions: { settings: settings } });
}

function writeManifest(profileFolder: string, extensionId: string, versionFolder: string, manifest: unknown): string {
  const folderPath = path.join(profileFolder, "Extensions", extensionId, versionFolder);
  writeJson(path.join(folderPath, "manifest.json"), manifest);
  return folderPath;
}

function createManifest(name: string, version: string): Record<string, unknown> {
  return { name: name, version: version, manifest_version: 3 };
}

beforeEach(() => {
  temporaryFolder = fs.mkdtempSync(path.join(os.tmpdir(), "arc-extensions-test-"));
  arcFolder = path.join(temporaryFolder, "Arc");
});

afterEach(() => {
  fs.rmSync(temporaryFolder, { recursive: true, force: true });
});

describe("findArcExtensions", () => {
  it("picks the highest version folder by comparing numbers", () => {
    const profileFolder = createProfile("Default");
    writeSettings(profileFolder, { [FIRST_ID]: { location: WEB_STORE_LOCATION } });
    writeManifest(profileFolder, FIRST_ID, "4.9.133_0", createManifest("Notes", "4.9.133"));
    const expectedFolder = writeManifest(profileFolder, FIRST_ID, "4.10.2_1", createManifest("Notes", "4.10.2"));
    writeManifest(profileFolder, FIRST_ID, "4.10.2_0", createManifest("Notes", "4.10.2"));

    const scan = findArcExtensions(arcFolder);

    expect(scan.extensions).toHaveLength(1);
    expect(scan.extensions[0]?.folderPath).toBe(expectedFolder);
    expect(scan.extensions[0]?.version).toBe("4.10.2");
    expect(scan.extensions[0]?.extensionId).toBe(FIRST_ID);
  });

  it("detects disabled extensions in the array and the number form", () => {
    const profileFolder = createProfile("Default");
    writeSettings(profileFolder, {
      [FIRST_ID]: { location: WEB_STORE_LOCATION, disable_reasons: [1] },
      [SECOND_ID]: { location: WEB_STORE_LOCATION, disable_reasons: 1 },
      [THIRD_ID]: { location: WEB_STORE_LOCATION, disable_reasons: [] },
    });
    writeManifest(profileFolder, FIRST_ID, "1.0_0", createManifest("Array Off", "1.0"));
    writeManifest(profileFolder, SECOND_ID, "1.0_0", createManifest("Number Off", "1.0"));
    writeManifest(profileFolder, THIRD_ID, "1.0_0", createManifest("Still On", "1.0"));

    const scan = findArcExtensions(arcFolder);
    const enabledByName = Object.fromEntries(scan.extensions.map((extension) => [extension.name, extension.isEnabled]));

    expect(enabledByName).toEqual({ "Array Off": false, "Number Off": false, "Still On": true });
  });

  it("treats a zero disable reason and a missing one as enabled", () => {
    const profileFolder = createProfile("Default");
    writeSettings(profileFolder, {
      [FIRST_ID]: { location: WEB_STORE_LOCATION, disable_reasons: 0 },
      [SECOND_ID]: { location: WEB_STORE_LOCATION },
    });
    writeManifest(profileFolder, FIRST_ID, "1.0_0", createManifest("Zero", "1.0"));
    writeManifest(profileFolder, SECOND_ID, "1.0_0", createManifest("Missing", "1.0"));

    const scan = findArcExtensions(arcFolder);

    expect(scan.extensions.map((extension) => extension.isEnabled)).toEqual([true, true]);
  });

  it("skips extensions not installed from the Web Store and counts them", () => {
    const profileFolder = createProfile("Default");
    writeSettings(profileFolder, {
      [FIRST_ID]: { location: COMPONENT_LOCATION },
      [SECOND_ID]: { location: WEB_STORE_LOCATION },
    });
    writeManifest(profileFolder, FIRST_ID, "1.0_0", createManifest("Built In", "1.0"));
    writeManifest(profileFolder, SECOND_ID, "1.0_0", createManifest("From Store", "1.0"));

    const scan = findArcExtensions(arcFolder);

    expect(scan.extensions.map((extension) => extension.name)).toEqual(["From Store"]);
    expect(scan.skippedNotFromWebStore).toBe(1);
    expect(scan.skippedUnreadable).toBe(0);
  });

  it("counts an extension without a settings entry as unreadable", () => {
    const profileFolder = createProfile("Default");
    writeSettings(profileFolder, { [SECOND_ID]: { location: WEB_STORE_LOCATION } });
    writeManifest(profileFolder, FIRST_ID, "1.0_0", createManifest("No Settings", "1.0"));
    writeManifest(profileFolder, SECOND_ID, "1.0_0", createManifest("Has Settings", "1.0"));

    const scan = findArcExtensions(arcFolder);

    expect(scan.extensions.map((extension) => extension.name)).toEqual(["Has Settings"]);
    expect(scan.skippedUnreadable).toBe(1);
  });

  it("counts a missing or broken manifest as unreadable", () => {
    const profileFolder = createProfile("Default");
    writeSettings(profileFolder, {
      [FIRST_ID]: { location: WEB_STORE_LOCATION },
      [SECOND_ID]: { location: WEB_STORE_LOCATION },
    });
    fs.mkdirSync(path.join(profileFolder, "Extensions", FIRST_ID, "1.0_0"), { recursive: true });
    const brokenFolder = path.join(profileFolder, "Extensions", SECOND_ID, "1.0_0");
    fs.mkdirSync(brokenFolder, { recursive: true });
    fs.writeFileSync(path.join(brokenFolder, "manifest.json"), "{ not json");

    const scan = findArcExtensions(arcFolder);

    expect(scan.extensions).toEqual([]);
    expect(scan.skippedUnreadable).toBe(2);
  });

  it("maps two profiles to their profile ids and sorts by profile then name", () => {
    const defaultFolder = createProfile("Default");
    const secondFolder = createProfile("Profile 2");
    writeSettings(defaultFolder, {
      [FIRST_ID]: { location: WEB_STORE_LOCATION },
      [SECOND_ID]: { location: WEB_STORE_LOCATION },
    });
    writeSettings(secondFolder, { [THIRD_ID]: { location: WEB_STORE_LOCATION } });
    writeManifest(defaultFolder, FIRST_ID, "1.0_0", createManifest("Zebra", "1.0"));
    writeManifest(defaultFolder, SECOND_ID, "1.0_0", createManifest("Apple", "1.0"));
    writeManifest(secondFolder, THIRD_ID, "1.0_0", createManifest("Mango", "1.0"));

    const scan = findArcExtensions(arcFolder);

    expect(scan.extensions.map((extension) => [extension.arcProfileFolder, extension.profileId, extension.name])).toEqual([
      ["Default", DEFAULT_PROFILE_ID, "Apple"],
      ["Default", DEFAULT_PROFILE_ID, "Zebra"],
      ["Profile 2", "arc-profile-profile-2", "Mango"],
    ]);
  });

  it("returns an empty scan when Arc's folder or its User Data folder is missing", () => {
    const emptyScan = { extensions: [], skippedNotFromWebStore: 0, skippedUnreadable: 0 };
    expect(findArcExtensions(path.join(temporaryFolder, "does-not-exist"))).toEqual(emptyScan);

    fs.mkdirSync(arcFolder, { recursive: true });
    expect(findArcExtensions(arcFolder)).toEqual(emptyScan);
  });
});

describe("arcProfileFolderToProfileId", () => {
  it("maps Default to our default profile and others to a dashed lowercase id", () => {
    expect(arcProfileFolderToProfileId("Default")).toBe(DEFAULT_PROFILE_ID);
    expect(arcProfileFolderToProfileId("Profile 2")).toBe("arc-profile-profile-2");
  });
});

describe("readExtensionManifestInfo", () => {
  function createExtensionFolder(manifest: unknown): string {
    const folderPath = path.join(temporaryFolder, "extension");
    writeJson(path.join(folderPath, "manifest.json"), manifest);
    return folderPath;
  }

  it("resolves a __MSG_ name case-insensitively through default_locale", () => {
    const folderPath = createExtensionFolder({
      name: "__MSG_appName__",
      version: "2.0",
      manifest_version: 3,
      default_locale: "de",
    });
    writeJson(path.join(folderPath, "_locales", "de", "messages.json"), { APPNAME: { message: "Mein Werkzeug" } });
    writeJson(path.join(folderPath, "_locales", "en", "messages.json"), { appName: { message: "My Tool" } });

    expect(readExtensionManifestInfo(folderPath)?.name).toBe("Mein Werkzeug");
  });

  it("falls back to the en locale when the default locale lacks the key", () => {
    const folderPath = createExtensionFolder({
      name: "__MSG_appName__",
      version: "2.0",
      manifest_version: 3,
      default_locale: "fr",
    });
    writeJson(path.join(folderPath, "_locales", "fr", "messages.json"), { other: { message: "Autre" } });
    writeJson(path.join(folderPath, "_locales", "en", "messages.json"), { appname: { message: "My Tool" } });

    expect(readExtensionManifestInfo(folderPath)?.name).toBe("My Tool");
  });

  it("uses the bare key when the message cannot be found", () => {
    const folderPath = createExtensionFolder({ name: "__MSG_appName__", version: "2.0", manifest_version: 3 });

    expect(readExtensionManifestInfo(folderPath)?.name).toBe("appName");
  });

  it("chooses the smallest icon of at least 32 px, otherwise the largest", () => {
    const withBigIcons = createExtensionFolder({
      name: "Icons",
      version: "1.0",
      manifest_version: 3,
      icons: { "16": "i16.png", "48": "i48.png", "128": "i128.png" },
    });
    expect(readExtensionManifestInfo(withBigIcons)?.iconPath).toBe("i48.png");

    const withSmallIcons = createExtensionFolder({
      name: "Icons",
      version: "1.0",
      manifest_version: 3,
      icons: { "16": "i16.png", "24": "i24.png" },
    });
    expect(readExtensionManifestInfo(withSmallIcons)?.iconPath).toBe("i24.png");
  });

  it("falls back to the action icon and has no icon when there is none", () => {
    const withActionIcon = createExtensionFolder({
      name: "Icons",
      version: "1.0",
      manifest_version: 3,
      action: { default_icon: { "19": "a19.png", "38": "a38.png" } },
    });
    expect(readExtensionManifestInfo(withActionIcon)?.iconPath).toBe("a38.png");

    const withoutIcon = createExtensionFolder({ name: "Icons", version: "1.0", manifest_version: 3 });
    expect(readExtensionManifestInfo(withoutIcon)?.iconPath).toBeNull();
  });

  it("reads the popup from the MV3 action and the MV2 browser_action", () => {
    const manifestVersion3 = createExtensionFolder({
      name: "Popup",
      version: "1.0",
      manifest_version: 3,
      action: { default_popup: "popup3.html" },
    });
    expect(readExtensionManifestInfo(manifestVersion3)?.popupPath).toBe("popup3.html");

    const manifestVersion2 = createExtensionFolder({
      name: "Popup",
      version: "1.0",
      manifest_version: 2,
      browser_action: { default_popup: "popup2.html" },
    });
    const info = readExtensionManifestInfo(manifestVersion2);
    expect(info?.popupPath).toBe("popup2.html");
    expect(info?.manifestVersion).toBe(2);
  });

  it("returns null for a missing, broken or incomplete manifest", () => {
    expect(readExtensionManifestInfo(path.join(temporaryFolder, "nothing"))).toBeNull();
    expect(readExtensionManifestInfo(createExtensionFolder({ version: "1.0" }))).toBeNull();
    expect(readExtensionManifestInfo(createExtensionFolder({ name: "No Version" }))).toBeNull();
    expect(readExtensionManifestInfo(createExtensionFolder([1, 2]))).toBeNull();
  });
});
