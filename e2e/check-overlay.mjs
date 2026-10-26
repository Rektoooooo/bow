// End-to-end check of the overlay panels and Little Window, driven like a user: type in the Command Bar and press
// Enter, edit the address with ⌘L's mode, run an action, restore from the Library, find in page, Escape to close,
// and move a Little Window into a Space.
// usage: npm run build && node e2e/check-overlay.mjs      (uses a throwaway --user-data-dir)
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-overlay");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, appDir],
  timeout: 30000,
});

async function findPage(suffix, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => candidate.url().includes(suffix));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`No page ending in ${suffix}`);
}

const sidebar = await findPage("/renderer/index.html");
await sidebar.waitForSelector(".space-title");
const overlay = await findPage("/overlay/overlay.html");
const getState = () => sidebar.evaluate(() => window.browserApi.getState());
const dispatch = (action) => sidebar.evaluate((value) => window.browserApi.dispatch(value), action);
const activeSpace = (state) => state.spaces.find((space) => space.id === state.activeSpaceId);
const selectedTab = (state) => state.items[state.selectedTabIdBySpace[state.activeSpaceId]];
const overlayIsShown = () =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
    return win.contentView.children.some((child) => child.webContents?.getURL().endsWith("/overlay/overlay.html"));
  });

// Type into the Command Bar and press Enter, like a user.
async function commandBar(mode, text) {
  await dispatch({ type: "openCommandBar", mode });
  await overlay.waitForSelector(".command-input", { timeout: 5000 });
  await overlay.fill(".command-input", text);
  // Let the ranked results arrive before choosing.
  await overlay.waitForTimeout(400);
  await overlay.press(".command-input", "Enter");
  await sidebar.waitForTimeout(600);
}

await commandBar("newTab", "example.com");
await sidebar.waitForFunction(() => document.querySelectorAll(".today-list .tab-row").length === 1, null, { timeout: 10000 });
let state = await getState();
check("⌘T, type an address, Enter: opens it in a new tab", selectedTab(state)?.url.startsWith("https://example.com"), selectedTab(state)?.url);
check("the overlay closes after choosing", !(await overlayIsShown()));

await commandBar("editUrl", "example.org");
await sidebar.waitForTimeout(1500);
state = await getState();
check("⌘L edits the current tab's address instead of opening a tab", activeSpace(state).todayIds.length === 1 && selectedTab(state)?.url.startsWith("https://example.org"), selectedTab(state)?.url);

await commandBar("newTab", "wikipedia.org");
await sidebar.waitForTimeout(1500);
await dispatch({ type: "openCommandBar", mode: "newTab" });
await overlay.fill(".command-input", "example.org");
await overlay.waitForTimeout(400);
const firstLine = await overlay.textContent(".command-line.is-highlighted .command-line-hint");
check("an open tab is offered as 'Switch to Tab' first", firstLine?.includes("Switch to Tab"), firstLine);
await overlay.press(".command-input", "Enter");
await sidebar.waitForTimeout(500);
state = await getState();
check("choosing it switches to that tab without opening another", activeSpace(state).todayIds.length === 2 && selectedTab(state)?.url.startsWith("https://example.org"));

await commandBar("newTab", "toggle sidebar");
state = await getState();
check("actions run from the Command Bar (Toggle Sidebar)", state.settings.isSidebarVisible === false);
await dispatch({ type: "setSidebarVisible", isVisible: true });

await dispatch({ type: "openCommandBar", mode: "newTab" });
await overlay.waitForSelector(".command-input");
await overlay.press(".command-input", "Escape");
await sidebar.waitForTimeout(300);
check("Escape closes the Command Bar", !(await overlayIsShown()));

// Library: close a tab, then restore it from the Archive by clicking it.
state = await getState();
await dispatch({ type: "closeTab", tabId: state.selectedTabIdBySpace[state.activeSpaceId] });
await sidebar.waitForTimeout(300);
await dispatch({ type: "openLibrary" });
await overlay.waitForSelector(".library .library-line", { timeout: 5000 });
const archiveLines = await overlay.locator(".library .library-line").count();
check("the Library lists the archived tab", archiveLines === 1, String(archiveLines));
await overlay.click(".library .library-line");
await sidebar.waitForTimeout(500);
state = await getState();
check("clicking it restores the tab and closes the Library", state.archive.length === 0 && !(await overlayIsShown()));

await dispatch({ type: "openLibrary" });
await overlay.click(".library-tab[data-section='history']");
await overlay.waitForSelector("#history-list .library-line", { timeout: 5000 }).catch(() => undefined);
const historyLines = await overlay.locator("#history-list .library-line").count();
check("visited pages show in History", historyLines >= 2, String(historyLines));
await overlay.press("body", "Escape");
await sidebar.waitForTimeout(300);

// Find in page through the Command Bar's "Find in Page" action.
await commandBar("newTab", "find in page");
await overlay.waitForSelector(".find-input", { timeout: 5000 });
await overlay.fill(".find-input", "domain");
await overlay.waitForFunction(() => /\d+ of [1-9]/.test(document.querySelector(".find-counter")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => undefined);
const counterText = await overlay.textContent(".find-counter");
const findContext = await sidebar.evaluate(async () => {
  const state = await window.browserApi.getState();
  const runtime = await window.browserApi.getRuntimeState();
  const tabId = state.selectedTabIdBySpace[state.activeSpaceId];
  return { url: state.items[tabId]?.url, isLoading: runtime.tabs[tabId]?.isLoading };
});
check("Find in page reports matches", /\d+ of [1-9]/.test(counterText ?? ""), `${counterText} on ${JSON.stringify(findContext)}`);
const findBounds = await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  const view = win.contentView.children.find((child) => child.webContents?.getURL().endsWith("/overlay/overlay.html"));
  return view?.getBounds();
});
check("the Find bar's overlay covers only its corner, so the page stays usable", findBounds !== undefined && findBounds.width < 500 && findBounds.height < 100, JSON.stringify(findBounds));
await overlay.press(".find-input", "Escape");
await sidebar.waitForTimeout(300);

// Little Window: open one from the Command Bar, load a page, then move it into the Space.
await commandBar("newTab", "new little window");
const little = await findPage("/little/little.html");
await little.waitForSelector(".little-address");
await little.fill(".little-address", "example.net");
await little.press(".little-address", "Enter");
await little.waitForTimeout(2000);
state = await getState();
const tabsBefore = activeSpace(state).todayIds.length;
await little.click(".little-move");
await sidebar.waitForTimeout(800);
state = await getState();
const windowCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
check("Open in Space moves the Little Window's page into Today", activeSpace(state).todayIds.length === tabsBefore + 1 && selectedTab(state)?.url.startsWith("https://example.net"), selectedTab(state)?.url);
check("…and closes the Little Window", windowCount === 1, String(windowCount));

await commandBar("newTab", "new little window");
const secondLittle = await findPage("/little/little.html");
await secondLittle.fill(".little-address", "example.com/little");
await secondLittle.press(".little-address", "Enter");
await secondLittle.waitForTimeout(1500);
await app.evaluate(({ BrowserWindow }) => {
  const littleWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes("/little/little.html"));
  littleWindow.close();
});
await sidebar.waitForTimeout(500);
state = await getState();
check("closing a Little Window puts its page in the Archive", state.archive[0]?.tab.url.startsWith("https://example.com/little") && state.archive[0]?.fromSpaceId === null, state.archive[0]?.tab.url);

// Peek: a link from a pinned tab to another site opens in a Peek; the pinned page stays.
await commandBar("newTab", "example.com/peek-source");
await sidebar.waitForTimeout(2500);
state = await getState();
const pinnedSourceId = state.selectedTabIdBySpace[state.activeSpaceId];
await dispatch({ type: "pinTab", tabId: pinnedSourceId });
await sidebar.waitForTimeout(300);
const peekViews = () =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
    return win.contentView.children.map((child) => ({ url: child.webContents?.getURL() ?? "", id: child.webContents?.id }));
  });
// Real mouse events at the link's position (they count as user input, which Peek requires). Playwright's own click
// would wait for the navigation, which the Peek rule cancels on purpose.
async function clickLinkInPage(urlPart) {
  const page = await findPage(urlPart);
  const point = await page.evaluate(() => {
    const rectangle = document.querySelector("a").getBoundingClientRect();
    return { x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
}
await clickLinkInPage("example.com/peek-source");
await sidebar.waitForTimeout(2500);
let views = await peekViews();
const peekEntry = views.find((view) => view.url.includes("iana.org"));
state = await getState();
check("a link from a pinned tab to another site opens in a Peek", peekEntry !== undefined, JSON.stringify(views.map((view) => view.url)));
check("…and the pinned tab stays on its page", state.items[pinnedSourceId]?.url.startsWith("https://example.com/peek-source"), state.items[pinnedSourceId]?.url);
await overlay.click(".peek-button[aria-label^='Open as Tab']");
await sidebar.waitForTimeout(800);
state = await getState();
views = await peekViews();
const adoptedTab = selectedTab(state);
const adoptedView = views.find((view) => view.url.includes("iana.org"));
check("Open as Tab turns the Peek into a Today tab", adoptedTab?.url.includes("iana.org") && activeSpace(state).todayIds[0] === adoptedTab?.id, adoptedTab?.url);
check("…keeping the same page (no reload)", adoptedView?.id === peekEntry?.id, `${adoptedView?.id} vs ${peekEntry?.id}`);

await dispatch({ type: "selectTab", tabId: pinnedSourceId });
await sidebar.waitForTimeout(800);
await clickLinkInPage("example.com/peek-source");
await sidebar.waitForTimeout(2000);
// Press Escape in the Peek's page: the newest iana.org page (the adopted tab is an older one).
await app.evaluate(({ webContents }) => {
  const ianaPages = webContents.getAllWebContents().filter((contents) => contents.getURL().includes("iana.org"));
  const peekContents = ianaPages.sort((first, second) => second.id - first.id)[0];
  peekContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
});
await sidebar.waitForTimeout(600);
views = await peekViews();
check("Escape dismisses the Peek", !views.some((view) => view.url.includes("iana.org")) && !(await overlayIsShown()), JSON.stringify(views.map((view) => view.url)));

// Media: a page plays a tone in a looping <audio>; in the background, the sidebar shows a player that can pause it.
function createToneWav() {
  const sampleRate = 8000;
  const sampleCount = sampleRate;
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + sampleCount * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index++) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 6000), 44 + index * 2);
  }
  return buffer;
}
const toneWav = createToneWav();
const server = http.createServer((request, response) => {
  if (request.url === "/tone.wav") {
    response.writeHead(200, { "Content-Type": "audio/wav" });
    response.end(toneWav);
    return;
  }
  if (request.url === "/news") {
    response.writeHead(200, { "Content-Type": "text/html" });
    // Like a mail app: the title changes a moment later, when "new mail" arrives.
    response.end('<!doctype html><title>Inbox</title><script>setTimeout(() => { document.title = "Inbox (3)"; }, 2500);</script><p>Inbox</p>');
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end('<!doctype html><title>Tone test</title><audio src="/tone.wav" autoplay loop></audio><p>Playing a tone</p>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const toneUrl = `http://127.0.0.1:${server.address().port}/`;
await dispatch({ type: "openTab", typedText: toneUrl });
await sidebar.waitForFunction(async () => {
  const runtime = await window.browserApi.getRuntimeState();
  return Object.values(runtime.tabs).some((info) => info.isAudible);
}, null, { timeout: 15000 }).catch(() => undefined);
state = await getState();
const toneTabId = state.selectedTabIdBySpace[state.activeSpaceId];
await dispatch({ type: "selectTab", tabId: pinnedSourceId });
await sidebar.waitForSelector("#media-player:not([hidden])", { timeout: 5000 }).catch(() => undefined);
const playerText = await sidebar.textContent("#media-player");
check("a tab playing in the background shows the sidebar media player", playerText?.includes("Tone test"), playerText);
await sidebar.click("#media-player .media-button[aria-label='Pause']");
// Chromium keeps a background tab "audible" for a while after a pause, so ask the page itself.
await sidebar.waitForSelector("#media-player .media-button[aria-label='Play']", { timeout: 5000 }).catch(() => undefined);
const tonePaused = await app.evaluate(({ webContents }) => {
  const tonePage = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith("http://127.0.0.1"));
  return tonePage.executeJavaScript("document.querySelector('audio').paused");
});
const runtimeAfterPause = await sidebar.evaluate(() => window.browserApi.getRuntimeState());
check("its pause button pauses the page's audio and turns into Play", tonePaused === true && runtimeAfterPause.media?.isPlaying === false, JSON.stringify(runtimeAfterPause.media));

// Unread dot: a pinned page that changes its title while you are elsewhere.
await dispatch({ type: "openTab", typedText: `${toneUrl}news` });
await sidebar.waitForTimeout(1200);
state = await getState();
const newsTabId = state.selectedTabIdBySpace[state.activeSpaceId];
await dispatch({ type: "pinTab", tabId: newsTabId });
await dispatch({ type: "selectTab", tabId: pinnedSourceId });
await sidebar.waitForTimeout(3000);
state = await getState();
const unreadDots = await sidebar.locator(".pinned-list .unread-dot").count();
check("a pinned tab whose title changes off screen gets an unread dot", state.items[newsTabId]?.isUnread === true && unreadDots === 1, `${state.items[newsTabId]?.title} dots=${unreadDots}`);
await dispatch({ type: "selectTab", tabId: newsTabId });
await sidebar.waitForTimeout(400);
state = await getState();
check("opening it clears the dot", state.items[newsTabId]?.isUnread === false);
server.close();

// Profiles: moving the Space to a new profile reloads its pages in that profile's own session.
const contentsIdBefore = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((contents) => contents.getURL().includes("/news"))?.id);
state = await getState();
await dispatch({ type: "createProfileForSpace", spaceId: state.activeSpaceId });
await sidebar.waitForTimeout(1500);
state = await getState();
const contentsIdAfter = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((contents) => contents.getURL().includes("/news"))?.id);
check("a Space moved to a new profile uses it, and its page reloads in that profile", state.profiles.length === 2 && activeSpace(state).profileId === state.profiles[1].id && contentsIdAfter !== undefined && contentsIdAfter !== contentsIdBefore, `${contentsIdBefore} → ${contentsIdAfter}`);

// Private window: says Private, has no Open in Space, and leaves nothing in the Archive.
const archiveCountBefore = (await getState()).archive.length;
await commandBar("newTab", "new private window");
const privateBar = await findPage("private=1");
await privateBar.waitForSelector(".little-private", { timeout: 5000 });
check("a private window shows its badge and cannot move pages into a Space", (await privateBar.locator(".little-move").count()) === 0);
await privateBar.fill(".little-address", "example.com/private");
await privateBar.press(".little-address", "Enter");
await privateBar.waitForTimeout(1500);
await app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes("private=1"))?.close();
});
await sidebar.waitForTimeout(500);
check("closing a private window archives nothing", (await getState()).archive.length === archiveCountBefore);

// Theme editor: light appearance, a second color (gradient) and grain apply to the Space.
state = await getState();
await dispatch({ type: "openThemeEditor", spaceId: state.activeSpaceId });
await overlay.waitForSelector(".theme-editor", { timeout: 5000 });
await overlay.click(".theme-segment:has-text('Light')");
await overlay.click(".theme-colors .theme-round-button[aria-label^='Add a color']");
await overlay.evaluate(() => {
  const slider = document.querySelector(".theme-grain input");
  slider.value = "0.5";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
});
await overlay.waitForTimeout(500);
state = await getState();
const editedTheme = activeSpace(state).theme;
check("the theme editor changes the Space's appearance, colors and grain", editedTheme.appearance === "light" && editedTheme.colors.length === 2 && editedTheme.grain === 0.5, JSON.stringify(editedTheme));
await overlay.press("body", "Escape");
await sidebar.waitForTimeout(300);

// Air Traffic Control: a second launch with a link hands it to this app (the path links from other apps take).
// A matching rule sends it to its Space; without one it opens in a Little Window.
const { spawn } = await import("node:child_process");
function openFromAnotherApp(url) {
  const secondLaunch = spawn(createRequire(import.meta.url)("electron"), [`--user-data-dir=${userDataDir}`, appDir, url], { stdio: "ignore" });
  return new Promise((resolve) => secondLaunch.on("exit", resolve));
}
state = await getState();
const workSpace = state.spaces[1];
await dispatch({ type: "addRoutingRule", matchType: "contains", value: "example.com/routed", spaceId: workSpace.id });
await openFromAnotherApp("https://example.com/routed");
await sidebar.waitForTimeout(1500);
state = await getState();
check("a link from another app that matches a rule opens in that rule's Space", state.activeSpaceId === workSpace.id && selectedTab(state)?.url.startsWith("https://example.com/routed"), `${state.activeSpaceId} ${selectedTab(state)?.url}`);
await openFromAnotherApp("https://example.com/not-routed");
const routedLittle = await findPage("/little/little.html").catch(() => null);
check("a link that matches no rule opens in a Little Window", routedLittle !== null);

await app.close();
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} overlay checks passed.`);
process.exit(failed === 0 ? 0 : 1);
