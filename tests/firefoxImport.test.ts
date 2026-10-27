// Firefox import: profiles.ini, the bookmark tree from moz_bookmarks rows, history from moz_places rows, and both
// read from a real SQLite file with Firefox's tables (made with /usr/bin/sqlite3 in a temporary home folder).
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  convertFirefoxBookmarkRows,
  convertFirefoxHistoryRows,
  findFirefoxProfiles,
  parseProfilesIni,
  readFirefoxBookmarks,
  readFirefoxHistory,
} from "../src/main/firefoxImport";

const FIREFOX_FOLDER = "/Users/someone/Library/Application Support/Firefox";

/** 2026-10-27 12:00:00 UTC in Firefox's microseconds and in our milliseconds. */
const VISIT_MICROSECONDS = 1793102400000000;
const VISIT_MILLISECONDS = 1793102400000;

const PROFILES_INI = `[Install4F96D1932A9F858E]
Default=Profiles/abcd1234.default-release
Locked=1

[Profile1]
Name=default
IsRelative=1
Path=Profiles/wxyz9876.default
Default=1

[Profile0]
Name=default-release
IsRelative=1
Path=Profiles/abcd1234.default-release

[Profile2]
Name=work
IsRelative=0
Path=/Volumes/Data/firefox-work

[General]
StartWithLastProfile=1
Version=2
`;

describe("parseProfilesIni", () => {
  it("lists every profile with its folder, and the one an [Install] section names as the default", () => {
    const profiles = parseProfilesIni(PROFILES_INI, FIREFOX_FOLDER);
    expect(profiles).toEqual([
      { folderName: "wxyz9876.default", displayName: "default", profileFolder: `${FIREFOX_FOLDER}/Profiles/wxyz9876.default`, isDefault: true },
      { folderName: "abcd1234.default-release", displayName: "default-release", profileFolder: `${FIREFOX_FOLDER}/Profiles/abcd1234.default-release`, isDefault: true },
      { folderName: "firefox-work", displayName: "work", profileFolder: "/Volumes/Data/firefox-work", isDefault: false },
    ]);
  });

  it("gives nothing for an empty or unrelated file", () => {
    expect(parseProfilesIni("", FIREFOX_FOLDER)).toEqual([]);
    expect(parseProfilesIni("[General]\nVersion=2\n", FIREFOX_FOLDER)).toEqual([]);
  });
});

/** A small bookmark table: the root, Firefox's built-in folders, a nested folder, a separator and a tag. */
const BOOKMARK_ROWS = [
  { id: 1, parent: 0, type: 2, position: 0, title: "", guid: "root________", url: null },
  { id: 2, parent: 1, type: 2, position: 0, title: "menu", guid: "menu________", url: null },
  { id: 3, parent: 1, type: 2, position: 1, title: "toolbar", guid: "toolbar_____", url: null },
  { id: 4, parent: 1, type: 2, position: 2, title: "tags", guid: "tags________", url: null },
  { id: 5, parent: 1, type: 2, position: 3, title: "unfiled", guid: "unfiled_____", url: null },
  { id: 6, parent: 1, type: 2, position: 4, title: "mobile", guid: "mobile______", url: null },
  { id: 10, parent: 3, type: 1, position: 0, title: "MDN", guid: "a", url: "https://developer.mozilla.org/" },
  { id: 11, parent: 3, type: 2, position: 1, title: "", guid: "b", url: null },
  { id: 12, parent: 11, type: 1, position: 0, title: "Example", guid: "c", url: "https://example.com/" },
  { id: 13, parent: 3, type: 3, position: 2, title: "", guid: "d", url: null },
  { id: 14, parent: 3, type: 1, position: 3, title: "Most Visited", guid: "e", url: "place:sort=8&maxResults=10" },
  { id: 20, parent: 2, type: 1, position: 0, title: "Wikipedia", guid: "f", url: "https://www.wikipedia.org/" },
  { id: 30, parent: 4, type: 2, position: 0, title: "reading", guid: "g", url: null },
  { id: 31, parent: 30, type: 1, position: 0, title: "", guid: "h", url: "https://developer.mozilla.org/" },
];

describe("convertFirefoxBookmarkRows", () => {
  it("makes one folder per built-in folder that holds anything, toolbar first, without tags or separators", () => {
    expect(convertFirefoxBookmarkRows(BOOKMARK_ROWS)).toEqual([
      {
        kind: "folder",
        title: "Bookmarks Toolbar",
        children: [
          { kind: "bookmark", title: "MDN", url: "https://developer.mozilla.org/" },
          { kind: "folder", title: "Folder", children: [{ kind: "bookmark", title: "Example", url: "https://example.com/" }] },
        ],
      },
      { kind: "folder", title: "Bookmarks Menu", children: [{ kind: "bookmark", title: "Wikipedia", url: "https://www.wikipedia.org/" }] },
    ]);
  });

  it("gives an empty tree for anything that is not a list of rows", () => {
    expect(convertFirefoxBookmarkRows(null)).toEqual([]);
    expect(convertFirefoxBookmarkRows([{ id: "1" }, 5, "row"])).toEqual([]);
  });

  it("stops at a folder that contains itself", () => {
    const loopRows = [
      { id: 3, parent: 1, type: 2, position: 0, title: "toolbar", guid: "toolbar_____", url: null },
      { id: 7, parent: 7, type: 2, position: 0, title: "Loop", guid: "x", url: null },
      { id: 8, parent: 3, type: 2, position: 0, title: "Holder", guid: "y", url: null },
      { id: 9, parent: 8, type: 1, position: 0, title: "Example", guid: "z", url: "https://example.com/" },
    ];
    expect(convertFirefoxBookmarkRows(loopRows)).toEqual([
      { kind: "folder", title: "Bookmarks Toolbar", children: [{ kind: "folder", title: "Holder", children: [{ kind: "bookmark", title: "Example", url: "https://example.com/" }] }] },
    ]);
  });
});

describe("convertFirefoxHistoryRows", () => {
  it("turns microseconds into milliseconds and keeps only web pages", () => {
    const rows = [
      { url: "https://example.com/", title: "Example", visit_count: 3, last_visit_date: VISIT_MICROSECONDS },
      { url: "https://example.org/", title: null, visit_count: 0, last_visit_date: VISIT_MICROSECONDS },
      { url: "about:config", title: "Config", visit_count: 1, last_visit_date: VISIT_MICROSECONDS },
      { url: "https://example.net/", title: "No date", visit_count: 1, last_visit_date: null },
    ];
    expect(convertFirefoxHistoryRows(rows)).toEqual([
      { url: "https://example.com/", title: "Example", visitCount: 3, lastVisitAt: VISIT_MILLISECONDS },
      { url: "https://example.org/", title: "", visitCount: 1, lastVisitAt: VISIT_MILLISECONDS },
    ]);
  });

  it("gives nothing for anything that is not a list of rows", () => {
    expect(convertFirefoxHistoryRows({ url: "https://example.com/" })).toEqual([]);
  });
});

describe("reading Firefox's files", () => {
  let homeFolder = "";

  beforeEach(() => {
    homeFolder = fs.mkdtempSync(path.join(os.tmpdir(), "firefox-import-test-"));
  });

  afterEach(() => {
    fs.rmSync(homeFolder, { recursive: true, force: true });
  });

  it("finds no profiles when Firefox was never used", () => {
    expect(findFirefoxProfiles(homeFolder)).toEqual([]);
  });

  it("reads bookmarks and history from a profile's places.sqlite", async () => {
    const firefoxFolder = path.join(homeFolder, "Library", "Application Support", "Firefox");
    const profileFolder = path.join(firefoxFolder, "Profiles", "abcd1234.default-release");
    fs.mkdirSync(profileFolder, { recursive: true });
    fs.writeFileSync(path.join(firefoxFolder, "profiles.ini"), PROFILES_INI);
    const sql = `CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, hidden INTEGER, last_visit_date INTEGER);
      CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT);
      INSERT INTO moz_places VALUES (1, 'https://example.com/', 'Example', 2, 0, ${VISIT_MICROSECONDS}),
        (2, 'https://example.org/redirect', 'Redirect', 1, 1, ${VISIT_MICROSECONDS}),
        (3, 'https://example.net/', 'Never visited', 0, 0, NULL);
      INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 0, '', 'root________'), (3, 2, NULL, 1, 0, 'toolbar', 'toolbar_____'),
        (10, 1, 3, 3, 0, 'Not visited yet', 'a'), (11, 1, 1, 3, 1, 'Example', 'b');`;
    execFileSync("/usr/bin/sqlite3", [path.join(profileFolder, "places.sqlite"), sql]);

    const profiles = findFirefoxProfiles(homeFolder);
    expect(profiles.map((profile) => profile.folderName)).toEqual(["abcd1234.default-release"]);
    const profile = profiles[0];
    if (profile === undefined) {
      return;
    }
    expect(await readFirefoxBookmarks(profile)).toEqual([
      {
        kind: "folder",
        title: "Bookmarks Toolbar",
        children: [
          { kind: "bookmark", title: "Not visited yet", url: "https://example.net/" },
          { kind: "bookmark", title: "Example", url: "https://example.com/" },
        ],
      },
    ]);
    expect(await readFirefoxHistory(profile)).toEqual([{ url: "https://example.com/", title: "Example", visitCount: 2, lastVisitAt: VISIT_MILLISECONDS }]);
  });

  it("gives no bookmarks and no history for a damaged database", async () => {
    const profileFolder = path.join(homeFolder, "broken-profile");
    fs.mkdirSync(profileFolder, { recursive: true });
    fs.writeFileSync(path.join(profileFolder, "places.sqlite"), "not a database");
    const profile = { folderName: "broken-profile", displayName: "broken", profileFolder: profileFolder, isDefault: true };
    expect(await readFirefoxBookmarks(profile)).toEqual([]);
    expect(await readFirefoxHistory(profile)).toEqual([]);
  });
});
