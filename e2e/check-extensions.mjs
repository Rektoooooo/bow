// End-to-end check of Chrome extension support with a synthetic extension (e2e/fixtures/extension-marker):
// Load Unpacked adds it to the profile, its content script marks pages, the toolbar's extensions menu opens its popup
// (which sees the selected tab through chrome.tabs), turning it off unloads it, it is loaded before the window after
// a relaunch, and Remove takes it out. A profile without extensions keeps pages free of preload scripts.
// usage: npm run e2e   (or: npm run build && node e2e/check-extensions.mjs)
// Uses a throwaway --user-data-dir folder, so your real browser state is never touched.
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const electronBinary = createRequire(import.meta.url)("electron");
const userDataDir = path.join(outDir, "user-data-extensions");
const fixtureDir = path.join(appDir, "e2e", "fixtures", "extension-marker");
const PROFILE_PARTITION = "persist:profile-default";
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Polls until read() gives a value that passes isDone, or the time runs out; returns the last value.
async function waitFor(read, isDone, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!isDone(value) && Date.now() < deadline) {
    await sleep(250);
    value = await read();
  }
  return value;
}

async function findPage(app, urlEnding) {
  const page = await waitFor(() => app.windows().find((candidate) => candidate.url().endsWith(urlEnding)) ?? null, (value) => value !== null, 30000);
  if (page === null) throw new Error(`${urlEnding} did not open`);
  return page;
}

async function launch() {
  const app = await _electron.launch({ executablePath: electronBinary, args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir], timeout: 30000 });
  const sidebar = await findPage(app, "/renderer/index.html");
  // Reduced motion: rows appear and disappear at once, so checks never meet a row that is still animating.
  await sidebar.emulateMedia({ reducedMotion: "reduce" });
  const pageErrors = [];
  sidebar.on("pageerror", (error) => pageErrors.push(error.message));
  await sidebar.waitForSelector(".sidebar");
  return { app, sidebar, pageErrors };
}

const getState = (sidebar) => sidebar.evaluate(() => window.browserApi.getState());
const dispatch = (sidebar, action) => sidebar.evaluate((value) => window.browserApi.dispatch(value), action);
const loadedNames = (app) =>
  app.evaluate(({ session }, partition) => session.fromPartition(partition).extensions.getAllExtensions().map((extension) => extension.name), PROFILE_PARTITION);
const preloadCount = (app) => app.evaluate(({ session }, partition) => session.fromPartition(partition).getPreloadScripts().length, PROFILE_PARTITION);
// The fixture's content script sets data-fixture-marker="on" on the shown page.
const pageMarker = (app) =>
  app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
    const view = win?.contentView.children.find((child) => child.webContents?.getURL().startsWith("https://"));
    if (view === undefined) return "no page";
    return view.webContents.executeJavaScript("document.documentElement.dataset.fixtureMarker ?? 'absent'");
  });

// ---------- first run: add, use, turn off and on ----------
let { app, sidebar, pageErrors } = await launch();

check("a profile without extensions gives its pages no preload script", (await preloadCount(app)) === 0);

// Load Unpacked asks for a folder; answer with the fixture instead of showing the dialog.
await app.evaluate(({ dialog }, folder) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
}, fixtureDir);
await dispatch(sidebar, { type: "loadUnpackedExtension" });
let state = await waitFor(() => getState(sidebar), (value) => (value.extensions ?? []).length === 1);
const added = state.extensions?.[0];
check("Load Unpacked adds the extension to the profile, with its localized name", added?.name === "Fixture Marker" && added.isEnabled && added.source === "unpacked", JSON.stringify(added));
check("it is loaded into the profile's session", (await waitFor(() => loadedNames(app), (names) => names.includes("Fixture Marker"))).includes("Fixture Marker"));
check("a profile with extensions gets the extension bridge", (await preloadCount(app)) > 0);

const overlay = await findPage(app, "/overlay/overlay.html");
const libraryLine = await overlay.waitForSelector(".extension-line .library-line-title", { timeout: 5000 }).catch(() => null);
check("the Library opens on Extensions and lists it", (await libraryLine?.textContent()) === "Fixture Marker");
await overlay.keyboard.press("Escape");

await dispatch(sidebar, { type: "openTab", typedText: "example.com" });
check("its content script runs in a page opened afterwards", (await waitFor(() => pageMarker(app), (value) => value === "on")) === "on");

const extensionsButton = sidebar.locator('button[aria-label="Extensions"]');
check("the toolbar shows the extensions button", (await extensionsButton.count()) === 1);

// The extensions menu is a native menu; capture it instead of showing it, then click its first item.
await app.evaluate(({ Menu }) => {
  globalThis.capturedMenus = [];
  globalThis.originalMenuPopup = Menu.prototype.popup;
  Menu.prototype.popup = function capture() {
    globalThis.capturedMenus.push(this);
  };
});
await extensionsButton.click();
const menuLabels = await waitFor(() => app.evaluate(() => globalThis.capturedMenus.at(-1)?.items.map((item) => item.label) ?? []), (labels) => labels.length > 0, 5000);
check("its menu lists the extension and Manage Extensions…", menuLabels[0] === "Fixture Marker" && menuLabels.includes("Manage Extensions…"), menuLabels.join(" | "));
await app.evaluate(({ Menu }) => {
  globalThis.capturedMenus.at(-1).items[0].click();
  Menu.prototype.popup = globalThis.originalMenuPopup;
});
const popupActiveUrl = await waitFor(
  () =>
    app.evaluate(async ({ BrowserWindow }) => {
      const popup = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().startsWith("chrome-extension://"));
      if (popup === undefined) return null;
      return popup.webContents.executeJavaScript("document.body.dataset.activeUrl ?? null");
    }),
  (value) => typeof value === "string",
);
check("clicking it opens the popup, which sees the selected tab through chrome.tabs", typeof popupActiveUrl === "string" && popupActiveUrl.startsWith("https://example.com"), String(popupActiveUrl));
await app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().startsWith("chrome-extension://"))?.close();
});

const extensionId = added?.id;
await dispatch(sidebar, { type: "setExtensionEnabled", profileId: "profile-default", extensionId, isEnabled: false });
check("turning it off unloads it", (await waitFor(() => loadedNames(app), (names) => names.length === 0)).length === 0);
await sidebar.waitForTimeout(300);
check("and hides the toolbar button", (await extensionsButton.count()) === 0);
await dispatch(sidebar, { type: "setExtensionEnabled", profileId: "profile-default", extensionId, isEnabled: true });
check("turning it on loads it again", (await waitFor(() => loadedNames(app), (names) => names.length === 1)).length === 1);
check("no page errors in the sidebar (first run)", pageErrors.length === 0, pageErrors.join(" | "));
await app.close();

// ---------- second run: loads before the first page, then Remove ----------
({ app, sidebar, pageErrors } = await launch());
// Startup loads extensions before it creates the window, so the extension is there the moment the window is.
check("after a relaunch, the extension is loaded before the window appears", (await loadedNames(app)).includes("Fixture Marker"));
// The restored page itself can miss the content script under heavy disk load: Chromium reads the script files after
// loadExtension resolves and Electron has no "scripts ready" signal (see extensionHost.ts). A reload always has it.
await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
  win?.contentView.children.find((child) => child.webContents?.getURL().startsWith("https://"))?.webContents.reload();
});
const markerAfterRelaunch = await waitFor(() => pageMarker(app), (value) => value === "on");
check("and its content script runs in the restored page after a reload", markerAfterRelaunch === "on", markerAfterRelaunch);
await dispatch(sidebar, { type: "removeExtension", profileId: "profile-default", extensionId });
state = await waitFor(() => getState(sidebar), (value) => (value.extensions ?? []).length === 0);
check("Remove takes it out of the profile", (state.extensions ?? []).length === 0);
check("and out of the session", (await waitFor(() => loadedNames(app), (names) => names.length === 0)).length === 0);
// Native messaging (how password managers such as Apple Passwords or 1Password talk to their app): a made-up echo host
// in the profile's NativeMessagingHosts folder, and a test extension with a fixed id that pings it and sends back the
// answer. The host logs what arrives, so its log shows the round trip.
const NATIVE_EXTENSION_ID = "dpnkcidamnfhaoahbjlbmphnnnbdmfff";
const hostsDir = path.join(userDataDir, "NativeMessagingHosts");
fs.mkdirSync(hostsDir, { recursive: true });
const hostScript = path.join(hostsDir, "echo-host.js");
const hostLog = path.join(hostsDir, "echo-log.txt");
fs.writeFileSync(
  hostScript,
  `#!${process.execPath}
// Chrome's native messaging: each message is a 4-byte little-endian length, then that much JSON.
const fs = require("node:fs");
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
    const length = buffer.readUInt32LE(0);
    const message = JSON.parse(buffer.subarray(4, 4 + length).toString("utf8"));
    buffer = buffer.subarray(4 + length);
    fs.appendFileSync(${JSON.stringify(hostLog)}, JSON.stringify(message) + "\\n");
    const reply = Buffer.from(JSON.stringify({ pong: true }));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(reply.length);
    process.stdout.write(Buffer.concat([header, reply]));
  }
});
`,
);
fs.chmodSync(hostScript, 0o755);
fs.writeFileSync(
  path.join(hostsDir, "com.sidebar_browser.test_echo.json"),
  JSON.stringify({ name: "com.sidebar_browser.test_echo", description: "Test echo host", path: hostScript, type: "stdio", allowed_origins: [`chrome-extension://${NATIVE_EXTENSION_ID}/`] }),
);
await app.evaluate(({ dialog }, folder) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
}, path.join(appDir, "e2e", "fixtures", "extension-native"));
await dispatch(sidebar, { type: "loadUnpackedExtension" });
const hostLines = await waitFor(
  () => (fs.existsSync(hostLog) ? fs.readFileSync(hostLog, "utf8").trim().split("\n") : []),
  (lines) => lines.length >= 2,
  20000,
);
check(
  "an extension reaches a native messaging host and gets its answer (password-manager bridges)",
  hostLines[0]?.includes("hello from the extension") && hostLines[1]?.includes('"pong":true'),
  hostLines.join(" | "),
);

// A Chrome Web Store extension page gets "Add Extension" in the toolbar (shown from the address alone; not clicked,
// which would download from the Web Store).
await dispatch(sidebar, { type: "openTab", typedText: "https://chromewebstore.google.com/detail/made-up-name/abcdefghijklmnopabcdefghijklmnop" });
const addPill = await sidebar.waitForSelector(".toolbar-pill", { timeout: 5000 }).catch(() => null);
check("a Web Store extension page offers Add Extension in the toolbar", (await addPill?.textContent())?.includes("Add Extension"));
check("no page errors in the sidebar (second run)", pageErrors.length === 0, pageErrors.join(" | "));
await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} extension checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
