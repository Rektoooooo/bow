// Checks the permission rules:
// - a website in a tab runs in a profile partition, gets nothing it was not allowed, and asks with a prompt;
// - Block is remembered (no second prompt), Reset forgets it, Allow grants it, Escape refuses once and saves nothing;
// - our own pages are refused without a prompt and cannot be navigated away;
// - screen sharing goes to macOS's sharing picker for sites (it shows on screen until the app quits; a background run
//   uses a stand-in that waits the same way: main/backgroundTesting.ts), never for ours.
// Uses notifications: camera and microphone requests can wait on a macOS system dialog, which a test cannot answer.
// usage: npm run build && node e2e/permission-check.mjs
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-permissions");
fs.rmSync(userDataDir, { recursive: true, force: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", "--host-resolver-rules=MAP other.example 127.0.0.1", appDir],
  timeout: 30000,
});
// Pick our pages by URL: a restored tab's page can open first.
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
const getState = () => page.evaluate(() => window.browserApi.getState());

// Tabs run in the profile's own session partition, so this proves the rules reach profile sessions too.
await page.evaluate(() => window.browserApi.dispatch({ type: "openTab", typedText: "example.com" }));
await sleep(3000);
const inTab = (script) =>
  app.evaluate(({ webContents }, code) => {
    const tab = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith("https://example.com"));
    return tab.executeJavaScript(code);
  }, script);

const usesProfilePartition = await app.evaluate(({ webContents, session }) => {
  const tab = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith("https://example.com"));
  return tab.session !== session.defaultSession;
});
check("a tab runs in its profile's session", usesProfilePartition);

const answers = await inTab(`(async () => {
  const out = {};
  for (const name of ["geolocation", "camera", "microphone", "notifications"]) {
    try { out[name] = (await navigator.permissions.query({ name })).state; } catch (error) { out[name] = "error: " + error.message; }
  }
  return out;
})()`);
check("a site that never asked is granted nothing", Object.values(answers).every((state) => state !== "granted"), JSON.stringify(answers));

// A request shows the prompt; the answer reaches the page.
const askForNotifications = () => inTab("window.permissionAnswer = null; Notification.requestPermission().then((answer) => { window.permissionAnswer = answer; }); true");
async function waitForPageAnswer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const answer = await inTab("window.permissionAnswer");
    if (answer !== null) return answer;
    await sleep(150);
  }
  return null;
}
// The overlay page keeps its last drawing after it closes; whether it is on screen is decided by the main window.
const isOverlayOnScreen = () =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
    return win.contentView.children.some((child) => child.webContents?.getURL().endsWith("/overlay/overlay.html"));
  });
// The prompt's text once the overlay is on screen with it, or null when no prompt comes within 5 s.
const promptText = async () => {
  for (let attempt = 0; attempt < 25; attempt++) {
    if (await isOverlayOnScreen()) {
      const prompt = await overlay.waitForSelector(".permission-prompt", { timeout: 2000 }).catch(() => null);
      return prompt === null ? null : (await prompt.textContent()).replace(/\s+/g, " ").trim();
    }
    await sleep(200);
  }
  return null;
};
// A closed prompt fades out for a moment (overlay.css panel-out) before its view leaves the window.
const waitForOverlayGone = async () => {
  for (let attempt = 0; attempt < 20 && (await isOverlayOnScreen()); attempt++) {
    await sleep(50);
  }
};
const savedNotificationAnswers = async () =>
  ((await getState()).sitePermissions ?? []).filter((answer) => answer.origin === "https://example.com" && answer.kind === "notifications");

await askForNotifications();
const firstPrompt = await promptText();
check("a site asking for notifications gets a prompt", /example\.com wants to\s*show notifications/i.test(firstPrompt ?? ""), firstPrompt ?? "no prompt");
await overlay.screenshot({ path: path.join(outDir, "permission-prompt.png") }).catch(() => undefined);
await overlay.click(".permission-button:not(.is-primary)");
check("Block refuses it", (await waitForPageAnswer()) === "denied");
check("and is remembered for the site", (await savedNotificationAnswers()).some((answer) => answer.isAllowed === false));

await waitForOverlayGone();
await askForNotifications();
const secondAnswer = await waitForPageAnswer();
const promptShownAgain = await isOverlayOnScreen();
check("a blocked site is refused again without a prompt", secondAnswer === "denied" && !promptShownAgain);

await page.evaluate(() => window.browserApi.dispatch({ type: "removeSitePermission", profileId: "profile-default", origin: "https://example.com", kind: "notifications" }));
await askForNotifications();
check("Reset makes the site ask again", (await promptText()) !== null);
await overlay.click(".permission-button.is-primary");
check("Allow grants it", (await waitForPageAnswer()) === "granted");
const queryAfterAllow = await inTab("navigator.permissions.query({ name: 'notifications' }).then((status) => status.state)");
check("and the site sees it as granted", queryAfterAllow === "granted" && (await inTab("Notification.permission")) === "granted", queryAfterAllow);

await page.evaluate(() => window.browserApi.dispatch({ type: "removeSitePermission", profileId: "profile-default", origin: "https://example.com", kind: "notifications" }));
await askForNotifications();
await promptText();
await overlay.keyboard.press("Escape");
check("Escape refuses this once", (await waitForPageAnswer()) === "denied");
check("and saves nothing", (await savedNotificationAnswers()).length === 0);

// A link to an app asks every time and names the app; Block opens nothing and saves nothing.
const answersBefore = ((await getState()).sitePermissions ?? []).length;
await inTab("location.href = 'mailto:someone@example.com'; true");
const appPrompt = await promptText();
check("a link to an app asks first, naming the app", /example\.com wants to\s*open /i.test(appPrompt ?? ""), appPrompt ?? "no prompt");
await overlay.click(".permission-button:not(.is-primary)");
await sleep(400);
check("Block keeps the app closed and saves nothing", !(await isOverlayOnScreen()) && ((await getState()).sitePermissions ?? []).length === answersBefore);
await inTab("location.href = 'no-app-handles-this-scheme-7f3a:test'; true");
await sleep(1200);
check("a link no app on this Mac handles is refused without a prompt", !(await isOverlayOnScreen()));

// Our own pages never get a prompt.
const sidebarAnswer = await page.evaluate(() => Notification.requestPermission());
await sleep(500);
const promptForSidebar = await isOverlayOnScreen();
check("our own pages are refused without a prompt", sidebarAnswer === "denied" && !promptForSidebar, sidebarAnswer);

const sidebarUrlBefore = page.url();
await page.evaluate(() => {
  window.location.href = "https://example.org";
});
await sleep(1500);
check("the sidebar page cannot be navigated away", page.url() === sidebarUrlBefore);
// The sidebar page opens only the card's corner pages main asked it for (cornerMasks.ts): not a site, and not a corner
// page under a name main did not give.
const sidebarRefused = await page.evaluate(() => [window.open("https://example.org", "_blank") === null, window.open(new URL("../corner/corner.html", location.href).href, "bow-corner-0") === null]);
check("the sidebar page cannot open windows of its own", sidebarRefused.every((isRefused) => isRefused), JSON.stringify(sidebarRefused));

// Screen sharing: a site's request opens macOS's sharing picker (the promise waits for the user's choice there; in a
// background run a stand-in that waits the same way, so the system's picker never takes the keyboard);
// our own pages are refused. The picker shows on screen until the app quits just below.
const shareScript = `new Promise((resolve) => {
  const timer = setTimeout(() => resolve("waiting for the picker"), 2500);
  navigator.mediaDevices.getDisplayMedia({ video: true }).then(
    () => { clearTimeout(timer); resolve("shared without asking"); },
    (error) => { clearTimeout(timer); resolve("refused: " + error.name); },
  );
})`;
const sidebarShare = await app.evaluate(({ BrowserWindow }, code) => {
  const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  return win.webContents.executeJavaScript(code, true);
}, shareScript);
check("our own pages cannot share the screen", sidebarShare.startsWith("refused"), sidebarShare);
const siteShare = await app.evaluate(({ webContents }, code) => {
  const tab = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith("https://example.com"));
  return tab.executeJavaScript(code, true);
}, shareScript);
check("a site sharing the screen gets macOS's sharing picker, nothing shared yet", siteShare === "waiting for the picker", siteShare);

// ---------- Bow's forms helper: invisible to pages, absent in private windows, reports only real input ----------
const pageGlobals = await inTab(`(() => {
  const names = ["require", "process", "module", "exports", "Buffer", "ipcRenderer", "electron"];
  const types = Object.fromEntries(names.map((name) => [name, typeof globalThis[name]]));
  const leaked = Object.getOwnPropertyNames(window).filter((key) => /^(bow|forms)/i.test(key));
  return { types, leaked };
})()`);
check("the page's own world sees nothing new from the forms helper", Object.values(pageGlobals.types).every((type) => type === "undefined") && pageGlobals.leaked.length === 0, JSON.stringify(pageGlobals));
const tabPreloadIds = await app.evaluate(({ webContents }) => {
  const tab = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith("https://example.com"));
  return tab.session.getPreloadScripts().map((script) => script.id);
});
// Bow's two page helpers: Google's sign-in user agent (does nothing elsewhere) and the forms helper of Bow Passwords.
check(
  "a tab's profile session has exactly Bow's helpers (Google sign-in, forms)",
  tabPreloadIds.length === 2 && tabPreloadIds.includes("bow-google-sign-in") && tabPreloadIds.includes("bow-forms"),
  JSON.stringify(tabPreloadIds),
);

// A private window (File › New Private Window) has a session in memory: no helper there.
await page.evaluate(() => window.browserApi.dispatch({ type: "openCommandBar", mode: "newTab" }));
await overlay.waitForSelector(".command-input", { timeout: 5000 });
await overlay.fill(".command-input", "new private window");
await overlay.waitForFunction(() => document.querySelector(".command-line.is-highlighted .command-line-title")?.textContent === "New Private Window", undefined, { timeout: 5000 }).catch(() => undefined);
await overlay.press(".command-input", "Enter");
const privatePreloadIds = await (async () => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const found = await app.evaluate(({ BrowserWindow }) => {
      const littleWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes("private=1"));
      if (littleWindow === undefined) return null;
      const pageView = littleWindow.contentView.children.find((child) => child.webContents !== undefined && child.webContents !== littleWindow.webContents);
      return pageView === undefined ? null : pageView.webContents.session.getPreloadScripts().map((script) => script.id);
    });
    if (found !== null) return found;
    await sleep(200);
  }
  return null;
})();
// Signing in to Google works in private windows too; nothing of Bow Passwords runs there.
check(
  "a private window's session has only the Google sign-in helper, never the forms helper",
  Array.isArray(privatePreloadIds) && privatePreloadIds.length === 1 && privatePreloadIds[0] === "bow-google-sign-in",
  JSON.stringify(privatePreloadIds),
);
await app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes("private=1"))?.close();
});
await sleep(500);

// A local sign-in page with a cross-origin iframe that has its own sign-in form.
const formsServer = http.createServer((request, response) => {
  response.setHeader("content-type", "text/html");
  if (request.url.startsWith("/login")) {
    const port = formsServer.address().port;
    response.end(`<!doctype html><title>Login</title><body style="margin:0">
      <form action="/welcome" method="post">
        <input type="email" name="email" autocomplete="username" style="width:300px;height:30px">
        <input type="password" name="password" autocomplete="current-password" style="width:300px;height:30px">
        <button>Sign in</button>
      </form>
      <iframe src="http://other.example:${port}/frame" style="width:400px;height:150px"></iframe></body>`);
    return;
  }
  if (request.url.startsWith("/frame")) {
    response.end(`<!doctype html><body><form action="/welcome" method="post"><input type="text" name="user" autocomplete="username" style="width:200px;height:30px"><input type="password" name="password" autocomplete="current-password" style="width:200px;height:30px"></form></body>`);
    return;
  }
  response.end("<!doctype html><title>Welcome</title>welcome");
});
await new Promise((resolve) => formsServer.listen(0, "127.0.0.1", resolve));
const formsPort = formsServer.address().port;
const formsOrigin = `http://127.0.0.1:${formsPort}`;
const formsBridgePath = path.join(appDir, "dist", "node", "main", "formsBridge.js");
const formsCounts = () => app.evaluate((_electron, modulePath) => process.mainModule.require(modulePath).getFormsMessageCounts(), formsBridgePath);

await page.evaluate((address) => window.browserApi.dispatch({ type: "openTab", typedText: address }), `${formsOrigin}/login`);
let formsPage = null;
for (let attempt = 0; attempt < 50 && formsPage === null; attempt++) {
  formsPage = app.windows().find((candidate) => candidate.url().startsWith(formsOrigin)) ?? null;
  if (formsPage === null) await sleep(200);
}
check("the local sign-in page opens in a tab", formsPage !== null);
await formsPage.waitForSelector("input[type=email]");
await sleep(500);

const beforeClick = await formsCounts();
await formsPage.click("input[type=email]");
await sleep(500);
const afterClick = await formsCounts();
check("a real click into the email field is reported as a username field of that site", afterClick.fieldFocused === beforeClick.fieldFocused + 1 && afterClick.lastRole === "username" && afterClick.lastOrigin === formsOrigin, JSON.stringify(afterClick));

await formsPage.click("html", { position: { x: 600, y: 400 } });
await sleep(300);
const beforeScriptFocus = await formsCounts();
await formsPage.evaluate(() => document.querySelector("input[type=email]").focus());
await sleep(500);
const afterScriptFocus = await formsCounts();
check("a page script moving focus into a field reports nothing", afterScriptFocus.fieldFocused === beforeScriptFocus.fieldFocused, JSON.stringify(afterScriptFocus));

await formsPage.click("html", { position: { x: 600, y: 400 } });
await sleep(300);
const beforeFrameClick = await formsCounts();
await formsPage.frameLocator("iframe").locator("input[type=password]").click();
await sleep(500);
const afterFrameClick = await formsCounts();
check("a click into a sign-in form inside an iframe reports nothing", afterFrameClick.fieldFocused === beforeFrameClick.fieldFocused, JSON.stringify(afterFrameClick));

await formsPage.click("input[type=email]");
await formsPage.keyboard.type("ann@example.com");
await formsPage.click("input[type=password]");
await formsPage.keyboard.type("correct horse battery");
const beforeSubmit = await formsCounts();
await formsPage.keyboard.press("Enter");
await sleep(800);
const afterSubmit = await formsCounts();
check("typing a login and pressing Enter reports one submitted form", afterSubmit.submitted === beforeSubmit.submitted + 1, JSON.stringify(afterSubmit));

// A script that fills a form and sends it is still a submit (the helper marks the password as not typed).
await app.evaluate(({ webContents }, address) => {
  const tab = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(address));
  return tab.loadURL(address + "/login");
}, formsOrigin);
await formsPage.waitForSelector("input[type=email]");
await sleep(500);
const beforeScriptSubmit = await formsCounts();
await formsPage.evaluate(() => {
  document.querySelector("input[type=email]").value = "script@example.com";
  document.querySelector("input[type=password]").value = "scripted";
  document.querySelector("form").requestSubmit();
});
await sleep(800);
const afterScriptSubmit = await formsCounts();
check("a script submitting a filled form is still reported as a submit", afterScriptSubmit.submitted === beforeScriptSubmit.submitted + 1, JSON.stringify(afterScriptSubmit));
formsServer.close();

// Quitting while a prompt waits must not stop on an error (the closing page settles the prompt as the window goes).
await askForNotifications();
await promptText();
const appPid = app.process().pid;
const quitResult = await Promise.race([app.close().then(() => "quit"), sleep(15000).then(() => "still running")]);
check("the app quits while a prompt is open", quitResult === "quit", quitResult);
if (quitResult !== "quit") process.kill(appPid);
fs.rmSync(userDataDir, { recursive: true, force: true });

const failed = results.filter((result) => !result.ok);
console.log(failed.length === 0 ? "PASS  permissions locked down" : "FAIL  permissions");
process.exit(failed.length === 0 ? 0 : 1);
