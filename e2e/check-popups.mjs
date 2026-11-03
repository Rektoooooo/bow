// End-to-end check of sign-in popups: a page in a tab, in a Peek and in a Little Window calls
// window.open(url, "auth", "width=500,height=600"); the popup opens as a window of its own in the same session (so its
// cookie reaches the opener), keeps window.opener (so postMessage reaches the opener), and closes itself. No tab is
// made for it. A popup whose first load is a download closes (and the file arrives). Pages are served by a local
// server with made-up content.
// usage: npm run build && node e2e/check-popups.mjs      (uses a throwaway --user-data-dir)
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-popups");
const downloadFolder = path.join(outDir, "popups-check-folder");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.rmSync(downloadFolder, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(downloadFolder, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// The opener page records the messages it gets. Its "auth" popup sets a cookie, tells the opener and closes itself.
const openerPage = `<!doctype html><title>opener</title><script>
window.messages = [];
window.addEventListener("message", (event) => window.messages.push({ origin: event.origin, data: event.data }));
function openAuth(target) { window.popup = window.open("/auth?for=" + target, "auth", "width=500,height=600"); return window.popup !== null; }
function openFile() { window.open("/file-popup", "download", "width=300,height=300"); }
</script>`;
const authPage = (target) => `<!doctype html><title>auth</title><script>
window.opener.postMessage({ signedIn: "${target}", hasOpener: window.opener !== null }, location.origin);
window.close();
</script>`;
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/auth") {
    const target = url.searchParams.get("for");
    response.writeHead(200, { "content-type": "text/html", "set-cookie": `signedin-${target}=1; Path=/` });
    response.end(authPage(target));
    return;
  }
  if (url.pathname === "/file-popup") {
    response.writeHead(200, { "content-type": "application/octet-stream", "content-length": 1000, "content-disposition": 'attachment; filename="file-popup.bin"' });
    response.end(Buffer.alloc(1000, 3));
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end(openerPage);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const now = Date.now();
const tabAt = (id, pathName) => ({ kind: "tab", id, url: `${origin}${pathName}`, title: id, customTitle: null, faviconUrl: null, homeUrl: null, lastActiveAt: now, isMuted: false });
fs.writeFileSync(
  path.join(userDataDir, "browser-state.json"),
  JSON.stringify({
    version: 3,
    items: { "tab-opener": tabAt("tab-opener", "/opener-tab") },
    profiles: [{ id: "profile-default", name: "Default", favoriteIds: [] }],
    spaces: [{ id: "space-main", name: "Main", icon: "✦", theme: { colors: ["#000000"], appearance: "dark", grain: 0 }, profileId: "profile-default", pinnedIds: [], todayIds: ["tab-opener"], isPinnedOpen: true }],
    activeSpaceId: "space-main",
    selectedTabIdBySpace: { "space-main": "tab-opener" },
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
const mainFolder = path.join(appDir, "dist", "node", "main");
const getState = () => sidebar.evaluate(() => window.browserApi.getState());
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

// Every window that opens with the auth page is noted, so a popup that closes at once is still seen.
await app.evaluate(({ app: electronApp }) => {
  globalThis.popupWindows = [];
  electronApp.on("browser-window-created", (_event, window) => {
    window.webContents.on("did-start-navigation", (_navigationEvent, url) => {
      if (url.includes("/auth?")) globalThis.popupWindows.push(url);
    });
  });
});

/** Runs code in the page at this path (a tab, a Peek and a Little Window each have their own). */
const inPage = (pathName, code) => app.evaluate(({ webContents }, { pageUrl, source }) => {
  const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === pageUrl);
  return contents.executeJavaScript(source, true);
}, { pageUrl: `${origin}${pathName}`, source: code });
const todayCount = async () => (await getState()).spaces[0].todayIds.length;

async function checkRoundTrip(placeName, pathName) {
  const popupCountBefore = (await app.evaluate(() => globalThis.popupWindows)).length;
  const tabsBefore = await todayCount();
  const opened = await inPage(pathName, `openAuth("${placeName}")`);
  check(`${placeName}: window.open returns a window to the page`, opened === true);
  check(`${placeName}: the popup opens as a window of its own`, await waitFor("popup", async () => (await app.evaluate(() => globalThis.popupWindows)).length > popupCountBefore));
  check(`${placeName}: the popup's message reaches the opener, with window.opener set`, await waitFor("message", async () => (await inPage(pathName, "window.messages.length")) === 1), JSON.stringify(await inPage(pathName, "window.messages")));
  const message = (await inPage(pathName, "window.messages"))[0];
  check(`${placeName}: the message is from the page's own origin and says it had an opener`, message?.origin === origin && message?.data?.signedIn === placeName && message?.data?.hasOpener === true, JSON.stringify(message));
  check(`${placeName}: the popup's cookie is in the opener's session`, (await inPage(pathName, "document.cookie")).includes(`signedin-${placeName}=1`));
  check(`${placeName}: the popup closed itself`, await waitFor("popup closed", async () => (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((candidate) => candidate.webContents.getURL().includes("/auth?")).length)) === 0));
  check(`${placeName}: no tab was made for it`, (await todayCount()) === tabsBefore, String(await todayCount()));
}

// ---------- a tab ----------
await findPage((url) => url === `${origin}/opener-tab`);
await checkRoundTrip("tab", "/opener-tab");

// ---------- a Little Window ----------
await requireMain("littleWindow", (module, address) => module.openLittleWindow(address), `${origin}/opener-little`);
await waitFor("little page", async () => (await app.evaluate(({ webContents }, address) => webContents.getAllWebContents().some((candidate) => candidate.getURL() === address), `${origin}/opener-little`)));
await checkRoundTrip("little", "/opener-little");

// ---------- a Peek ----------
await requireMain("peek", (module, argument) => module.openPeek(argument.url, argument.tabId), { url: `${origin}/opener-peek`, tabId: "tab-opener" });
await waitFor("peek page", async () => (await app.evaluate(({ webContents }, address) => webContents.getAllWebContents().some((candidate) => candidate.getURL() === address), `${origin}/opener-peek`)));
await checkRoundTrip("peek", "/opener-peek");
check("the Peek is still open after its popup", await requireMain("peek", (module) => module.isPeekOpen()));

// ---------- a popup that is a download ----------
await inPage("/opener-tab", "openFile()");
check("a popup whose first load is a download closes and the file arrives", await waitFor("file", async () => fs.existsSync(path.join(downloadFolder, "file-popup.bin")) && (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((candidate) => candidate.webContents.getURL() === "" || candidate.webContents.getURL() === "about:blank").length)) === 0));
check("and the popups list is empty again", (await requireMain("windowOpenRule", (module) => module.listOpenPopups().length)) === 0);

const log = mainLog.join("");
await app.close();
server.close();
const mainErrors = log.split("\n").filter((line) => /Error|Uncaught|TypeError/.test(line) && !line.includes("Autofill"));
check("no errors in the main process", mainErrors.length === 0, mainErrors.slice(0, 3).join(" | "));

const passed = results.filter((result) => result.ok).length;
console.log(`\n${passed}/${results.length} popup checks passed.`);
process.exit(passed === results.length ? 0 : 1);
