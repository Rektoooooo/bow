// Draws the app icon (our own design: a window with a sidebar and three tab lines on a gradient squircle) and saves
// it as a 1024 px PNG. tools/make-icon.sh turns it into build/icon.icns.
// usage: npx electron tools/make-icon.cjs <output.png>
const { app, BrowserWindow } = require("electron");
const fs = require("fs");

const ICON_SIZE = 1024;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff8a7a"/>
      <stop offset="0.5" stop-color="#b56cff"/>
      <stop offset="1" stop-color="#4f7cff"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#000" flood-opacity="0.25"/>
    </filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="190" fill="url(#background)"/>
  <g filter="url(#shadow)">
    <rect x="250" y="285" width="524" height="454" rx="56" fill="#ffffff" fill-opacity="0.96"/>
  </g>
  <rect x="250" y="285" width="190" height="454" rx="56" fill="#ffffff"/>
  <rect x="392" y="285" width="48" height="454" fill="#ffffff"/>
  <rect x="440" y="285" width="10" height="454" fill="#6a5cff" fill-opacity="0.18"/>
  <rect x="290" y="352" width="110" height="26" rx="13" fill="#7a68ff"/>
  <rect x="290" y="408" width="110" height="26" rx="13" fill="#c4bcff"/>
  <rect x="290" y="464" width="80" height="26" rx="13" fill="#c4bcff"/>
  <rect x="490" y="340" width="236" height="354" rx="30" fill="url(#background)" fill-opacity="0.22"/>
</svg>`;

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: ICON_SIZE, height: ICON_SIZE, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await window.loadURL(`data:text/html,<html><body style="margin:0;background:transparent">${encodeURIComponent(svg)}</body></html>`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: ICON_SIZE, height: ICON_SIZE });
  const resized = image.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: "best" });
  fs.writeFileSync(process.argv[process.argv.length - 1], resized.toPNG());
  app.quit();
});
