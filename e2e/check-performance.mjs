// End-to-end check that a big sidebar stays fast: 300 Today tabs plus 30 Pinned tabs in folders. Every state change
// redraws the sidebar (morph.ts keeps the elements, so only what changed is touched); this measures the sidebar
// page's main-thread time per change with Chromium's own counters (DevTools protocol Performance.getMetrics) and
// watches for long tasks (over 50 ms, the browser's "jank" line).
// usage: npm run build && node e2e/check-performance.mjs      (uses a throwaway --user-data-dir)
//   PERF_DETAIL=1 prints the metrics (style, layout); PERF_PROFILE=change or =select saves a CPU profile of that step
//   to e2e/output/sidebar-profile.cpuprofile (open it in Chrome's DevTools › Performance).
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-performance");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });

/** One frame at 60 Hz: a change should cost less than this on the sidebar's main thread. */
const FRAME_MS = 16.7;
/** Chromium's long-task line. */
const LONG_TASK_MS = 50;
const TODAY_TAB_COUNT = 300;
const PINNED_FOLDER_COUNT = 3;
const TABS_PER_FOLDER = 10;
const CHANGE_COUNT = 20;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// A made-up big state. Addresses use the reserved .invalid domain: nothing loads, icons fall back to letters.
const now = Date.now();
const items = {};
const todayIds = [];
const pinnedIds = [];
const tab = (id, title, homeUrl = null) => ({ kind: "tab", id, url: `https://example.invalid/${id}`, title, customTitle: null, faviconUrl: null, homeUrl, lastActiveAt: now, isMuted: false });
for (let index = 0; index < TODAY_TAB_COUNT; index++) {
  const id = `tab-today-${index}`;
  items[id] = tab(id, `Today page number ${index}`);
  todayIds.push(id);
}
for (let folderIndex = 0; folderIndex < PINNED_FOLDER_COUNT; folderIndex++) {
  const folderId = `folder-${folderIndex}`;
  const childIds = [];
  for (let index = 0; index < TABS_PER_FOLDER; index++) {
    const id = `tab-pinned-${folderIndex}-${index}`;
    items[id] = tab(id, `Pinned page ${folderIndex}.${index}`, `https://example.invalid/${id}`);
    childIds.push(id);
  }
  items[folderId] = { kind: "folder", id: folderId, title: `Folder ${folderIndex}`, childIds, isOpen: true };
  pinnedIds.push(folderId);
}
items["tab-blank"] = { ...tab("tab-blank", "Blank"), url: "about:blank" };
todayIds.unshift("tab-blank");
fs.writeFileSync(
  path.join(userDataDir, "browser-state.json"),
  JSON.stringify({
    version: 2,
    items,
    profiles: [{ id: "profile-default", name: "Default", favoriteIds: [] }],
    spaces: [{ id: "space-a", name: "Main", icon: "✦", theme: { colors: ["#000000"], appearance: "dark", grain: 0 }, profileId: "profile-default", pinnedIds, todayIds, isPinnedOpen: true }],
    activeSpaceId: "space-a",
    selectedTabIdBySpace: { "space-a": "tab-blank" },
    archive: [],
    settings: { archiveAfterMs: null, isSidebarVisible: true },
  }),
);

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir],
  timeout: 30000,
});
let sidebar;
while (!sidebar) {
  sidebar = app.windows().find((candidate) => candidate.url().endsWith("/renderer/index.html"));
  if (!sidebar) await new Promise((resolve) => setTimeout(resolve, 150));
}
await sidebar.waitForSelector(".space-title");
await sidebar.waitForTimeout(2000);

const rowCount = await sidebar.evaluate(() => document.querySelectorAll("[data-row='tab']").length);
check(`the sidebar shows all ${TODAY_TAB_COUNT + PINNED_FOLDER_COUNT * TABS_PER_FOLDER + 1} tabs`, rowCount === TODAY_TAB_COUNT + PINNED_FOLDER_COUNT * TABS_PER_FOLDER + 1, `${rowCount} rows`);

// Count the redraws: every state or runtime push redraws the sidebar.
await sidebar.evaluate(() => {
  globalThis.pushCount = 0;
  window.browserApi.onStateChanged(() => (globalThis.pushCount += 1));
  window.browserApi.onRuntimeChanged(() => (globalThis.pushCount += 1));
});
const readPushCount = () => sidebar.evaluate(() => globalThis.pushCount);

await sidebar.evaluate(() => {
  globalThis.longTasks = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) globalThis.longTasks.push(Math.round(entry.duration));
  }).observe({ type: "longtask", buffered: false });
});

const cdp = await sidebar.context().newCDPSession(sidebar);
await cdp.send("Performance.enable");
const readTaskSeconds = async () => {
  const { metrics } = await cdp.send("Performance.getMetrics");
  if (process.env.PERF_DETAIL) {
    console.log(metrics.filter((metric) => /Duration|Count/.test(metric.name)).map((metric) => `${metric.name}=${metric.value.toFixed(3)}`).join(" "));
  }
  return metrics.find((metric) => metric.name === "TaskDuration")?.value ?? 0;
};

// An idle stretch first: what the page spends while nothing changes (the baseline to subtract).
const IDLE_MS = 1500;
const idleStart = await readTaskSeconds();
await sidebar.waitForTimeout(IDLE_MS);
const idleSeconds = (await readTaskSeconds()) - idleStart;

if (process.env.PERF_PROFILE === "change") {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
}
const changePushesStart = await readPushCount();
const changeStart = await readTaskSeconds();
for (let index = 0; index < CHANGE_COUNT; index++) {
  await sidebar.evaluate((value) => window.browserApi.dispatch(value), { type: "renameItem", itemId: `tab-today-${index * 10}`, name: `Renamed ${index}` });
}
await sidebar.waitForFunction((count) => document.body.textContent.includes(`Renamed ${count - 1}`), CHANGE_COUNT);
await sidebar.waitForTimeout(IDLE_MS);
const changeSeconds = (await readTaskSeconds()) - changeStart - idleSeconds;
if (process.env.PERF_PROFILE === "change") {
  const { profile } = await cdp.send("Profiler.stop");
  fs.writeFileSync(path.join(outDir, "sidebar-profile.cpuprofile"), JSON.stringify(profile));
}
const changePushes = (await readPushCount()) - changePushesStart;
const perChangeMs = (changeSeconds * 1000) / changePushes;
check(`a change redraws the ${rowCount}-tab sidebar within a frame`, perChangeMs < FRAME_MS, `${perChangeMs.toFixed(1)} ms of main-thread time per redraw, ${changePushes} redraws for ${CHANGE_COUNT} renames (idle ${(idleSeconds * 1000).toFixed(0)} ms per ${IDLE_MS} ms)`);

// Selecting tabs changes the highlighted row and the runtime facts (the page loads): also within a frame.
if (process.env.PERF_PROFILE === "select") {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
}
const selectPushesStart = await readPushCount();
const selectStart = await readTaskSeconds();
for (let index = 0; index < CHANGE_COUNT; index++) {
  await sidebar.evaluate((value) => window.browserApi.dispatch(value), { type: "selectTab", tabId: `tab-pinned-${index % PINNED_FOLDER_COUNT}-${index % TABS_PER_FOLDER}` });
}
await sidebar.waitForTimeout(IDLE_MS);
const selectSeconds = (await readTaskSeconds()) - selectStart - idleSeconds;
const selectPushes = (await readPushCount()) - selectPushesStart;
if (process.env.PERF_PROFILE === "select") {
  const { profile } = await cdp.send("Profiler.stop");
  fs.writeFileSync(path.join(outDir, "sidebar-profile.cpuprofile"), JSON.stringify(profile));
}
const perSelectMs = (selectSeconds * 1000) / selectPushes;
check("selecting tabs (pages start loading) redraws within a frame", perSelectMs < FRAME_MS, `${perSelectMs.toFixed(1)} ms per redraw, ${selectPushes} redraws for ${CHANGE_COUNT} selections`);

const longTasks = await sidebar.evaluate(() => globalThis.longTasks);
check(`no long tasks (over ${LONG_TASK_MS} ms) while changing`, longTasks.length === 0, longTasks.length === 0 ? "" : `${longTasks.join(", ")} ms`);

// Arc's overlay scroller: the long list gives no width to a scroll bar, a knob shows while it scrolls, then fades.
const scrollFacts = () =>
  sidebar.evaluate(() => {
    const scroller = document.getElementById("sidebar-scroll");
    const thumb = document.querySelector(".overlay-scroll-thumb");
    return { barWidth: scroller.offsetWidth - scroller.clientWidth, isShown: thumb?.classList.contains("is-visible") ?? false, top: thumb?.offsetTop ?? 0, listTop: scroller.offsetTop };
  });
const beforeScroll = await scrollFacts();
check("the long sidebar list takes no width for a scroll bar, like Arc's overlay scroller", beforeScroll.barWidth === 0 && !beforeScroll.isShown, JSON.stringify(beforeScroll));
await sidebar.evaluate(() => document.getElementById("sidebar-scroll").scrollBy(0, 600));
await sidebar.waitForTimeout(150);
const whileScrolling = await scrollFacts();
check("scrolling shows the knob, moved down the list", whileScrolling.isShown && whileScrolling.top > whileScrolling.listTop + 2, JSON.stringify(whileScrolling));
await sidebar.waitForTimeout(1500);
const afterScroll = await scrollFacts();
check("and it fades once the list stops", !afterScroll.isShown, JSON.stringify(afterScroll));

await app.close();
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} performance checks passed.`);
process.exit(failed === 0 ? 0 : 1);
