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
// A tiny made-up filter list in place of the downloaded EasyList, so the ad-blocking check needs no network.
fs.mkdirSync(path.join(userDataDir, "adblock"), { recursive: true });
fs.writeFileSync(path.join(userDataDir, "adblock", "easylist.txt"), "! Test list\n/ads/banner.js\n##.ad-banner\n");
fs.writeFileSync(path.join(userDataDir, "adblock", "easyprivacy.txt"), "! Test list\n");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir],
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
// Reduced motion: rows appear and disappear at once, so checks never meet a row that is still animating.
await sidebar.emulateMedia({ reducedMotion: "reduce" });
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

// Waits (up to 15 s) until the selected tab's address contains the text: a ⌘L address only lands in the state once
// the page has navigated, which depends on the network.
async function waitForSelectedUrl(text) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const url = selectedTab(await getState())?.url ?? "";
    if (url.includes(text)) return;
    await sidebar.waitForTimeout(200);
  }
}

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
await waitForSelectedUrl("https://example.org");
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
// Arc dims nothing behind the Command Bar (its frame stays #313131 in the user's shot 3).
const commandBarBackdrop = await overlay.$eval(".backdrop", (backdrop) => getComputedStyle(backdrop).backgroundColor).catch(() => "no backdrop");
check("the Command Bar leaves the window undimmed, like Arc", commandBarBackdrop === "rgba(0, 0, 0, 0)", commandBarBackdrop);
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
// Like Arc's, the Library takes the sidebar column (410 pt wide); the sidebar page widens its column to match.
const libraryPlacement = await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  const overlayView = win.contentView.children.find((child) => child.webContents?.getURL().endsWith("/overlay/overlay.html"));
  return overlayView === undefined ? null : overlayView.getBounds();
});
// The column glides open (260 ms) after the runtime push; the card then starts after it (410 + the 7 pt gap).
await sidebar.waitForFunction(() => document.body.classList.contains("library-open") && Math.round(document.getElementById("card").getBoundingClientRect().x) === 417, null, { timeout: 3000 }).catch(() => undefined);
const sidebarColumn = await sidebar.evaluate(() => (document.body.classList.contains("library-open") ? Math.round(document.getElementById("card").getBoundingClientRect().x) - 7 : 0));
const railSections = await overlay.$$eval(".library-rail .library-tab", (tabs) => tabs.map((tab) => tab.dataset.section).join(","));
check("the Library takes the sidebar column, with Arc's rail of sections", libraryPlacement?.x === 0 && libraryPlacement?.width === 410 && sidebarColumn === 410 && railSections.startsWith("media,downloads,spaces,boosts,archive"), `${JSON.stringify(libraryPlacement)} column=${sidebarColumn} ${railSections}`);
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
// Arc's layout: the page sits under the Peek's own 44 pt toolbar row (which hangs from the window's top edge and
// shows the address), 80 % as wide as the page card; the round buttons are stacked right of it.
const peekLayout = await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  const peekView = win.contentView.children.find((child) => child.webContents?.getURL().includes("iana.org"));
  return { peek: peekView?.getBounds() ?? null, contentWidth: win.getContentSize()[0] };
});
const peekHost = await overlay.$eval(".peek-toolbar .peek-host", (element) => element.textContent).catch(() => "");
const buttonsBox = await overlay.$eval(".peek-buttons", (element) => element.getBoundingClientRect().toJSON()).catch(() => null);
const peekBox = peekLayout.peek;
const isArcLayout = peekBox !== null && peekBox.y === 44 && peekHost.includes("iana.org") && buttonsBox !== null && buttonsBox.x > peekBox.x + peekBox.width && buttonsBox.height > buttonsBox.width;
check("the Peek has Arc's layout: its own toolbar row with the address on top, buttons stacked at its right", isArcLayout, `${JSON.stringify(peekBox)} host=${peekHost} buttons=${JSON.stringify(buttonsBox)}`);
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
  if (request.url === "/adpage") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<!doctype html><title>Ad page</title><div class="ad-banner">Buy now</div><p>Article</p><script src="/ads/banner.js"></script>');
    return;
  }
  if (request.url === "/ads/banner.js") {
    response.writeHead(200, { "Content-Type": "text/javascript" });
    response.end("window.adScriptRan = true;");
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
// Ad blocking (off until turned on): the list's ad script is stopped and its ad element hidden; the Control Center
// counts it, and turning it off for the site lets the ad through after a reload.
await dispatch({ type: "setAdBlock", isOn: true });
await sidebar.waitForTimeout(600);
const adPageUrl = `http://127.0.0.1:${server.address().port}/adpage`;
await dispatch({ type: "openTab", typedText: adPageUrl });
await waitForSelectedUrl("/adpage");
await sidebar.waitForTimeout(1500);
const adPage = await findPage("/adpage");
const readAdPage = () => adPage.evaluate(() => ({ ran: window.adScriptRan === true, hidden: getComputedStyle(document.querySelector(".ad-banner")).display === "none" }));
const blockedResult = await readAdPage();
check("ad blocking stops the list's ad script and hides its ad element", !blockedResult.ran && blockedResult.hidden, JSON.stringify(blockedResult));
await dispatch({ type: "openSiteControls" });
await overlay.waitForSelector(".control-center", { timeout: 5000 });
const adSetting = '.control-setting:has(.control-setting-title:text-is("Ads and Trackers"))';
const adState = await overlay.textContent(`${adSetting} .control-setting-state`).catch(() => null);
check("the Control Center counts what was blocked on the page", adState === "Blocked · 1 blocked", String(adState));
await overlay.click(adSetting);
await sidebar.waitForTimeout(300);
await overlay.press("body", "Escape");
await sidebar.waitForTimeout(300);
await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((contents) => contents.getURL().includes("/adpage")).reload());
await sidebar.waitForTimeout(1500);
const allowedResult = await readAdPage();
check("turning it off for the site lets the ad through after a reload", allowedResult.ran && !allowedResult.hidden, JSON.stringify(allowedResult));
await dispatch({ type: "setAdBlock", isOn: false });
// The checks below expect the news page on screen, as before this block.
await dispatch({ type: "selectTab", tabId: newsTabId });
await sidebar.waitForTimeout(600);
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

// Boosts: CSS of your own for a site, Zap to hide clicked elements, and off again.
await commandBar("newTab", "example.com/boost");
await sidebar.waitForTimeout(2500);
const pageStyle = (expression) =>
  app.evaluate(({ webContents }, code) => {
    const boostPage = webContents.getAllWebContents().find((contents) => contents.getURL().includes("example.com/boost"));
    return boostPage.executeJavaScript(code);
  }, expression);
await dispatch({ type: "setBoostCss", site: "example.com", css: "body { background: rgb(1, 2, 3) !important; }" });
await sidebar.waitForTimeout(600);
const boostedBackground = await pageStyle("getComputedStyle(document.body).backgroundColor");
await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((contents) => contents.getURL().includes("example.com/boost")).reload());
await sidebar.waitForTimeout(2500);
const backgroundAfterReload = await pageStyle("getComputedStyle(document.body).backgroundColor");
check("a Boost's CSS changes the site, also after a reload", boostedBackground === "rgb(1, 2, 3)" && backgroundAfterReload === "rgb(1, 2, 3)", `${boostedBackground} / ${backgroundAfterReload}`);
// Colors and fonts apply at once; JavaScript runs in the site's pages only once switched on.
await dispatch({ type: "setBoostStyle", site: "example.com", hueShift: 90, isInverted: false, fontId: "mono" });
await sidebar.waitForTimeout(800);
const boostStyle = await pageStyle("[getComputedStyle(document.documentElement).filter, getComputedStyle(document.body).fontFamily].join(' | ')");
check("a Boost's colors and font apply to the site", boostStyle.includes("hue-rotate(90deg)") && boostStyle.includes("ui-monospace"), boostStyle);
await dispatch({ type: "setBoostJavaScript", site: "example.com", javascript: "document.body.dataset.boosted = 'yes';", isOn: false });
await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((contents) => contents.getURL().includes("example.com/boost")).reload());
await sidebar.waitForTimeout(2000);
const scriptWhileOff = await pageStyle("document.body.dataset.boosted ?? 'no'");
await dispatch({ type: "setBoostJavaScript", site: "example.com", javascript: "document.body.dataset.boosted = 'yes';", isOn: true });
await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((contents) => contents.getURL().includes("example.com/boost")).reload());
await sidebar.waitForTimeout(2000);
const scriptWhileOn = await pageStyle("document.body.dataset.boosted ?? 'no'");
check("a Boost's JavaScript runs on the site only once switched on", scriptWhileOff === "no" && scriptWhileOn === "yes", `${scriptWhileOff} / ${scriptWhileOn}`);
await dispatch({ type: "setBoostStyle", site: "example.com", hueShift: 0, isInverted: false, fontId: "" });
await dispatch({ type: "setBoostJavaScript", site: "example.com", javascript: "", isOn: false });
await sidebar.waitForTimeout(400);

await dispatch({ type: "openBoostEditor" });
await overlay.waitForSelector(".boost-zap", { timeout: 5000 });
await overlay.click(".boost-zap");
await sidebar.waitForTimeout(600);
await clickLinkInPage("example.com/boost");
await sidebar.waitForTimeout(800);
const linkDisplay = await pageStyle("getComputedStyle(document.querySelector('a')).display");
await app.evaluate(({ webContents }) => {
  webContents.getAllWebContents().find((contents) => contents.getURL().includes("example.com/boost")).sendInputEvent({ type: "keyDown", keyCode: "Escape" });
});
state = await getState();
const exampleBoost = (state.boosts ?? []).find((boost) => boost.site === "example.com");
check("Zap hides the clicked element and remembers it", linkDisplay === "none" && exampleBoost?.zappedSelectors.length === 1, `${linkDisplay} ${JSON.stringify(exampleBoost?.zappedSelectors)}`);

await dispatch({ type: "setBoostEnabled", site: "example.com", isEnabled: false });
await sidebar.waitForTimeout(600);
const offBackground = await pageStyle("getComputedStyle(document.body).backgroundColor");
const offLinkDisplay = await pageStyle("getComputedStyle(document.querySelector('a')).display");
check("turning the Boost off restores the site", offBackground !== "rgb(1, 2, 3)" && offLinkDisplay !== "none", `${offBackground} ${offLinkDisplay}`);

// Link status: hovering a link shows where it goes at the bottom of the page; leaving hides it.
const boostPage = await findPage("example.com/boost");
const linkPoint = await boostPage.evaluate(() => {
  const link = document.querySelector("a");
  link.style.setProperty("display", "inline", "important");
  const box = link.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
});
await boostPage.mouse.move(5, 5);
await boostPage.mouse.move(linkPoint.x, linkPoint.y, { steps: 3 });
await sidebar.waitForTimeout(600);
const bubbleText = await app.evaluate(async ({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  const bubble = win.contentView.children.find((child) => child.webContents?.getURL().endsWith("/status/status.html"));
  return bubble === undefined ? null : bubble.webContents.executeJavaScript("document.getElementById('status').textContent");
});
await boostPage.mouse.move(5, 5, { steps: 3 });
await sidebar.waitForTimeout(600);
const bubbleGone = await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  return !win.contentView.children.some((child) => child.webContents?.getURL().endsWith("/status/status.html"));
});
check("hovering a link shows where it goes, and leaving hides it", bubbleText?.startsWith("iana.org") && bubbleGone, `${bubbleText} gone=${bubbleGone}`);

// A crashed page shows our crash page; the tab keeps its address; Reload brings the page back.
await app.evaluate(({ webContents }) => {
  webContents.getAllWebContents().find((contents) => contents.getURL().includes("example.com/boost")).forcefullyCrashRenderer();
});
// The crash page can take a few seconds to appear when the machine is busy.
let crashPage;
for (let attempt = 0; attempt < 30 && crashPage === undefined; attempt++) {
  await sidebar.waitForTimeout(200);
  crashPage = app.windows().find((page) => page.url().includes("/crash/crash.html"));
}
state = await getState();
check("a crashed page shows the crash page, and the tab keeps its address", crashPage !== undefined && selectedTab(state)?.url.startsWith("https://example.com/boost"), `${crashPage?.url().slice(-60)} tab=${selectedTab(state)?.url}`);
// Playwright still sees the crashed page object, so the link is clicked from the main process instead.
await app.evaluate(({ webContents }) => {
  const crashContents = webContents.getAllWebContents().find((contents) => contents.getURL().includes("/crash/crash.html"));
  return crashContents?.executeJavaScript("document.getElementById('crash-reload').click()");
});
await sidebar.waitForTimeout(2500);
check("Reload on the crash page opens the page again", app.windows().some((page) => page.url().startsWith("https://example.com/boost")));

// Theme editor, Arc's popover: 14 pt right of the sidebar and above the window's bottom. Light appearance, a second
// color dragged to the pad's top (red), the intensity slider to its start and the grain dial to a quarter turn.
state = await getState();
await dispatch({ type: "openThemeEditor", spaceId: state.activeSpaceId });
await overlay.waitForSelector(".theme-editor", { timeout: 5000 });
await overlay.waitForTimeout(300);
const popoverPlace = await overlay.evaluate(() => {
  const box = document.querySelector(".theme-editor").getBoundingClientRect();
  return { left: Math.round(box.left), fromBottom: Math.round(window.innerHeight - box.bottom), width: Math.round(box.width), height: Math.round(box.height) };
});
const sidebarEdge = Math.round(state.settings.sidebarWidth ?? 242);
check("the theme editor is Arc's popover beside the sidebar's bottom", popoverPlace.left === sidebarEdge + 14 && popoverPlace.fromBottom === 14 && popoverPlace.width === 355 && popoverPlace.height === 506, JSON.stringify(popoverPlace));
await overlay.click(".theme-appearance-button[aria-label='Light']");
await overlay.click(".theme-count-button[aria-label^='Add a color']");
const boxOf = (selector) => overlay.evaluate((wanted) => {
  const box = document.querySelector(wanted).getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}, selector);
const dragOn = async (from, to) => {
  await overlay.mouse.move(from.x, from.y);
  await overlay.mouse.down();
  await overlay.mouse.move(to.x, to.y, { steps: 5 });
  await overlay.mouse.up();
};
const field = await boxOf(".theme-pad-field");
const fieldMiddle = { x: field.x + field.width / 2, y: field.y + field.height / 2 };
const handles = await overlay.$$eval(".theme-handle", (elements) => elements.map((element) => element.getBoundingClientRect()).map((box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 })));
await dragOn(handles.at(-1), { x: fieldMiddle.x, y: fieldMiddle.y - field.height * 0.47 });
const slider = await boxOf(".theme-intensity");
await dragOn({ x: slider.x + slider.width - 10, y: slider.y + slider.height / 2 }, { x: slider.x - 20, y: slider.y + slider.height / 2 });
const dial = await boxOf(".theme-grain-dial");
await dragOn({ x: dial.x + dial.width / 2, y: dial.y + 4 }, { x: dial.x + dial.width - 2, y: dial.y + dial.height / 2 });
await overlay.waitForTimeout(500);
state = await getState();
const editedTheme = activeSpace(state).theme;
const secondColor = editedTheme.colors[1] ?? "#000000";
const [red, green, blue] = [1, 3, 5].map((start) => parseInt(secondColor.slice(start, start + 2), 16));
check(
  "the popover changes the Space's appearance, colors (a handle dragged to red), intensity and grain",
  editedTheme.appearance === "light" && editedTheme.colors.length === 2 && red > 200 && green < 50 && blue < 50 && editedTheme.intensity < 0.05 && Math.abs(editedTheme.grain - 0.25) < 0.03,
  JSON.stringify(editedTheme),
);
await overlay.press("body", "Escape");
await sidebar.waitForTimeout(300);

// Icon picker, Arc's popover above the Space's button: the Icon tab sets one of our symbols (the sidebar draws it),
// the Emoji tab an emoji, the trash our plain mark.
const spaceButtonBox = await sidebar.evaluate(() => {
  const box = document.querySelector(".space-button.is-active").getBoundingClientRect();
  return { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) };
});
state = await getState();
await dispatch({ type: "openSpaceIconPicker", spaceId: state.activeSpaceId, anchor: spaceButtonBox });
await overlay.waitForSelector(".space-picker .space-picker-cell", { timeout: 5000 });
// Measured after the popover's opening animation (it grows in).
await overlay.waitForTimeout(400);
const pickerBox = await overlay.evaluate(() => {
  const box = document.querySelector(".space-picker").getBoundingClientRect();
  return { left: box.left, right: box.right, bottom: box.bottom, width: box.width, height: box.height, cells: document.querySelectorAll(".space-picker-cell").length };
});
const buttonMiddle = spaceButtonBox.x + spaceButtonBox.width / 2;
check(
  "the icon picker opens above the Space's button, eight icons wide",
  pickerBox.width === 270 && pickerBox.height === 270 && pickerBox.bottom <= spaceButtonBox.y && pickerBox.left <= buttonMiddle && pickerBox.right >= buttonMiddle && pickerBox.cells === 56,
  JSON.stringify(pickerBox),
);
await overlay.click(".space-picker-tab:has-text('Icon')");
await overlay.click(".space-picker-cell[aria-label='star']");
await sidebar.waitForTimeout(500);
state = await getState();
const drawnSymbol = await sidebar.evaluate(() => document.querySelector(".space-title-icon .icon-symbol")?.dataset.symbol ?? null);
check("choosing an icon sets it on the Space, and the sidebar draws the symbol", activeSpace(state).icon === "icon:star" && drawnSymbol === "space:star", `${activeSpace(state).icon} ${drawnSymbol}`);
await overlay.click(".space-picker-tab:has-text('Emoji')");
await overlay.click(".space-picker-cell[aria-label='🚀']");
await sidebar.waitForTimeout(300);
const emojiIcon = activeSpace(await getState()).icon;
await overlay.click(".space-picker-trash");
await sidebar.waitForTimeout(300);
const clearedIcon = activeSpace(await getState()).icon;
check("an emoji works too, and the trash goes back to the plain mark", emojiIcon === "🚀" && clearedIcon === "✦", `${emojiIcon} ${clearedIcon}`);
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

// Tab to search a site, like Arc: "youtu" offers it, Tab turns the input into a YouTube search, Backspace on the
// empty input leaves it, Enter opens the site's results in a new tab.
await dispatch({ type: "openCommandBar", mode: "newTab" });
await overlay.waitForSelector(".command-input", { timeout: 5000 });
await overlay.fill(".command-input", "youtu");
const siteHint = await overlay.textContent(".command-site-hint");
check("typing a site's name offers Tab to search it", siteHint === "Tab: Search YouTube" && (await overlay.isVisible(".command-site-hint")), siteHint);
await overlay.press(".command-input", "Tab");
const siteChip = await overlay.textContent(".command-site-chip");
check("Tab turns the input into a search of that site", siteChip === "YouTube" && (await overlay.isVisible(".command-site-chip")) && (await overlay.inputValue(".command-input")) === "", siteChip);
await overlay.press(".command-input", "Backspace");
check("Backspace on the empty input leaves the site search", !(await overlay.isVisible(".command-site-chip")));
await overlay.fill(".command-input", "youtu");
await overlay.press(".command-input", "Tab");
await overlay.fill(".command-input", "lofi beats");
await overlay.press(".command-input", "Enter");
await waitForSelectedUrl("youtube.com/results");
state = await getState();
check("Enter opens the site's search results in a new tab", selectedTab(state)?.url === "https://www.youtube.com/results?search_query=lofi%20beats", selectedTab(state)?.url);

// The Control Center, Arc's popover under the sliders button: its actions, a setting that changes in place, and
// Capture, which copies the part of the page you drag over and saves it. Saves go to a throwaway folder; the
// clipboard's text is put back afterwards.
const captureDir = path.join(outDir, "capture-downloads");
fs.rmSync(captureDir, { recursive: true, force: true });
fs.mkdirSync(captureDir, { recursive: true });
const clipboardTextBefore = await app.evaluate(({ app: electronApp, clipboard }, directory) => {
  electronApp.setPath("downloads", directory);
  return clipboard.readText();
}, captureDir);
await dispatch({ type: "openSiteControls" });
await overlay.waitForSelector(".control-center", { timeout: 5000 });
const actionLabels = await overlay.$$eval(".control-action", (buttons) => buttons.map((button) => button.getAttribute("aria-label")));
check("the Control Center shows Share, Boost, Screenshot and Capture", actionLabels.join("|") === "Share|Boost this site|Take Screenshot|Capture Part of the Page", actionLabels.join("|"));
const soundSetting = '.control-setting:has(.control-setting-title:text-is("Sound"))';
const soundBefore = await overlay.textContent(`${soundSetting} .control-setting-state`);
await overlay.click(soundSetting);
await overlay.waitForFunction(() => [...document.querySelectorAll(".control-setting-state")].some((state) => state.textContent === "Muted"), null, { timeout: 3000 }).catch(() => undefined);
const soundAfter = await overlay.textContent(`${soundSetting} .control-setting-state`);
const panelsAfterToggle = await overlay.$$eval(".control-center", (panels) => panels.length);
check("the Sound setting mutes the tab, shown in the same panel", soundBefore === "On" && soundAfter === "Muted" && selectedTab(await getState())?.isMuted === true && panelsAfterToggle === 1, `${soundBefore} → ${soundAfter}`);
await overlay.click(soundSetting);
await overlay.click('.control-action[aria-label="Capture Part of the Page"]');
await overlay.waitForSelector(".capture-layer", { timeout: 5000 });
const pageFrame = await overlay.evaluate(() => {
  const box = document.querySelector(".capture-page").getBoundingClientRect();
  return { x: box.x, y: box.y };
});
await overlay.mouse.move(pageFrame.x + 40, pageFrame.y + 40);
await overlay.mouse.down();
await overlay.mouse.move(pageFrame.x + 140, pageFrame.y + 90, { steps: 5 });
await overlay.mouse.up();
// Like Arc, pictures land in the Library (Media), kept in the app's data folder.
const capturesDir = path.join(userDataDir, "Captures");
let capturedFiles = [];
for (let attempt = 0; attempt < 25 && capturedFiles.length === 0; attempt += 1) {
  await sidebar.waitForTimeout(200);
  capturedFiles = fs.existsSync(capturesDir) ? fs.readdirSync(capturesDir).filter((name) => name.endsWith(".png")) : [];
}
const capturedSize = await app.evaluate(({ nativeImage }, filePath) => (filePath === null ? null : nativeImage.createFromPath(filePath).getSize()), capturedFiles.length === 1 ? path.join(capturesDir, capturedFiles[0]) : null);
check("Capture keeps exactly the dragged part of the page", capturedSize?.width === 100 && capturedSize?.height === 50, `${capturedFiles.join(",")} ${JSON.stringify(capturedSize)}`);
check("and closes the capture layer", !(await overlayIsShown()));
await dispatch({ type: "openLibrary" });
await overlay.waitForSelector(".library-tab[data-section='media']", { timeout: 5000 });
await overlay.click(".library-tab[data-section='media']");
await overlay.waitForTimeout(300);
const mediaTiles = await overlay.$$eval(".media-tile img", (images) => images.length);
check("the capture shows in Library › Media with its thumbnail", mediaTiles === 1, String(mediaTiles));
await overlay.click(".library-tab[data-section='spaces']");
await overlay.waitForTimeout(200);
const spaceLines = await overlay.$$eval(".space-line", (lines) => lines.length);
check("Library › Spaces lists every Space", spaceLines === (await getState()).spaces.length, String(spaceLines));
await overlay.click(".library-tab[data-section='boosts']");
await overlay.waitForTimeout(200);
const boostTitles = await overlay.$$eval(".library-line .library-line-title", (titles) => titles.map((title) => title.textContent));
check("Library › Boosts lists the sites with a Boost", boostTitles.includes("example.com"), boostTitles.join(","));
await overlay.click(".library-tab[data-section='settings']");
await overlay.waitForTimeout(200);
await overlay.click(".setting-switch[aria-label='Sound effects']");
await sidebar.waitForTimeout(300);
check("Library › Settings turns sound effects off", (await getState()).settings.areSoundEffectsOn === false);
await overlay.press("body", "Escape");
await sidebar.waitForTimeout(300);
await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardTextBefore);

// Live captures, like Arc's Easels: the capture remembers where it came from; put on an easel it is live, and its
// "Live" badge takes it again from the page (a hidden window, the same size, scroll and region).
const libraryCaptures = await sidebar.evaluate(() => window.browserApi.listCaptures());
const captureSource = libraryCaptures[0]?.source ?? null;
check("a capture remembers its page, view, scroll and region", captureSource?.url.startsWith("https://") && captureSource.viewport.width > 0 && captureSource.region.width === 100 && captureSource.region.height === 50, JSON.stringify(captureSource));
const tabBeforeEasel = selectedTab(await getState());
await dispatch({ type: "createEasel" });
await sidebar.waitForSelector(".easel-viewport", { timeout: 5000 });
await sidebar.click(".easel-button[title^='Add a capture']");
await sidebar.waitForSelector(".easel-capture-choice", { timeout: 5000 });
await sidebar.click(".easel-capture-choice");
const liveBadge = await sidebar.waitForSelector(".easel-live", { timeout: 5000 }).catch(() => null);
check("a capture placed on an easel is live", liveBadge !== null && (await liveBadge.textContent()) === "Live");
const easelState = await getState();
const liveEaselFile = path.join(userDataDir, "Easels", `${selectedTab(easelState).url.slice("sidebar-easel:".length)}.json`);
const readLiveImage = () => {
  try {
    return JSON.parse(fs.readFileSync(liveEaselFile, "utf8")).elements.find((element) => element.kind === "image") ?? null;
  } catch {
    return null;
  }
};
await sidebar.waitForTimeout(1200);
const savedBefore = readLiveImage();
const windowsBeforeRetake = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
await sidebar.click(".easel-live");
const updating = await sidebar.$eval(".easel-live", (badge) => badge.textContent).catch(() => null);
let savedAfter = savedBefore;
for (let attempt = 0; attempt < 60 && savedAfter?.live?.refreshedAt === savedBefore?.live?.refreshedAt; attempt++) {
  await sidebar.waitForTimeout(500);
  savedAfter = readLiveImage();
}
const windowsAfterRetake = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
check(
  "its Live badge takes it again from the page and saves it",
  updating === "Updating…" && savedAfter?.live?.refreshedAt > savedBefore?.live?.refreshedAt && savedAfter.src.startsWith("data:image/png"),
  `${updating} ${savedBefore?.live?.refreshedAt} → ${savedAfter?.live?.refreshedAt}`,
);
check("and the hidden window it used is gone", windowsAfterRetake === windowsBeforeRetake, `${windowsBeforeRetake} → ${windowsAfterRetake} windows`);
await dispatch({ type: "selectTab", tabId: tabBeforeEasel.id });
await sidebar.waitForTimeout(300);

// Developer Mode, Arc's per-site switch in the Control Center: the toolbar turns into the striped developer bar with
// the full address, back/forward/reload move to the sidebar's top strip, the tab gets its dashed outline, the page
// moves down under the taller bar, and the Network button opens the developer tools on that panel.
await commandBar("newTab", "example.com/developer");
await waitForSelectedUrl("example.com/developer");
await sidebar.waitForTimeout(1500);
await dispatch({ type: "openSiteControls" });
await overlay.waitForSelector(".control-center", { timeout: 5000 });
const firstSetting = await overlay.textContent(".control-setting .control-setting-title");
await overlay.click(".control-setting");
await sidebar.waitForSelector(".toolbar.is-developer", { timeout: 5000 }).catch(() => undefined);
const developerUrl = await sidebar.textContent(".developer-url").catch(() => null);
const developerRow = await sidebar.$(".tab-row.is-selected.is-developer .row-subtitle");
const headerNavigation = await sidebar.$$eval(".header-navigation .header-button", (buttons) => buttons.map((button) => button.dataset.action));
await sidebar.waitForTimeout(600);
const developerPageTop = await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  const view = win.contentView.children.find((child) => child.webContents?.getURL().includes("example.com/developer"));
  return view?.getBounds().y ?? null;
});
check(
  "Developer Mode from the Control Center: developer bar, outlined tab, page under the taller bar",
  firstSetting === "Developer Mode" && developerUrl === "https://example.com/developer" && developerRow !== null && developerPageTop === 48 && headerNavigation.join(",") === "navigate,navigate,navigate,reload-menu",
  `${firstSetting} | ${developerUrl} | row ${developerRow !== null} | top ${developerPageTop} | ${headerNavigation.join(",")}`,
);
await sidebar.click('.toolbar-button[data-tool="network"]');
let shownPanel = null;
for (let attempt = 0; attempt < 30 && shownPanel !== "network"; attempt++) {
  await sidebar.waitForTimeout(250);
  shownPanel = await app.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes("example.com/developer"));
    const devTools = page?.devToolsWebContents;
    if (!devTools) return null;
    // The developer tools' selected tab, found through their shadow roots ("tab-network").
    const script = `(() => {
      const walk = (root) => {
        for (const element of root.querySelectorAll("*")) {
          if (element.getAttribute("role") === "tab" && element.getAttribute("aria-selected") === "true") return element.id;
          const inside = element.shadowRoot ? walk(element.shadowRoot) : null;
          if (inside) return inside;
        }
        return null;
      };
      return walk(document);
    })()`;
    const selectedTab = await devTools.executeJavaScript(script).catch(() => null);
    return selectedTab === null ? null : selectedTab.replace("tab-", "");
  });
}
check("its Network button opens the developer tools on the Network panel", shownPanel === "network", String(shownPanel));
await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((contents) => contents.getURL().includes("example.com/developer"))?.closeDevTools());
await dispatch({ type: "setDeveloperMode", site: "example.com", isOn: false });
await sidebar.waitForTimeout(400);
check("and switching it off brings the normal toolbar back", (await sidebar.$(".toolbar.is-developer")) === null && (await sidebar.$(".tab-row.is-developer")) === null);

// The recent-tab switcher (⌃Tab, Arc's): cards of the recently used tabs with pictures of their pages; letting go of
// ⌃ switches to the highlighted one, which starts on the previously used tab.
const findMenuItemByLabel = (label) =>
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
state = await getState();
const tabBeforeSwitch = selectedTab(state)?.id;
await commandBar("newTab", "example.com/switcher");
await waitForSelectedUrl("example.com/switcher");
await sidebar.waitForTimeout(1500);
await findMenuItemByLabel("Recent Tab");
await overlay.waitForSelector(".switcher:not([hidden]) .switcher-card", { timeout: 5000 }).catch(() => undefined);
const switcherCards = await overlay.$$eval(".switcher-card", (cards) => cards.map((card) => ({ highlighted: card.classList.contains("is-highlighted"), picture: card.querySelector("img") !== null })));
check("⌃Tab shows the recent tabs, starting on the previous one, with pictures", switcherCards.length >= 2 && switcherCards[1]?.highlighted === true && switcherCards[0]?.picture === true, JSON.stringify(switcherCards.slice(0, 3)));
await overlay.keyboard.down("Control");
await overlay.keyboard.up("Control");
await sidebar.waitForTimeout(600);
state = await getState();
check("letting go of ⌃ switches to the highlighted tab", selectedTab(state)?.id === tabBeforeSwitch && !(await overlayIsShown()), `${selectedTab(state)?.url}`);

// Inline completion, like Arc's: typing the start of a known address finishes it in the input, the added part
// selected, so Return goes there and typing on replaces it.
await dispatch({ type: "openCommandBar", mode: "newTab" });
await overlay.waitForSelector(".command-input", { timeout: 5000 });
await overlay.locator(".command-input").pressSequentially("exam", { delay: 40 });
await overlay.waitForTimeout(600);
const completion = await overlay.evaluate(() => {
  const input = document.querySelector(".command-input");
  return { value: input.value, start: input.selectionStart, end: input.selectionEnd };
});
check("typing finishes a known address inline, the added part selected", completion.value === "example.com" && completion.start === 4 && completion.end === 11, JSON.stringify(completion));
await overlay.press(".command-input", "Backspace");
await overlay.waitForTimeout(400);
const afterBackspace = await overlay.inputValue(".command-input");
check("deleting removes the completion instead of completing again", afterBackspace === "exam", afterBackspace);
await overlay.fill(".command-input", "");
await overlay.locator(".command-input").pressSequentially("netfl", { delay: 40 });
await overlay.waitForTimeout(600);
const popularCompletion = await overlay.inputValue(".command-input");
const highlightedLines = await overlay.$$eval(".command-line.is-highlighted", (lines) => lines.length);
check("a well-known site completes before it was ever visited, and Return would open it", popularCompletion === "netflix.com" && highlightedLines === 0, `${popularCompletion} highlighted=${highlightedLines}`);
await overlay.press(".command-input", "Escape");

// Tab tooltips (Arc's): resting the pointer on a tab shows its title beside the pointer, with "Double-click to rename"
// on the selected tab only; moving on hides it. The tooltip never takes the keyboard.
await sidebar.waitForTimeout(500);
const otherTabRow = sidebar.locator(".tab-row:not(.is-selected)").first();
const otherRowBox = await otherTabRow.boundingBox();
const otherTitle = (await otherTabRow.locator(".row-title").textContent()).replace(/^\/ /, "").trim();
await sidebar.mouse.move(otherRowBox.x + 40, otherRowBox.y + otherRowBox.height / 2);
await sidebar.mouse.move(otherRowBox.x + 42, otherRowBox.y + otherRowBox.height / 2);
await overlay.waitForSelector(".tab-tooltip", { timeout: 4000 }).catch(() => undefined);
const tooltipTitle = await overlay.$eval(".tab-tooltip-title", (title) => title.textContent).catch(() => null);
const tooltipHasHint = (await overlay.$(".tab-tooltip-hint")) !== null;
const tooltipBounds = await app.evaluate(({ BrowserWindow }) => {
  const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  const overlayView = window?.contentView.children.find((child) => child.webContents?.getURL().endsWith("/overlay/overlay.html"));
  return overlayView === undefined ? null : overlayView.getBounds();
});
const keyboardOwner = await app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL() ?? "");
const besidePointer = tooltipBounds !== null && tooltipBounds.x > otherRowBox.x + 42 && tooltipBounds.y > otherRowBox.y + otherRowBox.height / 2 && tooltipBounds.height === 29;
check("resting on a tab shows its title beside the pointer (no rename hint off the selected tab), without taking the keyboard", tooltipTitle === otherTitle && !tooltipHasHint && besidePointer && !keyboardOwner.endsWith("/overlay/overlay.html"), `${tooltipTitle} / ${otherTitle} hint=${tooltipHasHint} ${JSON.stringify(tooltipBounds)}`);
await sidebar.mouse.move(otherRowBox.x + 90, otherRowBox.y + otherRowBox.height / 2);
await sidebar.waitForTimeout(200);
check("moving on hides the tooltip at once", !(await overlayIsShown()));
const selectedTabRow = sidebar.locator(".tab-row.is-selected").first();
const selectedRowBox = await selectedTabRow.boundingBox();
await sidebar.mouse.move(selectedRowBox.x + 40, selectedRowBox.y + selectedRowBox.height / 2);
await sidebar.mouse.move(selectedRowBox.x + 42, selectedRowBox.y + selectedRowBox.height / 2);
await overlay.waitForSelector(".tab-tooltip-hint", { timeout: 4000 }).catch(() => undefined);
const hintText = await overlay.$eval(".tab-tooltip-hint", (hint) => hint.textContent).catch(() => null);
check("the selected tab's tooltip adds \"Double-click to rename\"", hintText === "Double-click to rename", String(hintText));
await sidebar.mouse.move(60, 20);
await sidebar.waitForTimeout(300);
check("moving away hides it", !(await overlayIsShown()));

// A press while the tooltip shows: the tooltip fades at once, but its view stays in the window until the button comes
// up (taking a view out mid-press may stop a real tab drag from starting).
await sidebar.mouse.move(selectedRowBox.x + 40, selectedRowBox.y + selectedRowBox.height / 2);
await sidebar.mouse.move(selectedRowBox.x + 42, selectedRowBox.y + selectedRowBox.height / 2);
await overlay.waitForSelector(".tab-tooltip", { timeout: 4000 }).catch(() => undefined);
await sidebar.mouse.down();
await sidebar.waitForTimeout(300);
const isViewKeptDuringPress = await overlayIsShown();
const isTooltipFaded = await overlay.evaluate(() => document.body.classList.contains("is-closing"));
await sidebar.mouse.up();
await sidebar.waitForTimeout(300);
check("a press fades the tooltip but keeps its view until the button comes up", isViewKeptDuringPress && isTooltipFaded && !(await overlayIsShown()), `kept=${isViewKeptDuringPress} faded=${isTooltipFaded}`);
await sidebar.mouse.move(60, 20);

// A closed folder's list (Arc's): resting on a closed folder shows its tabs beside the sidebar, newest first, with a
// focused search field; leaving the row (and not entering the list) closes it; clicking a tab in it opens that tab.
state = await getState();
const folderTabId = activeSpace(state).todayIds.find((itemId) => state.items[itemId]?.kind === "tab");
const folderTabTitle = state.items[folderTabId]?.title;
await dispatch({ type: "createFolder", title: "Reading" });
await sidebar.waitForTimeout(300);
state = await getState();
const readingFolderId = Object.values(state.items).find((item) => item.kind === "folder" && item.title === "Reading")?.id;
await dispatch({ type: "moveItem", itemId: folderTabId, target: { kind: "folder", folderId: readingFolderId }, index: 0 });
await dispatch({ type: "toggleFolder", folderId: readingFolderId });
await sidebar.waitForTimeout(500);
const readingRow = await sidebar.locator(`[data-row="folder"][data-item-id="${readingFolderId}"]`).boundingBox();
await sidebar.mouse.move(readingRow.x + 40, readingRow.y + readingRow.height / 2);
await sidebar.mouse.move(readingRow.x + 42, readingRow.y + readingRow.height / 2);
await overlay.waitForSelector(".folder-list .folder-list-row", { timeout: 4000 }).catch(() => undefined);
const folderListTitles = await overlay.$$eval(".folder-list-title", (titles) => titles.map((title) => title.textContent)).catch(() => []);
const folderListTime = await overlay.$eval(".folder-list-time", (time) => time.textContent).catch(() => "");
const isSearchFocused = await overlay.evaluate(() => document.activeElement?.classList.contains("folder-list-search") === true);
check("resting on a closed folder lists its tabs beside the sidebar, with how long ago and the search focused", folderListTitles.length === 1 && folderListTitles[0] === folderTabTitle && (folderListTime.endsWith("ago") || folderListTime === "Just now") && isSearchFocused, `${folderListTitles.join(",")} / ${folderTabTitle} ${folderListTime} focused=${isSearchFocused}`);
await sidebar.mouse.move(60, 20);
await sidebar.waitForTimeout(700);
check("leaving the folder (not into the list) closes it", !(await overlayIsShown()));
await sidebar.mouse.move(readingRow.x + 40, readingRow.y + readingRow.height / 2);
await sidebar.mouse.move(readingRow.x + 42, readingRow.y + readingRow.height / 2);
await overlay.waitForSelector(".folder-list .folder-list-row", { timeout: 4000 }).catch(() => undefined);
await overlay.click(".folder-list .folder-list-row");
await sidebar.waitForTimeout(500);
state = await getState();
check("clicking a tab in the list opens it", selectedTab(state)?.id === folderTabId && !(await overlayIsShown()), selectedTab(state)?.id);

await app.close();
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} overlay checks passed.`);
process.exit(failed === 0 ? 0 : 1);
