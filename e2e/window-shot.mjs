// The README's pictures (docs/screenshot-*.png) are taken by hand, in Bow opened on a made-up sample sidebar (public
// sites only, never the user's data):
//   node e2e/window-shot.mjs --open   (after npm run package) writes the sample profile to
//   e2e/output/screenshot-profile and opens the packaged Bow on it, 1440 × 900, for macOS's own window screenshots.
// Without --open it takes the same views by itself, at 2x, into e2e/output/readme-shots/ (dark Space, Command Bar,
// split view, Library › Spaces, light Space): compositing the window and page views at their real bounds, so screen
// recording permission is not needed. It never writes into docs/.
// usage: npm run build && node e2e/window-shot.mjs
import { _electron } from "playwright-core";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { captureWindow } from "./composite.mjs";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const isOpenOnly = process.argv.includes("--open");
// The shots taken by itself run in the background like the checks (e2e/background.mjs); --open is for hand-taken
// screenshots, so Bow stays on screen then.
if (!isOpenOnly && process.env.BOW_E2E_FOREGROUND !== "1") {
  process.env.BOW_E2E_BACKGROUND = "1";
}
const userDataDir = path.join(outDir, isOpenOnly ? "screenshot-profile" : "user-data-shot");
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

if (isOpenOnly) {
  // The window opens at the screenshots' size (window-state.json, windowState.ts), near the screen's top left.
  fs.writeFileSync(path.join(userDataDir, "window-state.json"), JSON.stringify({ "window-1": { x: 80, y: 40, width: 1440, height: 900 } }));
  const bundlePath = path.join(appDir, "release", `Bow-darwin-${process.arch}`, "Bow.app");
  // -n: a second Bow next to the one in use; its own data folder keeps them apart.
  execFileSync("open", ["-n", "-a", bundlePath, "--args", `--user-data-dir=${userDataDir}`, "--skip-welcome"]);
  console.log(`Opened ${bundlePath} on the sample profile in ${userDataDir}`);
  process.exit(0);
}

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  // 2x: README images stay sharp on Retina screens whatever this Mac's display is.
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", "--force-device-scale-factor=2", appDir],
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

const shotsDir = path.join(outDir, "readme-shots");
fs.mkdirSync(shotsDir, { recursive: true });
async function compositeShot(fileName) {
  const filePath = path.join(shotsDir, fileName);
  fs.writeFileSync(filePath, await captureWindow(app));
  console.log("saved", filePath);
}

await compositeShot("screenshot-dark.png");

const overlay = app.windows().find((page) => page.url().endsWith("/overlay/overlay.html"));
await sidebar.evaluate(() => window.browserApi.dispatch({ type: "openCommandBar", mode: "newTab" }));
await overlay.waitForSelector(".command-input");
await overlay.fill(".command-input", "wiki");
await overlay.waitForTimeout(2500);
await compositeShot("screenshot-command-bar.png");
await overlay.press(".command-input", "Escape");

await dispatch({ type: "selectTab", tabId: "split-mdn" });
await sidebar.waitForTimeout(5000);
await compositeShot("screenshot-split.png");

await dispatch({ type: "openLibrary" });
await overlay.waitForSelector(".library");
await overlay.click(".library-tab[data-section='spaces']");
await sidebar.waitForTimeout(1500);
await compositeShot("screenshot-spaces.png");
await overlay.press("body", "Escape");

await dispatch({ type: "switchSpace", spaceId: "space-work" });
await sidebar.waitForTimeout(5000);
await compositeShot("screenshot-light.png");

await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
