// Checks Bow Passwords' "Save password?" offer with real clicks and typing on local sign-in pages:
// - after a typed sign-in the card asks to save (the overlay never holds the password), Save puts the login in the
//   profile's encrypted vault (the file on disk shows neither the password nor the username);
// - the same password asks nothing, a changed one asks to update, "Never for this site" is remembered per site;
// - a page script that fills and sends a form is never offered, a single-page sign-in (no navigation) is;
// - Not now and Escape save nothing, the setting turns the offers off, and only the tab that signed in asks.
// usage: npm run build && node e2e/check-passwords.mjs
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-passwords");
fs.rmSync(userDataDir, { recursive: true, force: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Local sites: 127.0.0.1 and login.test (mapped to the same server) ----------
const FIELDS = `<input type="email" name="email" autocomplete="username" style="width:300px;height:30px">
  <input type="password" name="password" autocomplete="current-password" style="width:300px;height:30px">
  <button>Sign in</button>`;
const server = http.createServer((request, response) => {
  response.setHeader("content-type", "text/html");
  if (request.url.startsWith("/login")) {
    response.end(`<!doctype html><title>Login</title><body style="margin:0"><form method="post" action="/welcome">${FIELDS}</form></body>`);
    return;
  }
  if (request.url.startsWith("/spa-login")) {
    response.end(`<!doctype html><title>Single page login</title><body style="margin:0"><form id="signin">${FIELDS}</form>
      <script>
        document.getElementById("signin").addEventListener("submit", (event) => {
          event.preventDefault();
          setTimeout(() => { document.body.innerHTML = "<p>Signed in</p>"; }, 300);
        });
      </script></body>`);
    return;
  }
  if (request.url.startsWith("/blank")) {
    response.end("<!doctype html><title>Blank</title><body>blank</body>");
    return;
  }
  // A slow answer to the sign-in, so a test can switch tabs before the page finishes loading.
  const delay = request.url.startsWith("/welcome") ? 1500 : 0;
  setTimeout(() => response.end("<!doctype html><title>Welcome</title><body>Welcome</body>"), delay);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const mainOrigin = `http://127.0.0.1:${port}`;
const otherOrigin = `http://login.test:${port}`;

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", "--host-resolver-rules=MAP login.test 127.0.0.1", appDir],
  timeout: 30000,
});
async function findPage(urlEnding) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const found = app.windows().find((candidate) => candidate.url().endsWith(urlEnding));
    if (found) return found;
    await sleep(200);
  }
  throw new Error(`${urlEnding} did not open`);
}
const page = await findPage("/renderer/index.html");
await page.emulateMedia({ reducedMotion: "reduce" });
await page.waitForSelector(".space-title");
const overlay = await findPage("/overlay/overlay.html");
const dispatch = (action) => page.evaluate((value) => window.browserApi.dispatch(value), action);

// ---------- Helpers ----------
const vaultModulePath = path.join(appDir, "dist", "node", "main", "passwordVault.js");
const readVault = () =>
  app.evaluate(async (_electron, modulePath) => {
    const vault = process.mainModule.require(modulePath);
    const access = await vault.openVault("profile-default");
    return {
      status: access.status,
      logins: access.vault.logins.map((login) => ({ origin: login.origin, username: login.username, password: login.password })),
      neverSave: access.vault.neverSaveOrigins,
    };
  }, vaultModulePath);

async function waitForVault(isWanted, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let latest = await readVault();
  while (!isWanted(latest) && Date.now() < deadline) {
    await sleep(150);
    latest = await readVault();
  }
  return latest;
}

// The overlay page keeps its last drawing after it closes; whether it is on screen is decided by the main window.
const isOverlayOnScreen = () =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
    return win.contentView.children.some((child) => child.webContents?.getURL().endsWith("/overlay/overlay.html"));
  });
const promptText = async (timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isOverlayOnScreen()) {
      const prompt = await overlay.$(".password-prompt");
      if (prompt !== null) return (await prompt.textContent()).replace(/\s+/g, " ").trim();
    }
    await sleep(150);
  }
  return null;
};
const noPromptWithin = async (timeoutMs) => (await promptText(timeoutMs)) === null;
const waitForOverlayGone = async () => {
  for (let attempt = 0; attempt < 40 && (await isOverlayOnScreen()); attempt++) {
    await sleep(50);
  }
};

let runCounter = 0;
// Opens a sign-in page in a new tab (a unique query makes the tab easy to find) and returns its page.
async function openSignIn(origin, route) {
  runCounter = runCounter + 1;
  const address = `${origin}/${route}?run=${runCounter}`;
  await dispatch({ type: "openTab", typedText: address });
  let tabPage = null;
  for (let attempt = 0; attempt < 50 && tabPage === null; attempt++) {
    tabPage = app.windows().find((candidate) => candidate.url().includes(`run=${runCounter}`)) ?? null;
    if (tabPage === null) await sleep(200);
  }
  if (tabPage === null) throw new Error(`${address} did not open`);
  await tabPage.waitForSelector("input[type=email]");
  await sleep(400);
  return tabPage;
}
async function typeCredentials(tabPage, email, password) {
  await tabPage.click("input[type=email]");
  await tabPage.keyboard.type(email);
  await tabPage.click("input[type=password]");
  await tabPage.keyboard.type(password);
}
async function signIn(tabPage, email, password) {
  await typeCredentials(tabPage, email, password);
  await tabPage.keyboard.press("Enter");
}

// ---------- 1. A typed sign-in asks to save; the overlay never sees the password ----------
const firstTab = await openSignIn(mainOrigin, "login");
await signIn(firstTab, "alex@example.com", "first-pass-1");
const firstPrompt = await promptText(5000);
check("a typed sign-in asks to save the password", /Save password for 127\.0\.0\.1:\d+\?/.test(firstPrompt ?? "") && (firstPrompt ?? "").includes("alex@example.com"), firstPrompt ?? "no prompt");
await overlay.screenshot({ path: path.join(outDir, "password-prompt.png") }).catch(() => undefined);
const overlayHtml = await overlay.content();
check("the overlay never holds the password", !overlayHtml.includes("first-pass-1"));

// ---------- 2. Save puts the login in the encrypted vault ----------
await overlay.click(".password-prompt .permission-button.is-primary");
const afterSave = await waitForVault((vault) => vault.logins.length > 0);
const savedLogin = afterSave.logins[0];
check(
  "Save keeps exactly that login in the vault",
  afterSave.logins.length === 1 && savedLogin.origin === mainOrigin && savedLogin.username === "alex@example.com" && savedLogin.password === "first-pass-1",
  JSON.stringify(afterSave.logins.map((login) => ({ origin: login.origin, username: login.username }))),
);
const vaultFile = path.join(userDataDir, "Passwords", "profile-default.vault");
for (let attempt = 0; attempt < 40 && !fs.existsSync(vaultFile); attempt++) {
  await sleep(150);
}
const vaultBytes = fs.existsSync(vaultFile) ? fs.readFileSync(vaultFile) : null;
check(
  "the vault file on disk shows neither the password nor the username",
  vaultBytes !== null && vaultBytes.length > 0 && !vaultBytes.includes("first-pass-1") && !vaultBytes.includes("alex@example.com"),
  vaultBytes === null ? "no file" : `${vaultBytes.length} bytes`,
);
await waitForOverlayGone();

// ---------- 3. The same password asks nothing ----------
const sameTab = await openSignIn(mainOrigin, "login");
await signIn(sameTab, "alex@example.com", "first-pass-1");
check("signing in again with the saved password asks nothing", await noPromptWithin(3000));

// ---------- 4. A changed password asks to update ----------
const changedTab = await openSignIn(mainOrigin, "login");
await signIn(changedTab, "alex@example.com", "second-pass-2");
const updatePrompt = await promptText(5000);
const hasNeverButton = (await overlay.$(".password-never-button")) !== null;
check("a changed password asks to update, without 'Never for this site'", /Update password for 127\.0\.0\.1:\d+\?/.test(updatePrompt ?? "") && !hasNeverButton, updatePrompt ?? "no prompt");
await overlay.click(".password-prompt .permission-button.is-primary");
const afterUpdate = await waitForVault((vault) => vault.logins.some((login) => login.password === "second-pass-2"));
check("Update keeps one login with the new password", afterUpdate.logins.length === 1 && afterUpdate.logins[0].password === "second-pass-2", JSON.stringify(afterUpdate.logins.map((login) => login.username)));
await waitForOverlayGone();

// ---------- 5. Never for this site, per site ----------
const otherTab = await openSignIn(otherOrigin, "login");
await signIn(otherTab, "blake@example.com", "other-pass-1");
const otherPrompt = await promptText(5000);
check("another site asks as well", /Save password for login\.test:\d+\?/.test(otherPrompt ?? ""), otherPrompt ?? "no prompt");
await overlay.click(".password-never-button");
const afterNever = await waitForVault((vault) => vault.neverSave.includes(otherOrigin));
check("Never for this site is remembered for that site only", afterNever.neverSave.includes(otherOrigin) && afterNever.neverSave.length === 1 && afterNever.logins.length === 1, JSON.stringify(afterNever.neverSave));
await waitForOverlayGone();
const neverTab = await openSignIn(otherOrigin, "login");
await signIn(neverTab, "blake@example.com", "other-pass-2");
check("and it asks nothing there any more", await noPromptWithin(3000));

// ---------- 6. A page script filling and sending a form is never offered ----------
const scriptTab = await openSignIn(mainOrigin, "login");
await scriptTab.evaluate(() => {
  document.querySelector("input[type=email]").value = "script@example.com";
  document.querySelector("input[type=password]").value = "scripted-pass";
  document.querySelector("form").requestSubmit();
});
check("a page script that sends a filled form is not offered", await noPromptWithin(3500));

// ---------- 7. A single-page sign-in (no navigation) is offered; Not now saves nothing ----------
const loginCountBefore = (await readVault()).logins.length;
const spaTab = await openSignIn(mainOrigin, "spa-login");
const spaAddress = spaTab.url();
await signIn(spaTab, "spa@example.com", "spa-pass-1");
const spaPrompt = await promptText(5000);
check("a single-page sign-in without navigation is offered", /Save password for 127\.0\.0\.1:\d+\?/.test(spaPrompt ?? "") && (spaPrompt ?? "").includes("spa@example.com") && spaTab.url() === spaAddress, spaPrompt ?? "no prompt");
await overlay.click(".password-prompt .permission-button:not(.is-primary):not(.password-never-button)");
await waitForOverlayGone();
await sleep(1500);
const afterNotNow = await readVault();
check("Not now saves nothing", afterNotNow.logins.length === loginCountBefore && !afterNotNow.logins.some((login) => login.username === "spa@example.com"));

// ---------- 8. Escape closes the card and saves nothing ----------
const escapeTab = await openSignIn(mainOrigin, "login");
await signIn(escapeTab, "esc@example.com", "escape-pass-1");
const escapePrompt = await promptText(5000);
await overlay.keyboard.press("Escape");
await waitForOverlayGone();
await sleep(1500);
const afterEscape = await readVault();
check("Escape closes the card and saves nothing", escapePrompt !== null && !(await isOverlayOnScreen()) && !afterEscape.logins.some((login) => login.username === "esc@example.com"), escapePrompt ?? "no prompt");

// ---------- 9. The setting turns the offers off ----------
await dispatch({ type: "setOffersToSavePasswords", isOn: false });
const offTab = await openSignIn(mainOrigin, "login");
await signIn(offTab, "off@example.com", "off-pass-1");
check("with the setting off, a typed sign-in asks nothing", await noPromptWithin(3500));
await dispatch({ type: "setOffersToSavePasswords", isOn: true });

// ---------- 10. Only the tab that signed in asks ----------
const hiddenTab = await openSignIn(mainOrigin, "login");
const hiddenRun = runCounter;
const tabsBefore = Object.values((await page.evaluate(() => window.browserApi.getState())).items);
const hiddenTabId = tabsBefore.find((item) => item.kind === "tab" && item.url.includes(`run=${hiddenRun}`))?.id;
await signIn(hiddenTab, "tabs@example.com", "tabs-pass-1");
await sleep(300);
// Another tab comes to the front before the slow sign-in answer arrives.
await dispatch({ type: "openTab", typedText: `${mainOrigin}/blank?run=blank` });
await sleep(300);
const promptWhileAway = await promptText(3500);
check("a sign-in in a tab that is not shown asks nothing yet", promptWhileAway === null);
if (hiddenTabId === undefined) {
  check("the sign-in tab was found again", false);
} else {
  await dispatch({ type: "selectTab", tabId: hiddenTabId });
  const promptBack = await promptText(5000);
  check("coming back to that tab shows the offer", /Save password for 127\.0\.0\.1:\d+\?/.test(promptBack ?? "") && (promptBack ?? "").includes("tabs@example.com"), promptBack ?? "no prompt");
  await overlay.keyboard.press("Escape");
  await waitForOverlayGone();
}

// ---------- Done ----------
const appPid = app.process().pid;
const quitResult = await Promise.race([app.close().then(() => "quit"), sleep(15000).then(() => "still running")]);
if (quitResult !== "quit") process.kill(appPid);
server.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

const passed = results.filter((result) => result.ok).length;
console.log(`${passed}/${results.length} password checks passed`);
process.exit(passed === results.length ? 0 : 1);
