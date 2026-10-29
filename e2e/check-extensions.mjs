// End-to-end check of Chrome extension support with a synthetic extension (e2e/fixtures/extension-marker):
// Load Unpacked adds it to the profile, its content script marks pages, the toolbar's extensions menu opens its popup
// (which sees the selected tab through chrome.tabs), turning it off unloads it, it is loaded before the window after
// a relaunch, and Remove takes it out. A profile without extensions keeps pages free of preload scripts.
// Chrome Web Store: a made-up extension signed with a key made here is served by a stand-in for Google's update server
// (net.fetch is replaced in the main process and pages get a stand-in, so nothing reaches the real Web Store).
// The toolbar says Adding… for the whole download, a second profile shares the first profile's copy, and copies are
// deleted one by one.
// usage: npm run e2e   (or: npm run build && node e2e/check-extensions.mjs)
// Uses a throwaway --user-data-dir folder, so your real browser state is never touched.
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
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
const loadedNames = (app, partition = PROFILE_PARTITION) =>
  app.evaluate(({ session }, name) => session.fromPartition(name).extensions.getAllExtensions().map((extension) => extension.name), partition);
// Read through Bow's own getProfileSession, the way a tab gets its session (it installs Bow's hooks on first use).
const profilesModulePath = path.join(appDir, "dist", "node", "main", "profiles.js");
const preloadIds = (app) =>
  app.evaluate((_electron, modulePath) => {
    const profiles = process.mainModule.require(modulePath);
    return profiles.getProfileSession("profile-default").getPreloadScripts().map((script) => script.id);
  }, profilesModulePath);
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

const idsWithoutExtensions = await preloadIds(app);
check(
  "a profile without extensions gives its pages only Bow's Google sign-in helper",
  idsWithoutExtensions.length === 1 && idsWithoutExtensions[0] === "bow-google-sign-in",
  JSON.stringify(idsWithoutExtensions),
);

// Load Unpacked asks for a folder; answer with the fixture instead of showing the dialog.
await app.evaluate(({ dialog }, folder) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
}, fixtureDir);
await dispatch(sidebar, { type: "loadUnpackedExtension" });
let state = await waitFor(() => getState(sidebar), (value) => (value.extensions ?? []).length === 1);
const added = state.extensions?.[0];
check("Load Unpacked adds the extension to the profile, with its localized name", added?.name === "Fixture Marker" && added.isEnabled && added.source === "unpacked", JSON.stringify(added));
check("it is loaded into the profile's session", (await waitFor(() => loadedNames(app), (names) => names.includes("Fixture Marker"))).includes("Fixture Marker"));
const idsWithExtensions = await preloadIds(app);
check("a profile with extensions gets the extension bridge as well", idsWithExtensions.length > 1 && idsWithExtensions.includes("bow-google-sign-in"), JSON.stringify(idsWithExtensions));

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

// ---------- Chrome Web Store: Add Extension, from a stand-in for Google's update server ----------
// A CRX3 file the way the Web Store builds one (as in tests/crx.test.ts): header data naming the id, the developer's
// signature over it and the zip, then the zip.
function encodeVarint(value) {
  const bytes = [];
  let remaining = value;
  while (remaining >= 128) {
    bytes.push((remaining % 128) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}
const encodeField = (fieldNumber, bytes) => Buffer.concat([encodeVarint(fieldNumber * 8 + 2), encodeVarint(bytes.length), bytes]);
function uint32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}
const idBytes = (extensionId) => Buffer.from(Array.from(extensionId, (letter) => (letter.charCodeAt(0) - 97).toString(16)).join(""), "hex");
function buildCrx(archive, publicKeyDer, privateKey, extensionId) {
  const signedHeaderData = encodeField(1, idBytes(extensionId));
  const signedData = Buffer.concat([Buffer.from("CRX3 SignedData\0", "latin1"), uint32(signedHeaderData.length), signedHeaderData, archive]);
  const proof = encodeField(2, Buffer.concat([encodeField(1, publicKeyDer), encodeField(2, crypto.sign("sha256", signedData, privateKey))]));
  const header = Buffer.concat([proof, encodeField(10000, signedHeaderData)]);
  return Buffer.concat([Buffer.from("Cr24", "latin1"), uint32(3), uint32(header.length), header, archive]);
}

const STORE_EXTENSION_NAME = "Fixture Store Extension";
const STORE_EXTENSION_VERSION = "1.0.0";
const { extensionIdFromPublicKey } = createRequire(import.meta.url)(path.join(appDir, "dist", "node", "main", "crx.js"));
const storeKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const storePublicKeyDer = storeKeys.publicKey.export({ type: "spki", format: "der" });
const storeExtensionId = extensionIdFromPublicKey(storePublicKeyDer);
const storeSourceDir = path.join(outDir, "store-extension");
fs.rmSync(storeSourceDir, { recursive: true, force: true });
fs.mkdirSync(storeSourceDir, { recursive: true });
fs.writeFileSync(path.join(storeSourceDir, "manifest.json"), JSON.stringify({ manifest_version: 3, name: STORE_EXTENSION_NAME, version: STORE_EXTENSION_VERSION }));
const storeZipPath = path.join(outDir, "store-extension.zip");
fs.rmSync(storeZipPath, { force: true });
execFileSync("/usr/bin/zip", ["-q", "-r", "-X", storeZipPath, "."], { cwd: storeSourceDir });
const storeCrx = buildCrx(fs.readFileSync(storeZipPath), storePublicKeyDer, storeKeys.privateKey, storeExtensionId);
fs.rmSync(storeSourceDir, { recursive: true, force: true });
fs.rmSync(storeZipPath, { force: true });

// The stand-in: Google's update address answers "no update" to update checks and the CRX to downloads, which wait
// until the check releases them (holdStoreDownloads / releaseStoreDownloads). Every other address is fetched as usual.
// Error dialogs are recorded instead of shown, so a failed install cannot leave a modal hanging.
await app.evaluate(({ net, dialog }, crxBase64) => {
  const originalFetch = net.fetch;
  const crx = Buffer.from(crxBase64, "base64");
  globalThis.storeDownloadCount = 0;
  globalThis.errorBoxes = [];
  dialog.showErrorBox = (title, message) => globalThis.errorBoxes.push(`${title}: ${message}`);
  globalThis.holdStoreDownloads = () => {
    globalThis.storeDownloadsReleased = new Promise((resolve) => {
      globalThis.releaseStoreDownloads = resolve;
    });
  };
  globalThis.holdStoreDownloads();
  net.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("https://clients2.google.com/service/update2/crx")) {
      return originalFetch.call(net, input, init);
    }
    if (url.includes("response=updatecheck")) {
      return new Response('<?xml version="1.0"?><gupdate protocol="2.0"></gupdate>');
    }
    globalThis.storeDownloadCount = globalThis.storeDownloadCount + 1;
    await globalThis.storeDownloadsReleased;
    return new Response(crx);
  };
}, storeCrx.toString("base64"));
// The Web Store's own page is a stand-in too: the real one sends a made-up id elsewhere (Google's consent page), and the
// toolbar needs only the address. From here on every https page in a profile session gets the stand-in; sessions made
// later (a new profile below) get it the moment they are created.
await app.evaluate(({ app: electronApp, session }, partition) => {
  const standInPage = "<!doctype html><title>Web Store stand-in</title>";
  const serveStandIn = (profileSession) => profileSession.protocol.handle("https", () => new Response(standInPage, { headers: { "content-type": "text/html" } }));
  serveStandIn(session.fromPartition(partition));
  electronApp.on("session-created", serveStandIn);
}, PROFILE_PARTITION);
const storeDownloadCount = () => app.evaluate(() => globalThis.storeDownloadCount);
const releaseStoreDownloads = () => app.evaluate(() => globalThis.releaseStoreDownloads());
const findStoreExtension = (value, profileId) => (value.extensions ?? []).find((extension) => extension.id === storeExtensionId && extension.profileId === profileId);
const activeProfileId = (value) => value.spaces.find((space) => space.id === value.activeSpaceId)?.profileId;
const readAddPill = () =>
  sidebar.evaluate(() => {
    const pill = document.querySelector(".toolbar-pill");
    return pill === null ? null : { text: pill.textContent, isDisabled: pill.disabled };
  });
const clickAddPill = () => sidebar.locator(".toolbar-pill").click();

// A Web Store extension page gets "Add Extension" in the toolbar; clicking it says "Adding…" for the whole download,
// even when the sidebar redraws meanwhile (it used to reset on the next redraw).
await dispatch(sidebar, { type: "openTab", typedText: `https://chromewebstore.google.com/detail/fixture-store-extension/${storeExtensionId}` });
let addPill = await waitFor(readAddPill, (value) => value?.text === "Add Extension");
check("a Web Store extension page offers Add Extension in the toolbar", addPill?.text === "Add Extension", JSON.stringify(addPill));
await clickAddPill();
addPill = await waitFor(readAddPill, (value) => value?.text === "Adding…", 5000);
check("clicking it says Adding… while it downloads", addPill?.text === "Adding…" && addPill.isDisabled && (await storeDownloadCount()) === 1, JSON.stringify(addPill));
state = await getState(sidebar);
await dispatch(sidebar, { type: "setPinnedSectionOpen", spaceId: state.activeSpaceId, isOpen: false });
await dispatch(sidebar, { type: "setPinnedSectionOpen", spaceId: state.activeSpaceId, isOpen: true });
await sidebar.waitForTimeout(500);
addPill = await readAddPill();
check("and keeps saying it when the sidebar redraws during the download", addPill?.text === "Adding…" && addPill.isDisabled, JSON.stringify(addPill));
await releaseStoreDownloads();
state = await waitFor(() => getState(sidebar), (value) => findStoreExtension(value, "profile-default") !== undefined);
const firstCopy = findStoreExtension(state, "profile-default");
const expectedCopyFolder = path.join(userDataDir, "Extensions", storeExtensionId, STORE_EXTENSION_VERSION);
check("the verified download is unpacked into the Extensions folder and added to the profile", firstCopy?.source === "webstore" && firstCopy.path === expectedCopyFolder, JSON.stringify(firstCopy));
check("and loaded into its session", (await waitFor(() => loadedNames(app), (names) => names.includes(STORE_EXTENSION_NAME))).includes(STORE_EXTENSION_NAME));
check("then the toolbar stops offering it", (await waitFor(readAddPill, (value) => value === null, 5000)) === null);

// A second profile adds it too: it shares the first profile's copy instead of downloading into the folder the first
// profile's session has loaded (it used to download again and replace those files). A file left in the folder shows it.
const leftoverPath = path.join(expectedCopyFolder, "left-by-the-check.txt");
fs.writeFileSync(leftoverPath, "The first profile's copy was not replaced.");
await dispatch(sidebar, { type: "createProfileForSpace", spaceId: state.activeSpaceId });
state = await waitFor(() => getState(sidebar), (value) => activeProfileId(value) !== "profile-default");
const secondProfileId = activeProfileId(state);
await waitFor(readAddPill, (value) => value?.text === "Add Extension");
await clickAddPill();
state = await waitFor(() => getState(sidebar), (value) => findStoreExtension(value, secondProfileId) !== undefined, 10000);
const secondCopy = findStoreExtension(state, secondProfileId);
check("adding it in a second profile shares the first profile's copy, with no second download", secondCopy?.path === expectedCopyFolder && (await storeDownloadCount()) === 1, `${await storeDownloadCount()} downloads, ${JSON.stringify(secondCopy)}`);
check("and leaves the files the first profile has loaded alone", fs.existsSync(leftoverPath));
const secondPartition = `persist:${secondProfileId}`;
check("it is loaded into the second profile's session", (await waitFor(() => loadedNames(app, secondPartition), (names) => names.includes(STORE_EXTENSION_NAME))).includes(STORE_EXTENSION_NAME));
check("and still into the first profile's", (await loadedNames(app)).includes(STORE_EXTENSION_NAME));

// Copies are deleted one by one, only when no profile uses them.
await dispatch(sidebar, { type: "removeExtension", profileId: "profile-default", extensionId: storeExtensionId });
await waitFor(() => loadedNames(app), (names) => !names.includes(STORE_EXTENSION_NAME));
await sidebar.waitForTimeout(1000);
check("removing it from one profile keeps the copy the other profile uses", fs.existsSync(expectedCopyFolder));
await dispatch(sidebar, { type: "removeExtension", profileId: secondProfileId, extensionId: storeExtensionId });
check("removing it from the last profile deletes the copy", await waitFor(() => !fs.existsSync(expectedCopyFolder), (isGone) => isGone, 10000));

// Both profiles ask while one download runs: the second waits for that download instead of starting its own (or
// being ignored, as before), and both get the one copy it makes.
await app.evaluate(() => globalThis.holdStoreDownloads());
await waitFor(readAddPill, (value) => value?.text === "Add Extension");
await clickAddPill();
await waitFor(readAddPill, (value) => value?.text === "Adding…", 5000);
await dispatch(sidebar, { type: "setSpaceProfile", spaceId: state.activeSpaceId, profileId: "profile-default" });
addPill = await waitFor(readAddPill, (value) => value?.text === "Add Extension");
check("a profile that is not waiting for the running download is offered Add Extension", addPill?.text === "Add Extension", JSON.stringify(addPill));
await clickAddPill();
addPill = await waitFor(readAddPill, (value) => value?.text === "Adding…", 5000);
check("asking while another profile's download runs says Adding… without a second download", addPill?.text === "Adding…" && (await storeDownloadCount()) === 2, `${await storeDownloadCount()} downloads`);
await releaseStoreDownloads();
state = await waitFor(() => getState(sidebar), (value) => findStoreExtension(value, "profile-default") !== undefined && findStoreExtension(value, secondProfileId) !== undefined, 10000);
const sharedPaths = [findStoreExtension(state, "profile-default")?.path, findStoreExtension(state, secondProfileId)?.path];
check("when it finishes, both profiles get the one copy", sharedPaths.every((folder) => folder === expectedCopyFolder) && (await storeDownloadCount()) === 2, JSON.stringify(sharedPaths));
const errorBoxes = await app.evaluate(() => globalThis.errorBoxes);
check("no Add Extension error dialogs", errorBoxes.length === 0, errorBoxes.join(" | "));
check("no page errors in the sidebar (second run)", pageErrors.length === 0, pageErrors.join(" | "));
await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} extension checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
