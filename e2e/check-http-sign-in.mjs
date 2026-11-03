// Checks the card for sites that ask for a username and password (HTTP authentication, a 401 with
// "WWW-Authenticate: Basic") against a local server with synthetic accounts:
// - the card names the host and the realm the server gave (as plain text);
// - Cancel and Escape show the site's own 401 page;
// - wrong credentials make the card come back and are not saved; right ones load the page and are saved in the
//   profile's vault; "Save in Bow Passwords" turned off saves nothing;
// - a later visit offers the saved login, one click signs in, and the password is never in the overlay page's HTML;
// - two tabs asking for the same host and realm share one card.
// usage: npm run build && node e2e/check-http-sign-in.mjs      (uses a throwaway --user-data-dir, the mock keychain)
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-http-sign-in");
fs.rmSync(userDataDir, { recursive: true, force: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- A local site that wants a password: made-up accounts, one realm ----------
const ACCOUNTS = { alex: "right-pass-1", casey: "casey-pass-1" };
const REALM = "Test Realm <b>not bold</b>";
const server = http.createServer((request, response) => {
  response.setHeader("content-type", "text/html");
  const header = request.headers.authorization ?? "";
  const [username, password] = Buffer.from(header.replace(/^Basic /, ""), "base64").toString().split(":");
  if (ACCOUNTS[username] !== undefined && ACCOUNTS[username] === password) {
    response.end("<!doctype html><title>Secret</title><body>Secret page</body>");
    return;
  }
  response.statusCode = 401;
  response.setHeader("www-authenticate", `Basic realm="${REALM}"`);
  response.end("<!doctype html><title>Denied</title><body>Denied page</body>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir],
  timeout: 30000,
});
// An error escaping a handler in the main process pops up Electron's error dialog (and takes the user's focus), so
// whatever the app prints on its error output is watched.
let appErrorOutput = "";
app.process().stderr.on("data", (chunk) => {
  appErrorOutput += chunk.toString();
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
    return { status: access.status, logins: access.vault.logins.map((login) => ({ origin: login.origin, username: login.username, password: login.password })) };
  }, vaultModulePath);

const isOverlayOnScreen = () =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
    return win.contentView.children.some((child) => child.webContents?.getURL().endsWith("/overlay/overlay.html"));
  });
async function waitForCard(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await isOverlayOnScreen()) && (await overlay.$(".http-sign-in")) !== null) return true;
    await sleep(150);
  }
  return false;
}
async function waitForCardGone(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isOverlayOnScreen())) return true;
    await sleep(100);
  }
  return false;
}
const cardText = async () => ((await (await overlay.$(".http-sign-in")).textContent()) ?? "").replace(/\s+/g, " ").trim();

let runCounter = 0;
// Chromium remembers the credentials of a realm for the session (like any browser), so a tab would sign in by
// itself; each visit starts from an empty cache to see the card again.
async function openSecureTab() {
  await app.evaluate(({ session }) => session.fromPartition("persist:profile-default").clearAuthCache());
  runCounter = runCounter + 1;
  const run = runCounter;
  await dispatch({ type: "openTab", typedText: `${origin}/secure?run=${run}` });
  return run;
}
// The tab's page, found by its address once it has one; its text once it shows something.
async function textOfTab(run, wantedText, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tabPage = app.windows().find((candidate) => candidate.url().includes(`run=${run}`));
    const text = tabPage ? await tabPage.textContent("body").catch(() => "") : "";
    if (text.includes(wantedText)) return text;
    await sleep(150);
  }
  return null;
}
async function signInWithTypedText(username, password) {
  await overlay.fill('.http-sign-in-field[aria-label="Username"]', username);
  await overlay.fill('.http-sign-in-field[aria-label="Password"]', password);
  await overlay.click(".http-sign-in .permission-button.is-primary");
}

// ---------- 1. The card names the host and the realm, as text ----------
const firstRun = await openSecureTab();
check("a site asking for a password shows the card", await waitForCard());
const text = await cardText();
check("the card names the host", text.includes(`Sign in to 127.0.0.1:${port}`), text);
check("the card shows the realm as plain text", text.includes("Test Realm <b>not bold</b>") && (await overlay.$(".http-sign-in b")) === null, text);
check("no saved login yet, so no 'Use saved login' button", (await overlay.$(".http-sign-in-saved")) === null);
await overlay.screenshot({ path: path.join(outDir, "http-sign-in.png") }).catch(() => undefined);

// ---------- 2. Cancel shows the site's own 401 page ----------
await overlay.click(".http-sign-in .permission-button:not(.is-primary)");
check("Cancel shows the site's own page", (await textOfTab(firstRun, "Denied page")) !== null);
check("and the card goes away", await waitForCardGone());

// ---------- 3. Escape does the same ----------
const escapeRun = await openSecureTab();
await waitForCard();
await overlay.keyboard.press("Escape");
check("Escape shows the site's own page", (await textOfTab(escapeRun, "Denied page")) !== null);
await waitForCardGone();

// ---------- 4. Wrong credentials: the card comes back, nothing is saved ----------
const wrongRun = await openSecureTab();
await waitForCard();
await signInWithTypedText("alex", "wrong-pass");
await waitForCardGone();
check("wrong credentials bring the card back", await waitForCard());
await sleep(1500);
check("and nothing is saved", (await readVault()).logins.length === 0);

// ---------- 5. Right credentials load the page and are saved ----------
await signInWithTypedText("alex", ACCOUNTS.alex);
check("right credentials load the page", (await textOfTab(wrongRun, "Secret page")) !== null);
let vault = { logins: [] };
for (let attempt = 0; attempt < 40 && vault.logins.length === 0; attempt++) {
  vault = await readVault();
  if (vault.logins.length === 0) await sleep(150);
}
const savedLogin = vault.logins[0];
check(
  "the credentials are saved for that site once the sign-in worked",
  vault.logins.length === 1 && savedLogin.origin === origin && savedLogin.username === "alex" && savedLogin.password === ACCOUNTS.alex,
  JSON.stringify(vault.logins.map((login) => ({ origin: login.origin, username: login.username }))),
);
await waitForCardGone();

// ---------- 6. "Save in Bow Passwords" turned off saves nothing ----------
const noSaveRun = await openSecureTab();
await waitForCard();
// The saved login now exists, but this visit types another account.
await overlay.click('.http-sign-in-save input[type="checkbox"]');
await signInWithTypedText("casey", ACCOUNTS.casey);
check("an account typed with saving off signs in", (await textOfTab(noSaveRun, "Secret page")) !== null);
await sleep(1500);
check("and is not saved", !(await readVault()).logins.some((login) => login.username === "casey"));
await waitForCardGone();

// ---------- 7. A later visit offers the saved login; the password never reaches the overlay ----------
const savedRun = await openSecureTab();
await waitForCard();
const savedButton = await overlay.$(".http-sign-in-saved");
const savedText = savedButton ? (await savedButton.textContent()) ?? "" : "";
check("a later visit offers the saved login", savedText.trim() === "Use saved login (alex)", savedText);
const overlayHtml = await overlay.content();
check("the overlay page never holds the saved password", !overlayHtml.includes(ACCOUNTS.alex));
await overlay.click(".http-sign-in-saved");
check("one click on the saved login signs in", (await textOfTab(savedRun, "Secret page")) !== null);
await waitForCardGone();

// ---------- 8. Two tabs asking at once share one card ----------
const firstSharedRun = await openSecureTab();
await waitForCard();
const secondSharedRun = await openSecureTab();
await sleep(1500);
// Opening a tab replaces nothing here: the card for the host is still the one card.
const cardCount = await overlay.$$eval(".http-sign-in", (cards) => cards.length);
check("a second tab for the same host and realm joins the card", cardCount === 1);
if ((await overlay.$(".http-sign-in-saved")) === null) {
  await waitForCard();
}
await overlay.click(".http-sign-in-saved");
check("one answer signs in both tabs", (await textOfTab(firstSharedRun, "Secret page")) !== null && (await textOfTab(secondSharedRun, "Secret page")) !== null);

// ---------- 9. A tab that closes while its card waits settles the card ----------
await waitForCardGone();
const closingRun = await openSecureTab();
await waitForCard();
const tabIdOfClosingRun = await page.evaluate(() => window.browserApi.getState().then((state) => state.selectedTabIdBySpace[state.activeSpaceId]));
await dispatch({ type: "closeTab", tabId: tabIdOfClosingRun });
check("closing the tab takes its card away", await waitForCardGone());


await sleep(500);
await app.close();
server.close();
check("the main process logged no error (no uncaught exception, no callback used twice)", !/Uncaught|TypeError|callback was called/i.test(appErrorOutput), appErrorOutput.slice(0, 300));
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
