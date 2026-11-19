// End-to-end check of pages that close themselves (window.close(), as a sign-in page does once it is done, like
// connecting an MCP server to NetSuite on 2026-11-19). Electron destroys such a page; Bow used to keep its dead view
// and threw "Cannot read properties of undefined (reading 'isDestroyed')" in the main process on every runtime push,
// again after every restart. Now: a Today tab closes (to the Archive), a pinned tab unloads and stays pinned, a Peek
// and a Little Window close, and no error reaches the main process. The pages Bow closes itself are not mistaken for
// it: a tab put to sleep stays in the sidebar, and quitting with loaded tabs keeps every tab. A start whose selected
// tab is such a page (what the user's own profile does) also ends with the tab closed and no error. Pages are served
// by a local server with made-up content.
// usage: npm run build && node e2e/check-self-closing.mjs      (uses throwaway --user-data-dir folders)
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const mainFolder = path.join(appDir, "dist", "node", "main");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// /done closes itself after ?delay= milliseconds; every other address is a plain page that stays.
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  response.writeHead(200, { "content-type": "text/html" });
  if (url.pathname === "/done") {
    const delay = Number(url.searchParams.get("delay") ?? "800");
    response.end(`<!doctype html><title>Done</title><p>Signed in. You can close this window.</p><script>setTimeout(() => window.close(), ${delay});</script>`);
    return;
  }
  response.end(`<!doctype html><title>Stay ${url.pathname}</title><p>A page that stays.</p>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const now = Date.now();
const tabAt = (id, address, homeUrl = null) => ({ kind: "tab", id, url: address, title: id, customTitle: null, faviconUrl: null, homeUrl, lastActiveAt: now, isMuted: false });

/** A fresh user data folder whose state has these Today and Pinned tabs, `selectedId` selected. */
function seedState(folderName, todayTabs, pinnedTabs, selectedId) {
  const userDataDir = path.join(outDir, folderName);
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  const items = {};
  for (const tab of [...todayTabs, ...pinnedTabs]) {
    items[tab.id] = tab;
  }
  fs.writeFileSync(
    path.join(userDataDir, "browser-state.json"),
    JSON.stringify({
      version: 3,
      items: items,
      profiles: [{ id: "profile-default", name: "Default", favoriteIds: [] }],
      spaces: [{ id: "space-main", name: "Main", icon: "✦", theme: { colors: ["#000000"], appearance: "dark", grain: 0 }, profileId: "profile-default", pinnedIds: pinnedTabs.map((tab) => tab.id), todayIds: todayTabs.map((tab) => tab.id), isPinnedOpen: true }],
      activeSpaceId: "space-main",
      selectedTabIdBySpace: { "space-main": selectedId },
      focusedWindowId: "window-1",
      otherWindows: [],
      archive: [],
      settings: { archiveAfterMs: 43200000, isSidebarVisible: true },
    }),
  );
  return userDataDir;
}

/** Starts Bow on a user data folder; errors in its main process are collected (and never shown as a dialog). */
async function launch(userDataDir) {
  const app = await _electron.launch({ executablePath: createRequire(import.meta.url)("electron"), args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir], timeout: 30000 });
  const mainLog = [];
  app.process().stdout.on("data", (data) => mainLog.push(data.toString()));
  app.process().stderr.on("data", (data) => mainLog.push(data.toString()));
  await app.evaluate(() => {
    globalThis.selfCloseErrors = [];
    const note = (error) => globalThis.selfCloseErrors.push(String(error && error.stack ? error.stack : error).split("\n").slice(0, 3).join(" | "));
    process.on("uncaughtException", note);
    process.on("unhandledRejection", note);
  });
  const findPage = async (isWanted) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const found = app.windows().find((candidate) => isWanted(candidate.url()));
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error("page did not open");
  };
  const sidebar = await findPage((url) => url.endsWith("/renderer/index.html"));
  await sidebar.waitForSelector(".space-title", { state: "attached", timeout: 30000 });
  const requireMain = (name, run, argument) => app.evaluate((_electron, { modulePath, code, argumentValue }) => new Function("module", "argument", code)(process.mainModule.require(modulePath), argumentValue), { modulePath: path.join(mainFolder, `${name}.js`), code: `return (${run.toString()})(module, argument);`, argumentValue: argument });
  return {
    app,
    sidebar,
    mainLog,
    requireMain,
    getState: () => sidebar.evaluate(() => window.browserApi.getState()),
    dispatch: (action) => sidebar.evaluate((sent) => window.browserApi.dispatch(sent), action),
    errors: () => app.evaluate(() => globalThis.selfCloseErrors),
  };
}

async function waitFor(description, condition, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(`  (timed out waiting for: ${description})`);
  return false;
}
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const mainSpace = (state) => state.spaces.find((space) => space.id === "space-main");
const selectedIdOf = (state) => state.selectedTabIdBySpace["space-main"];
const isLoaded = (bow, tabId) => bow.requireMain("tabViews", (module, id) => module.getTabViews().has(id), tabId);
const mainErrorLines = (bow) => bow.mainLog.join("").split("\n").filter((line) => /Error|Uncaught|TypeError/.test(line) && !line.includes("Autofill"));

// ---------- one run: a tab, a pinned tab, a Peek, a Little Window, then sleep and quit ----------
const pinnedDoneUrl = `${origin}/done?delay=800&for=pinned`;
const firstDir = seedState(
  "user-data-self-closing",
  [tabAt("tab-stay", `${origin}/stay`), tabAt("tab-other", `${origin}/other`), tabAt("tab-third", `${origin}/third`)],
  [tabAt("tab-pinned-done", pinnedDoneUrl, pinnedDoneUrl)],
  "tab-stay",
);
const bow = await launch(firstDir);
await waitFor("first page", () => isLoaded(bow, "tab-stay"));

// A Today tab: the page closes itself, the tab goes to the Archive and another tab is selected.
const doneUrl = `${origin}/done?delay=800&for=today`;
await bow.dispatch({ type: "openTab", typedText: doneUrl });
const opened = await waitFor("the self-closing tab", async () => (await bow.getState()).items[selectedIdOf(await bow.getState())]?.url === doneUrl);
const doneTabId = selectedIdOf(await bow.getState());
check("a typed address opens the self-closing page in a tab", opened, doneTabId);
const tabClosed = await waitFor("the tab to close", async () => !mainSpace(await bow.getState()).todayIds.includes(doneTabId));
let state = await bow.getState();
check("the tab whose page closed itself is gone from Today", tabClosed, JSON.stringify(mainSpace(state).todayIds));
check("it went to the Archive as a tab you closed (⇧⌘T brings it back)", state.archive.some((entry) => entry.tab.url === doneUrl && entry.reason === "manual"));
check("another tab is selected", selectedIdOf(state) !== null && selectedIdOf(state) !== doneTabId, String(selectedIdOf(state)));
check("its view is gone", !(await isLoaded(bow, doneTabId)));
check("the runtime facts are collected without an error", await bow.requireMain("tabViews", (module) => Object.keys(module.collectTabRuntime()).length > 0));

// A pinned tab: it unloads and stays pinned (like closing a pinned tab with ⌘W), and is no longer selected.
await bow.dispatch({ type: "selectTab", tabId: "tab-pinned-done" });
await waitFor("the pinned page to load", () => isLoaded(bow, "tab-pinned-done"));
const pinnedUnloaded = await waitFor("the pinned page to unload", async () => !(await isLoaded(bow, "tab-pinned-done")) && selectedIdOf(await bow.getState()) !== "tab-pinned-done");
state = await bow.getState();
check("a pinned tab whose page closed itself unloads and is no longer selected", pinnedUnloaded, String(selectedIdOf(state)));
check("and stays pinned", mainSpace(state).pinnedIds.includes("tab-pinned-done"));
await pause(2500);
check("and does not load again by itself", !(await isLoaded(bow, "tab-pinned-done")));

// A Peek: it closes without its shrink (nothing left to picture), and no tab is made for it.
const todayBeforePeek = mainSpace(await bow.getState()).todayIds.length;
await bow.requireMain("peek", (module, argument) => module.openPeek(argument.url, argument.tabId), { url: `${origin}/done?delay=2500`, tabId: "tab-stay" });
check("a Peek opens on the self-closing page", await waitFor("the Peek", () => bow.requireMain("peek", (module) => module.isPeekOpen())));
const peekClosed = await waitFor("the Peek to close", async () => !(await bow.requireMain("peek", (module) => module.isPeekOpen() || module.isPeekClosing())));
check("the Peek closes when its page closes itself", peekClosed);
check("no tab was made for it", mainSpace(await bow.getState()).todayIds.length === todayBeforePeek);

// A Little Window: it closes with its page.
const littleWindowCount = () => bow.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((window) => window.webContents.getURL().includes("/little/little.html")).length);
await bow.requireMain("littleWindow", (module, address) => module.openLittleWindow(address), `${origin}/done?delay=1500`);
check("a Little Window opens on the self-closing page", await waitFor("the Little Window", async () => (await littleWindowCount()) === 1));
check("the Little Window closes when its page closes itself", await waitFor("the Little Window to close", async () => (await littleWindowCount()) === 0));

// A page Bow puts to sleep is not taken for one that closed itself.
await bow.dispatch({ type: "selectTab", tabId: "tab-other" });
await waitFor("tab-other to load", () => isLoaded(bow, "tab-other"));
await bow.dispatch({ type: "selectTab", tabId: "tab-third" });
await waitFor("tab-third to load", () => isLoaded(bow, "tab-third"));
await waitFor("tab-other off screen", async () => (await bow.requireMain("tabViews", (module) => module.findWindowShowingTab("tab-other"))) === null);
check("a tab off screen goes to sleep", await bow.requireMain("tabViews", (module) => module.sleepTabView("tab-other")));
await pause(1500);
state = await bow.getState();
check("the sleeping tab stays in Today", mainSpace(state).todayIds.includes("tab-other"));

// Quitting with loaded pages keeps every tab.
await bow.dispatch({ type: "selectTab", tabId: "tab-stay" });
await waitFor("tab-stay shown", async () => (await bow.requireMain("tabViews", (module) => module.findWindowShowingTab("tab-stay"))) !== null);
state = await bow.getState();
const todayBeforeQuit = mainSpace(state).todayIds;
const archiveBeforeQuit = state.archive.length;
const loadedBeforeQuit = await bow.requireMain("tabViews", (module) => Array.from(module.getTabViews().keys()).length);
check("several pages are loaded before quitting", loadedBeforeQuit >= 2, String(loadedBeforeQuit));
const firstErrors = await bow.errors();
check("no error reached the main process", firstErrors.length === 0, firstErrors.slice(0, 2).join(" || "));
await bow.app.close();
check("no error lines in the main process's output", mainErrorLines(bow).length === 0, mainErrorLines(bow).slice(0, 3).join(" | "));
const saved = JSON.parse(fs.readFileSync(path.join(firstDir, "browser-state.json"), "utf8"));
const savedSpace = saved.spaces.find((space) => space.id === "space-main");
check("after quitting, Today has the same tabs", JSON.stringify(savedSpace.todayIds) === JSON.stringify(todayBeforeQuit), `${JSON.stringify(savedSpace.todayIds)} vs ${JSON.stringify(todayBeforeQuit)}`);
check("and the Archive the same entries", saved.archive.length === archiveBeforeQuit, `${saved.archive.length} vs ${archiveBeforeQuit}`);

// ---------- a start whose selected tab closes itself (the user's profile after the crash) ----------
const restartDoneUrl = `${origin}/done?delay=1500`;
const secondDir = seedState("user-data-self-closing-start", [tabAt("tab-keep", `${origin}/keep`), tabAt("tab-start-done", restartDoneUrl)], [], "tab-start-done");
const restarted = await launch(secondDir);
const startClosed = await waitFor("the restored tab to close", async () => !mainSpace(await restarted.getState()).todayIds.includes("tab-start-done"), 20000);
state = await restarted.getState();
check("at the start, the selected tab whose page closes itself is closed", startClosed, JSON.stringify(mainSpace(state).todayIds));
check("and the other tab is selected", selectedIdOf(state) === "tab-keep", String(selectedIdOf(state)));
await pause(1500);
const startErrors = await restarted.errors();
check("no error reached the main process at the start", startErrors.length === 0, startErrors.slice(0, 2).join(" || "));
await restarted.app.close();
check("no error lines in that run's output", mainErrorLines(restarted).length === 0, mainErrorLines(restarted).slice(0, 3).join(" | "));
server.close();

const passed = results.filter((result) => result.ok).length;
console.log(`\n${passed}/${results.length} self-closing page checks passed.`);
process.exit(passed === results.length ? 0 : 1);
