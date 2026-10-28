// End-to-end check of the real app: launch it, drive the sidebar, take screenshots, relaunch to check saving,
// and open a version 1 state file to check the upgrade.
// usage: npm run e2e        (builds first; output in e2e/output, or set E2E_OUTPUT_DIR)
// Uses throwaway --user-data-dir folders, so your real browser state is never touched.
// The sidebar page runs with reduced motion (emulated): rows appear and disappear at once, so checks never meet a
// row that is still animating. e2e/check-motion.mjs checks the animations themselves.
// Playwright emulates light mode by default, so screenshots here are light.
import "./background.mjs";
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
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
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
  const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  return win.contentView.children
    .filter((child) => child.webContents && child.webContents !== win.webContents && !child.webContents.getURL().startsWith("file:"))
    .map((child) => child.getBounds());
});

// Drags like a user with the mouse: the sidebar moves items with pointer events (dragDrop.ts), so Playwright's mouse
// is a real drag here. Press on the source, move past the threshold, move to a point inside the target
// (verticalFraction 0.5 = middle, which for a folder row means "inside"), let go.
async function simulateDrag(page, sourceSelector, targetSelector, verticalFraction = 0.5) {
  const source = await page.locator(sourceSelector).first().boundingBox();
  const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 6, start.y + 6, { steps: 2 });
  // The drop target may only appear once the drag has started (the Favorites end zone does).
  const target = await page.locator(targetSelector).first().boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height * verticalFraction, { steps: 4 });
  await page.mouse.up();
}

// ---------- first run ----------
let { app, page, mainLog, consoleErrors } = await launch(userDataDir);
await page.waitForSelector(".space-title", { timeout: 15000 });
// The first start shows the welcome tour (import, a look, shortcuts, default browser); Skip ends it for good.
const welcomeOverlay = await (async () => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const overlayPage = app.windows().find((candidate) => candidate.url().endsWith("/overlay/overlay.html"));
    if (overlayPage) return overlayPage;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
})();
const welcomeTitle = welcomeOverlay === null ? null : await welcomeOverlay.waitForSelector(".welcome-title", { timeout: 8000 }).then((title) => title.textContent()).catch(() => null);
check("the first start shows the welcome tour", welcomeTitle === "Welcome", String(welcomeTitle));
await welcomeOverlay?.click(".welcome-skip").catch(() => undefined);
await page.waitForTimeout(500);
check("Skip ends the tour for good", (await getState(page)).settings.hasSeenWelcome === true);
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
await dispatch(page, { type: "setShowFullUrls", isOn: true });
await page.waitForTimeout(300);
const fullAddress = await page.textContent(".address-text");
await dispatch(page, { type: "setShowFullUrls", isOn: false });
await page.waitForTimeout(300);
const shortAgain = await page.textContent(".address-text");
check("Show full URLs shows the whole address, and turning it off goes back", fullAddress === "https://example.com" && shortAgain === "example.com", `${fullAddress} → ${shortAgain}`);
const bounds = await tabViewBounds(app);
// Arc's measured layout: sidebar 242 + gap 7 → x 249; card inset 10 + toolbar 32 → y 42 (shared/settings.ts).
const SIDEBAR_WIDTH = 242;
const PAGE_LEFT = 249;
const PAGE_TOP = 42;
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
// Like Arc: a tab dragged onto the middle of another tab goes side by side with it, as a split view.
await simulateDrag(page, `[draggable="true"][data-item-id="${todayTabs(state)[1].id}"]`, `[draggable="true"][data-item-id="${todayTabs(state)[0].id}"]`, 0.5);
await page.waitForSelector(".split-row", { timeout: 5000 });
await page.waitForTimeout(500);
const splitBounds = await tabViewBounds(app);
check("a split view shows two pages side by side", splitBounds.length === 2 && splitBounds[0].x < splitBounds[1].x && splitBounds[0].y === splitBounds[1].y, JSON.stringify(splitBounds));
check("the split shows as one row with two panes", (await page.locator(".split-row .split-pane").count()) === 2);
await windowShot(app, "03-split-view");

// The divider between the panes: the sidebar page draws its handle in the gap main left between the pages
// (shared/splitLayout.ts on both sides); dragging resizes the pages and saves, a double-click makes them equal.
const panesByX = async () => (await tabViewBounds(app)).sort((first, second) => first.x - second.x);
const handleBox = await page.locator("#split-dividers .split-divider").first().boundingBox().catch(() => null);
const panesBefore = await panesByX();
const gapLeft = (panesBefore[0]?.x ?? 0) + (panesBefore[0]?.width ?? 0);
const gapRight = panesBefore[1]?.x ?? 0;
const handleCenterX = handleBox === null ? -1 : handleBox.x + handleBox.width / 2;
check("the split divider's handle sits in the gap between the two pages", handleCenterX > gapLeft && handleCenterX < gapRight, `${handleCenterX} in ${gapLeft}–${gapRight}`);
const handleCenterY = handleBox === null ? 0 : handleBox.y + handleBox.height / 2;
await page.mouse.move(handleCenterX, handleCenterY);
await page.mouse.down();
await page.mouse.move(handleCenterX - 150, handleCenterY, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(600);
state = await getState(page);
const resizedSplit = Object.values(state.items).find((item) => item.kind === "split");
const panesAfterDrag = await panesByX();
check("dragging the divider resizes the panes, and the sizes are saved", (resizedSplit?.sizes?.[0] ?? 1) < 0.45 && panesAfterDrag[0].width < panesBefore[0].width - 100, `${JSON.stringify(resizedSplit?.sizes)} ${panesBefore[0]?.width} → ${panesAfterDrag[0]?.width}`);
const movedHandle = await page.locator("#split-dividers .split-divider").first().boundingBox().catch(() => null);
const movedGap = (panesAfterDrag[0]?.x ?? 0) + (panesAfterDrag[0]?.width ?? 0);
check("and the handle follows into the new gap", movedHandle !== null && Math.abs(movedHandle.x - movedGap) <= 1, `${movedHandle?.x} vs ${movedGap}`);
await page.locator("#split-dividers .split-divider").first().dblclick();
await page.waitForTimeout(600);
state = await getState(page);
const panesEqual = await panesByX();
check("double-clicking the divider makes the panes equal again", Object.values(state.items).find((item) => item.kind === "split")?.sizes === undefined && Math.abs(panesEqual[0].width - panesEqual[1].width) <= 1, `${panesEqual[0]?.width} / ${panesEqual[1]?.width}`);
const orderBeforeSwap = Object.values(state.items).find((item) => item.kind === "split").childIds;
await dispatch(page, { type: "swapSplitPanes", splitId: Object.values(state.items).find((item) => item.kind === "split").id });
await page.waitForTimeout(400);
state = await getState(page);
check("Swap Panes trades the two pages' places", JSON.stringify(Object.values(state.items).find((item) => item.kind === "split").childIds) === JSON.stringify([...orderBeforeSwap].reverse()));
state = await getState(page);
// Like a Today tab's row, the split's row shows × on hover: it closes the split view, its tabs go to the Archive.
const splitItem = Object.values(state.items).find((item) => item.kind === "split");
await page.hover(".split-row");
await page.waitForTimeout(250);
const splitCloseOpacity = await page.$eval(".split-row .row-close", (button) => getComputedStyle(button).opacity).catch(() => "none");
await page.click(".split-row .row-close");
await page.waitForTimeout(500);
state = await getState(page);
const archivedIds = state.archive.slice(0, 2).map((entry) => entry.tab.id);
const isSplitClosed = state.items[splitItem.id] === undefined && todayTabs(state).length === 0 && splitItem.childIds.every((tabId) => archivedIds.includes(tabId));
check("hovering a split view's row shows × and it closes the split view into the Archive", splitCloseOpacity === "1" && isSplitClosed, `opacity ${splitCloseOpacity}, today ${todayTabs(state).length}, archived ${archivedIds.join(",")}`);

// ⌘W (or Close Split Pane) on one pane of a pinned split puts only that pane's page away, and the selection leaves
// the whole split: the split shows whole while any pane is selected, so it would load the closed page again.
const clickMenuItem = (label) => app.evaluate(({ Menu }, itemLabel) => {
  const menuItems = Menu.getApplicationMenu().items.flatMap((menu) => menu.submenu?.items ?? []);
  menuItems.find((item) => item.label === itemLabel).click();
}, label);
const shownPageUrls = () => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  return win.contentView.children
    .filter((child) => child.webContents && child.webContents !== win.webContents && !child.webContents.getURL().startsWith("file:"))
    .map((child) => child.webContents.getURL());
});
const loadedPageUrls = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().map((contents) => contents.getURL()));
await dispatch(page, { type: "openTab", typedText: "example.net" });
await dispatch(page, { type: "openTab", typedText: "example.org" });
await page.waitForFunction(() => document.querySelectorAll(".today-list .tab-row").length === 2, null, { timeout: 10000 });
state = await getState(page);
const pinnedPaneIds = todayTabs(state).map((tab) => tab.id);
for (const tabId of pinnedPaneIds) {
  await dispatch(page, { type: "pinTab", tabId: tabId });
}
await dispatch(page, { type: "splitTabs", firstTabId: pinnedPaneIds[0], secondTabId: pinnedPaneIds[1] });
await page.waitForSelector(".pinned-list .split-row", { timeout: 5000 });
await page.waitForTimeout(500);
state = await getState(page);
const pinnedSplit = pinnedItems(state).find((item) => item?.kind === "split");
const paneHosts = pinnedPaneIds.map((tabId) => new URL(state.items[tabId].homeUrl).host);
const showsPane = (urls) => urls.some((url) => paneHosts.some((host) => url.includes(host)));
const isPinnedSplitShown = pinnedSplit !== undefined && (await shownPageUrls()).length === 2;
await clickMenuItem("Close Tab");
await page.waitForTimeout(500);
state = await getState(page);
const closedPane = state.items[pinnedPaneIds[0]];
const selectedAfterClose = state.selectedTabIdBySpace[state.activeSpaceId];
const urlsAfterClose = await shownPageUrls();
const loadedAfterClose = await loadedPageUrls();
const isClosedPageGone = !loadedAfterClose.some((url) => url.includes(paneHosts[0]));
const isOtherPageKept = loadedAfterClose.some((url) => url.includes(paneHosts[1]));
const isSplitLeft = !pinnedPaneIds.includes(selectedAfterClose) && !showsPane(urlsAfterClose);
const isSplitKept = JSON.stringify(state.items[pinnedSplit?.id]?.childIds) === JSON.stringify(pinnedPaneIds);
const isPaneClosed = closedPane?.url === closedPane?.homeUrl && isClosedPageGone && isOtherPageKept && isSplitLeft && isSplitKept;
check("⌘W on a pinned split's pane puts only its page away and leaves the split", isPinnedSplitShown && isPaneClosed, `selected ${selectedAfterClose}, shown ${urlsAfterClose.join(",")}, loaded ${loadedAfterClose.join(",")}`);
await dispatch(page, { type: "selectTab", tabId: pinnedPaneIds[1] });
await page.waitForTimeout(800);
const isSplitShownAgain = (await shownPageUrls()).length === 2;
await clickMenuItem("Close Split Pane");
await page.waitForTimeout(500);
state = await getState(page);
const selectedAfterPaneClose = state.selectedTabIdBySpace[state.activeSpaceId];
const urlsAfterPaneClose = await shownPageUrls();
const isOtherPaneClosed = !pinnedPaneIds.includes(selectedAfterPaneClose) && !showsPane(urlsAfterPaneClose);
check("Close Split Pane on a pinned split's other pane leaves the split too", isSplitShownAgain && isOtherPaneClosed, `selected ${selectedAfterPaneClose}, shown ${urlsAfterPaneClose.join(",")}`);
// The checks below expect Pinned to hold only the folder.
await dispatch(page, { type: "deleteItem", itemId: pinnedSplit.id });
await page.waitForFunction(() => document.querySelectorAll(".pinned-list .split-row").length === 0, null, { timeout: 5000 });
// Clear (below) needs a Today tab again.
await dispatch(page, { type: "openTab", typedText: "example.net" });
await page.waitForFunction(() => document.querySelectorAll(".today-list .tab-row").length === 1, null, { timeout: 10000 });

await dispatch(page, { type: "setArchiveAfter", archiveAfterMs: 3600000 });
await page.waitForTimeout(200);
state = await getState(page);
check("'Archive tabs after' setting saves 1 hour", state.settings.archiveAfterMs === 3600000, String(state.settings.archiveAfterMs));

// A Today tab about to be archived shows the minutes left (main.ts measures every minute; set here directly through
// the app's own browserCore module, the instance the app uses).
const browserCorePath = path.join(appDir, "dist", "node", "main", "browserCore.js");
const soonTabId = todayTabs(state)[0]?.id;
await app.evaluate((_electron, { modulePath, tabId }) => process.mainModule.require(modulePath).setArchivingSoon({ [tabId]: 7 }), { modulePath: browserCorePath, tabId: soonTabId });
const soonText = await page.textContent(".today-list .tab-row .archive-soon", { timeout: 3000 }).catch(() => null);
check("a Today tab about to be archived shows the minutes left", soonText === "7m", String(soonText));
await app.evaluate((_electron, modulePath) => process.mainModule.require(modulePath).setArchivingSoon({}), browserCorePath);

await dispatch(page, { type: "clearTodayTabs" });
await page.waitForTimeout(300);
state = await getState(page);
check("Clear archives Today tabs and keeps Pinned ones", todayTabs(state).length === 0 && state.archive[0]?.reason === "clear-button" && pinnedItems(state).length === 1);
// The sidebar offers Undo for a few seconds (archiveUndoController.ts, sidebarNotice.ts); it puts the tab back.
const clearedTabId = state.archive[0]?.tab.id;
const undoText = await page.textContent("#sidebar-notice:not([hidden]) .sidebar-notice-text", { timeout: 3000 }).catch(() => null);
check("after Clear the sidebar offers Undo", undoText === "Cleared 1 tab", String(undoText));
await page.click("#sidebar-notice .sidebar-notice-button");
await page.waitForFunction(() => document.querySelectorAll(".today-list .tab-row").length === 1, null, { timeout: 5000 }).catch(() => undefined);
state = await getState(page);
const isOfferGone = await page.waitForSelector("#sidebar-notice[hidden]", { state: "attached", timeout: 3000 }).then(() => true, () => false);
check("Undo brings the cleared tab back, out of the Archive, and the offer goes", todayTabs(state)[0]?.id === clearedTabId && state.archive[0]?.tab.id !== clearedTabId && isOfferGone, `${todayTabs(state).map((tab) => tab?.id).join(",")} offer gone ${isOfferGone}`);
// Back to the state the checks below expect: Today cleared, no offer on screen.
await dispatch(page, { type: "clearTodayTabs" });
await dispatch(page, { type: "dismissNotice" });
await page.waitForTimeout(300);

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
check("touching the left edge shows the hidden sidebar and slides the page", sidebarShows && peekBounds[0]?.x === HIDDEN_PAGE_LEFT + SIDEBAR_WIDTH && peekBounds[0]?.width === hiddenBounds[0]?.width, JSON.stringify(peekBounds));
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

// Import From Browser: a made-up Chrome profile in a throwaway home folder. Its bookmarks arrive as one folder at
// the end of Pinned, keeping their folders; non-web addresses are left out. The summary dialog is answered here.
const fakeHome = path.join(outDir, "fake-home");
const chromeProfile = path.join(fakeHome, "Library", "Application Support", "Google", "Chrome", "Default");
fs.rmSync(fakeHome, { recursive: true, force: true });
fs.mkdirSync(chromeProfile, { recursive: true });
const chromeBookmarks = {
  roots: {
    bookmark_bar: {
      type: "folder",
      name: "Bookmarks bar",
      children: [
        { type: "url", name: "Example", url: "https://example.com/" },
        { type: "folder", name: "Reading", children: [{ type: "url", name: "Wikipedia", url: "https://www.wikipedia.org/" }] },
        { type: "url", name: "Settings", url: "chrome://settings/" },
      ],
    },
    other: { type: "folder", name: "Other bookmarks", children: [] },
  },
};
fs.writeFileSync(path.join(chromeProfile, "Bookmarks"), JSON.stringify(chromeBookmarks));
const realHome = await app.evaluate(({ app: electronApp, dialog }, home) => {
  const previousHome = electronApp.getPath("home");
  electronApp.setPath("home", home);
  dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  return previousHome;
}, fakeHome);
await dispatch(page, { type: "importFromBrowser", sourceId: "chromium:chrome:Default" });
await page.waitForTimeout(800);
await app.evaluate(({ app: electronApp }, home) => electronApp.setPath("home", home), realHome);
state = await getState(page);
const importedFolder = pinnedItems(state).at(-1);
const importedChildren = importedFolder?.kind === "folder" ? importedFolder.childIds.map((id) => state.items[id]) : [];
const barFolder = importedChildren[0];
const barChildren = barFolder?.kind === "folder" ? barFolder.childIds.map((id) => state.items[id]) : [];
check(
  "Import From Browser adds Chrome's bookmarks as one folder, keeping its folders and only web addresses",
  importedFolder?.title === "Google Chrome Bookmarks" && barChildren.map((item) => item.title).join(",") === "Example,Reading",
  `${importedFolder?.title} › ${barFolder?.title} › ${barChildren.map((item) => item.title).join(",")}`,
);

// Notes, like Arc's: a note sits in Today like a tab, its editor fills the page card, its first line names it, and
// its text is kept (in its own file) when you switch away and back. Pasted text arrives plain.
await dispatch(page, { type: "createNote" });
await page.waitForSelector(".note-body", { timeout: 5000 });
await page.waitForTimeout(400);
await page.click(".note-body");
await page.keyboard.type("Shopping list");
await page.keyboard.press("Enter");
await page.keyboard.type("- milk");
await page.waitForTimeout(1200);
state = await getState(page);
const noteTab = state.items[state.selectedTabIdBySpace[state.activeSpaceId]];
const noteViews = await tabViewBounds(app);
check("a new note opens in the card, without a web page, and its first line names the tab", noteTab?.url.startsWith("sidebar-note:") && noteTab?.title === "Shopping list" && noteViews.length === 0, `${noteTab?.title} views=${noteViews.length}`);
const noteListMade = await page.evaluate(() => document.querySelector(".note-body ul li")?.textContent ?? "");
check("typing '- ' at the start of a line makes a list", noteListMade === "milk", noteListMade);
const noteFile = path.join(userDataDir, "Notes", `${noteTab.url.slice("sidebar-note:".length)}.html`);
check("the note's text is saved in its own file", fs.existsSync(noteFile) && fs.readFileSync(noteFile, "utf8").includes("Shopping list"));
const otherTab = Object.values(state.items).find((item) => item.kind === "tab" && item.id !== noteTab.id && !item.url.startsWith("sidebar-note:"));
await dispatch(page, { type: "selectTab", tabId: otherTab.id });
await page.waitForTimeout(500);
await dispatch(page, { type: "selectTab", tabId: noteTab.id });
await page.waitForSelector(".note-body li", { timeout: 5000 }).catch(() => undefined);
const reopenedNote = await page.evaluate(() => document.querySelector(".note-body")?.innerText ?? "");
check("switching away and back keeps the note", reopenedNote.includes("Shopping list") && reopenedNote.includes("milk"), reopenedNote.replace(/\n/g, " / "));

// Easels, like Arc's: a board in the card; text and a pen stroke are kept in the easel's own file and come back
// after switching away.
await dispatch(page, { type: "createEasel" });
await page.waitForSelector(".easel-viewport", { timeout: 5000 });
await page.waitForTimeout(400);
const boardBox = await page.locator(".easel-viewport").boundingBox();
await page.click('[data-tool-button="text"]');
await page.mouse.click(boardBox.x + 100, boardBox.y + 120);
await page.keyboard.type("Board idea");
await page.click('[data-tool-button="pen"]');
await page.mouse.move(boardBox.x + 100, boardBox.y + 220);
await page.mouse.down();
for (let step = 0; step <= 12; step++) {
  await page.mouse.move(boardBox.x + 100 + step * 15, boardBox.y + 220 + step * 4);
}
await page.mouse.up();
await page.waitForTimeout(1300);
state = await getState(page);
const easelTab = state.items[state.selectedTabIdBySpace[state.activeSpaceId]];
const easelFile = path.join(userDataDir, "Easels", `${easelTab.url.slice("sidebar-easel:".length)}.json`);
const savedKinds = fs.existsSync(easelFile) ? JSON.parse(fs.readFileSync(easelFile, "utf8")).elements.map((element) => element.kind).join(",") : "none";
check("an easel keeps its text and drawing in its own file", easelTab.url.startsWith("sidebar-easel:") && savedKinds === "text,stroke", savedKinds);
await dispatch(page, { type: "selectTab", tabId: noteTab.id });
await page.waitForTimeout(400);
await dispatch(page, { type: "selectTab", tabId: easelTab.id });
await page.waitForSelector(".easel-text", { timeout: 5000 }).catch(() => undefined);
const reopenedBoard = await page.evaluate(() => ({ text: document.querySelector(".easel-text")?.textContent ?? "", strokes: document.querySelectorAll(".easel-strokes path").length }));
check("switching away and back keeps the board", reopenedBoard.text === "Board idea" && reopenedBoard.strokes === 1, JSON.stringify(reopenedBoard));

// Another app icon: our own drawing in another look, drawn for the Dock (errors would show in the main log below).
await dispatch(page, { type: "setAppIcon", variantId: "pixel" });
await page.waitForTimeout(1500);
state = await getState(page);
check("choosing another app icon is saved and drawn for the Dock", state.settings.appIcon === "pixel", String(state.settings.appIcon));
await dispatch(page, { type: "setAppIcon", variantId: "glass" });
await page.waitForTimeout(1000);

// ---------- Tab power tools: duplicates, Close Duplicate Tabs, tab search (⇧⌘A), several tabs at once ----------
const tabsWith = (current, part) => Object.values(current.items).filter((item) => item.kind === "tab" && item.url.includes(part));
const tabCount = (current) => Object.values(current.items).filter((item) => item.kind === "tab").length;
const noticeText = () => page.textContent("#sidebar-notice:not([hidden]) .sidebar-notice-text", { timeout: 3000 }).catch(() => null);
for (const part of ["power-a", "power-b", "power-c"]) {
  await dispatch(page, { type: "openTab", typedText: `example.com/${part}` });
}
await page.waitForTimeout(800);
state = await getState(page);
const firstPowerA = tabsWith(state, "power-a")[0]?.id;
const countBeforeDuplicate = tabCount(state);
await dispatch(page, { type: "openTab", typedText: "https://www.example.com/power-a/" });
await page.waitForTimeout(500);
state = await getState(page);
const switchNotice = await noticeText();
check("typing an address already open switches to its tab, and says so", state.selectedTabIdBySpace[state.activeSpaceId] === firstPowerA && tabCount(state) === countBeforeDuplicate && switchNotice === "Switched to the tab you already had open", String(switchNotice));
await page.click("#sidebar-notice .sidebar-notice-button");
await page.waitForTimeout(500);
state = await getState(page);
check("its Open Another opens the address in a new tab anyway", tabsWith(state, "power-a").length === 2);
await dispatch(page, { type: "closeDuplicateTabs" });
await page.waitForTimeout(500);
state = await getState(page);
const duplicatesNotice = await noticeText();
check("Close Duplicate Tabs keeps one copy, with Undo", tabsWith(state, "power-a").length === 1 && duplicatesNotice === "Closed 1 duplicate tab", String(duplicatesNotice));
await dispatch(page, { type: "dismissNotice" });

const overlayPage = app.windows().find((candidate) => candidate.url().includes("/overlay/overlay.html"));
await dispatch(page, { type: "openCommandBar", mode: "tabs" });
await overlayPage.waitForSelector(".command-input", { timeout: 5000 });
await overlayPage.fill(".command-input", "power-b");
await overlayPage.waitForTimeout(500);
const tabSearchLines = await overlayPage.$$eval(".command-line", (lines) => lines.map((line) => line.querySelector(".command-line-subtitle")?.textContent ?? ""));
const spaceName = activeSpace(state).name;
check("tab search (⇧⌘A) lists the matching tabs with their Space", tabSearchLines.length === 1 && tabSearchLines[0].includes(spaceName), JSON.stringify(tabSearchLines));
await overlayPage.press(".command-input", "Enter");
await page.waitForTimeout(500);
state = await getState(page);
check("and choosing one switches to it", state.items[state.selectedTabIdBySpace[state.activeSpaceId]]?.url.includes("power-b") === true);

const powerIds = ["power-a", "power-b", "power-c"].map((part) => tabsWith(state, part)[0]?.id);
const rowOf = (tabId) => `#space-content .tab-row[data-item-id="${tabId}"]`;
const todayOrder = activeSpace(state).todayIds.filter((itemId) => powerIds.includes(itemId));
await page.click(rowOf(todayOrder[0]), { modifiers: ["Meta"] });
await page.click(rowOf(todayOrder[2]), { modifiers: ["Shift"] });
const pickedIds = await page.$$eval(".tab-row.is-multi-selected", (rows) => rows.map((row) => row.dataset.itemId));
check("⌘-click and ⇧-click pick several tab rows", powerIds.every((tabId) => pickedIds.includes(tabId)), `${pickedIds.length} picked`);
await app.evaluate(({ Menu }) => {
  globalThis.originalPopup = Menu.prototype.popup;
  Menu.prototype.popup = function capturePopup() {
    globalThis.lastMenu = this;
  };
});
await page.click(rowOf(todayOrder[1]), { button: "right" });
await page.waitForTimeout(400);
const pickedMenuLabels = await app.evaluate(() => globalThis.lastMenu?.items.map((item) => item.label) ?? []);
check("right-clicking a picked tab acts on all of them", pickedMenuLabels.includes(`Close ${pickedIds.length} Tabs`) && pickedMenuLabels.includes(`Pin ${pickedIds.length} Tabs`), pickedMenuLabels.join(" | "));
await app.evaluate((_electron, label) => globalThis.lastMenu.items.find((item) => item.label === label).click(), `Close ${pickedIds.length} Tabs`);
await page.waitForTimeout(500);
state = await getState(page);
const closedNotice = await noticeText();
check("closing them archives them together, with Undo", powerIds.every((tabId) => state.items[tabId] === undefined) && closedNotice === `Closed ${pickedIds.length} tabs`, String(closedNotice));
await page.click("#sidebar-notice .sidebar-notice-button");
await page.waitForTimeout(500);
state = await getState(page);
check("and Undo brings them all back", powerIds.every((tabId) => state.items[tabId] !== undefined));
await page.click(rowOf(powerIds[0]), { modifiers: ["Meta"] });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check("Escape forgets the picked tabs", (await page.$$(".tab-row.is-multi-selected")).length === 0);
await app.evaluate(({ Menu }) => {
  Menu.prototype.popup = globalThis.originalPopup;
});

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
check("a milestone 1 (version 1) file opens and is upgraded", state.version === 4 && state.focusedWindowId === "window-1" && state.spaces[0].pinnedIds[0] === "tab-old" && state.settings.archiveAfterMs === 21600000);
await upgraded.app.close();

// Chromium prints its own internal log lines ("[pid:date/time:ERROR:base/…]"); only our app's output counts.
const appLogLines = (firstRunLog + mainLog.join("")).split("\n").filter((line) => !/^\[\d+:\d+\/\d+\.\d+:/.test(line));
const appErrorLines = appLogLines.filter((line) => /error/i.test(line) && !line.startsWith("Debugger"));
check("main process printed no errors", appErrorLines.length === 0, appErrorLines.join(" | ").slice(0, 300));

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in ${outDir}`);
process.exit(failed === 0 ? 0 : 1);
