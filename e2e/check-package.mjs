// Checks the packaged app (npm run package first): it starts, knows it is "Bow", declares http and https
// so macOS can make it the default browser, offers "Set as Default Browser…", opens a link from another app in a
// Little Window, runs a Chrome extension (so the extension library and its preload made it into the package), and
// asks its update feed for a new version (a local feed here, which says this version is the newest; a download
// that finished is played to the updater, so the sidebar's notice and the app menu's restart are checked too).
// usage: npm run package && node e2e/check-package.mjs
// Uses a throwaway --user-data-dir folder and never changes the default browser.
import { _electron } from "playwright-core";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const architecture = process.arch === "arm64" ? "arm64" : "x64";
const bundlePath = path.join(appDir, "release", `Bow-darwin-${architecture}`, "Bow.app");
const executablePath = path.join(bundlePath, "Contents", "MacOS", "Bow");
const userDataDir = path.join(outDir, "user-data-package");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });

if (!fs.existsSync(executablePath)) {
  console.error(`No packaged app at ${bundlePath}. Run npm run package first.`);
  process.exit(1);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const infoPlist = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path.join(bundlePath, "Contents", "Info.plist")]).toString());
const schemes = (infoPlist.CFBundleURLTypes ?? []).flatMap((type) => type.CFBundleURLSchemes ?? []);
check("Info.plist declares http and https", schemes.includes("http") && schemes.includes("https"), schemes.join(", "));
check("Info.plist names the app", infoPlist.CFBundleName === "Bow", infoPlist.CFBundleName);
// macOS ties the default-browser choice and website permissions to the bundle id, so it kept the first name.
check("the bundle id stays the same after the rename", infoPlist.CFBundleIdentifier === "io.github.rektoooooo.sidebar-browser", infoPlist.CFBundleIdentifier);
const usageTexts = [infoPlist.NSCameraUsageDescription, infoPlist.NSMicrophoneUsageDescription, infoPlist.NSLocationWhenInUseUsageDescription];
check("Info.plist explains camera, microphone and location use", usageTexts.every((text) => typeof text === "string" && text.startsWith("Websites you allow")), usageTexts.join(" | "));
// Only a release build (signed with a Developer ID by tools/release-mac.sh) updates itself from GitHub; an ad-hoc build
// would download every release and have each one refused.
// codesign prints the signature's details on stderr.
const codesignOutput = execFileSync("sh", ["-c", 'codesign --display --verbose=2 "$1" 2>&1', "sh", bundlePath]).toString();
const isDeveloperIdBuild = codesignOutput.includes("Authority=Developer ID Application");
const isMarkedForUpdates = infoPlist.BowUpdatesFromGitHub === true;
check("only a Developer ID build is marked to update itself from GitHub", isMarkedForUpdates === isDeveloperIdBuild, `Developer ID ${isDeveloperIdBuild}, marked ${isMarkedForUpdates}`);
check("the app icon is ours", fs.readFileSync(path.join(bundlePath, "Contents", "Resources", infoPlist.CFBundleIconFile)).equals(fs.readFileSync(path.join(appDir, "build", "icon.icns"))));

// The update feed: this app's own version is the newest, so the check must find nothing to download.
const feedRequests = [];
const feedServer = http.createServer((request, response) => {
  feedRequests.push(request.url);
  const feed = { currentRelease: infoPlist.CFBundleShortVersionString, releases: [{ version: infoPlist.CFBundleShortVersionString, updateTo: { version: infoPlist.CFBundleShortVersionString, name: infoPlist.CFBundleShortVersionString, url: "http://127.0.0.1/never-downloaded.zip" } }] };
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(feed));
});
await new Promise((resolve) => feedServer.listen(0, "127.0.0.1", resolve));
const feedUrl = `http://127.0.0.1:${feedServer.address().port}/update-darwin-${architecture}.json`;

const app = await _electron.launch({ executablePath, args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", `--update-feed=${feedUrl}`], timeout: 30000 });
const deadline = Date.now() + 30000;
let page = null;
while (page === null && Date.now() < deadline) {
  page = app.windows().find((candidate) => candidate.url().endsWith("/renderer/index.html")) ?? null;
  if (page === null) await new Promise((resolve) => setTimeout(resolve, 200));
}
check("the packaged app opens its window", page !== null);
const consoleErrors = [];
page?.on("pageerror", (error) => consoleErrors.push(error.message));
await page?.waitForSelector(".sidebar", { timeout: 15000 });

const appInfo = await app.evaluate(({ app }) => ({ name: app.getName(), isPackaged: app.isPackaged, userData: app.getPath("userData") }));
check("runs as the packaged Bow", appInfo.isPackaged && appInfo.name === "Bow", `${appInfo.name}, packaged ${appInfo.isPackaged}`);
check("uses the user data folder it was given", appInfo.userData === userDataDir);

const appMenuLabels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.map((item) => item.label));
check("the app menu offers Set as Default Browser…", appMenuLabels.includes("Set as Default Browser…"));
check("the app menu says Bow", appMenuLabels.includes("About Bow") && appMenuLabels.includes("Quit Bow"), appMenuLabels.join(", "));
check("the app menu offers Check for Updates…", appMenuLabels.includes("Check for Updates…"));

const updateOutcome = await app.evaluate(({ autoUpdater }) => new Promise((resolve) => {
  autoUpdater.once("update-not-available", () => resolve("newest"));
  autoUpdater.once("update-available", () => resolve("available"));
  autoUpdater.once("error", (error) => resolve(`error: ${error.message}`));
  autoUpdater.checkForUpdates();
}));
check("the updater reads its feed and finds this version is the newest", updateOutcome === "newest" && feedRequests.length > 0, `${updateOutcome}, ${feedRequests.length} feed request(s)`);
// What Squirrel says once a new version has downloaded (it was checked against a real signed update by hand).
await app.evaluate(({ autoUpdater }) => autoUpdater.emit("update-downloaded", {}, "", "9.9.9", new Date(), ""));
const notice = page.locator("#update-notice");
await notice.waitFor({ state: "visible", timeout: 5000 }).catch(() => undefined);
const noticeText = await notice.innerText().catch(() => "");
check("a downloaded update shows the sidebar's restart notice", noticeText.includes("Bow 9.9.9") && noticeText.includes("Restart"), noticeText.replaceAll("\n", " · "));
const menuAfterDownload = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.map((item) => item.label));
check("and the app menu offers the restart", menuAfterDownload.includes("Restart to Update to Bow 9.9.9"), menuAfterDownload.slice(0, 3).join(", "));

// The hidden window that draws the Dock icon (a data: page, in dark mode right at startup) is not one of the app's.
const windowCount = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((window) => !window.webContents.getURL().startsWith("data:")).length);
const windowsBefore = await windowCount();
await app.evaluate(({ app }) => app.emit("open-url", { preventDefault() {} }, "javascript:alert(1)"));
await new Promise((resolve) => setTimeout(resolve, 500));
check("a non-web link from another app is ignored", (await windowCount()) === windowsBefore);
await app.evaluate(({ app }) => app.emit("open-url", { preventDefault() {} }, "https://example.com/"));
const littleDeadline = Date.now() + 10000;
while ((await windowCount()) === windowsBefore && Date.now() < littleDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
check("a link from another app opens a Little Window", (await windowCount()) === windowsBefore + 1);
// The synthetic test extension: Load Unpacked (dialog answered), then its content script must mark a page.
const fixtureDir = path.join(appDir, "e2e", "fixtures", "extension-marker");
await app.evaluate(({ dialog }, folder) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
}, fixtureDir);
await page.evaluate(() => window.browserApi.dispatch({ type: "loadUnpackedExtension" }));
await page.evaluate(() => window.browserApi.dispatch({ type: "openTab", typedText: "example.com" }));
let marker = "no page";
const markerDeadline = Date.now() + 15000;
while (marker !== "on" && Date.now() < markerDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  marker = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
    const view = win?.contentView.children.find((child) => child.webContents?.getURL().startsWith("https://"));
    return view === undefined ? "no page" : view.webContents.executeJavaScript("document.documentElement.dataset.fixtureMarker ?? 'absent'");
  });
}
check("a Chrome extension runs in the packaged app", marker === "on", marker);
check("no page errors in the sidebar", consoleErrors.length === 0, consoleErrors.join(" | "));

await app.close();
feedServer.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
