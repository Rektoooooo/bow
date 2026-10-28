// End-to-end check that layout changes move, not jump: hiding the sidebar (⌘S), showing it again, the hidden
// sidebar peeking in, Compact Mode with its toolbar peeking in from the top edge, and Focus Mode. The page view's place is sampled every few milliseconds while it moves; it must pass through
// in-between places and arrive where the layout says. The sidebar page's own card must move along (its grid column
// eases with the same duration). Also checks that a window resize does not animate.
// usage: npm run build && node e2e/check-motion.mjs      (uses a throwaway --user-data-dir)
import "./background.mjs";
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
const LIBRARY_COLUMN_WIDTH = 560; // = LIBRARY_COLUMN_WIDTH_PX
const TOOLBAR_HEIGHT = 32; // = TOOLBAR_HEIGHT_PX

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
    items: { "tab-a": tab("tab-a", "about:blank", "Blank"), "tab-b": tab("tab-b", "about:blank", "Second") },
    profiles: [{ id: "profile-default", name: "Default", favoriteIds: [] }],
    spaces: [{ id: "space-a", name: "Main", icon: "✦", theme: { colors: ["#000000"], appearance: "dark", grain: 0 }, profileId: "profile-default", pinnedIds: [], todayIds: ["tab-a", "tab-b"], isPinnedOpen: true }],
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
// The card (and its toolbar) goes along at its full width: it used to fall into the hidden sidebar's empty grid
// column and shrink to nothing, so the page had no toolbar while the sidebar peeked.
const peekingCard = await sidebar.evaluate(() => {
  const card = document.getElementById("card").getBoundingClientRect();
  const toolbar = document.querySelector(".toolbar").getBoundingClientRect();
  return { cardX: Math.round(card.x), cardWidth: Math.round(card.width), toolbarWidth: Math.round(toolbar.width), windowWidth: window.innerWidth };
});
const fullCardWidth = peekingCard.windowWidth - 2 * CARD_INSET;
check("and the card with its toolbar slides with it, keeping its width", peekingCard.cardX === hiddenLeft + SIDEBAR_WIDTH && peekingCard.cardWidth === fullCardWidth && peekingCard.toolbarWidth === fullCardWidth, JSON.stringify(peekingCard));
await dispatch({ type: "setSidebarPeek", isPeeking: false });
await sidebar.waitForTimeout(LAYOUT_MOTION_MS + 200);
await dispatch({ type: "setSidebarVisible", isVisible: true });
await sidebar.waitForTimeout(LAYOUT_MOTION_MS + 200);

// Compact Mode (⌥⌘S): sidebar and toolbar hidden, the page at the card's top-left inset. Pointing at the window's top
// edge slides the toolbar in (the page moves down without resizing); moving down onto the page slides it out again.
// Focus Mode (⇧⌘F): the page fills the window; leaving it brings Compact Mode's layout back.
const pageBounds = () =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
    const view = win.contentView.children.find((child) => child.webContents && child.webContents !== win.webContents && !child.webContents.getURL().includes("overlay") && !child.webContents.getURL().startsWith("file:"));
    const [width, height] = win.getContentSize();
    return { ...view.getBounds(), windowWidth: width, windowHeight: height };
  });
await dispatch({ type: "toggleCompactMode" });
await sidebar.waitForTimeout(LAYOUT_MOTION_MS + 300);
const compact = await pageBounds();
const compactToolbarShown = await sidebar.evaluate(() => getComputedStyle(document.querySelector(".toolbar")).display !== "none");
check("Compact Mode hides the sidebar and the toolbar: the page starts at the card's top-left inset", compact.x === CARD_INSET && compact.y === CARD_INSET && !compactToolbarShown, `${JSON.stringify(compact)} toolbar ${compactToolbarShown}`);
const edgeX = Math.round(compact.windowWidth / 2);
await sidebar.mouse.move(edgeX, CARD_INSET + 200);
await sidebar.mouse.move(edgeX, 3);
await sidebar.waitForTimeout(LAYOUT_MOTION_MS + 300);
const toolbarPeeking = await pageBounds();
const peekingToolbar = await sidebar.evaluate(() => {
  const toolbar = document.querySelector(".toolbar").getBoundingClientRect();
  return { top: Math.round(toolbar.top), height: Math.round(toolbar.height) };
});
check(
  "pointing at the top edge slides the toolbar in and the page down, without resizing it",
  toolbarPeeking.y === CARD_INSET + TOOLBAR_HEIGHT && toolbarPeeking.height === compact.height && peekingToolbar.top === CARD_INSET && peekingToolbar.height >= TOOLBAR_HEIGHT - 1,
  `${JSON.stringify(toolbarPeeking)} toolbar ${JSON.stringify(peekingToolbar)}`,
);
await sidebar.mouse.move(edgeX, CARD_INSET + TOOLBAR_HEIGHT + 200);
await sidebar.waitForTimeout(LAYOUT_MOTION_MS + 600);
const toolbarGone = await pageBounds();
check("moving down onto the page slides it out again", toolbarGone.y === CARD_INSET, JSON.stringify(toolbarGone));
const enteringFocus = await sampleWhile(() => dispatch({ type: "toggleFocusMode" }), LAYOUT_MOTION_MS + 250);
const focus = await pageBounds();
check("Focus Mode: the page fills the window, gliding there", focus.x === 0 && focus.y === 0 && focus.width === focus.windowWidth && focus.height === focus.windowHeight && distinct(enteringFocus.views).length >= 3, `${JSON.stringify(focus)} / ${distinct(enteringFocus.views).join(" ")}`);
await sidebar.mouse.move(edgeX, 3);
await sidebar.waitForTimeout(LAYOUT_MOTION_MS + 200);
check("and nothing peeks in Focus Mode", (await pageBounds()).y === 0);
await dispatch({ type: "toggleFocusMode" });
await sidebar.waitForTimeout(LAYOUT_MOTION_MS + 300);
const leftFocus = await pageBounds();
await dispatch({ type: "toggleCompactMode" });
await sidebar.waitForTimeout(LAYOUT_MOTION_MS + 300);
const normalAgain = await pageBounds();
check("leaving Focus Mode, then Compact Mode, brings each layout back", leftFocus.x === CARD_INSET && leftFocus.y === CARD_INSET && normalAgain.x === shownLeft && normalAgain.y === CARD_INSET + TOOLBAR_HEIGHT, `${JSON.stringify(leftFocus)} / ${JSON.stringify(normalAgain)}`);

// The Library takes the sidebar column, like Arc's: the page glides aside to make room for it, and back when it closes.
const libraryLeft = LIBRARY_COLUMN_WIDTH + CARD_GAP;
const openingLibrary = await sampleWhile(() => dispatch({ type: "openLibrary" }), LAYOUT_MOTION_MS + 250);
const libraryViewSteps = between(distinct(openingLibrary.views), shownLeft, libraryLeft);
check("opening the Library glides the page aside for its column, the card with it", libraryViewSteps.length >= 3 && openingLibrary.views.at(-1) === libraryLeft && openingLibrary.cards.at(-1) === libraryLeft, `${distinct(openingLibrary.views).join(" ")} / ${distinct(openingLibrary.cards).join(" ")}`);
const overlayPage = app.windows().find((candidate) => candidate.url().endsWith("/overlay/overlay.html"));
const closingLibrary = await sampleWhile(() => overlayPage.evaluate(() => window.overlayApi.close()), LAYOUT_MOTION_MS + 250);
check("closing it glides the page back", between(distinct(closingLibrary.views), shownLeft, libraryLeft).length >= 3 && closingLibrary.views.at(-1) === shownLeft, distinct(closingLibrary.views).join(" "));

// A split: the page already on screen glides from the full card to its half.
const widths = [];
await app.evaluate(() => {
  globalThis.widthSamples = [];
});
await app.evaluate(({ BrowserWindow }, duration) => {
  const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  const view = win.contentView.children.find((child) => child.webContents && child.webContents !== win.webContents && !child.webContents.getURL().includes("overlay"));
  const started = Date.now();
  const timer = setInterval(() => {
    globalThis.widthSamples.push(view.getBounds().width);
    if (Date.now() - started > duration) clearInterval(timer);
  }, 10);
}, LAYOUT_MOTION_MS + 250);
await dispatch({ type: "splitTabs", firstTabId: "tab-a", secondTabId: "tab-b" });
await sidebar.waitForTimeout(LAYOUT_MOTION_MS + 350);
widths.push(...(await app.evaluate(() => globalThis.widthSamples)));
const distinctWidths = distinct(widths);
check("making a split glides the page to its half", distinctWidths.length >= 4 && distinctWidths.at(-1) < distinctWidths[0], distinctWidths.join(" "));

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
