// End-to-end check of the real app: launch it, drive the sidebar, take screenshots, relaunch to check saving,
// and open a version 1 state file to check the upgrade.
// usage: npm run e2e        (builds first; output in e2e/output, or set E2E_OUTPUT_DIR)
// Uses throwaway --user-data-dir folders, so your real browser state is never touched.
// The sidebar page runs with reduced motion (emulated): rows appear and disappear at once, so checks never meet a
// row that is still animating. e2e/check-motion.mjs checks the animations themselves.
// Playwright emulates light mode by default, so screenshots here are light.
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const electronBinary = createRequire(import.meta.url)("electron");
const userDataDir = path.join(outDir, "user-data");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// On relaunch the restored tab's page and the sidebar page load at the same time, so firstWindow()
// can return the tab. Pick the sidebar by its URL instead.
async function findSidebarPage(app) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const sidebarPage = app.windows().find((page) => page.url().endsWith("/renderer/index.html"));
    if (sidebarPage) return sidebarPage;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Sidebar page did not open within 30 s");
}

async function launch(dataDir) {
  const app = await _electron.launch({
    executablePath: electronBinary,
    args: [`--user-data-dir=${dataDir}`, appDir],
    timeout: 30000,
  });
  const mainLog = [];
  app.process().stdout.on("data", (data) => mainLog.push(data.toString()));
  app.process().stderr.on("data", (data) => mainLog.push(data.toString()));
  const page = await findSidebarPage(app);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push("pageerror: " + error.message));
  return { app, page, mainLog, consoleErrors };
}

// capturePage on the window does not include child web views, so save the tab's capture separately.
async function windowShot(app, name) {
  const shots = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const windowImage = await win.capturePage();
    const tabView = win.contentView.children.find((child) => child.webContents && child.webContents !== win.webContents);
    const out = { window: windowImage.toPNG().toString("base64"), tab: null };
    if (tabView) out.tab = (await tabView.webContents.capturePage()).toPNG().toString("base64");
    return out;
  });
  fs.writeFileSync(path.join(outDir, `${name}-window.png`), Buffer.from(shots.window, "base64"));
  if (shots.tab) fs.writeFileSync(path.join(outDir, `${name}-tab.png`), Buffer.from(shots.tab, "base64"));
}

const getState = (page) => page.evaluate(() => window.browserApi.getState());
const dispatch = (page, action) => page.evaluate((value) => window.browserApi.dispatch(value), action);
// Version 2 state: tabs live in state.items; each Space lists its Pinned and Today ids.
const activeSpace = (state) => state.spaces.find((space) => space.id === state.activeSpaceId);
const todayTabs = (state) => activeSpace(state).todayIds.map((id) => state.items[id]);
const pinnedItems = (state) => activeSpace(state).pinnedIds.map((id) => state.items[id]);
const favorites = (state) => state.profiles[0].favoriteIds.map((id) => state.items[id]);
const itemCount = (state) => Object.keys(state.items).length;
// Only web pages: our own overlay and status bubble (file: pages) can be on screen too, e.g. with a site's
// permission prompt (DuckDuckGo asks for the location on a "best pizza" search).
const tabViewBounds = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  return win.contentView.children
    .filter((child) => child.webContents && child.webContents !== win.webContents && !child.webContents.getURL().startsWith("file:"))
    .map((child) => child.getBounds());
});

// Playwright's dragAndDrop starts a real macOS drag inside Electron that never completes, so the drag is simulated
// in the page: the same dragstart / dragover / drop / dragend events, sharing one DataTransfer, at a point inside
// the target (verticalFraction 0.5 = middle, which for a folder row means "inside").
async function simulateDrag(page, sourceSelector, targetSelector, verticalFraction = 0.5) {
  return page.evaluate(({ sourceSelector, targetSelector, verticalFraction }) => {
    const source = document.querySelector(sourceSelector);
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    // The drop target may only appear once the drag has started (the Favorites end zone does).
    const target = document.querySelector(targetSelector);
    const rectangle = target.getBoundingClientRect();
    const point = { clientX: rectangle.left + rectangle.width / 2, clientY: rectangle.top + rectangle.height * verticalFraction };
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, ...point }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, ...point }));
    source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer }));
    return target.className;
  }, { sourceSelector, targetSelector, verticalFraction });
}

// ---------- first run ----------
let { app, page, mainLog, consoleErrors } = await launch(userDataDir);
await page.waitForSelector(".space-title", { timeout: 15000 });
check("preload exposes window.browserApi", (await page.evaluate(() => typeof window.browserApi)) === "object");
check("sidebar shows the Personal Space title", (await page.textContent(".space-title-name")).includes("Personal"));
check("empty card shows with no tabs", await page.isVisible("#empty-card"));
check("bottom bar has Library, two Spaces and +", (await page.locator(".bottom-bar .space-button").count()) === 2 && (await page.locator(".bottom-bar .bottom-button").count()) === 2);
await windowShot(app, "01-empty");

await dispatch(page, { type: "openTab", typedText: "example.com" });
await page.waitForSelector(".today-list .tab-row", { timeout: 10000 });
let titleOk = true;
try {
  await page.waitForFunction(() => document.querySelector(".today-list .tab-row .row-title")?.textContent?.includes("Example"), null, { timeout: 15000 });
} catch { titleOk = false; }
let state = await getState(page);
check("opening example.com adds a Today tab with https://", todayTabs(state)[0]?.url.startsWith("https://example.com"), todayTabs(state)[0]?.url);
check("page title flows back into the sidebar", titleOk, todayTabs(state)[0]?.title);
check("toolbar shows the page's host", (await page.textContent(".address-text")) === "example.com");
const bounds = await tabViewBounds(app);
// Arc's measured layout: sidebar 247 + gap 7 → x 254; card inset 10 + toolbar 33 → y 43 (shared/settings.ts).
const PAGE_LEFT = 254;
const PAGE_TOP = 43;
const HIDDEN_PAGE_LEFT = 10;
check("tab view sits right of the sidebar and below the card's toolbar", bounds[0]?.x === PAGE_LEFT && bounds[0]?.y === PAGE_TOP, JSON.stringify(bounds));
check("empty card hidden while a tab is open", !(await page.isVisible("#empty-card")));
await page.waitForFunction(() => document.querySelector(".toolbar-left .toolbar-button:nth-child(3)")?.getAttribute("aria-label") === "Reload (⌘R)", null, { timeout: 15000 }).catch(() => undefined);
await windowShot(app, "02-tab-open");

const exampleTabId = todayTabs(state)[0].id;
await dispatch(page, { type: "pinTab", tabId: exampleTabId });
await page.waitForSelector(".pinned-list .tab-row", { timeout: 5000 });
state = await getState(page);
check("Pin moves the tab into Pinned with a home URL", pinnedItems(state)[0]?.homeUrl?.startsWith("https://example.com"));

await dispatch(page, { type: "openTab", typedText: "best pizza" });
await page.waitForSelector(".today-list .tab-row", { timeout: 10000 });
state = await getState(page);
check("plain words open a search tab", todayTabs(state)[0]?.url.startsWith("https://duckduckgo.com/?q=best%20pizza"), todayTabs(state)[0]?.url);

// Real drag and drop: the Today tab onto the empty Favorites strip.
await simulateDrag(page, ".today-list .tab-row", ".favorites-end-zone");
await page.waitForTimeout(400);
state = await getState(page);
check("dragging a Today tab to the top makes it a Favorite", favorites(state).length === 1 && todayTabs(state).length === 0, JSON.stringify(favorites(state).map((tab) => tab?.url)));
check("the Favorite shows as a tile", (await page.locator(".favorite-tile").count()) === 1);
await dispatch(page, { type: "unpinTab", tabId: favorites(state)[0].id });
await page.waitForTimeout(300);

state = await getState(page);
await dispatch(page, { type: "closeTab", tabId: todayTabs(state)[0].id });
await page.waitForFunction(() => document.querySelectorAll(".today-list .tab-row").length === 0, null, { timeout: 5000 });
state = await getState(page);
check("closing a Today tab moves it to the Archive as 'manual'", state.archive.length === 1 && state.archive[0].reason === "manual");
check("selection falls back to the remaining tab", state.selectedTabIdBySpace[state.activeSpaceId] === exampleTabId);
const viewsAfterClose = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((contents) => contents.getURL()));
check("closed tab's web view is destroyed", !viewsAfterClose.some((url) => url.includes("duckduckgo")), viewsAfterClose.join(", "));

await dispatch(page, { type: "restoreArchivedTab", tabId: state.archive[0].tab.id });
await page.waitForSelector(".today-list .tab-row", { timeout: 5000 });
state = await getState(page);
check("Restore brings the tab back and empties the Archive", state.archive.length === 0 && itemCount(state) === 2);

// Folders: create one, drag the pinned tab into it, then collapse it.
await dispatch(page, { type: "createFolder", title: "Reading" });
await page.waitForSelector(".folder-row", { timeout: 5000 });
await simulateDrag(page, ".pinned-list .tab-row", ".folder-row");
await page.waitForTimeout(400);
state = await getState(page);
const folder = pinnedItems(state).find((item) => item?.kind === "folder");
check("dropping a pinned tab on a folder puts it inside", folder?.childIds.length === 1, JSON.stringify(pinnedItems(state).map((item) => item?.kind)));
await page.click(".folder-row");
await page.waitForTimeout(300);
state = await getState(page);
const collapsedFolder = pinnedItems(state).find((item) => item?.kind === "folder");
check("clicking a folder collapses it", collapsedFolder?.isOpen === false);

// Split view: two Today tabs side by side.
await dispatch(page, { type: "openTab", typedText: "example.net" });
await page.waitForFunction(() => document.querySelectorAll(".today-list .tab-row").length === 2, null, { timeout: 10000 });
state = await getState(page);
await dispatch(page, { type: "splitTabs", firstTabId: todayTabs(state)[0].id, secondTabId: todayTabs(state)[1].id });
await page.waitForSelector(".split-row", { timeout: 5000 });
await page.waitForTimeout(500);
const splitBounds = await tabViewBounds(app);
check("a split view shows two pages side by side", splitBounds.length === 2 && splitBounds[0].x < splitBounds[1].x && splitBounds[0].y === splitBounds[1].y, JSON.stringify(splitBounds));
check("the split shows as one row with two panes", (await page.locator(".split-row .split-pane").count()) === 2);
await windowShot(app, "03-split-view");
state = await getState(page);
const splitItem = Object.values(state.items).find((item) => item.kind === "split");
await dispatch(page, { type: "unsplit", splitId: splitItem.id });
await page.waitForTimeout(300);

await dispatch(page, { type: "setArchiveAfter", archiveAfterMs: 3600000 });
await page.waitForTimeout(200);
state = await getState(page);
check("'Archive tabs after' setting saves 1 hour", state.settings.archiveAfterMs === 3600000, String(state.settings.archiveAfterMs));

await dispatch(page, { type: "clearTodayTabs" });
await page.waitForTimeout(300);
state = await getState(page);
check("Clear archives Today tabs and keeps Pinned ones", todayTabs(state).length === 0 && state.archive[0]?.reason === "clear-button" && pinnedItems(state).length === 1);

await dispatch(page, { type: "setSidebarVisible", isVisible: false });
await page.waitForTimeout(400);
const hiddenBounds = await tabViewBounds(app);
check("hiding the sidebar widens the page card", hiddenBounds.length === 1 && hiddenBounds[0].x === HIDDEN_PAGE_LEFT, JSON.stringify(hiddenBounds));
// Touching the window's left edge shows the hidden sidebar; the page slides aside without resizing.
await page.mouse.move(400, 400);
await page.mouse.move(3, 400);
await page.waitForTimeout(500);
const peekBounds = await tabViewBounds(app);
const sidebarShows = await page.evaluate(() => getComputedStyle(document.getElementById("sidebar")).visibility === "visible");
check("touching the left edge shows the hidden sidebar and slides the page", sidebarShows && peekBounds[0]?.x === HIDDEN_PAGE_LEFT + 247 && peekBounds[0]?.width === hiddenBounds[0]?.width, JSON.stringify(peekBounds));
await page.mouse.move(900, 400);
await page.waitForTimeout(700);
const afterLeaveBounds = await tabViewBounds(app);
check("moving away hides it again", afterLeaveBounds[0]?.x === HIDDEN_PAGE_LEFT, JSON.stringify(afterLeaveBounds));
await dispatch(page, { type: "setSidebarVisible", isVisible: true });

// Dragging the sidebar's right edge resizes it (saved); dragging far left hides it.
const resizerBox = await page.locator("#sidebar-resizer").boundingBox();
const resizerX = resizerBox.x + resizerBox.width / 2;
await page.mouse.move(resizerX, 300);
await page.mouse.down();
await page.mouse.move(resizerX + 40, 300, { steps: 4 });
await page.mouse.move(320, 300, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(500);
state = await getState(page);
const resizedBounds = await tabViewBounds(app);
check("dragging the sidebar edge resizes it and moves the page", state.settings.sidebarWidth === 320 && resizedBounds[0]?.x === 320 + 7, `${state.settings.sidebarWidth} ${JSON.stringify(resizedBounds)}`);
await page.mouse.move(318, 300);
await page.mouse.down();
await page.mouse.move(60, 300, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(500);
state = await getState(page);
check("letting go far to the left hides the sidebar", state.settings.isSidebarVisible === false);
await dispatch(page, { type: "setSidebarVisible", isVisible: true });
await page.waitForTimeout(300);

await page.click(".space-button:nth-child(2)");
await page.waitForFunction(() => document.querySelector(".space-title-name")?.textContent?.includes("Work"), null, { timeout: 5000 });
// The frame color is computed from the theme like Arc's (themePalette.ts); Work's pale blue in light mode keeps its color.
const frameColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--frame-1").trim());
check("switching to Work shows an empty Space", await page.isVisible("#empty-card"));
check("the frame takes the Work Space's color", frameColor === "rgb(212, 223, 233)" || frameColor === "#d4dfe9", frameColor);
await windowShot(app, "04-work-space");
await page.click(".space-button:nth-child(1)");
await page.waitForTimeout(400);

// A site without /favicon.ico answers 404; Chromium logs that as a console error, but it is expected, not a bug.
const realErrors = consoleErrors.filter((message) => !message.startsWith("Failed to load resource"));
check("no errors in the sidebar console", realErrors.length === 0, realErrors.join(" | "));
const firstRunLog = mainLog.join("");
await app.close();
// Give the old process a moment to release its profile lock, or the relaunch can stall.
await new Promise((resolve) => setTimeout(resolve, 1500));

// ---------- second run: persistence ----------
const stateFile = path.join(userDataDir, "browser-state.json");
check("state saved under the test data folder", fs.existsSync(stateFile), stateFile);
({ app, page, mainLog, consoleErrors } = await launch(userDataDir));
await page.waitForSelector(".space-title", { timeout: 30000 });
state = await getState(page);
const savedFolder = pinnedItems(state).find((item) => item?.kind === "folder");
check("folder, pinned tab and setting survive a restart", savedFolder?.childIds.length === 1 && state.settings.archiveAfterMs === 3600000);
check("archive survives a restart", state.archive.length >= 1);
await page.waitForTimeout(1000);
await windowShot(app, "05-after-restart");
await app.close();
await new Promise((resolve) => setTimeout(resolve, 1500));

// ---------- third run: a version 1 file from milestone 1 is upgraded ----------
const upgradeDir = path.join(outDir, "user-data-upgrade");
fs.rmSync(upgradeDir, { recursive: true, force: true });
fs.mkdirSync(upgradeDir, { recursive: true });
const versionOneFile = {
  version: 1,
  spaces: [{ id: "space-personal", name: "Personal", icon: "🏠", color: "#e9d8d4" }],
  tabs: [{ id: "tab-old", spaceId: "space-personal", url: "https://example.org/", title: "Old pinned tab", isPinned: true, homeUrl: "https://example.org/", lastActiveAt: 1 }],
  activeSpaceId: "space-personal",
  selectedTabIdBySpace: { "space-personal": null },
  archive: [],
  settings: { archiveAfterMs: 21600000 },
};
fs.writeFileSync(path.join(upgradeDir, "browser-state.json"), JSON.stringify(versionOneFile));
const upgraded = await launch(upgradeDir);
await upgraded.page.waitForSelector(".pinned-list .tab-row", { timeout: 30000 });
state = await getState(upgraded.page);
check("a milestone 1 (version 1) file opens and is upgraded", state.version === 2 && state.spaces[0].pinnedIds[0] === "tab-old" && state.settings.archiveAfterMs === 21600000);
await upgraded.app.close();

// Chromium prints its own internal log lines ("[pid:date/time:ERROR:base/…]"); only our app's output counts.
const appLogLines = (firstRunLog + mainLog.join("")).split("\n").filter((line) => !/^\[\d+:\d+\/\d+\.\d+:/.test(line));
const appErrorLines = appLogLines.filter((line) => /error/i.test(line) && !line.startsWith("Debugger"));
check("main process printed no errors", appErrorLines.length === 0, appErrorLines.join(" | ").slice(0, 300));

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in ${outDir}`);
process.exit(failed === 0 ? 0 : 1);
