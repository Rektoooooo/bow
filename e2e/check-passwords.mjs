// Checks Bow Passwords' "Save password?" offer with real clicks and typing on local sign-in pages:
// - after a typed sign-in the card asks to save (the overlay never holds the password), Save puts the login in the
//   profile's encrypted vault (the file on disk shows neither the password nor the username);
// - the same password asks nothing, a changed one asks to update, "Never for this site" is remembered per site;
// - a page script that fills and sends a form is never offered, a single-page sign-in (no navigation) is;
// - Not now and Escape save nothing, the setting turns the offers off, and only the tab that signed in asks;
// - the list under the field (Bow's own view above the page): nothing is filled on load, a real click shows the saved
//   login below the field and inside the page's area, a script focus shows nothing, arrow keys + Return, Escape and a
//   click on a row work, Return with nothing highlighted still sends the form, typing past the match closes it, the
//   password field shows it too, a site without a saved login shows nothing, and near the page's bottom it opens above.
// usage: npm run build && node e2e/check-passwords.mjs
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { captureWindow } from "./composite.mjs";

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
// Counts the input events each field heard, so a check can see that a fill looks like typing to the page.
const INPUT_COUNTER = `<script>
  window.inputCounts = { email: 0, password: 0 };
  document.querySelector("input[type=email]").addEventListener("input", () => { window.inputCounts.email++; });
  document.querySelector("input[type=password]").addEventListener("input", () => { window.inputCounts.password++; });
</script>`;
const server = http.createServer((request, response) => {
  response.setHeader("content-type", "text/html");
  // A tall page with the form at its very bottom: scrolled down, the fields are at the view's bottom edge.
  if (request.url.startsWith("/login-bottom")) {
    response.end(`<!doctype html><title>Login bottom</title><body style="margin:0;height:3000px"><form method="post" action="/welcome" style="position:absolute;top:2900px">${FIELDS}</form></body>`);
    return;
  }
  if (request.url.startsWith("/login")) {
    response.end(`<!doctype html><title>Login</title><body style="margin:0"><form method="post" action="/welcome">${FIELDS}</form>${INPUT_COUNTER}</body>`);
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
  // An ordinary form (no password): what is typed into its allowed fields is remembered; the rest never is.
  if (request.url.startsWith("/profile")) {
    response.end(`<!doctype html><title>Profile</title><body style="margin:0"><form method="post" action="/saved">
      <input name="fullname" autocomplete="name" style="width:300px;height:30px">
      <input type="email" name="contact" style="width:300px;height:30px">
      <input type="tel" name="phone" style="width:300px;height:30px">
      <input type="search" name="q" style="width:300px;height:30px">
      <input name="comment" style="width:300px;height:30px">
      <input name="cardnumber" inputmode="numeric" style="width:300px;height:30px">
      <input name="code" autocomplete="one-time-code" style="width:300px;height:30px">
      <input name="company" value="Planted Inc" style="width:300px;height:30px">
      <button>Save</button></form></body>`);
    return;
  }
  // Another form on another site, with an email field: a remembered email comes back here.
  if (request.url.startsWith("/contact")) {
    response.end(`<!doctype html><title>Contact</title><body style="margin:0"><form method="post" action="/saved">
      <input type="email" name="reply_to" style="width:300px;height:30px"><button>Send</button></form></body>`);
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

// ---------- 11. The list under the field ----------
// Bow's own view above the page, found among the main window's views by its page.
const readAutofillView = (tabAddressPart) =>
  app.evaluate(({ BrowserWindow }, addressPart) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
    const views = win.contentView.children.filter((child) => child.webContents);
    const popup = views.find((child) => child.webContents.getURL().endsWith("/autofill/popup.html"));
    const tab = views.find((child) => child.webContents.getURL().includes(addressPart));
    if (!popup || !tab) return null;
    return { popup: popup.getBounds(), tab: tab.getBounds() };
  }, tabAddressPart);
const waitForList = async (tabPage, timeoutMs = 2500) => {
  const addressPart = `run=${new URL(tabPage.url()).searchParams.get("run")}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await readAutofillView(addressPart);
    if (found !== null) return found;
    await sleep(100);
  }
  return null;
};
const isListGone = async (tabPage, timeoutMs = 1500) => {
  const addressPart = `run=${new URL(tabPage.url()).searchParams.get("run")}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await readAutofillView(addressPart)) === null) return true;
    await sleep(100);
  }
  return false;
};
// Keys that Bow's list takes are sent through the tab's web contents: Playwright's keyboard goes straight to the page
// (the DevTools protocol) and never passes the browser-side "before-input-event" where the list listens, as a real key
// press does. A Return is followed by a "char" event, which is what sends a form.
const pressKeyLikeUser = (tabPage, keyCode) =>
  app.evaluate(
    async ({ webContents }, { addressPart, code }) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().includes(addressPart));
      contents.sendInputEvent({ type: "keyDown", keyCode: code });
      if (code === "Return") contents.sendInputEvent({ type: "char", keyCode: "\r" });
      contents.sendInputEvent({ type: "keyUp", keyCode: code });
    },
    { addressPart: `run=${new URL(tabPage.url()).searchParams.get("run")}`, code: keyCode },
  );
const fieldValues = (tabPage) =>
  tabPage.evaluate(() => ({
    email: document.querySelector("input[type=email]").value,
    password: document.querySelector("input[type=password]").value,
    counts: { ...window.inputCounts },
  }));
const clearFields = (tabPage) =>
  tabPage.evaluate(() => {
    document.querySelector("input[type=email]").value = "";
    document.querySelector("input[type=password]").value = "";
  });
const readTimesUsed = () =>
  app.evaluate(async (_electron, modulePath) => {
    const access = await process.mainModule.require(modulePath).openVault("profile-default");
    return access.vault.logins.map((login) => login.timesUsed ?? 0);
  }, vaultModulePath);
const popupPage = await findPage("/autofill/popup.html").catch(() => null);
let listPage = popupPage;

// 11a. Nothing is filled on load.
const listTab = await openSignIn(mainOrigin, "login");
await listTab.reload();
await listTab.waitForSelector("input[type=email]");
await sleep(1000);
const afterLoad = await fieldValues(listTab);
check("a page with a saved login fills nothing on load", afterLoad.email === "" && afterLoad.password === "", JSON.stringify({ email: afterLoad.email, password: afterLoad.password }));

// 11b. A real click shows the login below the field, inside the page's area, without the password.
await listTab.click("input[type=email]");
const shownList = await waitForList(listTab);
const emailBox = await listTab.evaluate(() => {
  const box = document.querySelector("input[type=email]").getBoundingClientRect();
  return { x: box.x, y: box.y, width: box.width, height: box.height };
});
const isBelowField = shownList !== null && shownList.popup.y >= shownList.tab.y + emailBox.y + emailBox.height - 1;
const isInsidePage =
  shownList !== null &&
  shownList.popup.x >= shownList.tab.x &&
  shownList.popup.y >= shownList.tab.y &&
  shownList.popup.x + shownList.popup.width <= shownList.tab.x + shownList.tab.width &&
  shownList.popup.y + shownList.popup.height <= shownList.tab.y + shownList.tab.height;
check("a click into the email field shows the list below it, inside the page's area", isBelowField && isInsidePage, JSON.stringify(shownList));
listPage = await findPage("/autofill/popup.html");
await sleep(300);
const listText = await listPage.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());
const listHtml = await listPage.content();
check("the list shows the username and no password", listText.includes("alex@example.com") && !listHtml.includes("second-pass-2") && !listHtml.includes("first-pass-1"), listText);
await listPage.screenshot({ path: path.join(outDir, "autofill-list.png"), omitBackground: true }).catch(() => undefined);
await fs.promises.writeFile(path.join(outDir, "autofill-window.png"), await captureWindow(app)).catch(() => undefined);

// 11c. Leaving the field closes it; a page script's focus shows nothing.
await listTab.mouse.click(700, 500);
const closedByClickElsewhere = await isListGone(listTab);
await listTab.evaluate(() => document.querySelector("input[type=email]").focus());
await sleep(1000);
check("a click elsewhere closes the list, and a script's focus() shows none", closedByClickElsewhere && (await isListGone(listTab, 300)));

// 11d. Arrow down + Return fills both fields, the page hears input events, the use is counted.
const timesUsedBefore = (await readTimesUsed())[0];
await listTab.click("input[type=email]");
await waitForList(listTab);
await pressKeyLikeUser(listTab, "Down");
await pressKeyLikeUser(listTab, "Return");
const filledByKeys = await fieldValues(listTab);
check(
  "ArrowDown and Return fill the email and the password, and the page heard input events",
  filledByKeys.email === "alex@example.com" && filledByKeys.password === "second-pass-2" && filledByKeys.counts.email > 0 && filledByKeys.counts.password > 0,
  JSON.stringify({ email: filledByKeys.email, counts: filledByKeys.counts }),
);
check("the list is gone after the pick", await isListGone(listTab));
let timesUsedAfter = (await readTimesUsed())[0];
for (let attempt = 0; attempt < 20 && timesUsedAfter === timesUsedBefore; attempt++) {
  await sleep(100);
  timesUsedAfter = (await readTimesUsed())[0];
}
check("the pick is counted as a use of the login", timesUsedAfter === timesUsedBefore + 1, `${timesUsedBefore} → ${timesUsedAfter}`);

// 11e. Escape closes the list and fills nothing.
await clearFields(listTab);
await listTab.click("input[type=email]");
await waitForList(listTab);
await pressKeyLikeUser(listTab, "Escape");
const closedByEscape = await isListGone(listTab);
const afterEscapeKey = await fieldValues(listTab);
check("Escape closes the list and the fields stay empty", closedByEscape && afterEscapeKey.email === "" && afterEscapeKey.password === "");

// 11f. A click on the row fills.
await listTab.click("input[type=email]");
await waitForList(listTab);
await listPage.click(".autofill-row");
await sleep(400);
const filledByClick = await fieldValues(listTab);
check("a click on the row fills the email and the password", filledByClick.email === "alex@example.com" && filledByClick.password === "second-pass-2", filledByClick.email);

// 11g. Return with nothing highlighted still sends the form.
await clearFields(listTab);
await listTab.click("input[type=email]");
await waitForList(listTab);
await pressKeyLikeUser(listTab, "Return");
let navigatedToWelcome = false;
for (let attempt = 0; attempt < 40 && !navigatedToWelcome; attempt++) {
  navigatedToWelcome = listTab.url().includes("/welcome");
  if (!navigatedToWelcome) await sleep(150);
}
check("Return with nothing highlighted sends the form", navigatedToWelcome, listTab.url());

// 11h. Typing past the match closes the list; the password field shows it again.
const typingTab = await openSignIn(mainOrigin, "login");
await typingTab.click("input[type=email]");
await waitForList(typingTab);
await typingTab.keyboard.type("zzz");
check("typing something that matches no login closes the list", await isListGone(typingTab));
await typingTab.click("input[type=password]");
const listAtPassword = await waitForList(typingTab);
check("a click into the password field shows the login too", listAtPassword !== null);
await pressKeyLikeUser(typingTab, "Escape");

// 11i. A site without a saved login shows nothing, though its field was reported.
const reportsBefore = await app.evaluate(async (_electron, modulePath) => process.mainModule.require(modulePath).getFormsMessageCounts().fieldFocused, path.join(appDir, "dist", "node", "main", "formsBridge.js"));
const strangerTab = await openSignIn(otherOrigin, "login");
await strangerTab.click("input[type=email]");
await sleep(800);
const reportsAfter = await app.evaluate(async (_electron, modulePath) => process.mainModule.require(modulePath).getFormsMessageCounts().fieldFocused, path.join(appDir, "dist", "node", "main", "formsBridge.js"));
check("a site with no saved login shows no list (the field was reported)", reportsAfter > reportsBefore && (await isListGone(strangerTab, 300)), `${reportsBefore} → ${reportsAfter}`);

// 11j. Near the page's bottom the list opens above the field, still inside the page's area.
const bottomTab = await openSignIn(mainOrigin, "login-bottom");
await bottomTab.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await sleep(300);
await bottomTab.click("input[type=email]");
const bottomList = await waitForList(bottomTab);
const bottomBox = await bottomTab.evaluate(() => {
  const box = document.querySelector("input[type=email]").getBoundingClientRect();
  return { y: box.y, height: box.height };
});
const isAboveField = bottomList !== null && bottomList.popup.y + bottomList.popup.height <= bottomList.tab.y + bottomBox.y + 1;
const staysInside =
  bottomList !== null &&
  bottomList.popup.y >= bottomList.tab.y &&
  bottomList.popup.y + bottomList.popup.height <= bottomList.tab.y + bottomList.tab.height;
check("near the page's bottom the list opens above the field, inside the page's area", isAboveField && staysInside, JSON.stringify(bottomList));
await pressKeyLikeUser(bottomTab, "Escape");

// ---------- 12. Form memory: what is typed into ordinary forms comes back ----------
const readFormEntries = () =>
  app.evaluate(async (_electron, modulePath) => {
    const access = await process.mainModule.require(modulePath).openVault("profile-default");
    return access.vault.formEntries.map((entry) => ({ kind: entry.kind, value: entry.value }));
  }, vaultModulePath);
async function openForm(origin, route) {
  runCounter = runCounter + 1;
  const address = `${origin}/${route}?run=${runCounter}`;
  await dispatch({ type: "openTab", typedText: address });
  let tabPage = null;
  for (let attempt = 0; attempt < 50 && tabPage === null; attempt++) {
    tabPage = app.windows().find((candidate) => candidate.url().includes(`run=${runCounter}`)) ?? null;
    if (tabPage === null) await sleep(200);
  }
  if (tabPage === null) throw new Error(`${address} did not open`);
  await tabPage.waitForSelector("form");
  await sleep(400);
  return tabPage;
}
async function typeInto(tabPage, selector, text) {
  await tabPage.click(selector);
  await tabPage.keyboard.type(text);
}
const isRemembered = (entries, kind, value) => entries.some((entry) => entry.kind === kind && entry.value === value);

// 12a. Typed values of allowed fields are kept; search, comment, card number, one-time code and a value the page
// filled in itself are not.
const profileTab = await openForm(mainOrigin, "profile");
await typeInto(profileTab, "input[name=fullname]", "Alex Example");
await typeInto(profileTab, "input[name=contact]", "alex.form@example.com");
await typeInto(profileTab, "input[name=phone]", "+1 415 555 0100");
await typeInto(profileTab, "input[name=q]", "secret search");
await typeInto(profileTab, "input[name=comment]", "a comment");
await typeInto(profileTab, "input[name=cardnumber]", "4111 1111 1111 1111");
await typeInto(profileTab, "input[name=code]", "123456");
await profileTab.click("button");
const remembered = await (async () => {
  const deadline = Date.now() + 5000;
  let entries = await readFormEntries();
  while (entries.length === 0 && Date.now() < deadline) {
    await sleep(150);
    entries = await readFormEntries();
  }
  return entries;
})();
check(
  "a sent form's typed name, email and phone are remembered",
  isRemembered(remembered, "name", "Alex Example") && isRemembered(remembered, "email", "alex.form@example.com") && isRemembered(remembered, "tel", "+1 415 555 0100"),
  JSON.stringify(remembered),
);
const rememberedText = JSON.stringify(remembered);
check(
  "a search, a comment, a card number, a one-time code and a value the page filled in are never remembered",
  ["secret search", "a comment", "4111", "123456", "Planted Inc"].every((secret) => !rememberedText.includes(secret)),
  rememberedText,
);

// 12b. The remembered email comes back in an email field on another site.
const contactTab = await openForm(otherOrigin, "contact");
await contactTab.click("input[name=reply_to]");
const contactList = await waitForList(contactTab);
const contactListText = contactList === null || listPage === null ? "" : await listPage.textContent("body");
check("on another site, an email field offers the remembered email", contactList !== null && contactListText.includes("alex.form@example.com"), contactListText.trim());
await pressKeyLikeUser(contactTab, "Down");
await pressKeyLikeUser(contactTab, "Return");
await sleep(400);
const contactValue = await contactTab.evaluate(() => document.querySelector("input[name=reply_to]").value);
check("Down and Return put it into the field", contactValue === "alex.form@example.com", contactValue);

// 12c. Shift+Delete on a highlighted suggestion forgets it.
const forgetTab = await openForm(otherOrigin, "contact");
await forgetTab.click("input[name=reply_to]");
await waitForList(forgetTab);
await pressKeyLikeUser(forgetTab, "Down");
await app.evaluate(({ webContents }, addressPart) => {
  const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().includes(addressPart));
  contents.sendInputEvent({ type: "keyDown", keyCode: "Delete", modifiers: ["shift"] });
  contents.sendInputEvent({ type: "keyUp", keyCode: "Delete", modifiers: ["shift"] });
}, `run=${new URL(forgetTab.url()).searchParams.get("run")}`);
await sleep(500);
const afterForget = await readFormEntries();
check("Shift+Delete forgets the highlighted suggestion", !isRemembered(afterForget, "email", "alex.form@example.com") && isRemembered(afterForget, "name", "Alex Example"), JSON.stringify(afterForget));

// 12d. With the setting off nothing new is remembered.
await dispatch({ type: "setRemembersFormEntries", isOn: false });
const offProfileTab = await openForm(mainOrigin, "profile");
await typeInto(offProfileTab, "input[name=fullname]", "Sam Off");
await offProfileTab.click("button");
await sleep(1500);
check("with form memory off, a sent form is not remembered", !isRemembered(await readFormEntries(), "name", "Sam Off"));
await dispatch({ type: "setRemembersFormEntries", isOn: true });

// ---------- Done ----------
const appPid = app.process().pid;
const quitResult = await Promise.race([app.close().then(() => "quit"), sleep(15000).then(() => "still running")]);
if (quitResult !== "quit") process.kill(appPid);
server.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

const passed = results.filter((result) => result.ok).length;
console.log(`${passed}/${results.length} password checks passed`);
process.exit(passed === results.length ? 0 : 1);
