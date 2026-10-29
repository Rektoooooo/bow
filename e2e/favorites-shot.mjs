// A picture of Favorites per Space: two Spaces that share one profile, each with its own Favorites row.
// usage: npm run build && node e2e/favorites-shot.mjs   → e2e/output/favorites-per-space-<space>.png
// Like window-shot.mjs it composites the window and page views, so screen recording permission is not needed, and it
// runs in the background like the checks.
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { captureWindow } from "./composite.mjs";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-favorites-shot");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });

const now = Date.now();
const tab = (id, url, title) => ({ kind: "tab", id, url, title, customTitle: null, faviconUrl: null, homeUrl: url, lastActiveAt: now, isMuted: false });
const items = {
  "personal-wikipedia": tab("personal-wikipedia", "https://www.wikipedia.org/", "Wikipedia"),
  "personal-github": tab("personal-github", "https://github.com/", "GitHub"),
  "personal-youtube": tab("personal-youtube", "https://www.youtube.com/", "YouTube"),
  "work-apple": tab("work-apple", "https://developer.apple.com/", "Apple Developer"),
  "work-notion": tab("work-notion", "https://www.notion.so/", "Notion"),
  "work-figma": tab("work-figma", "https://www.figma.com/", "Figma"),
  "work-w3c": tab("work-w3c", "https://www.w3.org/", "W3C"),
};
const space = (id, name, icon, colors, favoriteIds, pinnedIds) => ({ id, name, icon, theme: { colors, appearance: "dark", grain: 0.2 }, profileId: "profile-default", favoriteIds, pinnedIds, todayIds: [], isPinnedOpen: true });
const state = {
  version: 5,
  items,
  profiles: [{ id: "profile-default", name: "Default" }],
  spaces: [
    space("space-personal", "Personal", "🏠", ["#1f2b47", "#2e2147"], ["personal-wikipedia", "personal-github", "personal-youtube"], []),
    space("space-work", "Work", "💼", ["#2b3a2e"], ["work-apple", "work-notion", "work-figma"], ["work-w3c"]),
  ],
  activeSpaceId: "space-personal",
  selectedTabIdBySpace: { "space-personal": "personal-wikipedia", "space-work": "work-apple" },
  focusedWindowId: "window-1",
  otherWindows: [],
  archive: [],
  settings: { archiveAfterMs: 43200000, isSidebarVisible: true },
};
fs.writeFileSync(path.join(userDataDir, "browser-state.json"), JSON.stringify(state));

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
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
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html")).setContentSize(1100, 700));
await sidebar.waitForTimeout(4000);

for (const spaceId of ["space-personal", "space-work"]) {
  await sidebar.evaluate((value) => window.browserApi.dispatch({ type: "switchSpace", spaceId: value }), spaceId);
  await sidebar.waitForTimeout(2500);
  const tileCount = await sidebar.locator(".favorite-tile").count();
  const filePath = path.join(outDir, `favorites-per-space-${spaceId.replace("space-", "")}.png`);
  fs.writeFileSync(filePath, await captureWindow(app));
  console.log("saved", filePath, `(${tileCount} Favorites in the row)`);
}
await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
