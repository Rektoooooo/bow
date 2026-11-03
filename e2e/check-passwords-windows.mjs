// Checks Bow Passwords outside tabs, on local made-up sign-in pages:
// - in a Little Window: a click in the username field shows the list inside that window over its page, a pick fills the
//   fields, a new sign-in asks in a native sheet on that window (no password in it) and Save stores the login, and a
//   sent form's typed name is remembered;
// - in a Peek: the list shows over the Peek's page, a pick fills, and the offer is a sheet on the main window;
// - in a sign-in popup (window.open with a size) opened from a tab: the list shows over the popup's own content, and a
//   popup that closes itself right after sending gets the offer's card in the main window, where its opener lives;
// - a private Little Window gets no list and no offer, and nothing of it reaches the vault.
// The macOS sheet is replaced in main (as backgroundTesting.ts does for every sheet) so none shows.
// usage: npm run build && node e2e/check-passwords-windows.mjs
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-passwords-windows");
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
  if (request.url.startsWith("/profile")) {
    response.end(`<!doctype html><title>Profile</title><body style="margin:0"><form method="post" action="/saved">
      <input name="fullname" autocomplete="name" style="width:300px;height:30px"><button>Save</button></form></body>`);
    return;
  }
  // A page in a tab with a button that opens the sign-in popup (a real click gives the page its user gesture).
  if (request.url.startsWith("/popup-opener")) {
    response.end(`<!doctype html><title>Opener</title><body><button id="open" style="width:200px;height:40px"
      onclick="window.open('${otherOrigin}/popup-login', 'auth', 'width=500,height=600')">Sign in with a popup</button></body>`);
    return;
  }
  // The popup's sign-in closes the window by itself right after the form was sent, like Google's and Apple's do.
  if (request.url.startsWith("/popup-login")) {
    response.end(`<!doctype html><title>Popup sign-in</title><body style="margin:0"><form id="signin">${FIELDS}</form>
      <script>
        document.getElementById("signin").addEventListener("submit", (event) => {
          event.preventDefault();
          setTimeout(() => window.close(), 150);
        });
      </script></body>`);
    return;
  }
  response.end("<!doctype html><title>Done</title><body>Done</body>");
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
async function findPage(isWanted, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = app.windows().find((candidate) => isWanted(candidate.url()));
    if (found) return found;
    await sleep(150);
  }
  throw new Error("page did not open");
}
const page = await findPage((url) => url.endsWith("/renderer/index.html"));
await page.waitForSelector(".space-title");
const overlay = await findPage((url) => url.endsWith("/overlay/overlay.html"));
const dispatch = (action) => page.evaluate((value) => window.browserApi.dispatch(value), action);

const mainFolder = path.join(appDir, "dist", "node", "main");
const requireMain = (name, run, argument) =>
  app.evaluate((_electron, { modulePath, code, argumentValue }) => new Function("module", "argument", code)(process.mainModule.require(modulePath), argumentValue), {
    modulePath: path.join(mainFolder, `${name}.js`),
    code: `return (${run.toString()})(module, argument);`,
    argumentValue: argument,
  });

// ---------- The vault: one login to list, and what the checks add ----------
const readVault = () =>
  app.evaluate(
    async (_electron, { vaultPath }) => {
      const access = await process.mainModule.require(vaultPath).openVault("profile-default");
      return {
        status: access.status,
        logins: access.vault.logins.map((login) => ({ origin: login.origin, username: login.username, password: login.password })),
        entries: access.vault.formEntries.map((entry) => ({ kind: entry.kind, field: entry.field, value: entry.value })),
      };
    },
    { vaultPath: path.join(mainFolder, "passwordVault.js") },
  );
async function waitForVault(isWanted, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let latest = await readVault();
  while (!isWanted(latest) && Date.now() < deadline) {
    await sleep(150);
    latest = await readVault();
  }
  return latest;
}
const seedLogin = (origin, username, password) =>
  app.evaluate(
    async (_electron, { vaultPath, passwordsPath, login }) => {
      const passwords = process.mainModule.require(passwordsPath);
      await process.mainModule.require(vaultPath).changeVault("profile-default", (vault) => passwords.saveLogin(vault, login, `seed-${login.username}`, Date.now()));
    },
    { vaultPath: path.join(mainFolder, "passwordVault.js"), passwordsPath: path.join(mainFolder, "passwords.js"), login: { origin, username, password } },
  );
await seedLogin(mainOrigin, "alex@example.com", "alex-pass-1");
await seedLogin(otherOrigin, "pop@example.com", "pop-pass-1");

// ---------- The sheet: replaced in main, answers with the chosen button and remembers what it was asked ----------
await app.evaluate(({ dialog }) => {
  globalThis.sheetCalls = [];
  globalThis.sheetAnswer = 0;
  dialog.showMessageBox = async (...parts) => {
    const options = parts.at(-1);
    const parent = parts.length > 1 ? parts[0] : null;
    globalThis.sheetCalls.push({
      message: options.message,
      detail: options.detail,
      buttons: options.buttons,
      parentUrl: parent === null ? null : parent.webContents.getURL(),
    });
    return { response: globalThis.sheetAnswer, checkboxChecked: false };
  };
});
const sheetCalls = () => app.evaluate(() => globalThis.sheetCalls);
const waitForSheetCount = async (count, timeoutMs = 6000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await sheetCalls()).length >= count) return true;
    await sleep(100);
  }
  return false;
};
const setSheetAnswer = (index) => app.evaluate((_electron, value) => { globalThis.sheetAnswer = value; }, index);

// ---------- Helpers for lists, fields and the overlay's card ----------
// The list's view, wherever it is: in a main window, a Little Window (next to the page's view) or a popup (over the
// window's own content).
const readList = (addressPart) =>
  app.evaluate(({ BrowserWindow }, part) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      const views = win.contentView.children.filter((child) => child.webContents);
      const popup = views.find((child) => child.webContents.getURL().endsWith("/autofill/popup.html"));
      if (!popup) continue;
      const pageView = views.find((child) => child.webContents.getURL().includes(part));
      if (pageView) return { popup: popup.getBounds(), area: pageView.getBounds() };
      if (win.webContents.getURL().includes(part)) {
        const [width, height] = win.getContentSize();
        return { popup: popup.getBounds(), area: { x: 0, y: 0, width, height } };
      }
    }
    return null;
  }, addressPart);
const waitForList = async (addressPart, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await readList(addressPart);
    if (found !== null) return found;
    await sleep(100);
  }
  return null;
};
const isListGone = async (addressPart, timeoutMs = 1500) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await readList(addressPart)) === null) return true;
    await sleep(100);
  }
  return false;
};
const isInside = (inner, outer) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const fieldValues = (somePage) =>
  somePage.evaluate(() => ({ email: document.querySelector("input[type=email]").value, password: document.querySelector("input[type=password]").value }));
const fieldBottom = (somePage) =>
  somePage.evaluate(() => {
    const box = document.querySelector("input[type=email]").getBoundingClientRect();
    return box.y + box.height;
  });
const countFieldReports = () => requireMain("formsBridge", (module) => module.getFormsMessageCounts().fieldFocused);
const isOverlayOnScreen = () =>
  app.evaluate(({ BrowserWindow }) => {
    // A popup that is closing can still be in the list, with its page already destroyed.
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && !candidate.webContents.isDestroyed() && candidate.webContents.getURL().endsWith("/renderer/index.html"));
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
async function openLittle(route, runName, options = {}) {
  const address = `${mainOrigin}/${route}?run=${runName}`;
  await requireMain("littleWindow", (module, argument) => module.openLittleWindow(argument.address, argument.options), { address, options });
  const littlePage = await findPage((url) => url.includes(`run=${runName}`));
  await littlePage.waitForSelector("input");
  await sleep(500);
  return littlePage;
}

// ---------- 1. A Little Window: the list, a pick, a new sign-in asks in a sheet ----------
const littlePage = await openLittle("login", "little");
await littlePage.click("input[type=email]");
const littleList = await waitForList("run=little");
const littleFieldBottom = await fieldBottom(littlePage);
check(
  "in a Little Window, a click into the username field shows the list below it, inside the page's area",
  littleList !== null && littleList.popup.y >= littleList.area.y + littleFieldBottom - 1 && isInside(littleList.popup, littleList.area),
  JSON.stringify(littleList),
);
const listPage = await findPage((url) => url.endsWith("/autofill/popup.html"));
await sleep(300);
const littleListText = await listPage.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());
check("the list names the saved login and holds no password", littleListText.includes("alex@example.com") && !(await listPage.content()).includes("alex-pass-1"), littleListText);
await listPage.click(".autofill-row");
await sleep(500);
const littleFilled = await fieldValues(littlePage);
check("a pick fills the username and password in the Little Window", littleFilled.email === "alex@example.com" && littleFilled.password === "alex-pass-1", littleFilled.email);
check("the list is gone after the pick", await isListGone("run=little"));

await littlePage.evaluate(() => {
  document.querySelector("input[type=email]").value = "";
  document.querySelector("input[type=password]").value = "";
});
await littlePage.click("input[type=email]");
await littlePage.keyboard.type("lena@example.com");
await littlePage.click("input[type=password]");
await littlePage.keyboard.type("little-pass-1");
await littlePage.keyboard.press("Enter");
check("a new sign-in in a Little Window asks in a sheet", await waitForSheetCount(1));
const [littleSheet] = await sheetCalls();
check(
  "the sheet is on that Little Window, names the site and the account, and holds no password",
  littleSheet !== undefined &&
    littleSheet.parentUrl.includes("/little/little.html") &&
    littleSheet.message === `Save password for 127.0.0.1:${port}?` &&
    littleSheet.detail === "lena@example.com" &&
    littleSheet.buttons.join("|") === "Save|Never for This Site|Not Now" &&
    !JSON.stringify(littleSheet).includes("little-pass-1"),
  JSON.stringify(littleSheet),
);
const afterLittleSave = await waitForVault((vault) => vault.logins.some((login) => login.username === "lena@example.com"));
check(
  "Save in the sheet keeps the login in the vault",
  afterLittleSave.logins.some((login) => login.username === "lena@example.com" && login.password === "little-pass-1" && login.origin === mainOrigin),
);
check("and no card appeared on the main window", !(await isOverlayOnScreen()));

// Not Now keeps nothing.
await setSheetAnswer(2);
const notNowPage = await openLittle("login", "little-notnow");
await notNowPage.click("input[type=email]");
await notNowPage.keyboard.type("nina@example.com");
await notNowPage.click("input[type=password]");
await notNowPage.keyboard.type("nina-pass-1");
await notNowPage.keyboard.press("Enter");
check("a second sign-in asks again", await waitForSheetCount(2));
await sleep(1200);
check("Not Now keeps nothing", !(await readVault()).logins.some((login) => login.username === "nina@example.com"));
await setSheetAnswer(0);

// ---------- 2. Form memory in a Little Window ----------
const profilePage = await openLittle("profile", "little-profile");
await profilePage.click("input[name=fullname]");
await profilePage.keyboard.type("Lena Little");
await profilePage.click("button");
const remembered = await waitForVault((vault) => vault.entries.some((entry) => entry.value === "Lena Little"));
check("a name sent from a Little Window is remembered", remembered.entries.some((entry) => entry.kind === "name" && entry.value === "Lena Little"), JSON.stringify(remembered.entries));

// ---------- 3. A private Little Window: no list, no offer, nothing kept ----------
const reportsBeforePrivate = await countFieldReports();
const sheetsBeforePrivate = (await sheetCalls()).length;
const privatePage = await openLittle("login", "little-private", { isPrivate: true });
const privatePreloadIds = await app.evaluate(({ webContents }) => {
  const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().includes("run=little-private"));
  return contents.session.getPreloadScripts().map((script) => script.id);
});
check("the private window's session has no forms helper", !privatePreloadIds.includes("bow-forms"), JSON.stringify(privatePreloadIds));
await privatePage.click("input[type=email]");
await sleep(800);
check("a private Little Window shows no list (and reports nothing)", (await isListGone("run=little-private", 500)) && (await countFieldReports()) === reportsBeforePrivate);
await privatePage.keyboard.type("private@example.com");
await privatePage.click("input[type=password]");
await privatePage.keyboard.type("private-pass-1");
await privatePage.keyboard.press("Enter");
await sleep(2500);
const afterPrivate = await readVault();
check(
  "a sign-in there asks nothing and keeps nothing",
  (await sheetCalls()).length === sheetsBeforePrivate && !(await isOverlayOnScreen()) && !afterPrivate.logins.some((login) => login.username === "private@example.com") && !JSON.stringify(afterPrivate).includes("private-pass-1"),
);
await app.evaluate(({ BrowserWindow }) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.getURL().includes("/little/little.html")) win.close();
  }
});

// ---------- 4. A Peek ----------
const state = await page.evaluate(() => window.browserApi.getState());
const sourceTabId = state.selectedTabIdBySpace[state.activeSpaceId] ?? null;
await requireMain("peek", (module, argument) => module.openPeek(argument.url, argument.tabId), { url: `${mainOrigin}/login?run=peek`, tabId: sourceTabId });
const peekPage = await findPage((url) => url.includes("run=peek"));
await peekPage.waitForSelector("input[type=email]");
// The Peek's page shows once its card has grown.
let peekList = null;
for (let attempt = 0; attempt < 30 && peekList === null; attempt++) {
  await sleep(300);
  await peekPage.click("input[type=email]");
  peekList = await waitForList("run=peek", 600);
}
const peekFieldBottom = await fieldBottom(peekPage);
check(
  "in a Peek, a click into the username field shows the list below it, inside the Peek's page",
  peekList !== null && peekList.popup.y >= peekList.area.y + peekFieldBottom - 1 && isInside(peekList.popup, peekList.area),
  JSON.stringify(peekList),
);
// The vault now holds more than one login for this site: pick Alex's row.
await listPage.click('.autofill-row:has-text("alex@example.com")');
await sleep(500);
const peekFilled = await fieldValues(peekPage);
check("a pick fills the Peek's fields", peekFilled.email === "alex@example.com" && peekFilled.password === "alex-pass-1", peekFilled.email);
await peekPage.evaluate(() => {
  document.querySelector("input[type=email]").value = "";
  document.querySelector("input[type=password]").value = "";
});
await peekPage.click("input[type=email]");
await peekPage.keyboard.type("peter@example.com");
await peekPage.click("input[type=password]");
await peekPage.keyboard.type("peek-pass-1");
await peekPage.keyboard.press("Enter");
check("a new sign-in in a Peek asks in a sheet on the main window", await waitForSheetCount(3));
const peekSheet = (await sheetCalls())[2];
check("that sheet is on the main window and names the account", peekSheet !== undefined && peekSheet.parentUrl.endsWith("/renderer/index.html") && peekSheet.detail === "peter@example.com", JSON.stringify(peekSheet));
const afterPeekSave = await waitForVault((vault) => vault.logins.some((login) => login.username === "peter@example.com"));
check("Save keeps the Peek's login", afterPeekSave.logins.some((login) => login.username === "peter@example.com" && login.password === "peek-pass-1"));
await requireMain("peek", (module) => module.closePeek());
for (let attempt = 0; attempt < 40 && (await requireMain("peek", (module) => module.isPeekOpen() || module.isPeekClosing())); attempt++) {
  await sleep(150);
}

// ---------- 5. A sign-in popup from a tab ----------
await dispatch({ type: "openTab", typedText: `${mainOrigin}/popup-opener?run=opener` });
const openerPage = await findPage((url) => url.includes("run=opener"));
await openerPage.waitForSelector("#open");
await sleep(500);
await openerPage.click("#open");
const popupPage = await findPage((url) => url.includes("/popup-login"));
await popupPage.waitForSelector("input[type=email]");
await sleep(500);
await popupPage.click("input[type=email]");
const popupList = await waitForList("/popup-login");
const popupFieldBottom = await fieldBottom(popupPage);
check(
  "in a sign-in popup, a click into the username field shows the list below it, inside the popup's own content",
  popupList !== null && popupList.popup.y >= popupList.area.y + popupFieldBottom - 1 && isInside(popupList.popup, popupList.area),
  JSON.stringify(popupList),
);
const popupListText = await listPage.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());
check("the popup's list names the login of the popup's site", popupListText.includes("pop@example.com"), popupListText);
const sheetsBeforePopup = (await sheetCalls()).length;
await popupPage.keyboard.type("paula@example.com");
await popupPage.click("input[type=password]");
await popupPage.keyboard.type("popup-pass-1");
await popupPage.keyboard.press("Enter");
const popupPrompt = await promptText(8000);
check(
  "a popup that closes itself after sending gets the card in the main window, where its opener lives",
  /Save password for login\.test:\d+\?/.test(popupPrompt ?? "") && (popupPrompt ?? "").includes("paula@example.com"),
  popupPrompt ?? "no prompt",
);
check("and no sheet was used", (await sheetCalls()).length === sheetsBeforePopup);
if (popupPrompt !== null) {
  await overlay.click(".password-prompt .permission-button.is-primary");
}
const afterPopupSave = await waitForVault((vault) => vault.logins.some((login) => login.username === "paula@example.com"));
check(
  "Save keeps the popup's login for the popup's site",
  afterPopupSave.logins.some((login) => login.username === "paula@example.com" && login.password === "popup-pass-1" && login.origin === otherOrigin),
);

const failed = results.filter((result) => !result.ok);
await app.close();
server.close();
console.log(failed.length === 0 ? `PASS  Bow Passwords in Little Windows, Peek and popups (${results.length} checks)` : `FAIL  ${failed.length} of ${results.length} checks`);
process.exit(failed.length === 0 ? 0 : 1);
