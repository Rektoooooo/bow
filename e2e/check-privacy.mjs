// End-to-end check of Library › Privacy against a local server:
//   - the privacy report: a page's blocked ad script is counted for its site and the tracker's host, and the Library
//     shows the week's total, bars and lists; with blocking off it offers to turn it on.
//   - HTTPS-Only Mode: made-up names map to the local plain-http server (Chromium's --host-resolver-rules), so an
//     upgraded page fails its TLS handshake like a site without https: the sidebar offers "Open with HTTP", which
//     loads it and allows the site until Bow quits. A typed https:// address that fails gets no offer; IP addresses
//     are never upgraded.
// usage: npm run build && node e2e/check-privacy.mjs      (uses a throwaway --user-data-dir)
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-privacy");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(path.join(userDataDir, "adblock"), { recursive: true });
// A one-line filter list instead of EasyList, so nothing is downloaded and the result is known.
fs.writeFileSync(path.join(userDataDir, "adblock", "easylist.txt"), "! Test list\n/ads/banner.js\n");
fs.writeFileSync(path.join(userDataDir, "adblock", "easyprivacy.txt"), "! Test list\n");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// ---------- The local server: a page with an ad script ----------

/** Plain-http page requests the server answered, by host and path ("insecure.example:1234/plain"). */
const httpRequests = [];
const server = http.createServer((request, response) => {
  httpRequests.push(`${request.headers.host}${request.url}`);
  if (request.url === "/ads/banner.js") {
    response.writeHead(200, { "Content-Type": "text/javascript" });
    response.end("window.adScriptRan = true;");
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(`<!doctype html><title>Page ${request.url}</title><p>Article</p><script src="/ads/banner.js"></script>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// ---------- The app ----------

const hostRules = "MAP insecure.example 127.0.0.1, MAP other.example 127.0.0.1";
const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", `--host-resolver-rules=${hostRules}`, appDir],
  timeout: 30000,
});
async function findPage(suffix, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => candidate.url().endsWith(suffix));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`No page ending in ${suffix}`);
}
const sidebar = await findPage("/renderer/index.html");
await sidebar.waitForSelector(".space-title");
const overlay = await findPage("/overlay/overlay.html");
const dispatch = (action) => sidebar.evaluate((value) => window.browserApi.dispatch(value), action);
const getState = () => sidebar.evaluate(() => window.browserApi.getState());
const selectedUrl = async () => {
  const state = await getState();
  return state.items[state.selectedTabIdBySpace[state.activeSpaceId]]?.url ?? "";
};
async function waitForSelectedUrl(part, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await selectedUrl()).includes(part) && Date.now() < deadline) {
    await sidebar.waitForTimeout(200);
  }
}
async function openPrivacy() {
  await dispatch({ type: "openLibrary" });
  await overlay.waitForSelector(".library-tab[data-section='privacy']", { timeout: 5000 });
  await overlay.click(".library-tab[data-section='privacy']");
  await overlay.waitForSelector(".library-privacy", { timeout: 5000 });
}

// ---------- The privacy report ----------

await openPrivacy();
const offOffer = await overlay.$(".privacy-turn-on");
check("with blocking off, Privacy says so and offers to turn it on", offOffer !== null && (await overlay.textContent(".library-empty-title")) === "Blocking is off");
await overlay.click(".privacy-turn-on");
await sidebar.waitForTimeout(600);
check("its button turns blocking on", (await getState()).settings.isAdBlockOn === true);
await overlay.press("body", "Escape");
await dispatch({ type: "openTab", typedText: `${origin}/story` });
await waitForSelectedUrl("/story");
await sidebar.waitForTimeout(1500);
await openPrivacy();
const report = await overlay.evaluate(() => ({
  total: document.querySelector(".privacy-total")?.textContent,
  bars: document.querySelectorAll(".privacy-bar").length,
  sites: Array.from(document.querySelectorAll(".privacy-list:first-child .privacy-row")).map((row) => `${row.querySelector(".privacy-row-name").textContent} ${row.querySelector(".privacy-row-count").textContent}`),
  trackers: Array.from(document.querySelectorAll(".privacy-list:last-child .privacy-row")).map((row) => `${row.querySelector(".privacy-row-name").textContent} ${row.querySelector(".privacy-row-count").textContent}`),
}));
check(
  "a blocked ad script is counted for the page's site and the tracker, and Privacy shows the week",
  report.total === "1" && report.bars === 7 && report.sites[0] === "127.0.0.1 1" && report.trackers[0] === "127.0.0.1 1",
  JSON.stringify(report),
);
await overlay.press("body", "Escape");

// ---------- HTTPS-Only Mode ----------

const port = server.address().port;
const getRuntime = () => sidebar.evaluate(() => window.browserApi.getRuntimeState());
async function waitForNotice(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let notice = (await getRuntime()).notice;
  while (notice === null && Date.now() < deadline) {
    await sidebar.waitForTimeout(200);
    notice = (await getRuntime()).notice;
  }
  return notice;
}
await openPrivacy();
await overlay.click('[role="switch"][aria-label="HTTPS-Only Mode"]');
await sidebar.waitForTimeout(400);
check("Privacy's switch turns HTTPS-Only Mode on", (await getState()).settings.isHttpsOnly === true);
await overlay.press("body", "Escape");
await dispatch({ type: "openTab", typedText: `http://insecure.example:${port}/plain` });
const notice = await waitForNotice();
// The upgraded load fails (the server speaks no TLS), so nothing reached the server over http, the icon guess
// included (it goes over https too).
const plainRequests = httpRequests.filter((request) => request.startsWith("insecure.example"));
check(
  "an http page is asked for over https; a site without it gets the Open with HTTP offer",
  notice?.message === `insecure.example:${port} has no secure version` && notice.buttonLabel === "Open with HTTP" && plainRequests.length === 0,
  `${JSON.stringify(notice)} / ${httpRequests.join(" ")}`,
);
await sidebar.click(".sidebar-notice-button");
await waitForSelectedUrl(`http://insecure.example:${port}/plain`);
await sidebar.waitForTimeout(800);
check("Open with HTTP loads the page over http", httpRequests.includes(`insecure.example:${port}/plain`) && (await selectedUrl()).startsWith("http://insecure.example"), await selectedUrl());
await dispatch({ type: "openTab", typedText: `http://insecure.example:${port}/again` });
await sidebar.waitForTimeout(1500);
check("and the site stays allowed over http", httpRequests.includes(`insecure.example:${port}/again`), httpRequests.join(" "));
await dispatch({ type: "dismissNotice" });
await dispatch({ type: "openTab", typedText: `https://other.example:${port}/typed` });
await sidebar.waitForTimeout(2500);
check("a typed https:// address that fails gets no offer to go down to http", (await getRuntime()).notice === null && !httpRequests.includes(`other.example:${port}/typed`));
await dispatch({ type: "openTab", typedText: `http://127.0.0.1:${port}/local` });
await sidebar.waitForTimeout(1500);
check("an IP address is never upgraded", httpRequests.includes(`127.0.0.1:${port}/local`) && (await selectedUrl()).startsWith("http://127.0.0.1"));
await dispatch({ type: "setHttpsOnly", isOn: false });

// The report reaches its file a few seconds after a block (privacyReportStore.ts SAVE_DELAY_MS), and at quit.
await app.close();
const savedReport = JSON.parse(fs.readFileSync(path.join(userDataDir, "privacy-report.json"), "utf8"));
const savedSites = savedReport.days.at(-1)?.sites ?? {};
check("the report is saved with counts only (no page addresses)", savedSites["127.0.0.1"] >= 1 && !JSON.stringify(savedReport).includes("/story"), JSON.stringify(savedReport));

server.close();
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} privacy checks passed.`);
process.exit(failed === 0 ? 0 : 1);
