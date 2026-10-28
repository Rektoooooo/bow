// End-to-end check of Library › Privacy against a local server:
//   - the privacy report: a page's blocked ad script is counted for its site and the tracker's host, and the Library
//     shows the week's total, bars and lists; with blocking off it offers to turn it on.
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

const server = http.createServer((request, response) => {
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

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir],
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

// The report reaches its file a few seconds after a block (privacyReportStore.ts SAVE_DELAY_MS), and at quit.
await app.close();
const savedReport = JSON.parse(fs.readFileSync(path.join(userDataDir, "privacy-report.json"), "utf8"));
const savedSites = savedReport.days.at(-1)?.sites ?? {};
check("the report is saved with counts only (no page addresses)", savedSites["127.0.0.1"] === 1 && !JSON.stringify(savedReport).includes("/story"), JSON.stringify(savedReport));

server.close();
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} privacy checks passed.`);
process.exit(failed === 0 ? 0 : 1);
