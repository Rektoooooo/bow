// Checks that a website in a tab is refused camera, microphone, location and notifications,
// and that the sidebar page cannot be navigated away.
// usage: npm run build && node e2e/permission-check.mjs
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-permissions");
fs.rmSync(userDataDir, { recursive: true, force: true });

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, appDir],
  timeout: 30000,
});
const page = await app.firstWindow();
await page.waitForSelector(".space-heading");
await page.fill("#address-input", "example.com");
await page.press("#address-input", "Enter");
await page.waitForTimeout(3000);

const answers = await app.evaluate(async ({ webContents }) => {
  const tab = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith("https://example.com"));
  return tab.executeJavaScript(`(async () => {
    const out = {};
    for (const name of ["geolocation", "camera", "microphone", "notifications"]) {
      try { out[name] = (await navigator.permissions.query({ name })).state; } catch (error) { out[name] = "error: " + error.message; }
    }
    try { await navigator.mediaDevices.getUserMedia({ video: true }); out.getUserMedia = "GRANTED"; } catch (error) { out.getUserMedia = "refused: " + error.name; }
    return out;
  })()`);
});
console.log("permission answers:", JSON.stringify(answers));

const sidebarUrlBefore = page.url();
await page.evaluate(() => { window.location.href = "https://example.org"; });
await page.waitForTimeout(1500);
const navigationBlocked = page.url() === sidebarUrlBefore;
console.log("sidebar navigation blocked:", navigationBlocked);

await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

const allDenied = ["geolocation", "camera", "microphone", "notifications"].every((name) => answers[name] === "denied");
const passed = allDenied && answers.getUserMedia !== "GRANTED" && navigationBlocked;
console.log(passed ? "PASS  permissions locked down" : "FAIL  permissions");
process.exit(passed ? 0 : 1);
