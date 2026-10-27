// Pictures for reviewing the look of the floating pieces that the reference screenshots do not show: a Peek, the
// link status bubble and the crashed-tab page, in a dark Space. Pages come from a local server; output goes to
// e2e/output/review-*.png (git-ignored). Not part of `npm run e2e`: it checks nothing, it only takes pictures.
// usage: npm run build && node e2e/review-shots.mjs
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { captureWindow } from "./composite.mjs";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-review");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });

const article = (title, link) => `<!doctype html><html><head><title>${title}</title><style>
  body { font: 16px/1.6 -apple-system, sans-serif; margin: 0; padding: 48px 64px; background: #fbfaf7; color: #222; }
  h1 { font-size: 30px; margin: 0 0 12px; } p { max-width: 640px; color: #444; } a { color: #2a5bd7; }
</style></head><body><h1>${title}</h1><p>A made-up page for reviewing the browser's own pieces. ${link}</p>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio. Praesent libero. Sed cursus ante dapibus
diam. Sed nisi. Nulla quis sem at nibh elementum imperdiet. Duis sagittis ipsum.</p></body></html>`;

let port = 0;
const server = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  if (request.url === "/source") {
    response.end(article("Reading list", `Read <a href="http://localhost:${port}/target">the linked article</a> next.`));
    return;
  }
  response.end(article("The linked article", `It links on to <a href="http://localhost:${port}/further/reading/with/a/long/address">further reading</a>.`));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
port = server.address().port;
const sourceUrl = `http://127.0.0.1:${port}/source`;

const now = Date.now();
fs.writeFileSync(
  path.join(userDataDir, "browser-state.json"),
  JSON.stringify({
    version: 2,
    items: { "tab-source": { kind: "tab", id: "tab-source", url: sourceUrl, title: "Reading list", customTitle: null, faviconUrl: null, homeUrl: sourceUrl, lastActiveAt: now, isMuted: false } },
    profiles: [{ id: "profile-default", name: "Default", favoriteIds: [] }],
    spaces: [{ id: "space-a", name: "Main", icon: "✦", theme: { colors: ["#000000"], appearance: "dark", grain: 0 }, profileId: "profile-default", pinnedIds: ["tab-source"], todayIds: [], isPinnedOpen: true }],
    activeSpaceId: "space-a",
    selectedTabIdBySpace: { "space-a": "tab-source" },
    archive: [],
    // Local servers start in Developer Mode; these pictures are about the ordinary look.
    developerModeSites: { "127.0.0.1": false, localhost: false },
    settings: { archiveAfterMs: 43200000, isSidebarVisible: true },
  }),
);

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir],
  colorScheme: "dark",
  timeout: 30000,
});
let sidebar;
while (!sidebar) {
  sidebar = app.windows().find((candidate) => candidate.url().endsWith("/renderer/index.html"));
  if (!sidebar) await new Promise((resolve) => setTimeout(resolve, 150));
}
await sidebar.waitForSelector(".space-title");
await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  win.setContentSize(1280, 800);
});
await sidebar.waitForTimeout(2500);

const findPage = async (urlPart) => {
  for (let attempt = 0; attempt < 40; attempt++) {
    const found = app.windows().find((candidate) => candidate.url().includes(urlPart));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`No page with ${urlPart}`);
};
const shoot = async (name) => fs.writeFileSync(path.join(outDir, `review-${name}.png`), await captureWindow(app));

// A Peek: a link from a pinned tab to another site.
const source = await findPage("/source");
const linkPoint = await source.evaluate(() => {
  const box = document.querySelector("a").getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
});
await source.mouse.click(linkPoint.x, linkPoint.y);
await sidebar.waitForTimeout(1500);
await shoot("peek");

// The link status bubble, hovering a link in the Peek's page.
const target = await findPage("localhost");
const targetLink = await target.evaluate(() => {
  const box = document.querySelector("a").getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
});
await target.mouse.move(5, 5);
await target.mouse.move(targetLink.x, targetLink.y, { steps: 3 });
await sidebar.waitForTimeout(700);
await shoot("status-in-peek");

// Back to the page, the status bubble on the page itself.
// A real key event (Playwright's own key press does not reach Electron's before-input-event, where Peek listens).
await app.evaluate(({ webContents }) => {
  webContents.getAllWebContents().find((contents) => contents.getURL().includes("localhost")).sendInputEvent({ type: "keyDown", keyCode: "Escape" });
});
await sidebar.waitForTimeout(800);
await source.mouse.move(5, 5);
await source.mouse.move(linkPoint.x, linkPoint.y, { steps: 3 });
await sidebar.waitForTimeout(700);
await shoot("status");

// The crashed-tab page.
await app.evaluate(({ webContents }, part) => {
  webContents.getAllWebContents().find((contents) => contents.getURL().includes(part)).forcefullyCrashRenderer();
}, "/source");
await sidebar.waitForTimeout(3000);
await shoot("crash");

await app.close();
server.close();
console.log("Review pictures in", outDir);
