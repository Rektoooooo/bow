// WHY this file exists:
//   Google refused to sign anyone in to Bow 0.1.1 ("This browser or app may not be secure"): it runs desktop Chrome's
//   checks on a browser that says it is Chrome. Google's sign-in pages now get Electron's own user agent, in the
//   request header and in the page's scripts (src/main/googleSignIn.ts, src/preload/googleSignInPreload.ts). This
//   check proves the two match exactly on accounts.google.com, that Google then serves its lighter sign-in
//   ("WebLiteSignIn") instead of desktop Chrome's ("GlifWebSignIn"), and that every other site still sees the Chrome
//   user agent with no "Electron" in it. No email is ever typed: the sign-in page is only opened.
// Data source: a local test server; the real accounts.google.com (its checks print SKIP when it cannot be reached).
// Data flow: open a local page → header and navigator.userAgent are Chrome's → open Google's sign-in → flow and
//   navigator.userAgent are Electron's → leave it → Chrome's again.
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-google-sign-in");
fs.rmSync(userDataDir, { recursive: true, force: true });
const profilesModulePath = path.join(appDir, "dist", "node", "main", "profiles.js");
const SIGN_IN_ADDRESS = "https://accounts.google.com/ServiceLogin?hl=en&continue=https://www.google.com/";
const HELPER_ID = "bow-google-sign-in";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** The User-Agent header of each request the local server answered, by path. */
const headersByPath = new Map();
const server = http.createServer((request, response) => {
  headersByPath.set(request.url, request.headers["user-agent"]);
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(`<!doctype html><title>Local ${request.url}</title><p>A page that is not Google's sign-in.</p>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir],
  timeout: 30000,
});
async function findPage(matches, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => matches(candidate.url()));
    if (page) return page;
    await sleep(200);
  }
  return null;
}
const sidebar = await findPage((url) => url.endsWith("/renderer/index.html"));
await sidebar.waitForSelector(".space-title");
const dispatch = (action) => sidebar.evaluate((value) => window.browserApi.dispatch(value), action);

const userAgents = await app.evaluate(({ app: electronApp }, modulePath) => {
  const profiles = process.mainModule.require(modulePath);
  return { chrome: electronApp.userAgentFallback, electron: profiles.getElectronUserAgent() };
}, profilesModulePath);
check("Bow's user agent is Chrome's, without Electron or Bow in it", /Chrome\/\d/.test(userAgents.chrome) && !/Electron|Bow\//.test(userAgents.chrome), userAgents.chrome);
check(
  "the sign-in user agent is Electron's own, without Bow's name",
  userAgents.electron.includes(" Electron/") && !userAgents.electron.includes("Bow/") && userAgents.electron.replace(/ Electron\/\S+/, "") === userAgents.chrome,
  userAgents.electron,
);

const helperIds = await app.evaluate((_electron, modulePath) => {
  const profiles = process.mainModule.require(modulePath);
  const ofSession = (webSession) => webSession.getPreloadScripts().map((script) => script.id);
  return { profile: ofSession(profiles.getProfileSession("profile-default")), private: ofSession(profiles.createPrivateSession()) };
}, profilesModulePath);
check("a profile's pages get the sign-in helper", helperIds.profile.includes(HELPER_ID), JSON.stringify(helperIds.profile));
check("a private window's pages get it too", helperIds.private.includes(HELPER_ID), JSON.stringify(helperIds.private));

// Any other site: Chrome's user agent in the header and in the page.
await dispatch({ type: "openTab", typedText: `${origin}/first` });
const localPage = await findPage((url) => url.startsWith(`${origin}/first`));
await localPage.waitForLoadState("domcontentloaded");
check("another site's request carries the Chrome user agent", headersByPath.get("/first") === userAgents.chrome, headersByPath.get("/first"));
check("another site's scripts read the Chrome user agent", (await localPage.evaluate(() => navigator.userAgent)) === userAgents.chrome);

// Google's sign-in: the lighter flow, and the page reads exactly what its requests carry.
await dispatch({ type: "openTab", typedText: SIGN_IN_ADDRESS });
const signInPage = await findPage((url) => url.startsWith("https://accounts.google.com/") && url.includes("flowName="), 25000);
if (signInPage === null) {
  console.log("SKIP  accounts.google.com could not be reached (offline?): the sign-in flow is not checked");
} else {
  await signInPage.waitForLoadState("domcontentloaded");
  const flowName = new URL(signInPage.url()).searchParams.get("flowName");
  check("Google serves its lighter sign-in (WebLiteSignIn), not desktop Chrome's", flowName === "WebLiteSignIn", flowName ?? "no flow");
  const signInScripts = await signInPage.evaluate(() => ({ userAgent: navigator.userAgent, appVersion: navigator.appVersion }));
  check("the sign-in page's scripts read the same user agent as its requests", signInScripts.userAgent === userAgents.electron, signInScripts.userAgent);
  check("navigator.appVersion matches it", signInScripts.appVersion === userAgents.electron.replace(/^Mozilla\//, ""), signInScripts.appVersion);
  // Leaving the sign-in page (the page's own navigation) returns to Chrome.
  await signInPage.evaluate((address) => {
    location.href = address;
  }, `${origin}/after-sign-in`);
  const leftPage = await findPage((url) => url.startsWith(`${origin}/after-sign-in`));
  await leftPage?.waitForLoadState("domcontentloaded");
  check("after leaving it, the next site gets the Chrome user agent again", headersByPath.get("/after-sign-in") === userAgents.chrome, headersByPath.get("/after-sign-in"));
  const leftScripts = await leftPage?.evaluate(() => navigator.userAgent);
  check("and its scripts read the Chrome user agent", leftScripts === userAgents.chrome, leftScripts);
}

await app.close();
server.close();
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} Google sign-in checks passed.`);
process.exit(failed === 0 ? 0 : 1);
