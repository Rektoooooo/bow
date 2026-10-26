// End-to-end check that layout changes move, not jump: hiding the sidebar (⌘S), showing it again, and the hidden
// sidebar peeking in. The page view's place is sampled every few milliseconds while it moves; it must pass through
// in-between places and arrive where the layout says. The sidebar page's own card must move along (its grid column
// eases with the same duration). Also checks that a window resize does not animate.
// usage: npm run build && node e2e/check-motion.mjs      (uses a throwaway --user-data-dir)
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-motion");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });

/** Same values as shared/settings.ts. */
const SIDEBAR_WIDTH = 242;
const CARD_GAP = 7;
const CARD_INSET = 10;
const LAYOUT_MOTION_MS = 260;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const now = Date.now();
const tab = (id, url, title) => ({ kind: "tab", id, url, title, customTitle: null, faviconUrl: null, homeUrl: null, lastActiveAt: now, isMuted: false });
fs.writeFileSync(
  path.join(userDataDir, "browser-state.json"),
  JSON.stringify({
    version: 2,
    items: { "tab-a": tab("tab-a", "about:blank", "Blank") },
    profiles: [{ id: "profile-default", name: "Default", favoriteIds: [] }],
    spaces: [{ id: "space-a", name: "Main", icon: "✦", theme: { colors: ["#000000"], appearance: "dark", grain: 0 }, profileId: "profile-default", pinnedIds: [], todayIds: ["tab-a"], isPinnedOpen: true }],
    activeSpaceId: "space-a",
    selectedTabIdBySpace: { "space-a": "tab-a" },
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
await sidebar.waitForTimeout(800);
const dispatch = (action) => sidebar.evaluate((value) => window.browserApi.dispatch(value), action);

/**
 * Runs a step and records the page view's x (main process) and the sidebar page's card x every few milliseconds.
 */
async function sampleWhile(step, durationMs) {
  await app.evaluate(({ BrowserWindow }, duration) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
    const view = win.contentView.children.find((child) => child.webContents && child.webContents !== win.webContents && !child.webContents.getURL().includes("overlay"));
    globalThis.motionSamples = [];
    const started = Date.now();
    const timer = setInterval(() => {
      globalThis.motionSamples.push({ time: Date.now() - started, x: view.getBounds().x });
      if (Date.now() - started > duration) clearInterval(timer);
    }, 10);
  }, durationMs);
  const cardSamples = sidebar.evaluate((duration) => {
    return new Promise((resolve) => {
      const samples = [];
      const started = performance.now();
      const card = document.getElementById("card");
      const tick = () => {
        samples.push(Math.round(card.getBoundingClientRect().x));
        if (performance.now() - started < duration) requestAnimationFrame(tick);
        else resolve(samples);
      };
      requestAnimationFrame(tick);
    });
  }, durationMs);
  await step();
  const cards = await cardSamples;
  await sidebar.waitForTimeout(100);
  const views = await app.evaluate(() => globalThis.motionSamples);
  return { views: views.map((sample) => sample.x), cards: cards };
}

/** The distinct values a list passes through, in order. */
const distinct = (values) => values.filter((value, index) => index === 0 || value !== values[index - 1]);
const between = (values, low, high) => values.filter((value) => value > low && value < high);

const shownLeft = SIDEBAR_WIDTH + CARD_GAP;
const hiddenLeft = CARD_INSET;

const hiding = await sampleWhile(() => dispatch({ type: "setSidebarVisible", isVisible: false }), LAYOUT_MOTION_MS + 250);
const hidingViewSteps = between(distinct(hiding.views), hiddenLeft, shownLeft);
const hidingCardSteps = between(distinct(hiding.cards), hiddenLeft, shownLeft);
check("⌘S: the page glides left instead of jumping", hidingViewSteps.length >= 3 && hiding.views.at(-1) === hiddenLeft, `${distinct(hiding.views).join(" ")}`);
check("and the card in the sidebar page moves with it", hidingCardSteps.length >= 3 && hiding.cards.at(-1) === hiddenLeft, `${distinct(hiding.cards).join(" ")}`);

const showing = await sampleWhile(() => dispatch({ type: "setSidebarVisible", isVisible: true }), LAYOUT_MOTION_MS + 250);
check("⌘S again: the page glides back", between(distinct(showing.views), hiddenLeft, shownLeft).length >= 3 && showing.views.at(-1) === shownLeft, `${distinct(showing.views).join(" ")}`);

await dispatch({ type: "setSidebarVisible", isVisible: false });
await sidebar.waitForTimeout(LAYOUT_MOTION_MS + 200);
const peeking = await sampleWhile(() => dispatch({ type: "setSidebarPeek", isPeeking: true }), LAYOUT_MOTION_MS + 250);
check("the hidden sidebar peeking in slides the page aside smoothly", between(distinct(peeking.views), hiddenLeft, hiddenLeft + SIDEBAR_WIDTH).length >= 3 && peeking.views.at(-1) === hiddenLeft + SIDEBAR_WIDTH, `${distinct(peeking.views).join(" ")}`);
await dispatch({ type: "setSidebarPeek", isPeeking: false });
await sidebar.waitForTimeout(LAYOUT_MOTION_MS + 200);
await dispatch({ type: "setSidebarVisible", isVisible: true });
await sidebar.waitForTimeout(LAYOUT_MOTION_MS + 200);

const resizing = await sampleWhile(
  () =>
    app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
      const [width, height] = win.getContentSize();
      win.setContentSize(width - 100, height);
    }),
  150,
);
check("a window resize does not animate the page", distinct(resizing.views).length <= 2, `${distinct(resizing.views).join(" ")}`);

await app.close();
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} motion checks passed.`);
process.exit(failed === 0 ? 0 : 1);
