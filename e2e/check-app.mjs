// End-to-end check of the real app: launch it, drive the sidebar, take screenshots, relaunch to check saving.
// usage: npm run e2e        (builds first; output in e2e/output, or set E2E_OUTPUT_DIR)
// Uses a throwaway --user-data-dir, so your real browser state is never touched.
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
  results.push({ name, ok, detail });
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

async function launch() {
  const app = await _electron.launch({
    executablePath: electronBinary,
    args: [`--user-data-dir=${userDataDir}`, appDir],
    timeout: 30000,
  });
  const mainLog = [];
  app.process().stdout.on("data", (data) => mainLog.push(data.toString()));
  app.process().stderr.on("data", (data) => mainLog.push(data.toString()));
  const page = await findSidebarPage(app);
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

// ---------- first run ----------
let { app, page, mainLog, consoleErrors } = await launch();
await page.waitForSelector(".space-heading", { timeout: 15000 });
check("preload exposes window.browserApi", (await page.evaluate(() => typeof window.browserApi)) === "object");
check("sidebar renders the Personal Space", (await page.textContent(".space-heading")).includes("Personal"));
check("empty card shows with no tabs", await page.isVisible("#empty-card"));
await windowShot(app, "01-empty");

await page.fill("#address-input", "example.com");
await page.press("#address-input", "Enter");
await page.waitForSelector(".tab-row", { timeout: 10000 });
let titleOk = true;
try {
  await page.waitForFunction(() => document.querySelector(".tab-row .tab-title")?.textContent?.includes("Example"), null, { timeout: 15000 });
} catch { titleOk = false; }
let state = await getState(page);
check("typing example.com opens a tab with https://", state.tabs[0]?.url.startsWith("https://example.com"), state.tabs[0]?.url);
check("page title flows back into the sidebar", titleOk, state.tabs[0]?.title);
const contents = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((contents) => contents.getURL()));
check("a web view exists for the tab", contents.some((url) => url.startsWith("https://example.com")), contents.join(", "));
check("empty card hidden while a tab is open", !(await page.isVisible("#empty-card")));
const bounds = await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  const child = win.contentView.children.find((candidate) => candidate.webContents && candidate.webContents !== win.webContents);
  return { bounds: child?.getBounds(), content: win.getContentSize() };
});
check("tab view sits right of the sidebar as an inset card", bounds.bounds?.x === 248 && bounds.bounds?.y === 8, JSON.stringify(bounds));
await windowShot(app, "02-tab-open");

await page.evaluate(() => [...document.querySelectorAll(".tab-row .tab-action")].find((button) => button.textContent === "Pin").click());
await page.waitForFunction(() => document.querySelectorAll(".tab-list")[0].querySelector(".tab-row") !== null, null, { timeout: 5000 });
state = await getState(page);
check("Pin moves the tab into Pinned with a home URL", state.tabs[0]?.isPinned === true && state.tabs[0]?.homeUrl?.startsWith("https://example.com"));

await page.fill("#address-input", "best pizza");
await page.press("#address-input", "Enter");
await page.waitForFunction(() => document.querySelectorAll(".tab-row").length === 2, null, { timeout: 10000 });
state = await getState(page);
const searchTab = state.tabs.find((tab) => !tab.isPinned);
check("plain words open a search tab", searchTab?.url.startsWith("https://duckduckgo.com/?q=best%20pizza"), searchTab?.url);
await page.evaluate(() => document.querySelectorAll(".tab-list")[1].querySelector(".tab-close").click());
await page.waitForFunction(() => document.querySelectorAll(".tab-row").length === 1, null, { timeout: 5000 });
state = await getState(page);
check("Close moves the tab to the Archive as 'manual'", state.archive.length === 1 && state.archive[0].reason === "manual");
check("selection falls back to the remaining tab", state.selectedTabIdBySpace[state.activeSpaceId] === state.tabs[0]?.id);
const viewsAfterClose = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((contents) => contents.getURL()));
check("closed tab's web view is destroyed", !viewsAfterClose.some((url) => url.includes("duckduckgo")), viewsAfterClose.join(", "));

await page.evaluate(() => { document.querySelector(".archive").open = true; });
await page.evaluate(() => document.querySelector(".archive-restore").click());
await page.waitForFunction(() => document.querySelectorAll(".tab-row").length === 2, null, { timeout: 5000 });
state = await getState(page);
check("Restore brings the tab back and empties the Archive", state.archive.length === 0 && state.tabs.length === 2);

await page.selectOption("#archive-after", { label: "1 hour" });
await page.waitForTimeout(300);
state = await getState(page);
check("'Archive tabs after' setting saves 1 hour", state.settings.archiveAfterMs === 3600000, String(state.settings.archiveAfterMs));

await page.evaluate(() => [...document.querySelectorAll(".text-button")].find((button) => button.textContent === "Clear").click());
await page.waitForTimeout(300);
state = await getState(page);
check("Clear archives today's tabs, keeps pinned", state.tabs.length === 1 && state.tabs[0].isPinned && state.archive[0]?.reason === "clear-button");

await page.evaluate(() => document.querySelectorAll(".space-button")[1].click());
await page.waitForFunction(() => document.querySelector(".space-heading")?.textContent?.includes("Work"), null, { timeout: 5000 });
await page.waitForTimeout(400); // the frame color fades over 200 ms
const frameColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check("switching to Work shows an empty Space", await page.isVisible("#empty-card"));
check("frame color changes with the Space", frameColor === "rgb(212, 223, 233)", frameColor);
await windowShot(app, "03-work-space");
await page.evaluate(() => document.querySelectorAll(".space-button")[0].click());
await page.waitForTimeout(400);
await windowShot(app, "04-back-to-personal");

check("no errors in the sidebar console", consoleErrors.length === 0, consoleErrors.join(" | "));
const firstRunLog = mainLog.join("");
await app.close();
// Give the old process a moment to release its profile lock, or the relaunch can stall.
await new Promise((resolve) => setTimeout(resolve, 1500));

// ---------- second run: persistence ----------
const stateFile = path.join(userDataDir, "browser-state.json");
check("state saved under the test data folder", fs.existsSync(stateFile), stateFile);
({ app, page, mainLog, consoleErrors } = await launch());
await page.waitForSelector(".space-heading", { timeout: 30000 });
await page.waitForSelector(".tab-row", { timeout: 30000 });
state = await getState(page);
check("pinned tab and setting survive a restart", state.tabs.length === 1 && state.tabs[0].isPinned && state.settings.archiveAfterMs === 3600000);
check("archive survives a restart", state.archive.length === 1);
await page.waitForTimeout(1500);
await windowShot(app, "05-after-restart");
await app.close();
// Chromium prints its own internal log lines ("[pid:date/time:ERROR:base/…]"); only our app's output counts.
const appLogLines = (firstRunLog + mainLog.join("")).split("\n").filter((line) => !/^\[\d+:\d+\/\d+\.\d+:/.test(line));
const appErrorLines = appLogLines.filter((line) => /error/i.test(line) && !line.startsWith("Debugger"));
check("main process printed no errors", appErrorLines.length === 0, appErrorLines.join(" | ").slice(0, 300));

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in ${outDir}`);
process.exit(failed === 0 ? 0 : 1);
