// Checks what a tab does with a site whose certificate Bow cannot trust, against a local https server with a
// throwaway self-signed certificate made at test time (/usr/bin/openssl):
// - the tab shows "This connection isn't private" with the site and the reason, and a card offers the two choices;
// - Back to Safety goes back to the page before (or closes a tab that has none);
// - Visit Anyway loads the page; another tab of the same site then loads without a warning; the allowance is in
//   memory only, so after a restart the warning comes again;
// - a page HTTPS-Only Mode upgraded from http still falls back to the "Open with HTTP" offer, with no warning;
// - nothing of this made the main process log an error.
// usage: npm run build && node e2e/check-certificates.mjs      (uses a throwaway --user-data-dir)
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-certificates");
const certificateDir = path.join(outDir, "certificates-check");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.rmSync(certificateDir, { recursive: true, force: true });
fs.mkdirSync(certificateDir, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- A throwaway self-signed certificate, and two local servers ----------
const keyFile = path.join(certificateDir, "key.pem");
const certificateFile = path.join(certificateDir, "certificate.pem");
execFileSync("/usr/bin/openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyFile, "-out", certificateFile, "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1,DNS:insecure.example"], { stdio: "ignore" });
const secureRequests = [];
const secureServer = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certificateFile) }, (request, response) => {
  secureRequests.push(request.url);
  response.setHeader("content-type", "text/html");
  response.end("<!doctype html><title>Secure</title><body>Certificate page</body>");
});
await new Promise((resolve) => secureServer.listen(0, "127.0.0.1", resolve));
const securePort = secureServer.address().port;
const secureOrigin = `https://127.0.0.1:${securePort}`;
const safeServer = http.createServer((request, response) => {
  response.setHeader("content-type", "text/html");
  response.end("<!doctype html><title>Safe</title><body>Safe page</body>");
});
await new Promise((resolve) => safeServer.listen(0, "127.0.0.1", resolve));
const safeOrigin = `http://127.0.0.1:${safeServer.address().port}`;

// ---------- The app (started again later to see that the allowance is forgotten) ----------
let app = null;
let page = null;
let overlay = null;
let appErrorOutput = "";
async function findPage(urlPart) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const found = app.windows().find((candidate) => candidate.url().includes(urlPart));
    if (found) return found;
    await sleep(200);
  }
  throw new Error(`${urlPart} did not open`);
}
async function startApp() {
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", "--host-resolver-rules=MAP insecure.example 127.0.0.1", appDir],
    timeout: 30000,
  });
  app.process().stderr.on("data", (chunk) => {
    appErrorOutput += chunk.toString();
  });
  page = await findPage("/renderer/index.html");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForSelector(".space-title");
  overlay = await findPage("/overlay/overlay.html");
}
await startApp();
const dispatch = (action) => page.evaluate((value) => window.browserApi.dispatch(value), action);
const getState = () => page.evaluate(() => window.browserApi.getState());
const getRuntime = () => page.evaluate(() => window.browserApi.getRuntimeState());

const isOverlayOnScreen = () =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
    return win.contentView.children.some((child) => child.webContents?.getURL().endsWith("/overlay/overlay.html"));
  });
async function waitForCard(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await isOverlayOnScreen()) && (await overlay.$(".certificate-warning")) !== null) return true;
    await sleep(150);
  }
  return false;
}
async function waitForOverlayGone(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isOverlayOnScreen())) return true;
    await sleep(100);
  }
  return false;
}
async function findWarningPage(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = app.windows().find((candidate) => candidate.url().includes("/certificate/certificate.html"));
    if (found) return found;
    await sleep(150);
  }
  return null;
}
async function findTabPage(urlPart, wantedText, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = app.windows().find((candidate) => candidate.url().includes(urlPart));
    const text = found ? await found.textContent("body").catch(() => "") : "";
    if (text.includes(wantedText)) return found;
    await sleep(150);
  }
  return null;
}
const selectedUrl = async () => {
  const state = await getState();
  return state.items[state.selectedTabIdBySpace[state.activeSpaceId]]?.url ?? "";
};
const cardText = async () => ((await (await overlay.$(".certificate-warning")).textContent()) ?? "").replace(/\s+/g, " ").trim();

// ---------- 1. The warning page and the card ----------
await dispatch({ type: "openTab", typedText: `${secureOrigin}/first` });
const warningPage = await findWarningPage();
check("a self-signed site shows the warning page in the tab", warningPage !== null);
const warningText = warningPage ? await warningPage.textContent("body") : "";
check("it says the connection isn't private, names the site and the reason", warningText.includes("This connection isn't private") && warningText.includes(`127.0.0.1:${securePort}`) && warningText.includes("not from an issuer Bow trusts"), warningText.replace(/\s+/g, " "));
check("the card offers both choices", (await waitForCard()) && /Back to Safety/.test(await cardText()) && (await cardText()).includes(`Visit 127.0.0.1:${securePort} Anyway`), await cardText().catch(() => "no card"));
await overlay.screenshot({ path: path.join(outDir, "certificate-warning.png") }).catch(() => undefined);
check("the warning page is never recorded as the tab's address", !(await selectedUrl()).startsWith("file://"), await selectedUrl());
check("nothing was fetched from the site", secureRequests.length === 0);

// ---------- 2. Back to Safety: a tab with nothing before it closes ----------
const todayCount = async () => (await getState()).spaces[0].todayIds.length;
const tabCountBefore = await todayCount();
await overlay.click(".certificate-warning .permission-button.is-primary");
check("the card goes away", await waitForOverlayGone());
await sleep(800);
const tabCountAfter = await todayCount();
check("Back to Safety closes a tab that has no page before it", tabCountAfter < tabCountBefore, `${tabCountBefore} → ${tabCountAfter}`);

// ---------- 3. Back to Safety goes back to the page before ----------
await dispatch({ type: "openTab", typedText: `${safeOrigin}/start` });
const safeTab = await findTabPage("/start", "Safe page");
await safeTab.evaluate((address) => { window.location.href = address; }, `${secureOrigin}/second`);
check("a page that navigates to the bad site also gets the warning", (await findWarningPage()) !== null && (await waitForCard()));
await overlay.click(".certificate-warning .permission-button.is-primary");
await waitForOverlayGone();
const backPage = await findTabPage("/start", "Safe page");
check("Back to Safety returns to the page before", backPage !== null && (await selectedUrl()).includes("/start"), await selectedUrl());

// ---------- 4. Visit Anyway ----------
await dispatch({ type: "openTab", typedText: `${secureOrigin}/third` });
await findWarningPage();
await waitForCard();
await overlay.click(".certificate-warning .permission-button:not(.is-primary)");
const visitedPage = await findTabPage("/third", "Certificate page");
check("Visit Anyway loads the page", visitedPage !== null && secureRequests.includes("/third"));
check("and the tab shows the site's own address", (await selectedUrl()).startsWith(secureOrigin), await selectedUrl());

// ---------- 5. The allowance covers the site with that certificate ----------
await dispatch({ type: "openTab", typedText: `${secureOrigin}/fourth` });
const otherTab = await findTabPage("/fourth", "Certificate page");
check("another tab of the same site loads with no warning", otherTab !== null && !(await isOverlayOnScreen()));

// ---------- 6. A page HTTPS-Only Mode upgraded still falls back to http, with no warning ----------
await dispatch({ type: "setHttpsOnly", isOn: true });
await sleep(400);
await dispatch({ type: "openTab", typedText: `http://insecure.example:${securePort}/upgraded` });
let notice = null;
for (let attempt = 0; attempt < 50 && notice === null; attempt++) {
  notice = (await getRuntime()).notice;
  if (notice === null) await sleep(200);
}
check("an upgraded page keeps the 'Open with HTTP' offer", notice?.message === `insecure.example:${securePort} has no secure version`, JSON.stringify(notice));
await sleep(800);
const strayWarning = app.windows().filter((candidate) => candidate.url().includes("/certificate/certificate.html")).length;
check("and shows no warning", strayWarning === 0 && !(await isOverlayOnScreen()));
await dispatch({ type: "setHttpsOnly", isOn: false });

// ---------- 7. A restart forgets the allowance ----------
await sleep(1500);
await app.close();
await startApp();
await dispatch({ type: "openTab", typedText: `${secureOrigin}/after-restart` });
check("after a restart the warning comes again", (await findWarningPage()) !== null && (await waitForCard()));

await sleep(500);
await app.close();
secureServer.close();
safeServer.close();
check("the main process logged no error", !/Uncaught|TypeError|Could not handle/i.test(appErrorOutput), appErrorOutput.slice(-300));
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
