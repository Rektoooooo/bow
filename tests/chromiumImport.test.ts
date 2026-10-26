/**
 * WHY this file exists:
 *   The Chromium importer reads files we do not control (Bookmarks, Local State). These tests pin down profile
 *   discovery and the tolerant parsing of the bookmark tree.
 *
 * Data source:
 *   A temporary fake home folder and bookmark JSON written by hand below. No real browser data.
 *
 * Data flow:
 *   fake home → findChromiumProfiles() / readChromiumBookmarks(); JSON → parseChromiumBookmarks() → checks
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findChromiumProfiles, parseChromiumBookmarks, readChromiumBookmarks } from "../src/main/chromiumImport";

const BOOKMARKS_JSON = {
  roots: {
    bookmark_bar: {
      name: "Bookmarks bar",
      type: "folder",
      children: [
        { type: "url", name: "Example", url: "https://example.com/" },
        { type: "url", name: "Script", url: "javascript:alert(1)" },
        { type: "url", name: "Settings", url: "chrome://settings" },
        { type: "url", name: "Local", url: "file:///tmp/a.html" },
        {
          type: "folder",
          name: "Wiki",
          children: [{ type: "url", name: "Wikipedia", url: "http://en.wikipedia.org/" }],
        },
      ],
    },
    other: { name: "Other bookmarks", type: "folder", children: [] },
    synced: { name: "Mobile bookmarks", type: "folder", children: [{ type: "url", name: "Phone", url: "https://example.org/" }] },
  },
};

let homeFolder = "";

function writeFile(relativePath: string, content: string): void {
  const filePath = path.join(homeFolder, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

beforeEach(() => {
  homeFolder = fs.mkdtempSync(path.join(os.tmpdir(), "chromium-import-test-"));
});

afterEach(() => {
  fs.rmSync(homeFolder, { recursive: true, force: true });
});

describe("parseChromiumBookmarks", () => {
  it("builds folders and bookmarks and drops non-web addresses and empty roots", () => {
    expect(parseChromiumBookmarks(BOOKMARKS_JSON)).toEqual([
      {
        kind: "folder",
        title: "Bookmarks bar",
        children: [
          { kind: "bookmark", title: "Example", url: "https://example.com/" },
          { kind: "folder", title: "Wiki", children: [{ kind: "bookmark", title: "Wikipedia", url: "http://en.wikipedia.org/" }] },
        ],
      },
      { kind: "folder", title: "Mobile bookmarks", children: [{ kind: "bookmark", title: "Phone", url: "https://example.org/" }] },
    ]);
  });

  it("returns an empty tree for unknown shapes", () => {
    expect(parseChromiumBookmarks(null)).toEqual([]);
    expect(parseChromiumBookmarks("text")).toEqual([]);
    expect(parseChromiumBookmarks({})).toEqual([]);
    expect(parseChromiumBookmarks({ roots: [] })).toEqual([]);
    expect(parseChromiumBookmarks({ roots: { bookmark_bar: { children: "no" }, other: 5 } })).toEqual([]);
    expect(parseChromiumBookmarks({ roots: { other: { children: [null, 3, { type: "url" }, { type: "url", url: 4 }] } } })).toEqual([]);
  });
});

describe("findChromiumProfiles", () => {
  it("finds profiles with a Bookmarks or History file and reads display names from Local State", () => {
    const chromeFolder = "Library/Application Support/Google/Chrome";
    writeFile(`${chromeFolder}/Default/Bookmarks`, JSON.stringify(BOOKMARKS_JSON));
    writeFile(`${chromeFolder}/Profile 1/History`, "");
    writeFile(`${chromeFolder}/Profile 2/Preferences`, "{}");
    writeFile(`${chromeFolder}/Crashpad/History`, "");
    writeFile(`${chromeFolder}/Local State`, JSON.stringify({ profile: { info_cache: { "Profile 1": { name: "Work" } } } }));
    writeFile("Library/Application Support/Vivaldi/Default/Bookmarks", "not json");

    const profiles = findChromiumProfiles(homeFolder).map((profile) => ({
      browserId: profile.browserId,
      folderName: profile.folderName,
      displayName: profile.displayName,
      hasBookmarks: profile.hasBookmarks,
      hasHistory: profile.hasHistory,
    }));
    expect(profiles).toEqual([
      { browserId: "chrome", folderName: "Default", displayName: "Default", hasBookmarks: true, hasHistory: false },
      { browserId: "chrome", folderName: "Profile 1", displayName: "Work", hasBookmarks: false, hasHistory: true },
      { browserId: "vivaldi", folderName: "Default", displayName: "Default", hasBookmarks: true, hasHistory: false },
    ]);
  });

  it("returns nothing when no browser is installed", () => {
    expect(findChromiumProfiles(homeFolder)).toEqual([]);
  });
});

describe("readChromiumBookmarks", () => {
  it("reads a profile's file and tolerates damaged ones", () => {
    writeFile("Library/Application Support/Microsoft Edge/Default/Bookmarks", JSON.stringify(BOOKMARKS_JSON));
    writeFile("Library/Application Support/Microsoft Edge/Profile 1/Bookmarks", "{broken");
    const [good, broken] = findChromiumProfiles(homeFolder);
    expect(good && readChromiumBookmarks(good)).toHaveLength(2);
    expect(broken && readChromiumBookmarks(broken)).toEqual([]);
  });
});
