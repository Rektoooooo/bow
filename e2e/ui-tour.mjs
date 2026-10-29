// Takes the README screenshots from a made-up sample sidebar (public sites only, never the user's data), at 2x so
// they stay sharp on Retina screens:
//   docs/screenshot-dark.png         the window in a dark Space
//   docs/screenshot-command-bar.png  the same window with the Command Bar open
//   docs/screenshot-split.png        two tabs side by side in a split view
//   docs/screenshot-spaces.png       Library › Spaces: every Space as a column
//   docs/screenshot-light.png        a light Space
// Window and page views are composited at their real bounds (screen recording permission is not needed).
// usage: npm run build && node e2e/window-shot.mjs
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { captureWindow } from "./composite.mjs";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-tour");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });

const now = Date.now();
function tab(id, url, title, homeUrl = null) {
  return { kind: "tab", id, url, title, customTitle: null, faviconUrl: null, homeUrl, lastActiveAt: now, isMuted: false };
}
const items = {
  "fav-wikipedia": tab("fav-wikipedia", "https://www.wikipedia.org/", "Wikipedia", "https://www.wikipedia.org/"),
  "fav-github": tab("fav-github", "https://github.com/", "GitHub", "https://github.com/"),
  "fav-youtube": tab("fav-youtube", "https://www.youtube.com/", "YouTube", "https://www.youtube.com/"),
  "fav-duckduckgo": tab("fav-duckduckgo", "https://duckduckgo.com/", "DuckDuckGo", "https://duckduckgo.com/"),
  // Work has its own Favorites row (Favorites belong to the Space).
  "work-fav-apple": tab("work-fav-apple", "https://developer.apple.com/", "Apple Developer", "https://developer.apple.com/"),
  "work-fav-notion": tab("work-fav-notion", "https://www.notion.so/", "Notion", "https://www.notion.so/"),
  "work-fav-figma": tab("work-fav-figma", "https://www.figma.com/", "Figma", "https://www.figma.com/"),
  "folder-reading": { kind: "folder", id: "folder-reading", title: "Reading", childIds: ["pin-mdn", "pin-hn", "pin-ars"], isOpen: true },
  "pin-mdn": tab("pin-mdn", "https://developer.mozilla.org/", "MDN Web Docs", "https://developer.mozilla.org/"),
  "pin-hn": tab("pin-hn", "https://news.ycombinator.com/", "Hacker News", "https://news.ycombinator.com/"),
  "pin-ars": tab("pin-ars", "https://arstechnica.com/", "Ars Technica", "https://arstechnica.com/"),
  "pin-electron": tab("pin-electron", "https://www.electronjs.org/", "Electron", "https://www.electronjs.org/"),
  "today-browser": tab("today-browser", "https://en.wikipedia.org/wiki/Web_browser", "Web browser - Wikipedia"),
  "today-hypertext": tab("today-hypertext", "https://en.wikipedia.org/wiki/Hypertext", "Hypertext - Wikipedia"),
  "today-example": tab("today-example", "https://example.com/", "Example Domain"),
  "split-docs": { kind: "split", id: "split-docs", childIds: ["split-mdn", "split-electron"], orientation: "horizontal" },
  "split-mdn": tab("split-mdn", "https://developer.mozilla.org/en-US/docs/Web/HTML", "HTML: HyperText Markup Language | MDN"),
  "split-electron": tab("split-electron", "https://www.electronjs.org/docs/latest", "Electron Docs"),
  "work-apple": tab("work-apple", "https://developer.apple.com/", "Apple Developer", "https://developer.apple.com/"),
  "work-w3c": tab("work-w3c", "https://www.w3.org/", "W3C", "https://www.w3.org/"),
  "work-article": tab("work-article", "https://en.wikipedia.org/wiki/Typography", "Typography - Wikipedia"),
  "side-node": tab("side-node", "https://nodejs.org/", "Node.js", "https://nodejs.org/"),
  "side-ts": tab("side-ts", "https://www.typescriptlang.org/", "TypeScript", "https://www.typescriptlang.org/"),
};
const sampleState = {
  version: 5,
  items: items,
  profiles: [{ id: "profile-default", name: "Default" }],
  spaces: [
    { id: "space-personal", name: "Personal", icon: "🏠", theme: { colors: ["#1f2b47", "#2e2147"], appearance: "dark", grain: 0.35 }, profileId: "profile-default", favoriteIds: ["fav-wikipedia", "fav-github", "fav-youtube", "fav-duckduckgo"], pinnedIds: ["folder-reading", "pin-electron"], todayIds: ["today-browser", "today-hypertext", "today-example", "split-docs"], isPinnedOpen: true },
    { id: "space-work", name: "Work", icon: "💼", theme: { colors: ["#cfe0f4"], appearance: "light", grain: 0 }, profileId: "profile-default", favoriteIds: ["work-fav-apple", "work-fav-notion", "work-fav-figma"], pinnedIds: ["work-apple", "work-w3c"], todayIds: ["work-article"], isPinnedOpen: true },
    { id: "space-side", name: "Side project", icon: "🚀", theme: { colors: ["#cdeadb", "#c2e3e8"], appearance: "light", grain: 0 }, profileId: "profile-default", favoriteIds: [], pinnedIds: ["side-node", "side-ts"], todayIds: [], isPinnedOpen: true },
  ],
  activeSpaceId: "space-personal",
  selectedTabIdBySpace: { "space-personal": "today-browser", "space-work": "work-article", "space-side": null },
  focusedWindowId: "window-1",
  otherWindows: [],
  archive: [],
  settings: { archiveAfterMs: 43200000, isSidebarVisible: true },
};
fs.writeFileSync(path.join(userDataDir, "browser-state.json"), JSON.stringify(sampleState));

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  // 2x: README images stay sharp on Retina screens whatever this Mac's display is.
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
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html")).setContentSize(1440, 900));
// Give the page and the favicons time to load.
await sidebar.waitForTimeout(6000);
const dispatch = (action) => sidebar.evaluate((value) => window.browserApi.dispatch(value), action);

const tourDir = path.join(outDir, "tour");
fs.mkdirSync(tourDir, { recursive: true });
async function compositeShot(fileName) {
  const filePath = path.join(tourDir, fileName);
  fs.writeFileSync(filePath, await captureWindow(app));
  console.log("saved", filePath);
}


const overlay = app.windows().find((page) => page.url().endsWith("/overlay/overlay.html"));
const settle = (ms) => sidebar.waitForTimeout(ms);
await compositeShot("01-dark-window.png");
await dispatch({ type: "openCommandBar", mode: "newTab" });
await overlay.waitForSelector(".command-input");
await settle(600);
await compositeShot("02-command-bar-empty.png");
await overlay.fill(".command-input", "git");
await settle(1500);
await compositeShot("03-command-bar-query.png");
await overlay.press(".command-input", "Escape");
await settle(400);
await dispatch({ type: "openSiteControls" });
await settle(900);
await compositeShot("04-control-center.png");
await overlay.press("body", "Escape");
await settle(400);
for (const section of ["media", "downloads", "spaces", "boosts", "archive", "history", "extensions", "settings"]) {
  await dispatch({ type: "openLibrary" });
  await overlay.waitForSelector(".library").catch(() => undefined);
  await overlay.click(`.library-tab[data-section='${section}']`).catch(() => undefined);
  await settle(900);
  await compositeShot(`05-library-${section}.png`);
}
await overlay.press("body", "Escape");
await settle(500);
await dispatch({ type: "openThemeEditor", spaceId: "space-personal" });
await settle(900);
await compositeShot("06-theme-editor.png");
await overlay.press("body", "Escape");
await settle(400);
const folderRow = await sidebar.$("[data-item-id='folder-reading']");
const folderBox = folderRow ? await folderRow.boundingBox() : null;
if (folderBox) {
  await dispatch({ type: "toggleFolder", folderId: "folder-reading" });
  await settle(400);
  await sidebar.mouse.move(folderBox.x + 40, folderBox.y + folderBox.height / 2);
  await settle(1800);
  await compositeShot("07-folder-hover-list.png");
  await sidebar.mouse.move(5, 500);
  await dispatch({ type: "toggleFolder", folderId: "folder-reading" });
}
await settle(600);
const tabRow = await sidebar.$("[data-item-id='today-hypertext']");
const tabBox = tabRow ? await tabRow.boundingBox() : null;
if (tabBox) {
  await sidebar.mouse.move(tabBox.x + 60, tabBox.y + tabBox.height / 2);
  await settle(1800);
  await compositeShot("08-tab-tooltip.png");
  await sidebar.mouse.move(5, 500);
}
await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap((menu) => menu.submenu?.items ?? []).find((item) => item.label === "Copy URL")?.click());
await settle(300);
await compositeShot("09-copy-toast.png");
await settle(2000);
await dispatch({ type: "selectTab", tabId: "split-mdn" });
await settle(4000);
await compositeShot("10-split.png");
await dispatch({ type: "switchSpace", spaceId: "space-work" });
await settle(4000);
await compositeShot("11-light-window.png");
await dispatch({ type: "openCommandBar", mode: "newTab" });
await settle(800);
await compositeShot("12-light-command-bar.png");
await overlay.press(".command-input", "Escape");
await settle(400);
await dispatch({ type: "openLibrary" });
await overlay.click(".library-tab[data-section='settings']").catch(() => undefined);
await settle(900);
await compositeShot("13-light-library-settings.png");
await overlay.press("body", "Escape");
await settle(400);
await dispatch({ type: "setSidebarVisible", isVisible: false });
await settle(900);
await compositeShot("14-light-sidebar-hidden.png");
await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
