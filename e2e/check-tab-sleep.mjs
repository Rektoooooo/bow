// End-to-end check that a sleeping page frees its renderer and wakes where it was, and that after a crash a page comes
// back scrolled where it was: a tab goes from page one to a long
// page two and scrolls down, another tab is selected, the page is put to sleep (what the minute timer does once the
// tab has been unused for "Sleep unused tabs after"), and selecting the tab again shows page two at the same scroll
// position with page one still behind Back. Also checks that a page on screen refuses to sleep, and that a page in a
// call (allowed the camera or microphone, or sharing the screen) stays awake until it loads another page.
// Then what you can ask for: Sleep Tab (its row fades until it wakes), Keep Awake for a site (Sleep Other Tabs leaves
// it alone) and Library › Task Manager (each awake page with its memory; its Sleep button works).
// The app's own functions are reached with process.mainModule.require (the module instance the app uses, cached by
// path): deprecated in Node, so if this check breaks with "mainModule", that is why.
// usage: npm run build && node e2e/check-tab-sleep.mjs      (uses a throwaway --user-data-dir and a local web server)
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import { captureWindow } from "./composite.mjs";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-tab-sleep");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });

/** How far page two is scrolled before it sleeps. */
const SCROLL_Y = 1200;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const server = http.createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(`<!doctype html><title>Page ${request.url}</title><h1>${request.url}</h1>${"<p>A line of text on a long page.</p>".repeat(400)}`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const now = Date.now();
const tab = (id, url, title) => ({ kind: "tab", id, url, title, customTitle: null, faviconUrl: null, homeUrl: null, lastActiveAt: now, isMuted: false });
fs.writeFileSync(
  path.join(userDataDir, "browser-state.json"),
  JSON.stringify({
    version: 2,
    items: {
      "tab-reader": tab("tab-reader", `${origin}/one`, "One"),
      "tab-other": tab("tab-other", "about:blank", "Other"),
      // The same server under another name: another site, so keeping one awake does not keep the other.
      "tab-local": tab("tab-local", `http://localhost:${new URL(origin).port}/local`, "Local"),
    },
    profiles: [{ id: "profile-default", name: "Default", favoriteIds: [] }],
    spaces: [{ id: "space-a", name: "Main", icon: "✦", theme: { colors: ["#000000"], appearance: "dark", grain: 0 }, profileId: "profile-default", pinnedIds: [], todayIds: ["tab-reader", "tab-other", "tab-local"], isPinnedOpen: true }],
    activeSpaceId: "space-a",
    selectedTabIdBySpace: { "space-a": "tab-reader" },
    archive: [],
    settings: { archiveAfterMs: 43200000, isSidebarVisible: true },
  }),
);

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir],
  timeout: 30000,
});
let sidebar;
while (!sidebar) {
  sidebar = app.windows().find((page) => page.url().endsWith("/renderer/index.html"));
  if (!sidebar) await new Promise((resolve) => setTimeout(resolve, 150));
}
await sidebar.waitForSelector(".space-title");
const dispatch = (action) => sidebar.evaluate((value) => window.browserApi.dispatch(value), action);

/** Runs JavaScript in the page of the given address, or returns null when no such page is open. */
const inPage = (urlPart, script) =>
  app.evaluate(async ({ webContents }, { urlPart, script }) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes(urlPart));
    return page === undefined ? null : page.executeJavaScript(script);
  }, { urlPart, script });

/** Calls the app's own sleepTabView, as the minute timer does (the same module instance: Node caches it by path). */
const tabViewsModulePath = path.join(appDir, "dist", "node", "main", "tabViews.js");
const sleepTab = (tabId) =>
  app.evaluate((_electron, { modulePath, id }) => process.mainModule.require(modulePath).sleepTabView(id), { modulePath: tabViewsModulePath, id: tabId });

/** Marks the page of an address as in a call, as profiles.ts does when the camera or microphone is allowed. */
const mediaCaptureModulePath = path.join(appDir, "dist", "node", "main", "mediaCapture.js");
const markCapturing = (urlPart) =>
  app.evaluate(({ webContents }, { modulePath, urlPart }) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes(urlPart));
    process.mainModule.require(modulePath).markCapturing(page);
  }, { modulePath: mediaCaptureModulePath, urlPart });

const rendererCount = () => app.evaluate(({ app }) => app.getAppMetrics().filter((metric) => metric.type === "Tab").length);

await sidebar.waitForTimeout(1500);
await inPage("/one", `location.href = "${origin}/two"`);
await sidebar.waitForTimeout(1500);
await inPage("/two", `window.scrollTo(0, ${SCROLL_Y}); window.scrollY`);
await sidebar.waitForTimeout(500);

check("a page on screen refuses to sleep", (await sleepTab("tab-reader")) === false);

await dispatch({ type: "selectTab", tabId: "tab-other" });
await sidebar.waitForTimeout(1000);
const renderersAwake = await rendererCount();
const slept = await sleepTab("tab-reader");
await sidebar.waitForTimeout(1500);
const renderersAsleep = await rendererCount();
const pageAfterSleep = await inPage("/two", "location.href");
check("a page off screen goes to sleep and its renderer process ends", slept === true && pageAfterSleep === null && renderersAsleep === renderersAwake - 1, `${renderersAwake} → ${renderersAsleep} renderers`);
const sleepingState = await sidebar.evaluate(() => window.browserApi.getState());
check("the tab stays in the sidebar with its address and title", sleepingState.items["tab-reader"]?.url === `${origin}/two` && sleepingState.spaces[0].todayIds.includes("tab-reader"));

await dispatch({ type: "selectTab", tabId: "tab-reader" });
await sidebar.waitForTimeout(2500);
const scrollAfterWake = await inPage("/two", "window.scrollY");
check("selecting it wakes the page where it was, scrolled down", scrollAfterWake !== null && Math.abs(scrollAfterWake - SCROLL_Y) < 50, `scrollY ${scrollAfterWake}`);
const canGoBack = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((contents) => contents.getURL().includes("/two"))?.navigationHistory.canGoBack() ?? false);
check("and with page one still behind Back", canGoBack === true);

// A page in a call never sleeps, even silent; once it loads another page, the call is over and it may sleep.
await dispatch({ type: "selectTab", tabId: "tab-other" });
await sidebar.waitForTimeout(800);
await markCapturing("/two");
check("a page in a call (camera, microphone or screen share) refuses to sleep", (await sleepTab("tab-reader")) === false);
await inPage("/two", `location.href = "${origin}/three"`);
await sidebar.waitForTimeout(1500);
check("after it loads another page it may sleep again", (await sleepTab("tab-reader")) === true);

// ---------- What you can ask for ----------
/** Whether a tab's row in the sidebar is faded as asleep, and how faded its name is. */
const rowSleepLook = (tabId) =>
  sidebar.evaluate((id) => {
    const row = [...document.querySelectorAll(".tab-row")].find((candidate) => candidate.dataset.key?.endsWith(id));
    const title = row?.querySelector(".row-title");
    return { isAsleep: row?.classList.contains("is-asleep") ?? null, opacity: title === null || title === undefined ? null : getComputedStyle(title).opacity };
  }, tabId);
await dispatch({ type: "selectTab", tabId: "tab-reader" });
await sidebar.waitForTimeout(2000);
await dispatch({ type: "selectTab", tabId: "tab-local" });
await sidebar.waitForTimeout(2000);
await dispatch({ type: "selectTab", tabId: "tab-other" });
await sidebar.waitForTimeout(1000);
await dispatch({ type: "sleepTab", tabId: "tab-reader" });
await sidebar.waitForTimeout(1500);
const lookAsleep = await rowSleepLook("tab-reader");
check("Sleep Tab puts a page to sleep now", (await inPage("/three", "location.href")) === null);
check("and its row fades in the sidebar", lookAsleep.isAsleep === true && Number(lookAsleep.opacity) < 1, JSON.stringify(lookAsleep));
await dispatch({ type: "selectTab", tabId: "tab-reader" });
await sidebar.waitForTimeout(2500);
const lookAwake = await rowSleepLook("tab-reader");
check("waking it brings the row back", lookAwake.isAsleep === false && (await inPage("/three", "location.href")) !== null, JSON.stringify(lookAwake));

await dispatch({ type: "selectTab", tabId: "tab-other" });
await sidebar.waitForTimeout(1000);
const wasLocalAwake = (await inPage("/local", "location.href")) !== null;
await dispatch({ type: "setSiteKeptAwake", site: "127.0.0.1", isKeptAwake: true });
await dispatch({ type: "sleepOtherTabs" });
await sidebar.waitForTimeout(1500);
check("Sleep Other Tabs puts the other pages to sleep", wasLocalAwake && (await inPage("/local", "location.href")) === null);
check("but not a site kept awake", (await inPage("/three", "location.href")) !== null);
const keptState = await sidebar.evaluate(() => window.browserApi.getState());
check("Keep Awake is remembered per site", JSON.stringify(keptState.keepAwakeSites) === JSON.stringify(["127.0.0.1"]));

await dispatch({ type: "openTaskManager" });
const overlay = app.windows().find((page) => page.url().includes("/overlay/overlay.html"));
await overlay.waitForSelector(".task-line", { timeout: 8000 }).catch(() => undefined);
const taskLines = await overlay.$$eval(".task-line", (lines) => lines.map((line) => ({ tabId: line.dataset.tabId, numbers: line.querySelector(".task-numbers")?.textContent ?? "", canSleep: !line.querySelector(".task-sleep")?.disabled })));
const readerLine = taskLines.find((line) => line.tabId === "tab-reader");
fs.writeFileSync(path.join(outDir, "tab-sleep-task-manager.png"), await captureWindow(app));
check("Task Manager lists each awake page with its memory", readerLine !== undefined && /\d+ (MB|GB)/.test(readerLine.numbers), JSON.stringify(taskLines));
check("and only awake pages", taskLines.every((line) => line.tabId !== "tab-local"));
check("and Bow's own use", /Bow itself .* uses \d+/.test((await overlay.textContent(".task-summary")) ?? ""), await overlay.textContent(".task-summary"));
await overlay.click(".task-line[data-tab-id='tab-reader'] .task-sleep");
await sidebar.waitForTimeout(1500);
check("its Sleep button puts the page to sleep", (await inPage("/three", "location.href")) === null);
await overlay.press("body", "Escape");

// A crash: the app is killed (no quit, nothing saved on the way out). Started again, a page comes back scrolled where
// it was, from the back/forward lists Bow saves every few seconds (tabHistoryStore.ts).
await dispatch({ type: "selectTab", tabId: "tab-local" });
await sidebar.waitForTimeout(1500);
await inPage("/local", `window.scrollTo(0, ${SCROLL_Y}); window.scrollY`);
// Chromium commits the page state about a second after a scroll; the next save follows within 5 s.
await sidebar.waitForTimeout(7500);
app.process().kill("SIGKILL");
await new Promise((resolve) => setTimeout(resolve, 1500));
const afterCrash = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir],
  timeout: 30000,
});
let crashSidebar;
while (!crashSidebar) {
  crashSidebar = afterCrash.windows().find((page) => page.url().endsWith("/renderer/index.html"));
  if (!crashSidebar) await new Promise((resolve) => setTimeout(resolve, 150));
}
await crashSidebar.waitForSelector(".space-title");
await crashSidebar.evaluate(() => window.browserApi.dispatch({ type: "selectTab", tabId: "tab-local" }));
let scrollAfterCrash = null;
for (let attempt = 0; attempt < 30 && (scrollAfterCrash === null || scrollAfterCrash === 0); attempt += 1) {
  await crashSidebar.waitForTimeout(300);
  scrollAfterCrash = await afterCrash.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes("/local"));
    return page === undefined ? null : page.executeJavaScript("window.scrollY");
  });
}
check("after a crash, a page comes back scrolled where it was", scrollAfterCrash !== null && Math.abs(scrollAfterCrash - SCROLL_Y) < 50, `scrollY ${scrollAfterCrash}`);
await afterCrash.close();
server.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} tab sleep checks passed.`);
process.exit(failed === 0 ? 0 : 1);
