// WHY this file exists:
//   The onboarding imports for real: it reads a browser's files first, counts them, then brings the chosen parts
//   over. The e2e checks need something to read that is not the user's own browsers, so this builds a stand-in home
//   folder with made-up data where Bow looks for it: Google Chrome with one profile (bookmarks and history), Dia with
//   four spaces (each a profile, as Dia keeps them), and Arc (a sidebar with two Spaces, Favorites and Pinned tabs,
//   and a history). The app is started with
//   --import-home=<this folder> (src/main/importHome.ts).
//
// Data source:
//   Invented sites on example.com / example.org / example.net (reserved for examples). No real browser data.
//   The file shapes follow docs/research/arc-data-model.md and Chromium's Bookmarks / History formats.
//
// Data flow:
//   check-onboarding.mjs / check-app.mjs → createImportHome(folder) → files under folder/Library/Application Support
//   → the app (--import-home=folder) → listImportSources() / findArcSidebarFile() → the onboarding's browser tiles
//   and File › Import From Browser
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** Microseconds between 1601-01-01 (Chromium's clock) and 1970-01-01. */
const CHROMIUM_EPOCH_OFFSET_MICROSECONDS = 11644473600000000;

/** What the stand-in holds, so the checks know what to expect. */
export const IMPORT_HOME_COUNTS = {
  arc: { spaces: 2, tabs: 4, favorites: 4, history: 30 },
  chromeDefault: { bookmarks: 5, history: 12 },
  // Dia's spaces, in Dia's profile order (Default, Profile 1, …): name, bookmarks, history.
  diaSpaces: [
    { folder: "Default", name: "Personal", bookmarks: 3, history: 8 },
    { folder: "Profile 1", name: "Work", bookmarks: 2, history: 5 },
    { folder: "Profile 2", name: "School", bookmarks: 1, history: 0 },
    { folder: "Profile 3", name: "Side project", bookmarks: 2, history: 3 },
  ],
};

/**
 * Writes a Chromium-style History database with `count` visited pages on one site.
 */
function writeHistoryDatabase(databasePath, siteName, count) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.rmSync(databasePath, { force: true });
  const nowMicroseconds = Date.now() * 1000 + CHROMIUM_EPOCH_OFFSET_MICROSECONDS;
  const rows = [];
  for (let index = 0; index < count; index++) {
    const visitedAt = nowMicroseconds - index * 60_000_000;
    rows.push(`(${index + 1}, 'https://${siteName}/page-${index + 1}', 'Page ${index + 1}', ${index + 1}, 0, ${visitedAt}, 0)`);
  }
  const statements = [
    "CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER DEFAULT 0);",
  ];
  if (rows.length > 0) {
    statements.push(`INSERT INTO urls VALUES ${rows.join(", ")};`);
  }
  execFileSync("/usr/bin/sqlite3", [databasePath, statements.join("\n")]);
}

/**
 * A Chromium Bookmarks file with these bookmarks on the bookmarks bar.
 */
function writeBookmarks(filePath, bookmarks) {
  const children = bookmarks.map((bookmark, index) => ({ id: String(index + 10), type: "url", name: bookmark.name, url: bookmark.url }));
  const file = {
    version: 1,
    roots: {
      bookmark_bar: { id: "1", type: "folder", name: "Bookmarks bar", children: children },
      other: { id: "2", type: "folder", name: "Other bookmarks", children: [] },
      synced: { id: "3", type: "folder", name: "Mobile bookmarks", children: [] },
    },
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(file));
}

/** One Arc item, as Arc stores it (id, title, children, data). */
function arcTab(id, title, url) {
  return [id, { id: id, title: null, childrenIds: [], data: { tab: { savedTitle: title, savedURL: url } } }];
}

function arcFolder(id, title, childrenIds) {
  return [id, { id: id, title: title, childrenIds: childrenIds, data: { list: {} } }];
}

function arcContainer(id, childrenIds) {
  return [id, { id: id, title: null, childrenIds: childrenIds, data: { itemContainer: {} } }];
}

/** A Space whose theme is one color (Arc's numbers are 0…1). */
function arcSpace(id, title, red, green, blue) {
  const themeColor = { red: red, green: green, blue: blue, alpha: 1, colorSpace: "extendedSRGB" };
  const windowTheme = {
    background: { single: { _0: { style: { color: { _0: { blendedSingleColor: { _0: { color: themeColor } } } }, modifiers: { noiseFactor: 0.2 } }, contentOverBackgroundAppearance: "light" } } },
  };
  return [id, { id: id, title: title, profile: { default: true }, customInfo: { windowTheme: windowTheme }, containerIDs: ["unpinned", `${id}-today`, "pinned", `${id}-pinned`] }];
}

/**
 * Writes Arc's StorableSidebar.json: two Spaces with Pinned and Today tabs, and four Favorites.
 */
function writeArcSidebar(filePath) {
  const items = [
    arcTab("fav-1", "Mail", "https://mail.example.com/"),
    arcTab("fav-2", "Calendar", "https://calendar.example.com/"),
    arcTab("fav-3", "Music", "https://music.example.org/"),
    arcTab("fav-4", "Notes", "https://notes.example.net/"),
    arcContainer("favorites", ["fav-1", "fav-2", "fav-3", "fav-4"]),
    arcTab("studio-roadmap", "Roadmap", "https://plans.example.com/roadmap"),
    arcFolder("studio-projects", "Projects", ["studio-roadmap"]),
    arcTab("studio-review", "Design review", "https://design.example.com/review"),
    arcContainer("studio-pinned", ["studio-projects", "studio-review"]),
    arcTab("studio-weather", "Weather", "https://weather.example.org/"),
    arcContainer("studio-today", ["studio-weather"]),
    arcTab("home-recipes", "Recipes", "https://recipes.example.net/"),
    arcContainer("home-pinned", ["home-recipes"]),
    arcContainer("home-today", []),
  ];
  const spaces = [arcSpace("studio", "Studio", 0.55, 0.42, 0.85), arcSpace("home", "Home", 0.35, 0.62, 0.5)];
  const file = {
    version: 1,
    sidebar: {
      containers: [
        { global: {} },
        {
          spaces: spaces.flat(),
          items: items.flat(),
          topAppsContainerIDs: [{ default: true }, "favorites"],
        },
      ],
    },
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(file));
}

/**
 * Builds the stand-in home folder (wiping an earlier one) and returns its path.
 */
export function createImportHome(folder) {
  fs.rmSync(folder, { recursive: true, force: true });
  const applicationSupport = path.join(folder, "Library", "Application Support");
  const chromeFolder = path.join(applicationSupport, "Google", "Chrome");
  writeBookmarks(path.join(chromeFolder, "Default", "Bookmarks"), [
    { name: "Docs", url: "https://docs.example.com/" },
    { name: "News", url: "https://news.example.org/" },
    { name: "Shop", url: "https://shop.example.net/" },
    { name: "Maps", url: "https://maps.example.com/" },
    { name: "Wiki", url: "https://wiki.example.org/" },
  ]);
  writeHistoryDatabase(path.join(chromeFolder, "Default", "History"), "chrome.example.com", IMPORT_HOME_COUNTS.chromeDefault.history);
  const localState = { profile: { info_cache: { Default: { name: "Personal" } } } };
  fs.writeFileSync(path.join(chromeFolder, "Local State"), JSON.stringify(localState));
  // Dia: each space is a Chromium profile in "Dia/User Data", named in its Local State.
  const diaFolder = path.join(applicationSupport, "Dia", "User Data");
  const diaInfoCache = {};
  for (const space of IMPORT_HOME_COUNTS.diaSpaces) {
    const site = space.name.toLowerCase().replace(" ", "");
    const bookmarks = Array.from({ length: space.bookmarks }, (_unused, index) => ({ name: `${space.name} ${index + 1}`, url: `https://${site}.example.org/page-${index + 1}` }));
    writeBookmarks(path.join(diaFolder, space.folder, "Bookmarks"), bookmarks);
    writeHistoryDatabase(path.join(diaFolder, space.folder, "History"), `dia-${site}.example.net`, space.history);
    diaInfoCache[space.folder] = { name: space.name };
  }
  fs.writeFileSync(path.join(diaFolder, "Local State"), JSON.stringify({ profile: { info_cache: diaInfoCache } }));
  const arcFolderPath = path.join(applicationSupport, "Arc");
  writeArcSidebar(path.join(arcFolderPath, "StorableSidebar.json"));
  writeHistoryDatabase(path.join(arcFolderPath, "User Data", "Default", "History"), "arc.example.org", IMPORT_HOME_COUNTS.arc.history);
  return folder;
}
