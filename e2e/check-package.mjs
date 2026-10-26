// Checks the packaged app (npm run package first): it starts, knows it is "Sidebar Browser", declares http and https
// so macOS can make it the default browser, offers "Set as Default Browser…", and opens a link from another app in
// a Little Window.
// usage: npm run package && node e2e/check-package.mjs
// Uses a throwaway --user-data-dir folder and never changes the default browser.
import { _electron } from "playwright-core";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const architecture = process.arch === "arm64" ? "arm64" : "x64";
const bundlePath = path.join(appDir, "release", `Sidebar Browser-darwin-${architecture}`, "Sidebar Browser.app");
const executablePath = path.join(bundlePath, "Contents", "MacOS", "Sidebar Browser");
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
check("Info.plist names the app", infoPlist.CFBundleName === "Sidebar Browser", infoPlist.CFBundleName);
check("the app icon is ours", fs.readFileSync(path.join(bundlePath, "Contents", "Resources", infoPlist.CFBundleIconFile)).equals(fs.readFileSync(path.join(appDir, "build", "icon.icns"))));

const app = await _electron.launch({ executablePath, args: [`--user-data-dir=${userDataDir}`], timeout: 30000 });
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
check("runs as the packaged Sidebar Browser", appInfo.isPackaged && appInfo.name === "Sidebar Browser", `${appInfo.name}, packaged ${appInfo.isPackaged}`);
check("uses the user data folder it was given", appInfo.userData === userDataDir);

const appMenuLabels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.map((item) => item.label));
check("the app menu offers Set as Default Browser…", appMenuLabels.includes("Set as Default Browser…"));

const windowCount = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
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
check("no page errors in the sidebar", consoleErrors.length === 0, consoleErrors.join(" | "));

await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
