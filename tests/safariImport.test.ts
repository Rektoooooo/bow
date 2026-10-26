/**
 * WHY this file exists:
 *   Safari's files are property lists and a SQLite database in a folder macOS may block. These tests pin down the
 *   plist reader, the bookmark tree, the history conversion and the "needs Full Disk Access" result.
 *
 * Data source:
 *   A plist and rows written by hand below, plus a throwaway SQLite database made with /usr/bin/sqlite3. No real
 *   Safari data.
 *
 * Data flow:
 *   XML text → parseXmlPropertyList() → parseSafariBookmarks(); rows → convertSafariHistoryRows();
 *   fake home → readSafariBookmarks() / readSafariHistory()
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  convertSafariHistoryRows,
  isPermissionDenied,
  parseSafariBookmarks,
  parseXmlPropertyList,
  readSafariBookmarks,
  readSafariHistory,
} from "../src/main/safariImport";

/** 2026-10-26 13:00 UTC as seconds since 2001-01-01 (Unix 1792242000 − 978307200). */
const VISIT_APPLE_SECONDS = 813934800;
const VISIT_UNIX_MILLISECONDS = 1792242000000;

const PLIST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WebBookmarkType</key><string>WebBookmarkTypeList</string>
  <key>Title</key><string></string>
  <key>Children</key>
  <array>
    <dict><key>WebBookmarkType</key><string>WebBookmarkTypeProxy</string><key>Title</key><string>History</string></dict>
    <dict>
      <key>WebBookmarkType</key><string>WebBookmarkTypeList</string>
      <key>Title</key><string>BookmarksBar</string>
      <key>Children</key>
      <array>
        <dict>
          <key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string>
          <key>URLString</key><string>https://example.com/?a=1&amp;b=2</string>
          <key>URIDictionary</key><dict><key>title</key><string>Tom &amp; Jerry</string></dict>
        </dict>
        <dict>
          <key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string>
          <key>URLString</key><string>javascript:void(0)</string>
          <key>URIDictionary</key><dict><key>title</key><string>Bad</string></dict>
        </dict>
        <dict>
          <key>WebBookmarkType</key><string>WebBookmarkTypeList</string>
          <key>Title</key><string>Wiki</string>
          <key>Children</key>
          <array>
            <dict>
              <key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string>
              <key>URLString</key><string>https://en.wikipedia.org/</string>
              <key>URIDictionary</key><dict><key>title</key><string>Wikipedia</string></dict>
            </dict>
          </array>
        </dict>
      </array>
    </dict>
    <dict>
      <key>WebBookmarkType</key><string>WebBookmarkTypeList</string>
      <key>Title</key><string>com.apple.ReadingList</string>
      <key>Children</key>
      <array>
        <dict>
          <key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string>
          <key>URLString</key><string>https://example.net/article</string>
          <key>URIDictionary</key><dict><key>title</key><string>Article</string></dict>
          <key>ReadingList</key><dict><key>DateAdded</key><date>2026-10-01T10:00:00Z</date><key>PreviewText</key><data>AAEC</data></dict>
        </dict>
      </array>
    </dict>
  </array>
  <key>Count</key><integer>3</integer>
  <key>Flag</key><true/>
  <key>EmptyList</key><array/>
</dict>
</plist>`;

let homeFolder = "";

beforeEach(() => {
  homeFolder = fs.mkdtempSync(path.join(os.tmpdir(), "safari-import-test-"));
});

afterEach(() => {
  fs.rmSync(homeFolder, { recursive: true, force: true });
});

describe("parseXmlPropertyList", () => {
  it("reads dictionaries, arrays, scalars, dates and data", () => {
    const parsed = parseXmlPropertyList(PLIST_XML) as Record<string, unknown>;
    expect(parsed["Count"]).toBe(3);
    expect(parsed["Flag"]).toBe(true);
    expect(parsed["EmptyList"]).toEqual([]);
    expect(Array.isArray(parsed["Children"])).toBe(true);
  });

  it("returns null for text that is not a property list", () => {
    expect(parseXmlPropertyList("hello")).toBeNull();
  });
});

describe("parseSafariBookmarks", () => {
  it("builds the tree, renames built-in lists and separates the Reading List", () => {
    const result = parseSafariBookmarks(parseXmlPropertyList(PLIST_XML));
    expect(result.bookmarks).toEqual([
      {
        kind: "folder",
        title: "Favorites",
        children: [
          { kind: "bookmark", title: "Tom & Jerry", url: "https://example.com/?a=1&b=2" },
          { kind: "folder", title: "Wiki", children: [{ kind: "bookmark", title: "Wikipedia", url: "https://en.wikipedia.org/" }] },
        ],
      },
    ]);
    expect(result.readingList).toEqual([{ kind: "bookmark", title: "Article", url: "https://example.net/article" }]);
  });

  it("returns empty results for unknown shapes", () => {
    expect(parseSafariBookmarks(null)).toEqual({ bookmarks: [], readingList: [] });
    expect(parseSafariBookmarks({ Children: "no" })).toEqual({ bookmarks: [], readingList: [] });
    expect(parseSafariBookmarks({ Children: [1, null, { WebBookmarkType: "Other" }] })).toEqual({ bookmarks: [], readingList: [] });
  });
});

describe("convertSafariHistoryRows", () => {
  it("converts seconds since 2001 into Unix milliseconds and filters rows", () => {
    const rows = [
      { url: "https://example.com/", title: "Example", visit_count: 2, visit_time: VISIT_APPLE_SECONDS },
      { url: "file:///tmp/a", title: "File", visit_count: 1, visit_time: VISIT_APPLE_SECONDS },
      { url: "https://example.org/", title: null, visit_count: 1, visit_time: VISIT_APPLE_SECONDS },
      { url: "https://example.net/", title: "x", visit_count: "many", visit_time: 1 },
      null,
    ];
    expect(convertSafariHistoryRows(rows)).toEqual([
      { url: "https://example.com/", title: "Example", visitCount: 2, lastVisitAt: VISIT_UNIX_MILLISECONDS },
      { url: "https://example.org/", title: "", visitCount: 1, lastVisitAt: VISIT_UNIX_MILLISECONDS },
    ]);
    expect(convertSafariHistoryRows({})).toEqual([]);
  });
});

describe("isPermissionDenied", () => {
  it("recognises Node error codes and tool messages", () => {
    expect(isPermissionDenied(Object.assign(new Error("x"), { code: "EPERM" }))).toBe(true);
    expect(isPermissionDenied(Object.assign(new Error("x"), { code: "EACCES" }))).toBe(true);
    expect(isPermissionDenied(Object.assign(new Error("failed"), { stderr: "Error: Operation not permitted" }))).toBe(true);
    expect(isPermissionDenied(new Error("The file couldn’t be opened because you don’t have permission to view it."))).toBe(true);
    expect(isPermissionDenied(new Error("boom"))).toBe(false);
    expect(isPermissionDenied(null)).toBe(false);
  });
});

describe("reading Safari's files", () => {
  it("reports notFound when Safari has no files", async () => {
    expect(await readSafariBookmarks(homeFolder)).toEqual({ ok: false, reason: "notFound" });
    expect(await readSafariHistory(homeFolder)).toEqual({ ok: false, reason: "notFound" });
  });

  it("reads a real plist through plutil, including dates and data", async () => {
    const safariFolder = path.join(homeFolder, "Library", "Safari");
    fs.mkdirSync(safariFolder, { recursive: true });
    const xmlPath = path.join(safariFolder, "source.xml");
    fs.writeFileSync(xmlPath, PLIST_XML);
    execFileSync("/usr/bin/plutil", ["-convert", "binary1", "-o", path.join(safariFolder, "Bookmarks.plist"), xmlPath]);
    const result = await readSafariBookmarks(homeFolder);
    expect(result.ok && result.value.readingList).toHaveLength(1);
    expect(result.ok && result.value.bookmarks).toHaveLength(1);
  });

  it("reads history from a database with Safari's tables", async () => {
    const safariFolder = path.join(homeFolder, "Library", "Safari");
    fs.mkdirSync(safariFolder, { recursive: true });
    const sql = `CREATE TABLE history_items (id INTEGER PRIMARY KEY, url TEXT);
      CREATE TABLE history_visits (id INTEGER PRIMARY KEY, history_item INTEGER, visit_time REAL, title TEXT);
      INSERT INTO history_items VALUES (1, 'https://example.com/'), (2, 'https://example.org/'), (3, 'ftp://example.net/');
      INSERT INTO history_visits VALUES (1, 1, 100, 'Old'), (2, 1, ${VISIT_APPLE_SECONDS}, 'New'), (3, 2, 200, 'Other'), (4, 3, 300, 'Ftp');`;
    execFileSync("/usr/bin/sqlite3", [path.join(safariFolder, "History.db"), sql]);
    const result = await readSafariHistory(homeFolder);
    expect(result).toEqual({
      ok: true,
      value: [
        { url: "https://example.com/", title: "New", visitCount: 2, lastVisitAt: VISIT_UNIX_MILLISECONDS },
        { url: "https://example.org/", title: "Other", visitCount: 1, lastVisitAt: (200 + 978307200) * 1000 },
      ],
    });
  });
});
