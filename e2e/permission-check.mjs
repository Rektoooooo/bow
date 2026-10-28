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
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir],
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
