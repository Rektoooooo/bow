// Takes the README screenshot: the real app in dark mode with a few tabs, sidebar and tab view composited
// at the tab's real bounds with rounded corners (screencapture needs Screen Recording permission, which the shell lacks).
// usage: npm run build && node e2e/window-shot.mjs      → e2e/output/real-window-dark.png
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-shot");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, appDir],
  colorScheme: "dark",
  timeout: 30000,
});
const page = await app.firstWindow();
await page.waitForSelector(".space-heading");

async function open(text) {
  await page.fill("#address-input", text);
  await page.press("#address-input", "Enter");
  await page.waitForTimeout(2500);
}
await open("wikipedia.org");
await page.evaluate(() => [...document.querySelectorAll(".tab-action")].find((button) => button.textContent === "Pin").click());
await page.waitForTimeout(300);
await open("example.com");
await page.evaluate(() => document.querySelectorAll(".tab-list")[1].querySelector(".tab-close").click());
await page.waitForTimeout(300);
await open("en.wikipedia.org/wiki/Web_browser");
await page.waitForTimeout(1500);

const pngBase64 = await app.evaluate(async ({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  const tabView = win.contentView.children.find((child) => child.webContents && child.webContents !== win.webContents);
  const windowImage = await win.capturePage();
  const tabImage = await tabView.webContents.capturePage();
  const bounds = tabView.getBounds();
  const contentWidth = win.getContentSize()[0];
  const helper = new BrowserWindow({ show: false, width: 400, height: 300 });
  await helper.loadURL("about:blank");
  const script = `(async () => {
    const load = (src) => new Promise((resolve) => { const image = new Image(); image.onload = () => resolve(image); image.src = src; });
    const base = await load(${JSON.stringify(windowImage.toDataURL())});
    const tab = await load(${JSON.stringify(tabImage.toDataURL())});
    const scale = base.width / ${contentWidth};
    const canvas = document.createElement("canvas");
    canvas.width = base.width; canvas.height = base.height;
    const context = canvas.getContext("2d");
    context.drawImage(base, 0, 0);
    context.save();
    context.beginPath();
    context.roundRect(${bounds.x} * scale, ${bounds.y} * scale, ${bounds.width} * scale, ${bounds.height} * scale, 10 * scale);
    context.clip();
    context.drawImage(tab, ${bounds.x} * scale, ${bounds.y} * scale, ${bounds.width} * scale, ${bounds.height} * scale);
    context.restore();
    return canvas.toDataURL("image/png").split(",")[1];
  })()`;
  const result = await helper.webContents.executeJavaScript(script);
  helper.destroy();
  return result;
});
const shot = path.join(outDir, "real-window-dark.png");
fs.writeFileSync(shot, Buffer.from(pngBase64, "base64"));
console.log("saved", shot);
await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
