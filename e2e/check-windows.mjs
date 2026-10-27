// End-to-end check of several main windows (File › New Window, ⌘N, like Arc): a second window opens with its own
// sidebar over the same Spaces and tabs; each window keeps its own Space and selection; a tab selected in both shows
// "Open in another window" in the second one (and Move to This Window takes the page over); the Command Bar opens in
// the focused window; menus act on the focused window; closing one window keeps the other; a restart opens both
// again where they were; and the app quits with the last window, which the next start opens again.
// usage: npm run build && node e2e/check-windows.mjs      (uses a throwaway --user-data-dir)
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-windows");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// Three small pages, so each window's page views can be told apart by address.
const server = http.createServer((request, response) => {
  const name = request.url.slice(1) || "index";
  response.writeHead(200, { "content-type": "text/html" });
  response.end(`<!doctype html><title>${name}</title><h1>${name}</h1>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const urlOf = (name) => `${origin}/${name}`;

const now = Date.now();
const tab = (id, name) => ({ kind: "tab", id, url: urlOf(name), title: name, customTitle: null, faviconUrl: null, homeUrl: null, lastActiveAt: now, isMuted: false });
const space = (id, name, todayIds, pinnedIds = []) => ({ id, name, icon: "✦", theme: { colors: ["#000000"], appearance: "dark", grain: 0 }, profileId: "profile-default", pinnedIds, todayIds, isPinnedOpen: true });
const folder = { kind: "folder", id: "folder-reading", title: "Reading", childIds: [], isOpen: true };
const splitPair = { kind: "split", id: "split-pair", childIds: ["tab-left", "tab-right"], orientation: "horizontal" };
const spareTabNames = ["gamma", "delta", "epsilon", "zeta", "left", "right"];
const spareTabs = Object.fromEntries(spareTabNames.map((name) => [`tab-${name}`, tab(`tab-${name}`, name)]));

/** Same values as shared/settings.ts: where the page card starts with the sidebar shown, and with it hidden. */
const SIDEBAR_WIDTH = 242;
const CARD_GAP = 7;
const CARD_INSET = 10;
fs.writeFileSync(
  path.join(userDataDir, "browser-state.json"),
  JSON.stringify({
    version: 3,
    items: { "tab-alpha": tab("tab-alpha", "alpha"), "tab-beta": tab("tab-beta", "beta"), "tab-work": tab("tab-work", "work"), "folder-reading": folder, "split-pair": splitPair, ...spareTabs },
    profiles: [{ id: "profile-default", name: "Default", favoriteIds: [] }],
    spaces: [
      space("space-main", "Main", ["tab-alpha", "tab-beta", "tab-gamma", "tab-delta", "tab-epsilon", "tab-zeta"], ["folder-reading"]),
      space("space-work", "Work", ["tab-work", "split-pair"]),
    ],
    activeSpaceId: "space-main",
    selectedTabIdBySpace: { "space-main": "tab-alpha", "space-work": "tab-work" },
    focusedWindowId: "window-1",
    otherWindows: [],
    archive: [],
    settings: { archiveAfterMs: 43200000, isSidebarVisible: true },
  }),
);

// window-state.json as it was before several windows: one rectangle. It belongs to the first window.
const LEGACY_BOUNDS = { x: 140, y: 90, width: 1100, height: 760 };
fs.writeFileSync(path.join(userDataDir, "window-state.json"), JSON.stringify(LEGACY_BOUNDS));

const isSidebarPage = (page) => page.url().endsWith("/renderer/index.html");

async function launch() {
  const app = await _electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir],
    timeout: 30000,
  });
  const mainLog = [];
  // E2E_DEBUG=1 prints the main process's own output as it comes.
  const keep = (data) => {
    mainLog.push(data.toString());
    if (process.env.E2E_DEBUG) process.stdout.write(`[main] ${data}`);
  };
  app.process().stdout.on("data", keep);
  app.process().stderr.on("data", keep);
  return { app, mainLog };
}

/** Waits until the app has this many sidebar pages and returns them (oldest first). */
async function waitForSidebars(app, count) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const sidebars = app.windows().filter(isSidebarPage);
    if (sidebars.length >= count) {
      // "attached": a window whose sidebar is hidden (⌘S) still draws it, out of sight.
      for (const sidebar of sidebars) await sidebar.waitForSelector(".space-title", { state: "attached", timeout: 30000 });
      return sidebars;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Expected ${count} sidebar pages, found ${app.windows().filter(isSidebarPage).length}`);
}

const getState = (sidebar) => sidebar.evaluate(() => window.browserApi.getState());
const getRuntime = (sidebar) => sidebar.evaluate(() => window.browserApi.getRuntimeState());
const dispatch = (sidebar, action) => sidebar.evaluate((value) => window.browserApi.dispatch(value), action);
const selectedTabId = (state) => state.selectedTabIdBySpace[state.activeSpaceId] ?? null;

/** Every main window as the main process sees it: its name tag, bounds, page addresses and whether the overlay is in it. */
function describeWindows(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    // A closing window can still be listed while its page is already gone.
    const isOpenMainWindow = (candidate) => !candidate.isDestroyed() && !candidate.webContents.isDestroyed() && candidate.webContents.getURL().endsWith("/renderer/index.html");
    const windows = BrowserWindow.getAllWindows().filter(isOpenMainWindow);
    const described = [];
    for (const window of windows) {
      if (window.isDestroyed()) continue;
      const children = window.contentView.children.filter((child) => child.webContents && !child.webContents.isDestroyed() && child.webContents !== window.webContents);
      const urls = children.map((child) => child.webContents.getURL());
      // A window that is closing never answers; it counts as gone.
      const tag = await Promise.race([window.webContents.executeJavaScript("window.name"), new Promise((resolve) => setTimeout(() => resolve(null), 500))]);
      if (tag === null) continue;
      described.push({
        tag: tag,
        bounds: window.getNormalBounds(),
        pageUrls: urls.filter((url) => url.startsWith("http")),
        pageX: children.find((child) => child.webContents.getURL().startsWith("http"))?.getBounds().x ?? null,
        hasOverlay: urls.some((url) => url.endsWith("/overlay/overlay.html")),
      });
    }
    return described;
  });
}

/** Names each sidebar page (window.name), so describeWindows can tell the windows apart. */
async function tagWindows(sidebars, tags) {
  for (let index = 0; index < sidebars.length; index++) {
    await sidebars[index].evaluate((tag) => { window.name = tag; }, tags[index]);
  }
}

const findWindow = (windows, tag) => windows.find((candidate) => candidate.tag === tag);

/** Waits until a condition on the windows holds (views move after a state change), then returns them. */
async function waitForWindows(app, condition) {
  const deadline = Date.now() + 5000;
  let windows = await describeWindows(app);
  while (!condition(windows) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    windows = await describeWindows(app);
  }
  return windows;
}

/** Clicks an app menu item by its label, like the user choosing it. */
const clickMenuItem = (app, label) =>
  app.evaluate(({ Menu }, wanted) => {
    const search = (items) => {
      for (const item of items) {
        if (item.label === wanted) return item;
        const inside = item.submenu ? search(item.submenu.items) : null;
        if (inside) return inside;
      }
      return null;
    };
    const item = search(Menu.getApplicationMenu().items);
    item?.click();
    return item !== null;
  }, label);

/**
 * Drags a sidebar item out of one window's sidebar and drops it on a target in another's, with the HTML drag events
 * the user's drag fires (Playwright's own drag hangs in Electron). The target page knows the item only from main.
 */
async function dragAcrossWindows(fromSidebar, itemId, toSidebar, targetSelector, verticalFraction = 0.5) {
  await fromSidebar.evaluate((id) => {
    const source = document.querySelector(`[draggable="true"][data-item-id="${id}"]`);
    window.crossWindowDrag = { source: source, dataTransfer: new DataTransfer() };
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: window.crossWindowDrag.dataTransfer }));
  }, itemId);
  const isAccepted = await toSidebar.waitForFunction(() => document.body.classList.contains("is-dragging"), null, { timeout: 3000 }).then(() => true, () => false);
  await toSidebar.evaluate(({ selector, fraction }) => {
    const target = document.querySelector(selector);
    const rectangle = target.getBoundingClientRect();
    const point = { clientX: rectangle.left + rectangle.width / 2, clientY: rectangle.top + rectangle.height * fraction };
    const dataTransfer = new DataTransfer();
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, ...point }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, ...point }));
  }, { selector: targetSelector, fraction: verticalFraction });
  await fromSidebar.evaluate(() => {
    const drag = window.crossWindowDrag;
    drag.source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: drag.dataTransfer }));
  });
  await toSidebar.waitForTimeout(500);
  return isAccepted;
}

/** Whether the "Open in another window" card shows in a sidebar page. */
const showsElsewhereCard = (sidebar) => sidebar.evaluate(() => document.getElementById("elsewhere-card")?.hidden === false);

// ---------- first run: two windows ----------
let { app, mainLog } = await launch();
let [firstSidebar] = await waitForSidebars(app, 1);
await firstSidebar.waitForTimeout(800);
await tagWindows([firstSidebar], ["first"]);
const legacyWindow = findWindow(await describeWindows(app), "first");
const legacyBounds = legacyWindow?.bounds;
check(
  "an old window-state.json (one rectangle) places the first window",
  legacyBounds?.x === LEGACY_BOUNDS.x && legacyBounds?.y === LEGACY_BOUNDS.y && legacyBounds?.width === LEGACY_BOUNDS.width && legacyBounds?.height === LEGACY_BOUNDS.height,
  JSON.stringify(legacyBounds),
);

await clickMenuItem(app, "New Window");
let sidebars = await waitForSidebars(app, 2);
let secondSidebar = sidebars.find((sidebar) => sidebar !== firstSidebar);
await tagWindows([secondSidebar], ["second"]);
let windows = await waitForWindows(app, (list) => findWindow(list, "second")?.hasOverlay === true);
check("⌘N opens a second main window with its own sidebar", windows.length === 2 && secondSidebar !== undefined, `${windows.length} windows`);
check("it opens beside the first one, not on top of it", findWindow(windows, "second").bounds.x !== findWindow(windows, "first").bounds.x);
check("the Command Bar opens in the new window, ready for a new tab", findWindow(windows, "second").hasOverlay && !findWindow(windows, "first").hasOverlay);
const overlayPage = app.windows().find((page) => page.url().endsWith("/overlay/overlay.html"));
await overlayPage.keyboard.press("Escape");
await secondSidebar.waitForTimeout(400);

let firstState = await getState(firstSidebar);
let secondState = await getState(secondSidebar);
check(
  "both windows show the same Spaces and tabs",
  JSON.stringify(firstState.spaces) === JSON.stringify(secondState.spaces) && Object.keys(secondState.items).length === 11,
);
check("the new window starts on the same Space with nothing selected", secondState.activeSpaceId === "space-main" && selectedTabId(secondState) === null && selectedTabId(firstState) === "tab-alpha");
check("the new window has the focus", secondState.focusedWindowId !== "window-1" && firstState.otherWindows.length === 1);

// Each window keeps its own Space.
await dispatch(secondSidebar, { type: "switchSpace", spaceId: "space-work" });
await secondSidebar.waitForTimeout(500);
firstState = await getState(firstSidebar);
secondState = await getState(secondSidebar);
const firstTitle = await firstSidebar.textContent(".space-title");
const secondTitle = await secondSidebar.textContent(".space-title");
check("switching Spaces in one window does not move the other", secondState.activeSpaceId === "space-work" && firstState.activeSpaceId === "space-main", `${firstTitle?.trim()} / ${secondTitle?.trim()}`);
check("the new window has nothing selected in the other Space either (an empty card)", selectedTabId(secondState) === null);
await dispatch(secondSidebar, { type: "selectTab", tabId: "tab-work" });
windows = await waitForWindows(app, (list) => findWindow(list, "second")?.pageUrls.includes(urlOf("work")));
check("each window shows its own Space's page", findWindow(windows, "first").pageUrls.join() === urlOf("alpha") && findWindow(windows, "second").pageUrls.join() === urlOf("work"), JSON.stringify(windows.map((window) => window.pageUrls)));

// Each window keeps its own selection in the same Space.
await dispatch(secondSidebar, { type: "switchSpace", spaceId: "space-main" });
await dispatch(secondSidebar, { type: "selectTab", tabId: "tab-beta" });
windows = await waitForWindows(app, (list) => findWindow(list, "second")?.pageUrls.includes(urlOf("beta")));
firstState = await getState(firstSidebar);
secondState = await getState(secondSidebar);
check("each window keeps its own selected tab in the same Space", selectedTabId(firstState) === "tab-alpha" && selectedTabId(secondState) === "tab-beta");
check("and has its page on screen", findWindow(windows, "first").pageUrls.join() === urlOf("alpha") && findWindow(windows, "second").pageUrls.join() === urlOf("beta"), JSON.stringify(windows.map((window) => window.pageUrls)));

// A tab selected in both windows: the one that shows it keeps it, the other shows the placeholder.
await dispatch(secondSidebar, { type: "selectTab", tabId: "tab-alpha" });
windows = await waitForWindows(app, (list) => findWindow(list, "second")?.pageUrls.length === 0);
await secondSidebar.waitForTimeout(300);
let secondRuntime = await getRuntime(secondSidebar);
check("a tab another window shows stays in that window", findWindow(windows, "first").pageUrls.join() === urlOf("alpha") && findWindow(windows, "second").pageUrls.length === 0, JSON.stringify(windows.map((window) => window.pageUrls)));
check("and this window says \"Open in another window\"", (await showsElsewhereCard(secondSidebar)) && secondRuntime.tabIdsInOtherWindows.includes("tab-alpha") && !(await showsElsewhereCard(firstSidebar)));

await secondSidebar.click("#move-here-button");
windows = await waitForWindows(app, (list) => findWindow(list, "second")?.pageUrls.includes(urlOf("alpha")));
await firstSidebar.waitForTimeout(300);
check("Move to This Window takes the page over", findWindow(windows, "second").pageUrls.join() === urlOf("alpha") && findWindow(windows, "first").pageUrls.length === 0, JSON.stringify(windows.map((window) => window.pageUrls)));
check("and the other window now shows the placeholder", (await showsElsewhereCard(firstSidebar)) && !(await showsElsewhereCard(secondSidebar)));

// Selecting another tab lets go of the page: the other window gets it back at once.
await dispatch(secondSidebar, { type: "selectTab", tabId: "tab-beta" });
windows = await waitForWindows(app, (list) => findWindow(list, "first")?.pageUrls.includes(urlOf("alpha")));
// The card follows the runtime push, a moment after the views moved.
await firstSidebar.waitForTimeout(300);
check(
  "a page let go of goes back to the window that still selects it",
  findWindow(windows, "first").pageUrls.join() === urlOf("alpha") && findWindow(windows, "second").pageUrls.join() === urlOf("beta") && !(await showsElsewhereCard(firstSidebar)),
  JSON.stringify(windows.map((window) => window.pageUrls)),
);

// Notes and Easels follow the same rule as pages (Arc's notes are tabs too): one editor at a time writes the file.
const editorCount = (sidebar, selector) => sidebar.evaluate((wanted) => document.querySelectorAll(wanted).length, selector);
await dispatch(firstSidebar, { type: "createNote" });
await firstSidebar.waitForSelector(".note-body", { timeout: 5000 });
await firstSidebar.waitForTimeout(300);
const noteTabId = selectedTabId(await getState(firstSidebar));
await firstSidebar.click(".note-body");
await firstSidebar.keyboard.type("First window");
await firstSidebar.waitForTimeout(900);
await dispatch(secondSidebar, { type: "selectTab", tabId: noteTabId });
await secondSidebar.waitForTimeout(600);
check(
  "a Note open in one window says \"Open in another window\" in the other, with no second editor",
  (await showsElsewhereCard(secondSidebar)) && (await editorCount(secondSidebar, ".note-editor")) === 0 && (await editorCount(firstSidebar, ".note-editor")) === 1,
);
// Typed just before the move, so the save is still waiting: the first window saves it before letting go.
await firstSidebar.click(".note-body");
await firstSidebar.keyboard.press("End");
await firstSidebar.keyboard.type(" and more");
await secondSidebar.click("#move-here-button");
await secondSidebar.waitForSelector(".note-body", { timeout: 5000 });
await secondSidebar.waitForTimeout(300);
const movedNoteText = await secondSidebar.evaluate(() => document.querySelector(".note-body")?.innerText ?? "");
check(
  "Move to This Window takes the Note over with its last keystrokes",
  movedNoteText.includes("First window and more") && (await editorCount(firstSidebar, ".note-editor")) === 0 && (await showsElsewhereCard(firstSidebar)),
  movedNoteText.replace(/\n/g, " / "),
);
await dispatch(secondSidebar, { type: "createEasel" });
await secondSidebar.waitForSelector(".easel-viewport", { timeout: 5000 });
const easelTabId = selectedTabId(await getState(secondSidebar));
await dispatch(firstSidebar, { type: "selectTab", tabId: easelTabId });
await firstSidebar.waitForTimeout(600);
check("an Easel too: one window draws it, the other says \"Open in another window\"", (await showsElsewhereCard(firstSidebar)) && (await editorCount(firstSidebar, ".easel-editor")) === 0 && (await editorCount(secondSidebar, ".easel-editor")) === 1);
await dispatch(firstSidebar, { type: "selectTab", tabId: "tab-alpha" });
await dispatch(secondSidebar, { type: "selectTab", tabId: "tab-beta" });
await waitForWindows(app, (list) => findWindow(list, "first")?.pageUrls.includes(urlOf("alpha")) && findWindow(list, "second")?.pageUrls.includes(urlOf("beta")));

// Dragging an item from one window's sidebar into another's, like Arc: it lands where it is dropped, and a tab comes
// along (selected there, its page moved over; the window it came from shows another of its tabs).
const spaceOf = (state, spaceId) => state.spaces.find((candidate) => candidate.id === spaceId);
await dispatch(secondSidebar, { type: "switchSpace", spaceId: "space-work" });
await dispatch(firstSidebar, { type: "selectTab", tabId: "tab-gamma" });
await waitForWindows(app, (list) => findWindow(list, "first")?.pageUrls.includes(urlOf("gamma")));
const isDragAccepted = await dragAcrossWindows(firstSidebar, "tab-gamma", secondSidebar, ".today-list .list-end-zone");
windows = await waitForWindows(app, (list) => findWindow(list, "second")?.pageUrls.includes(urlOf("gamma")));
firstState = await getState(firstSidebar);
secondState = await getState(secondSidebar);
check("a drag in one window shows the other window's drop places", isDragAccepted);
check(
  "a tab dropped into another window's Today moves there, is selected, and its page comes along",
  spaceOf(secondState, "space-work").todayIds.at(-1) === "tab-gamma" && selectedTabId(secondState) === "tab-gamma" && findWindow(windows, "second").pageUrls.join() === urlOf("gamma"),
  JSON.stringify(windows.map((window) => window.pageUrls)),
);
check(
  "and the window it came from shows another of its tabs",
  selectedTabId(firstState) !== "tab-gamma" && findWindow(windows, "first").pageUrls.length === 1 && !findWindow(windows, "first").pageUrls.includes(urlOf("gamma")),
  `${selectedTabId(firstState)} ${JSON.stringify(findWindow(windows, "first").pageUrls)}`,
);
await dragAcrossWindows(firstSidebar, "tab-delta", secondSidebar, ".favorites-end-zone");
secondState = await getState(secondSidebar);
check("onto another window's Favorites", secondState.profiles[0].favoriteIds.includes("tab-delta") && selectedTabId(secondState) === "tab-delta");
await dispatch(secondSidebar, { type: "switchSpace", spaceId: "space-main" });
await secondSidebar.waitForTimeout(300);
await dragAcrossWindows(firstSidebar, "tab-epsilon", secondSidebar, '[data-drop="item"][data-item-id="folder-reading"]');
secondState = await getState(secondSidebar);
check("into a folder in another window", secondState.items["folder-reading"].childIds.includes("tab-epsilon") && selectedTabId(secondState) === "tab-epsilon");
await dispatch(secondSidebar, { type: "switchSpace", spaceId: "space-work" });
await secondSidebar.waitForTimeout(300);
await dragAcrossWindows(firstSidebar, "tab-zeta", secondSidebar, '[data-drop="item"][data-item-id="split-pair"]', 0.2);
secondState = await getState(secondSidebar);
const workToday = spaceOf(secondState, "space-work").todayIds;
check("next to a split view in another window", workToday.indexOf("tab-zeta") === workToday.indexOf("split-pair") - 1 && selectedTabId(secondState) === "tab-zeta", workToday.join());
await dispatch(firstSidebar, { type: "switchSpace", spaceId: "space-work" });
await firstSidebar.waitForTimeout(300);
await dragAcrossWindows(firstSidebar, "split-pair", secondSidebar, ".today-list .list-end-zone");
windows = await waitForWindows(app, (list) => findWindow(list, "second")?.pageUrls.length === 2);
check("a split view dragged into another window comes along with both pages", findWindow(windows, "second").pageUrls.sort().join() === [urlOf("left"), urlOf("right")].sort().join(), JSON.stringify(windows.map((window) => window.pageUrls)));
await dispatch(firstSidebar, { type: "switchSpace", spaceId: "space-main" });
await firstSidebar.waitForTimeout(300);
const selectionBeforeSpaceDrop = selectedTabId(await getState(secondSidebar));
await dragAcrossWindows(firstSidebar, easelTabId, secondSidebar, '[data-drop="space"][data-space-id="space-work"]');
firstState = await getState(firstSidebar);
secondState = await getState(secondSidebar);
check(
  "on another window's Space button it only moves to that Space",
  spaceOf(secondState, "space-work").todayIds.includes(easelTabId) && selectedTabId(secondState) === selectionBeforeSpaceDrop,
  `${selectedTabId(secondState)} vs ${selectionBeforeSpaceDrop}`,
);
await dispatch(firstSidebar, { type: "selectTab", tabId: "tab-alpha" });
await dispatch(secondSidebar, { type: "switchSpace", spaceId: "space-main" });
await dispatch(secondSidebar, { type: "selectTab", tabId: "tab-beta" });
await waitForWindows(app, (list) => findWindow(list, "first")?.pageUrls.includes(urlOf("alpha")) && findWindow(list, "second")?.pageUrls.includes(urlOf("beta")));

// Actions from a window's sidebar act there, and the overlay goes to that window.
await dispatch(firstSidebar, { type: "openCommandBar", mode: "newTab" });
windows = await waitForWindows(app, (list) => findWindow(list, "first")?.hasOverlay === true);
firstState = await getState(firstSidebar);
check("an action from a background window's sidebar gives that window the focus", firstState.focusedWindowId === "window-1");
check("and its Command Bar opens in that window", findWindow(windows, "first").hasOverlay && !findWindow(windows, "second").hasOverlay);
await overlayPage.keyboard.press("Escape");
await firstSidebar.waitForTimeout(400);

// Menus act on the focused window only.
await clickMenuItem(app, "Next Space");
await firstSidebar.waitForTimeout(500);
firstState = await getState(firstSidebar);
secondState = await getState(secondSidebar);
check("a menu command acts on the focused window only", firstState.activeSpaceId === "space-work" && secondState.activeSpaceId === "space-main");
await dispatch(firstSidebar, { type: "switchSpace", spaceId: "space-main" });

// Each window has its own sidebar (⌘S, width), Pinned sections and open folders, like Arc's StorableWindows.
const sidebarHidden = (sidebar) => sidebar.evaluate(() => document.body.classList.contains("sidebar-hidden"));
await dispatch(secondSidebar, { type: "setSidebarVisible", isVisible: false });
windows = await waitForWindows(app, (list) => findWindow(list, "second")?.pageX === CARD_INSET);
await secondSidebar.waitForTimeout(300);
check(
  "⌘S hides the sidebar of its own window only",
  findWindow(windows, "second").pageX === CARD_INSET && findWindow(windows, "first").pageX === SIDEBAR_WIDTH + CARD_GAP && (await sidebarHidden(secondSidebar)) && !(await sidebarHidden(firstSidebar)),
  JSON.stringify(windows.map((window) => window.pageX)),
);
await dispatch(secondSidebar, { type: "setSidebarPeek", isPeeking: true });
windows = await waitForWindows(app, (list) => findWindow(list, "second")?.pageX === CARD_INSET + SIDEBAR_WIDTH);
check("the hidden sidebar peeks in its own window, and the page glides aside there only", findWindow(windows, "second").pageX === CARD_INSET + SIDEBAR_WIDTH && findWindow(windows, "first").pageX === SIDEBAR_WIDTH + CARD_GAP, JSON.stringify(windows.map((window) => window.pageX)));
await dispatch(secondSidebar, { type: "setSidebarPeek", isPeeking: false });
await dispatch(firstSidebar, { type: "setSidebarWidth", width: 300, isFinal: true });
windows = await waitForWindows(app, (list) => findWindow(list, "first")?.pageX === 300 + CARD_GAP && findWindow(list, "second")?.pageX === CARD_INSET);
firstState = await getState(firstSidebar);
secondState = await getState(secondSidebar);
check("the sidebar width is per window too", findWindow(windows, "first").pageX === 300 + CARD_GAP && firstState.settings.sidebarWidth === 300 && secondState.settings.sidebarWidth === undefined, JSON.stringify(windows.map((window) => window.pageX)));
await dispatch(firstSidebar, { type: "setPinnedSectionOpen", spaceId: "space-main", isOpen: false });
await dispatch(secondSidebar, { type: "toggleFolder", folderId: "folder-reading" });
await secondSidebar.waitForTimeout(400);
firstState = await getState(firstSidebar);
secondState = await getState(secondSidebar);
const mainSpaceOf = (state) => state.spaces.find((candidate) => candidate.id === "space-main");
check("collapsing a Pinned section is per window", mainSpaceOf(firstState).isPinnedOpen === false && mainSpaceOf(secondState).isPinnedOpen === true);
check("and so is opening or closing a folder", firstState.items["folder-reading"].isOpen === true && secondState.items["folder-reading"].isOpen === false);
const shownFolderRows = (sidebar) => sidebar.evaluate(() => document.querySelectorAll('.pinned-list [data-item-id="folder-reading"]').length);
check("each sidebar draws its own", (await shownFolderRows(firstSidebar)) === 0 && (await shownFolderRows(secondSidebar)) === 1);

// Close Window (⇧⌘W) closes one window; the other stays and keeps working.
await dispatch(secondSidebar, { type: "switchSpace", spaceId: "space-main" });
await secondSidebar.waitForTimeout(300);
const focusBeforeClose = await app.evaluate(async ({ BrowserWindow }) => {
  const focused = BrowserWindow.getFocusedWindow();
  return focused === null ? "none" : await focused.webContents.executeJavaScript("window.name");
});
await clickMenuItem(app, "Close Window");
windows = await waitForWindows(app, (list) => list.length === 1);
await firstSidebar.waitForTimeout(500);
firstState = await getState(firstSidebar);
check(
  "Close Window closes one window and the other stays",
  windows.length === 1 && findWindow(windows, "first") !== undefined && firstState.otherWindows.length === 0 && firstState.focusedWindowId === "window-1",
  `window in front before: ${focusBeforeClose}; left open: ${windows.map((window) => window.tag).join()}`,
);
await dispatch(firstSidebar, { type: "selectTab", tabId: "tab-beta" });
windows = await waitForWindows(app, (list) => findWindow(list, "first")?.pageUrls.includes(urlOf("beta")));
check("the remaining window shows the pages the closed one had", findWindow(windows, "first").pageUrls.join() === urlOf("beta"));

// Two windows again, each with its own Space, then quit (⌘Q keeps both).
await clickMenuItem(app, "New Window");
sidebars = await waitForSidebars(app, 2);
secondSidebar = sidebars.find((sidebar) => sidebar !== firstSidebar);
await tagWindows([secondSidebar], ["second"]);
await waitForWindows(app, (list) => findWindow(list, "second")?.hasOverlay === true);
await overlayPage.keyboard.press("Escape");
secondState = await getState(secondSidebar);
check("a new window starts with the sidebar of the last window closed (hidden there), like Arc", secondState.settings.isSidebarVisible === false && (await sidebarHidden(secondSidebar)));
check("and the same Pinned sections as the window it came from (our choice)", mainSpaceOf(secondState).isPinnedOpen === false);
await dispatch(secondSidebar, { type: "setPinnedSectionOpen", spaceId: "space-main", isOpen: true });
await dispatch(secondSidebar, { type: "switchSpace", spaceId: "space-work" });
await dispatch(secondSidebar, { type: "selectTab", tabId: "tab-work" });
await secondSidebar.waitForTimeout(400);
const boundsBeforeQuit = await describeWindows(app);
const savedSecondId = (await getState(secondSidebar)).focusedWindowId;
const firstRunLog = mainLog.join("");
await app.close();
await new Promise((resolve) => setTimeout(resolve, 1500));

// ---------- second run: both windows come back ----------
({ app, mainLog } = await launch());
sidebars = await waitForSidebars(app, 2);
await sidebars[0].waitForTimeout(1000);
const restoredStates = await Promise.all(sidebars.map((sidebar) => getState(sidebar)));
const restoredSpaces = restoredStates.map((state) => state.activeSpaceId).sort();
check("a restart opens both windows again", sidebars.length === 2, `${sidebars.length} sidebars`);
check("each with its own Space and selection", restoredSpaces.join() === "space-main,space-work" && restoredStates.some((state) => state.activeSpaceId === "space-main" && selectedTabId(state) === "tab-beta"), restoredSpaces.join());
check("the window that had the focus has it again", restoredStates[0].focusedWindowId === savedSecondId);
const workIndex = restoredStates.findIndex((state) => state.activeSpaceId === "space-work");
await tagWindows(sidebars, sidebars.map((_sidebar, index) => (index === workIndex ? "second" : "first")));
windows = await waitForWindows(app, (list) => findWindow(list, "second")?.pageUrls.length === 1 && findWindow(list, "first")?.pageUrls.length === 1);
const sameBounds = (before, after) => before && after && before.x === after.x && before.y === after.y && before.width === after.width && before.height === after.height;
const firstBefore = boundsBeforeQuit.find((window) => window.tag === "first")?.bounds;
const secondBefore = boundsBeforeQuit.find((window) => window.tag === "second")?.bounds;
check("each window opens where it was", sameBounds(firstBefore, findWindow(windows, "first")?.bounds) && sameBounds(secondBefore, findWindow(windows, "second")?.bounds), JSON.stringify(windows.map((window) => window.bounds)));
check("and shows its pages", findWindow(windows, "first").pageUrls.join() === urlOf("beta") && findWindow(windows, "second").pageUrls.join() === urlOf("work"), JSON.stringify(windows.map((window) => window.pageUrls)));
const restoredFirst = restoredStates[workIndex === 0 ? 1 : 0];
const restoredSecond = restoredStates[workIndex];
check(
  "and its own sidebar, width and Pinned sections",
  restoredFirst.settings.isSidebarVisible && restoredFirst.settings.sidebarWidth === 300 && !mainSpaceOf(restoredFirst).isPinnedOpen && !restoredSecond.settings.isSidebarVisible && mainSpaceOf(restoredSecond).isPinnedOpen,
  JSON.stringify(windows.map((window) => window.pageX)),
);

// Closing every window ends the app; the last one is kept for the next start.
const exited = new Promise((resolve) => app.process().once("exit", () => resolve(true)));
const secondRunLog = mainLog.join("");
await app.evaluate(({ BrowserWindow }) => {
  const mainWindows = BrowserWindow.getAllWindows().filter((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  mainWindows[0]?.close();
  setTimeout(() => mainWindows[1]?.close(), 500);
}).catch(() => undefined);
const didQuit = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(false), 10000))]);
check("the app quits when the last main window closes", didQuit === true);
if (!didQuit) await app.close().catch(() => undefined);
await new Promise((resolve) => setTimeout(resolve, 1500));

// ---------- third run: the last window comes back alone ----------
({ app, mainLog } = await launch());
sidebars = await waitForSidebars(app, 1);
await sidebars[0].waitForTimeout(1000);
const lastState = await getState(sidebars[0]);
check("the next start opens the last closed window", app.windows().filter(isSidebarPage).length === 1 && lastState.otherWindows.length === 0);
const thirdRunLog = mainLog.join("");
await app.close();
server.close();

const allLogs = firstRunLog + secondRunLog + thirdRunLog;
const mainErrors = allLogs.split("\n").filter((line) => /Error|Uncaught|TypeError/.test(line) && !line.includes("Autofill"));
check("no errors in the main process", mainErrors.length === 0, mainErrors.slice(0, 3).join(" | "));

const passed = results.filter((result) => result.ok).length;
console.log(`\n${passed}/${results.length} window checks passed.`);
process.exit(passed === results.length ? 0 : 1);
