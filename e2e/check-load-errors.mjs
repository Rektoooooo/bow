// Checks what a tab shows when its page cannot be loaded, against local servers that are started and stopped at test
// time (a development server that is not running is the usual case):
// - the tab says why ("refused to connect"), names the site, shows Chromium's error name and the development-server
//   tip, instead of a white page; the tab keeps the real address;
// - Try Again loads the real page once the server runs;
// - Back from a failed page goes to the page before (no bounce), Forward returns to it, and Reload loads it once its
//   server runs;
// - a frame inside a page that fails to load leaves the page alone;
// - nothing of this made the main process log an error.
// macOS's Local Network privacy cannot be checked here: an app started from a shell or terminal gets that one's
// permission (tests/loadErrors.test.ts covers the Local Network tip's wording).
// usage: npm run build && node e2e/check-load-errors.mjs      (uses a throwaway --user-data-dir)
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-load-errors");
fs.rmSync(userDataDir, { recursive: true, force: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Local servers: started only when a step needs them ----------
async function findFreePort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
async function startServer(port, pages) {
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(pages[request.url] ?? "<!doctype html><title>Other</title><body>Other page</body>");
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}
async function stopServer(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
const firstPort = await findFreePort();
const secondPort = await findFreePort();
const deadPort = await findFreePort();
const firstOrigin = `http://127.0.0.1:${firstPort}`;
const secondOrigin = `http://127.0.0.1:${secondPort}`;
const deadOrigin = `http://127.0.0.1:${deadPort}`;
const firstPages = {
  "/app": "<!doctype html><title>Served</title><body>Served page</body>",
  "/with-frame": `<!doctype html><title>Framed</title><body>Page with a frame<iframe src="${deadOrigin}/frame"></iframe></body>`,
};
const secondPages = { "/second": "<!doctype html><title>Second</title><body>Second page</body>" };

// ---------- The app ----------
const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir],
  timeout: 30000,
});
let appErrorOutput = "";
app.process().stderr.on("data", (chunk) => {
  appErrorOutput += chunk.toString();
});
let page = null;
for (let attempt = 0; attempt < 150 && page === null; attempt++) {
  page = app.windows().find((candidate) => candidate.url().endsWith("/renderer/index.html")) ?? null;
  if (page === null) await sleep(200);
}
await page.waitForSelector(".space-title");
const dispatch = (action) => page.evaluate((value) => window.browserApi.dispatch(value), action);
const getState = () => page.evaluate(() => window.browserApi.getState());
const selectedUrl = async () => {
  const state = await getState();
  return state.items[state.selectedTabIdBySpace[state.activeSpaceId]]?.url ?? "";
};

// The tab's page, read in the main process: Playwright does not attach to Chromium's error documents.
const tabPage = (addressPart) =>
  app.evaluate(async ({ webContents }, wanted) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().includes(wanted));
    if (contents === undefined) return null;
    const document = await contents.executeJavaScript("({ text: document.body ? document.body.innerText : '', location: location.href })").catch(() => null);
    return { ...document, entries: contents.navigationHistory.length(), activeIndex: contents.navigationHistory.getActiveIndex() };
  }, addressPart);
async function waitForText(addressPart, wantedText, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await tabPage(addressPart);
    if (last?.text?.includes(wantedText)) return last;
    await sleep(150);
  }
  return last;
}
// As a user gesture, like a click: Chromium's Back skips a page that went elsewhere without one (its history
// intervention), and the real case is a clicked link.
const runInTab = (addressPart, script) =>
  app.evaluate(({ webContents }, [wanted, code]) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().includes(wanted));
    return contents?.executeJavaScript(code, true);
  }, [addressPart, script]);

// ---------- 1. A development server that is not running ----------
await dispatch({ type: "openTab", typedText: `${firstOrigin}/app` });
const refused = await waitForText(`:${firstPort}/app`, "refused to connect");
const refusedText = (refused?.text ?? "").replace(/\s+/g, " ");
check("the tab says the site refused to connect instead of staying white", refusedText.includes(`127.0.0.1:${firstPort}`) && refusedText.includes("The site refused to connect."), refusedText);
check("it shows Chromium's error name and the development-server tip", refusedText.includes("ERR_CONNECTION_REFUSED") && refusedText.includes("check that it is running"));
check("the page is Chromium's error document, not a page of ours", refused?.location === "chrome-error://chromewebdata/", refused?.location);
check("the tab keeps the real address", (await selectedUrl()) === `${firstOrigin}/app`, await selectedUrl());
await page.screenshot({ path: path.join(outDir, "load-error-sidebar.png") }).catch(() => undefined);

// ---------- 2. Try Again once the server runs ----------
const firstServer = await startServer(firstPort, firstPages);
await runInTab(`:${firstPort}/app`, "document.querySelector('.load-error-retry').click()");
const served = await waitForText(`:${firstPort}/app`, "Served page");
check("Try Again loads the real page once the server runs", served?.text?.includes("Served page"), JSON.stringify(served));
check("in the same history entry", served?.entries === 1, JSON.stringify(served));

// ---------- 3. Back, Forward and Reload around a failed page ----------
await runInTab(`:${firstPort}/app`, `window.location.href = ${JSON.stringify(`${secondOrigin}/second`)}`);
const secondFailed = await waitForText(`:${secondPort}/second`, "refused to connect");
check("a link to a server that is not running shows the page too", secondFailed?.text?.includes("refused to connect"), JSON.stringify(secondFailed));
check("and the tab's address is the failed page's, like Chrome's address bar", (await selectedUrl()) === `${secondOrigin}/second`, await selectedUrl());
await dispatch({ type: "navigate", command: "back" });
const backAgain = await waitForText(`:${firstPort}/app`, "Served page");
check("Back goes to the page before, with no bounce", backAgain?.text?.includes("Served page") && backAgain?.activeIndex === 0 && backAgain?.entries === 2, JSON.stringify(backAgain));
await dispatch({ type: "navigate", command: "forward" });
const forwardAgain = await waitForText(`:${secondPort}/second`, "refused to connect");
check("Forward returns to the failed page", forwardAgain?.text?.includes("refused to connect"), JSON.stringify(forwardAgain));
const secondServer = await startServer(secondPort, secondPages);
await dispatch({ type: "navigate", command: "reload" });
const reloaded = await waitForText(`:${secondPort}/second`, "Second page");
check("Reload loads the real page once its server runs", reloaded?.text?.includes("Second page") && reloaded?.entries === 2, JSON.stringify(reloaded));

// ---------- 4. A frame that fails leaves its page alone ----------
await dispatch({ type: "openTab", typedText: `${firstOrigin}/with-frame` });
await waitForText(`:${firstPort}/with-frame`, "Page with a frame");
await sleep(1500);
const framed = await tabPage(`:${firstPort}/with-frame`);
check("a frame that fails to load leaves its page alone", framed?.text?.includes("Page with a frame") && !framed.text.includes("can't open"), JSON.stringify(framed));

await sleep(500);
await app.close();
await stopServer(firstServer);
await stopServer(secondServer);
check("the main process logged no error", !/Uncaught|TypeError|Could not handle/i.test(appErrorOutput), appErrorOutput.slice(-300));
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
