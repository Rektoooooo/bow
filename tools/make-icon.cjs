// Draws the app icon (our own design: a window with a sidebar and three tab lines on a gradient squircle, in
// src/shared/appIconDrawing.ts) and saves it as a 1024 px PNG. tools/make-icon.sh turns it into build/icon.icns.
// The drawing comes from the build output, so run `npm run build` first.
// usage: npx electron tools/make-icon.cjs <output.png>
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const { APP_ICON_SIZE_PX, buildAppIconSvg, findAppIconVariant } = require(path.join(__dirname, "..", "dist", "node", "shared", "appIconDrawing.js"));

const ICON_SIZE = APP_ICON_SIZE_PX;
const svg = buildAppIconSvg(findAppIconVariant("classic"));

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: ICON_SIZE, height: ICON_SIZE, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await window.loadURL(`data:text/html,<html><body style="margin:0;background:transparent">${encodeURIComponent(svg)}</body></html>`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: ICON_SIZE, height: ICON_SIZE });
  const resized = image.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: "best" });
  fs.writeFileSync(process.argv[process.argv.length - 1], resized.toPNG());
  app.quit();
});
