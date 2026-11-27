// End-to-end check of a page's own fullscreen (YouTube's fullscreen button, `requestFullscreen()`): Electron makes the
// window fullscreen, and the page's view must then cover the whole window, above the card's corners, instead of
// staying in the card beside the sidebar (2026-11-27, YouTube on macOS 27). Escape, the window leaving fullscreen
// (the green button) and selecting another tab each end it and bring the card back. Pages are served by a local
// server with made-up content.
// A background run (the default, e2e/background.mjs) keeps the window as it is: a real macOS fullscreen gets a desktop
// of its own and switched the user's screen to it, so there the page's fullscreen stays inside the invisible window and
// the green button is its "leave-full-screen" event. BOW_E2E_FOREGROUND=1 uses macOS's real fullscreen.
// usage: npm run build && node e2e/check-fullscreen.mjs      (uses a throwaway --user-data-dir)
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const isBackgroundRun = process.env.BOW_E2E_BACKGROUND === "1";
const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-fullscreen");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// The video page: a button puts its player in fullscreen, like a video site's fullscreen button.
const videoPage = `<!doctype html><title>video</title><body style="margin:0;background:#111">
<div id="player" style="width:320px;height:180px;background:#c00"></div>
<button id="fullscreen" onclick="document.getElementById('player').requestFullscreen()">Fullscreen</button>`;
const otherPage = "<!doctype html><title>other</title><p>Another page.</p>";
const server = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(request.url === "/other" ? otherPage : videoPage);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const now = Date.now();
const tabAt = (id, pathName) => ({ kind: "tab", id, url: `${origin}${pathName}`, title: id, customTitle: null, faviconUrl: null, homeUrl: null, lastActiveAt: now, isMuted: false });
fs.writeFileSync(
  path.join(userDataDir, "browser-state.json"),
  JSON.stringify({
    version: 3,
    items: { "tab-video": tabAt("tab-video", "/video"), "tab-other": tabAt("tab-other", "/other") },
    profiles: [{ id: "profile-default", name: "Default", favoriteIds: [] }],
    spaces: [{ id: "space-main", name: "Main", icon: "✦", theme: { colors: ["#000000"], appearance: "dark", grain: 0 }, profileId: "profile-default", pinnedIds: [], todayIds: ["tab-video", "tab-other"], isPinnedOpen: true }],
    activeSpaceId: "space-main",
    selectedTabIdBySpace: { "space-main": "tab-video" },
    focusedWindowId: "window-1",
    otherWindows: [],
    archive: [],
    settings: { archiveAfterMs: 43200000, isSidebarVisible: true },
  }),
);

const app = await _electron.launch({ executablePath: createRequire(import.meta.url)("electron"), args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir], timeout: 30000 });
const mainLog = [];
app.process().stdout.on("data", (data) => mainLog.push(data.toString()));
app.process().stderr.on("data", (data) => mainLog.push(data.toString()));

async function findPage(isWanted) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const found = app.windows().find((candidate) => isWanted(candidate.url()));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("page did not open");
}
async function waitFor(condition, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
const sidebar = await findPage((url) => url.endsWith("/renderer/index.html"));
await sidebar.waitForSelector(".space-title", { state: "attached", timeout: 30000 });
const dispatch = (action) => sidebar.evaluate((value) => window.browserApi.dispatch(value), action);
const videoTab = await findPage((url) => url === `${origin}/video`);
await videoTab.waitForSelector("#fullscreen");

// The browser window, its size, where the video page's view sits and what lies above it (corner masks are the card's
// two rounded bottom corners, see src/main/cornerMasks.ts).
const measure = () =>
  app.evaluate(({ BrowserWindow }, videoUrl) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
    const children = window.contentView.children;
    const videoIndex = children.findIndex((view) => view.webContents?.getURL() === videoUrl);
    const cornerIndexes = children.map((view, index) => (view.webContents?.getURL().includes("/corner/") ? index : -1)).filter((index) => index >= 0);
    const [width, height] = window.getContentSize();
    return {
      isWindowFullscreen: window.isFullScreen(),
      width: width,
      height: height,
      video: videoIndex >= 0 ? children[videoIndex].getBounds() : null,
      isVideoAboveCorners: videoIndex >= 0 && cornerIndexes.every((index) => index < videoIndex),
      areCornersAboveVideo: videoIndex >= 0 && cornerIndexes.length > 0 && cornerIndexes.every((index) => index > videoIndex),
    };
  }, `${origin}/video`);
const isPageFullscreen = () => videoTab.evaluate(() => document.fullscreenElement !== null);
const coversWindow = (layout) => layout.video !== null && layout.video.x === 0 && layout.video.y === 0 && layout.video.width === layout.width && layout.video.height === layout.height;
const isInCard = (layout) => layout.video !== null && layout.video.x > 0 && layout.video.y > 0 && layout.video.width < layout.width;
async function enterFullscreen() {
  await videoTab.click("#fullscreen");
  await waitFor(async () => (await isPageFullscreen()) && coversWindow(await measure()));
  // A background run whose window went into macOS fullscreen anyway would hold the user's screen on a black desktop:
  // it stops at once (closing the app ends that desktop).
  if (isBackgroundRun && (await measure()).isWindowFullscreen) {
    console.log("FAIL  the window went into macOS fullscreen in a background run; stopped");
    await app.close();
    server.close();
    process.exit(1);
  }
  // macOS's fullscreen animation: the window grows for a moment after the page entered.
  if (!isBackgroundRun) {
    await waitFor(async () => (await measure()).isWindowFullscreen);
  }
  await videoTab.waitForTimeout(800);
}
async function waitForCard() {
  await waitFor(async () => !(await isPageFullscreen()) && isInCard(await measure()));
  await videoTab.waitForTimeout(800);
}

const before = await measure();
check("before: the video page sits in the card", isInCard(before) && !before.isWindowFullscreen, JSON.stringify(before.video));

// ---------- the page's fullscreen button ----------
await enterFullscreen();
const inFullscreen = await measure();
if (isBackgroundRun) {
  check("in a background run the window keeps its size (no macOS fullscreen desktop)", !inFullscreen.isWindowFullscreen);
} else {
  check("the page's fullscreen makes the window fullscreen", inFullscreen.isWindowFullscreen);
}
check("and its view covers the whole window, not the card", coversWindow(inFullscreen), `${JSON.stringify(inFullscreen.video)} in ${inFullscreen.width} × ${inFullscreen.height}`);
check("above the card's rounded corners", inFullscreen.isVideoAboveCorners);

// ---------- Escape (sent through Electron's own input, like a real key) ----------
await app.evaluate(({ webContents }, videoUrl) => {
  const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === videoUrl);
  contents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  contents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
}, `${origin}/video`);
await waitForCard();
const afterEscape = await measure();
check("Escape ends it: the page goes back into the card", !(await isPageFullscreen()) && isInCard(afterEscape), JSON.stringify(afterEscape.video));
check("with the card's corners above the page again", afterEscape.areCornersAboveVideo);

// ---------- the window leaves fullscreen (the green button, ⌃⌘F) ----------
await enterFullscreen();
await app.evaluate(({ BrowserWindow }, isBackground) => {
  const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  if (isBackground) {
    window.emit("leave-full-screen");
    return;
  }
  window.setFullScreen(false);
}, isBackgroundRun);
await waitForCard();
const afterWindowLeft = await measure();
check("the window leaving fullscreen ends the page's fullscreen too", !(await isPageFullscreen()) && isInCard(afterWindowLeft) && !afterWindowLeft.isWindowFullscreen, JSON.stringify(afterWindowLeft.video));

// ---------- another tab selected ----------
await enterFullscreen();
await dispatch({ type: "selectTab", tabId: "tab-other" });
await waitFor(async () => !(await isPageFullscreen()));
check("selecting another tab ends the page's fullscreen", !(await isPageFullscreen()));
await dispatch({ type: "selectTab", tabId: "tab-video" });
await waitForCard();
const backAgain = await measure();
check("and the page comes back in the card, not over the whole window", isInCard(backAgain) && !backAgain.isWindowFullscreen, JSON.stringify(backAgain.video));

const log = mainLog.join("");
await app.close();
server.close();
const mainErrors = log.split("\n").filter((line) => /Error|Uncaught|TypeError/.test(line));
check("no errors in the main process", mainErrors.length === 0, mainErrors.slice(0, 3).join(" | "));

const passed = results.filter((result) => result.ok).length;
console.log(`\n${passed}/${results.length} fullscreen checks passed.`);
process.exit(passed === results.length ? 0 : 1);
