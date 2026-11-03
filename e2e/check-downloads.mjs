// End-to-end check of downloads you can see and of the empty views a file link used to leave behind: a target=_blank
// file link opens no tab that stays (the page it came from is selected again), the sidebar's downloads card shows the
// file, its progress and "Downloaded", the file lands in the chosen folder with macOS's quarantine mark, a file link
// opened as if from another app closes its Little Window, a Peek on a file closes, a tab typed with a file address
// stays (like Chrome), the card's buttons open the file / show it in Finder (both stubbed) / dismiss it, and the
// right-click menu has Download Linked File, Save Link As… and Save Image As….
// The server's data is made up: a file of 600 KB sent in two parts, so the card is seen while it runs.
// usage: npm run build && node e2e/check-downloads.mjs      (uses a throwaway --user-data-dir)
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-downloads");
const downloadFolder = path.join(outDir, "downloads-check-folder");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.rmSync(downloadFolder, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(downloadFolder, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const FILE_BYTES = 600 * 1024;
const FIRST_PART_BYTES = 200 * 1024;
const SECOND_PART_DELAY_MS = 1500;
const fileBody = Buffer.alloc(FILE_BYTES, 7);

const server = http.createServer((request, response) => {
  if (request.url.startsWith("/file")) {
    response.writeHead(200, { "content-type": "application/octet-stream", "content-length": FILE_BYTES, "content-disposition": `attachment; filename="${request.url.slice(1).split("?")[0]}.bin"` });
    response.write(fileBody.subarray(0, FIRST_PART_BYTES));
    setTimeout(() => response.end(fileBody.subarray(FIRST_PART_BYTES)), SECOND_PART_DELAY_MS);
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end(`<!doctype html><title>source</title><a id="blank" href="/file-blank" target="_blank">file</a> <img id="picture" src="/picture.png" width="20" height="20">`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const now = Date.now();
const sourceTab = { kind: "tab", id: "tab-source", url: `${origin}/`, title: "source", customTitle: null, faviconUrl: null, homeUrl: null, lastActiveAt: now, isMuted: false };
fs.writeFileSync(
  path.join(userDataDir, "browser-state.json"),
  JSON.stringify({
    version: 3,
    items: { "tab-source": sourceTab },
    profiles: [{ id: "profile-default", name: "Default", favoriteIds: [] }],
    spaces: [{ id: "space-main", name: "Main", icon: "✦", theme: { colors: ["#000000"], appearance: "dark", grain: 0 }, profileId: "profile-default", pinnedIds: [], todayIds: ["tab-source"], isPinnedOpen: true }],
    activeSpaceId: "space-main",
    selectedTabIdBySpace: { "space-main": "tab-source" },
    focusedWindowId: "window-1",
    otherWindows: [],
    archive: [],
    settings: { archiveAfterMs: 43200000, isSidebarVisible: true, downloadFolder: downloadFolder },
  }),
);

const app = await _electron.launch({ executablePath: createRequire(import.meta.url)("electron"), args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir], timeout: 30000 });
const mainLog = [];
app.process().stdout.on("data", (data) => mainLog.push(data.toString()));
app.process().stderr.on("data", (data) => mainLog.push(data.toString()));

async function findPage(isWanted) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const found = app.windows().find((candidate) => isWanted(candidate.url()));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("page did not open");
}
const sidebar = await findPage((url) => url.endsWith("/renderer/index.html"));
await sidebar.waitForSelector(".space-title", { state: "attached", timeout: 30000 });
await sidebar.emulateMedia({ reducedMotion: "reduce" });

const mainFolder = path.join(appDir, "dist", "node", "main");
const getState = () => sidebar.evaluate(() => window.browserApi.getState());
const getRuntime = () => sidebar.evaluate(() => window.browserApi.getRuntimeState());
const dispatch = (action) => sidebar.evaluate((value) => window.browserApi.dispatch(value), action);
const requireMain = (name, run, argument) => app.evaluate((_electron, { modulePath, code, argumentValue }) => new Function("module", "argument", code)(process.mainModule.require(modulePath), argumentValue), { modulePath: path.join(mainFolder, `${name}.js`), code: `return (${run.toString()})(module, argument);`, argumentValue: argument });

async function waitFor(description, condition, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(`  (timed out waiting for: ${description})`);
  return false;
}
const todayIds = async () => (await getState()).spaces[0].todayIds;
const selectedId = async () => (await getState()).selectedTabIdBySpace["space-main"];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Stubs: Finder and the file's own app never open in a test. The pages that start downloads are noted, with their address at that moment.
await app.evaluate(async ({ shell }, { profilesPath }) => {
  globalThis.openedPaths = [];
  globalThis.shownPaths = [];
  shell.openPath = async (filePath) => { globalThis.openedPaths.push(filePath); return ""; };
  shell.showItemInFolder = (filePath) => { globalThis.shownPaths.push(filePath); };
  globalThis.downloadStarters = [];
  process.mainModule.require(profilesPath).getProfileSession("profile-default").on("will-download", (_event, _item, starter) => {
    globalThis.downloadStarters.push(starter === null ? null : starter.getURL());
  });
}, { profilesPath: path.join(mainFolder, "profiles.js") });

await findPage((url) => url.startsWith(origin));
const pageContents = (action) => app.evaluate(({ webContents }, { origin: pageOrigin, code }) => {
  const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === `${pageOrigin}/`);
  return contents.executeJavaScript(code, true);
}, { origin, code: action });

// ---------- a target=_blank file link ----------
await pageContents(`document.getElementById("blank").click()`);
check("the downloads card appears while the file comes", await waitFor("card", async () => (await getRuntime()).downloadCard !== null));
const cardWhileRunning = await getRuntime();
check("the card is about the file and counts one running download", cardWhileRunning.downloadCard?.fileName === "file-blank.bin" && cardWhileRunning.downloadCard?.runningCount === 1, JSON.stringify(cardWhileRunning.downloadCard));
check("a thin progress bar and the file name show in the card", await waitFor("card DOM", async () => (await sidebar.locator("#download-card .download-name").textContent().catch(() => "")) === "file-blank.bin" && (await sidebar.locator("#download-card .download-bar-fill").count()) === 1));
check("the empty tab the link opened went away", await waitFor("tab gone", async () => (await todayIds()).length === 1 && !(await todayIds()).includes("tab-new")), JSON.stringify(await todayIds()));
check("the page the link was on is selected again", (await selectedId()) === "tab-source");
check("no Archive entry was made for it", (await getState()).archive.length === 0);
check("the download started in a page with no address yet", ["", "about:blank"].includes((await app.evaluate(() => globalThis.downloadStarters))[0]), JSON.stringify(await app.evaluate(() => globalThis.downloadStarters)));
check("the card reaches Downloaded", await waitFor("done", async () => (await sidebar.locator("#download-card .download-status").textContent().catch(() => "")).startsWith("Downloaded")), await sidebar.locator("#download-card .download-status").textContent().catch(() => "none"));
const savedPath = path.join(downloadFolder, "file-blank.bin");
check("the whole file is in the chosen folder (the download survived its tab)", fs.existsSync(savedPath) && fs.statSync(savedPath).size === FILE_BYTES);
let quarantine = "";
try { quarantine = execFileSync("xattr", ["-p", "com.apple.quarantine", savedPath]).toString().trim(); } catch { quarantine = ""; }
check("the file carries macOS's quarantine mark", quarantine !== "", quarantine || "missing");

// ---------- the card's buttons ----------
await sidebar.locator('#download-card [data-action="download-show"]').click();
check("Show in Finder shows the file", await waitFor("shown", async () => (await app.evaluate(() => globalThis.shownPaths)).includes(savedPath)));
await sidebar.locator("#download-card .download-main").click();
check("a click on a finished download opens the file", await waitFor("opened", async () => (await app.evaluate(() => globalThis.openedPaths)).includes(savedPath)));
await sidebar.locator('#download-card [data-action="download-dismiss"]').click();
check("× hides the card", await waitFor("hidden", async () => (await getRuntime()).downloadCard === null));

// ---------- a link from another app ----------
const littleWindowCount = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((candidate) => candidate.webContents.getURL().endsWith("/little/little.html")).length);
await requireMain("littleWindow", (module, address) => module.handleExternalUrl(address, null), `${origin}/file-external`);
check("a file link from another app closes its Little Window", await waitFor("little window gone", async () => (await littleWindowCount()) === 0 && fs.existsSync(path.join(downloadFolder, "file-external.bin"))));
check("the card shows again for the new download", await waitFor("card again", async () => (await getRuntime()).downloadCard !== null));
check("the Little Window left nothing in the Archive", (await getState()).archive.length === 0);

// ---------- a Peek on a file ----------
await requireMain("peek", (module, argument) => module.openPeek(argument.url, argument.tabId), { url: `${origin}/file-peek`, tabId: "tab-source" });
check("a Peek on a file closes", await waitFor("peek closed", async () => !(await requireMain("peek", (module) => module.isPeekOpen())) && fs.existsSync(path.join(downloadFolder, "file-peek.bin"))));

// ---------- a typed address stays ----------
await dispatch({ type: "openTab", typedText: `${origin}/file-typed` });
check("a tab typed with a file address saves the file", await waitFor("typed download", () => fs.existsSync(path.join(downloadFolder, "file-typed.bin"))));
await pause(1000);
check("and stays, like in Chrome", (await todayIds()).length === 2, JSON.stringify(await todayIds()));

// ---------- the right-click menu ----------
// The menu is not popped up (that would show a real one); its items are recorded instead, and one is clicked.
const menuItems = await app.evaluate(({ Menu, webContents }, { modulePath, host, pageOrigin }) => {
  const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === `${pageOrigin}/`);
  const menus = process.mainModule.require(modulePath);
  const menuHost = process.mainModule.require(host).menuHost;
  const params = { x: 1, y: 1, linkURL: `${pageOrigin}/file-link`, srcURL: `${pageOrigin}/picture.png`, mediaType: "image", misspelledWord: "", dictionarySuggestions: [], selectionText: "", isEditable: false, editFlags: {} };
  const originalPopup = Menu.prototype.popup;
  Menu.prototype.popup = function recordMenu() { globalThis.recordedMenu = this; };
  menus.showPageContextMenu(menuHost, contents, params);
  Menu.prototype.popup = originalPopup;
  return globalThis.recordedMenu.items.map((item) => item.label);
}, { modulePath: path.join(mainFolder, "menus.js"), host: path.join(mainFolder, "actionRunner.js"), pageOrigin: origin });
check("the right-click menu offers Download Linked File, Save Link As…, Save Image As… and View Page Source", ["Download Linked File", "Save Link As…", "Save Image As…", "View Page Source"].every((label) => menuItems.includes(label)), menuItems.join(" | "));
const tabCountBeforeSource = (await todayIds()).length;
await app.evaluate(() => globalThis.recordedMenu.items.find((item) => item.label === "View Page Source").click());
check("View Page Source opens a tab that shows the page's source", await waitFor("source tab", async () => (await todayIds()).length === tabCountBeforeSource + 1 && (await app.evaluate(({ webContents }) => webContents.getAllWebContents().some((candidate) => candidate.getURL().startsWith("view-source:http://127.0.0.1"))))));
await requireMain("downloads", (module, argument) => {
  const contents = process.mainModule.require("electron").webContents.getAllWebContents().find((candidate) => candidate.getURL() === `${argument.origin}/`);
  module.downloadAddress(contents, `${argument.origin}/file-menu`, false);
}, { origin });
check("Download Linked File downloads the file", await waitFor("menu download", () => fs.existsSync(path.join(downloadFolder, "file-menu.bin"))));

const log = mainLog.join("");
await app.close();
server.close();
const mainErrors = log.split("\n").filter((line) => /Error|Uncaught|TypeError/.test(line) && !line.includes("Autofill"));
check("no errors in the main process", mainErrors.length === 0, mainErrors.slice(0, 3).join(" | "));

const passed = results.filter((result) => result.ok).length;
console.log(`\n${passed}/${results.length} download checks passed.`);
process.exit(passed === results.length ? 0 : 1);
