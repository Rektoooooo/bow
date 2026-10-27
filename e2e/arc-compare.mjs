// WHY this file exists:
//   The look is meant to match Arc 1:1. This script renders our window at the size of the user's Arc screenshots
//   (reference/arc-ui, git-ignored) with a made-up sidebar of the same shape, and writes side-by-side crops
//   (Arc left, ours right) of the parts that matter, so differences are visible at a glance.
// Data source: reference/arc-ui/1.webp (sidebar + toolbar), 3.webp (Command Bar), 4.webp (Control Center) and
//   5.webp (a site in Developer Mode): a 1888 × 1032 pt window,
//   captured at 1 px per point with macOS's window shadow around it (window at 56, 38 in the image).
// Data flow: sample state → app at 1888 × 1032 → captureWindow() → crops → e2e/output/arc-compare/*.png
// usage: npm run build && node e2e/arc-compare.mjs   (needs the reference screenshots; they are never committed)
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { captureWindow } from "./composite.mjs";

const appDir = path.resolve(import.meta.dirname, "..");
const referenceDir = path.join(appDir, "reference", "arc-ui");
const outDir = path.join(appDir, "e2e", "output", "arc-compare");
const userDataDir = path.join(appDir, "e2e", "output", "user-data-compare");

/** The Arc window inside the reference images (measured from their alpha channel). */
const REFERENCE_WINDOW = { x: 56, y: 38, width: 1888, height: 1032 };

/** The parts compared, in window points. Small parts are shown larger. */
const REGIONS = [
  { name: "1-sidebar-top", shot: 1, x: 0, y: 0, width: 320, height: 360, zoom: 2 },
  { name: "1-sidebar-bottom", shot: 1, x: 0, y: 962, width: 320, height: 70, zoom: 2 },
  { name: "1-toolbar-left", shot: 1, x: 240, y: 0, width: 420, height: 90, zoom: 2 },
  { name: "1-toolbar-middle", shot: 1, x: 840, y: 0, width: 440, height: 70, zoom: 2 },
  { name: "1-toolbar-right", shot: 1, x: 1660, y: 0, width: 228, height: 90, zoom: 2 },
  { name: "1-card-bottom", shot: 1, x: 220, y: 952, width: 300, height: 80, zoom: 2 },
  { name: "3-command-bar", shot: 3, x: 540, y: 330, width: 810, height: 360, zoom: 1 },
  { name: "4-control-center", shot: 4, x: 1630, y: 36, width: 258, height: 480, zoom: 2 },
  { name: "4-sidebar-top", shot: 4, x: 0, y: 90, width: 300, height: 330, zoom: 2 },
  { name: "4-sidebar-bottom", shot: 4, x: 0, y: 690, width: 300, height: 330, zoom: 2 },
  { name: "5-toolbar-left", shot: 5, x: 0, y: 0, width: 560, height: 60, zoom: 2 },
  { name: "5-toolbar-right", shot: 5, x: 1560, y: 0, width: 328, height: 60, zoom: 2 },
];

if (!fs.existsSync(path.join(referenceDir, "1.webp"))) {
  console.log("No reference screenshots in reference/arc-ui; nothing to compare.");
  process.exit(0);
}
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const now = Date.now();
function tab(id, url, title, homeUrl = null) {
  return { kind: "tab", id, url, title, customTitle: null, faviconUrl: null, homeUrl, lastActiveAt: now, isMuted: false };
}
// Same shape as the reference (four Favorites, two folders, one Today tab), public sites only. The first folder
// holds as many rows as the user's, for shot 4 (opened there, its second child selected).
const READING_SITES = [
  ["mdn", "https://developer.mozilla.org/", "MDN Web Docs"],
  ["hn", "https://news.ycombinator.com/", "Hacker News"],
  ["ars", "https://arstechnica.com/", "Ars Technica"],
  ["wiki-browser", "https://en.wikipedia.org/wiki/Web_browser", "Web browser - Wikipedia"],
  ["node", "https://nodejs.org/", "Node.js"],
  ["typescript", "https://www.typescriptlang.org/", "TypeScript"],
  ["rust", "https://www.rust-lang.org/", "Rust Programming Language"],
  ["python", "https://www.python.org/", "Welcome to Python.org"],
  ["w3c", "https://www.w3.org/", "W3C"],
  ["webkit", "https://webkit.org/", "WebKit"],
  ["chromium", "https://www.chromium.org/", "The Chromium Projects"],
  ["mozilla", "https://www.mozilla.org/", "Mozilla"],
  ["kernel", "https://www.kernel.org/", "The Linux Kernel Archives"],
  ["gnu", "https://www.gnu.org/", "GNU Project"],
  ["debian", "https://www.debian.org/", "Debian"],
  ["sqlite", "https://www.sqlite.org/", "SQLite Home Page"],
  ["vim", "https://www.vim.org/", "welcome home : vim online"],
];
const readingChildren = Object.fromEntries(READING_SITES.map(([key, url, title]) => [`pin-${key}`, tab(`pin-${key}`, url, title, url)]));
const items = {
  ...readingChildren,
  "fav-wikipedia": tab("fav-wikipedia", "https://www.wikipedia.org/", "Wikipedia", "https://www.wikipedia.org/"),
  "fav-github": tab("fav-github", "https://github.com/", "GitHub", "https://github.com/"),
  "fav-youtube": tab("fav-youtube", "https://www.youtube.com/", "YouTube", "https://www.youtube.com/"),
  "fav-duckduckgo": tab("fav-duckduckgo", "https://duckduckgo.com/", "DuckDuckGo", "https://duckduckgo.com/"),
  "folder-reading": { kind: "folder", id: "folder-reading", title: "Reading List", childIds: Object.keys(readingChildren), isOpen: false },
  // Like the user's second folder: a closed GitHub live folder (Arc draws GitHub's mark on it).
  "folder-projects": { kind: "folder", id: "folder-projects", title: "Pull Requests", childIds: [], isOpen: false, live: { source: { kind: "github", list: "pullRequests" }, hiddenUrls: [] } },
  "pin-electron": tab("pin-electron", "https://www.electronjs.org/", "Electron", "https://www.electronjs.org/"),
  "today-search": tab("today-search", "https://duckduckgo.com/", "DuckDuckGo"),
  "today-mdn": tab("today-mdn", "https://developer.mozilla.org/", "MDN Web Docs"),
  "today-wikipedia": tab("today-wikipedia", "https://en.wikipedia.org/wiki/Web_browser", "Web browser - Wikipedia"),
};
const sampleState = {
  version: 2,
  items,
  profiles: [{ id: "profile-default", name: "Default", favoriteIds: ["fav-wikipedia", "fav-github", "fav-youtube", "fav-duckduckgo"] }],
  spaces: [
    { id: "space-main", name: "Main", icon: "✦", theme: { colors: ["#000000"], appearance: "dark", grain: 0, intensity: 1 }, profileId: "profile-default", pinnedIds: ["folder-reading", "folder-projects"], todayIds: ["today-search"], isPinnedOpen: true },
    { id: "space-work", name: "Work", icon: "💼", theme: { colors: ["#000000"], appearance: "auto", grain: 0 }, profileId: "profile-default", pinnedIds: [], todayIds: ["today-mdn"], isPinnedOpen: true },
    { id: "space-side", name: "Side", icon: "🚀", theme: { colors: ["#000000"], appearance: "auto", grain: 0 }, profileId: "profile-default", pinnedIds: [], todayIds: ["today-wikipedia"], isPinnedOpen: true },
  ],
  activeSpaceId: "space-main",
  selectedTabIdBySpace: { "space-main": "today-search", "space-work": "today-mdn", "space-side": "today-wikipedia" },
  archive: [],
  settings: { archiveAfterMs: 43200000, isSidebarVisible: true },
};
fs.writeFileSync(path.join(userDataDir, "browser-state.json"), JSON.stringify(sampleState));

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir],
  colorScheme: "dark",
  timeout: 30000,
});
let sidebar;
while (!sidebar) {
  sidebar = app.windows().find((page) => page.url().endsWith("/renderer/index.html"));
  if (!sidebar) await new Promise((resolve) => setTimeout(resolve, 200));
}
await sidebar.waitForSelector(".space-title");
await app.evaluate(({ BrowserWindow }, size) => {
  const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  win.setContentSize(size.width, size.height);
}, REFERENCE_WINDOW);
// Give the page, the favicons and the toolbar color time to arrive.
await sidebar.waitForTimeout(7000);
const ours = { 1: await captureWindow(app) };
// Where our elements are, to compare with the measurements in the crops.
const layout = await sidebar.evaluate(() => {
  const selectors = [".header-button", ".favorite-tile", ".space-title", ".space-title-name", ".folder-row", ".folder-row .row-title", ".today-divider .divider-line", ".new-tab-row", ".new-tab-row .row-title", ".new-tab-row .icon", ".tab-row.is-selected", ".tab-row.is-selected .row-title", ".bottom-bar button", ".bottom-bar .icon", ".toolbar-button", ".toolbar-button .icon", ".address-pill", "#card"];
  const result = {};
  for (const selector of selectors) {
    result[selector] = [...document.querySelectorAll(selector)].map((element) => {
      const box = element.getBoundingClientRect();
      return [box.x, box.y, box.width, box.height].map((value) => Math.round(value * 10) / 10).join(" ");
    });
  }
  return result;
});
fs.writeFileSync(path.join(outDir, "layout.json"), JSON.stringify(layout, null, 1));

const overlay = app.windows().find((page) => page.url().endsWith("/overlay/overlay.html"));
await sidebar.evaluate(() => window.browserApi.dispatch({ type: "openCommandBar", mode: "newTab" }));
await overlay.waitForSelector(".command-line", { timeout: 5000 }).catch(() => undefined);
await overlay.mouse.move(0, 0);
await overlay.waitForTimeout(1500);
ours[3] = await captureWindow(app);
await overlay.keyboard.press("Escape");
await sidebar.waitForTimeout(500);
await sidebar.evaluate(async () => {
  await window.browserApi.dispatch({ type: "toggleFolder", folderId: "folder-reading" });
  await window.browserApi.dispatch({ type: "selectTab", tabId: "pin-hn" });
});
await sidebar.waitForTimeout(2500);
await sidebar.evaluate(() => window.browserApi.dispatch({ type: "openSiteControls" }));
await overlay.waitForSelector(".control-center", { timeout: 5000 }).catch(() => undefined);
await overlay.mouse.move(0, 0);
await overlay.waitForTimeout(800);
ours[4] = await captureWindow(app);
await overlay.keyboard.press("Escape");
await sidebar.waitForTimeout(300);
await sidebar.evaluate(() => window.browserApi.dispatch({ type: "setDeveloperMode", site: "ycombinator.com", isOn: true }));
await sidebar.waitForTimeout(1200);
ours[5] = await captureWindow(app);

// Crop and pair with the helper window's canvas (the app's own renderer decodes WebP and PNG).
const pairs = await app.evaluate(async ({ BrowserWindow }, job) => {
  const helper = new BrowserWindow({ show: false, width: 400, height: 300 });
  await helper.loadURL("about:blank");
  const script = `(async () => {
    const job = ${JSON.stringify(job)};
    const load = (src) => new Promise((resolve) => { const image = new Image(); image.onload = () => resolve(image); image.src = src; });
    const results = [];
    for (const region of job.regions) {
      const reference = await load(job.references[region.shot]);
      const ours = await load(job.ours[region.shot]);
      const ourScale = ours.width / job.window.width;
      const gap = 12;
      const width = region.width * region.zoom;
      const height = region.height * region.zoom;
      const canvas = document.createElement("canvas");
      canvas.width = width * 2 + gap;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.imageSmoothingEnabled = false;
      context.fillStyle = "#ff00ff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(reference, job.window.x + region.x, job.window.y + region.y, region.width, region.height, 0, 0, width, height);
      context.drawImage(ours, region.x * ourScale, region.y * ourScale, region.width * ourScale, region.height * ourScale, width + gap, 0, width, height);
      results.push({ name: region.name, png: canvas.toDataURL("image/png").split(",")[1] });
    }
    return results;
  })()`;
  const result = await helper.webContents.executeJavaScript(script);
  helper.destroy();
  return result;
}, {
  regions: REGIONS,
  window: REFERENCE_WINDOW,
  references: {
    1: `data:image/webp;base64,${fs.readFileSync(path.join(referenceDir, "1.webp")).toString("base64")}`,
    3: `data:image/webp;base64,${fs.readFileSync(path.join(referenceDir, "3.webp")).toString("base64")}`,
    4: `data:image/webp;base64,${fs.readFileSync(path.join(referenceDir, "4.webp")).toString("base64")}`,
    5: `data:image/webp;base64,${fs.readFileSync(path.join(referenceDir, "5.webp")).toString("base64")}`,
  },
  ours: {
    1: `data:image/png;base64,${ours[1].toString("base64")}`,
    3: `data:image/png;base64,${ours[3].toString("base64")}`,
    4: `data:image/png;base64,${ours[4].toString("base64")}`,
    5: `data:image/png;base64,${ours[5].toString("base64")}`,
  },
});

fs.writeFileSync(path.join(outDir, "ours-1.png"), ours[1]);
fs.writeFileSync(path.join(outDir, "ours-3.png"), ours[3]);
fs.writeFileSync(path.join(outDir, "ours-4.png"), ours[4]);
fs.writeFileSync(path.join(outDir, "ours-5.png"), ours[5]);
for (const pair of pairs) {
  fs.writeFileSync(path.join(outDir, `${pair.name}.png`), Buffer.from(pair.png, "base64"));
}
console.log(`Wrote ${pairs.length} side-by-side crops (Arc left, ours right) to ${outDir}`);

await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
