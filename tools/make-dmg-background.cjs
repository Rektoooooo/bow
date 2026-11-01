// WHY this file exists:
//   The window the downloaded disk image opens in is our own design: a pale wash of the icon's colors, a soft shadow
//   under each icon, and a dotted arc (the bow of the icon) from Bow to Applications. It is light because Finder draws
//   the icon labels in black on a picture, also in Dark Mode (seen on macOS 26). This draws it and saves it at 1x and 2x
//   as PNG files; tools/make-dmg-background.sh joins them into build/dmg-background.tiff.
// Data source:
//   tools/dmg-layout.cjs (window size, icon places) and the icon's colors (src/shared/appIconDrawing.ts: peach, violet,
//   periwinkle).
// Data flow:
//   layout → an HTML page → an offscreen window at 1x and 2x → background.png / background@2x.png
// usage: npx electron tools/make-dmg-background.cjs <output folder> [<Bow icon png> <Applications icon png>]
//   With the two icons it also writes preview.png: the window as Finder shows it, icons and labels included, to check
//   the picture before it ships.
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const layout = require("./dmg-layout.cjs");

/** How long the page gets to lay out and paint before the capture. Our choice: the page has no network or fonts. */
const PAINT_WAIT_MS = 400;

/** Where Finder puts a label: its first line starts this far below the icon's centre (measured on macOS 26). */
const LABEL_OFFSET_Y = layout.iconSize / 2 + 18;

/** The arc's ends sit this far from each icon's centre, toward the other icon, and this far above the centres. */
const ARC_END_INSET_X = 82;
const ARC_LIFT_Y = 34;

/** How high the arc rises above its ends (the control point of a quadratic curve rises twice this). */
const ARC_HEIGHT = 46;

/** Space between the last dot and the arrowhead's tip. Our choice: a little more than one dot spacing. */
const ARROW_GAP = 10;

/** The dotted arc runs from the icon's peach through its violet to its periwinkle; the arrowhead is periwinkle. */
const ARC_COLORS = ["#ec9890", "#b08af5", "#7c95ff"];
const ARROW_COLOR = "#7c95ff";
const CAPTION_COLOR = "rgba(44, 32, 78, 0.62)";

/** A faint grain over the picture: smooth gradients show bands on some screens without it. Our choice. */
const GRAIN_OPACITY = 0.03;

/** A soft contact shadow under each icon and a light bloom behind it, on a pale wash of the icon's three colors. */
function pictureBackground(windowWidth, windowHeight) {
  const { appIcon, applicationsIcon } = layout;
  return `
    radial-gradient(76px 13px at ${appIcon.x}px ${appIcon.y + 66}px, rgba(72, 44, 130, 0.20), rgba(72, 44, 130, 0) 100%),
    radial-gradient(76px 13px at ${applicationsIcon.x}px ${applicationsIcon.y + 66}px, rgba(40, 70, 150, 0.20), rgba(40, 70, 150, 0) 100%),
    radial-gradient(230px 190px at ${appIcon.x}px ${appIcon.y}px, rgba(255, 255, 255, 0.70), rgba(255, 255, 255, 0) 100%),
    radial-gradient(230px 190px at ${applicationsIcon.x}px ${applicationsIcon.y}px, rgba(255, 255, 255, 0.70), rgba(255, 255, 255, 0) 100%),
    radial-gradient(460px 330px at 20px -40px, rgba(249, 182, 168, 0.55), rgba(249, 182, 168, 0) 100%),
    radial-gradient(500px 360px at ${windowWidth + 40}px ${windowHeight * 0.22}px, rgba(196, 160, 250, 0.50), rgba(196, 160, 250, 0) 100%),
    radial-gradient(600px 300px at ${windowWidth / 2}px ${windowHeight + 90}px, rgba(138, 162, 255, 0.45), rgba(138, 162, 255, 0) 100%),
    linear-gradient(160deg, #fff7f5 0%, #f7f2ff 50%, #eff3ff 100%)`;
}

/** An image file as a data address: the page is a data address itself and may not load files. */
function imageDataAddress(filePath) {
  const bytes = fs.readFileSync(filePath);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function buildPage(previewIcons) {
  const { windowWidth, appIcon, applicationsIcon } = layout;
  const windowHeight = layout.windowHeight + layout.pictureSpare;
  const startX = appIcon.x + ARC_END_INSET_X;
  const endX = applicationsIcon.x - ARC_END_INSET_X;
  const endY = appIcon.y - ARC_LIFT_Y;
  const controlX = (startX + endX) / 2;
  const controlY = endY - ARC_HEIGHT * 2;
  // The arrowhead follows the curve's direction at its end (from the control point to the end).
  const directionX = endX - controlX;
  const directionY = endY - controlY;
  const directionLength = Math.hypot(directionX, directionY);
  const unitX = directionX / directionLength;
  const unitY = directionY / directionLength;
  const headLength = 13;
  const headSpread = 0.6;
  // The dots stop short of the arrowhead's tip, so the last dot never sits inside the head.
  const dotsEndX = endX - unitX * ARROW_GAP;
  const dotsEndY = endY - unitY * ARROW_GAP;
  const leftHeadX = endX - headLength * (unitX * Math.cos(headSpread) - unitY * Math.sin(headSpread));
  const leftHeadY = endY - headLength * (unitY * Math.cos(headSpread) + unitX * Math.sin(headSpread));
  const rightHeadX = endX - headLength * (unitX * Math.cos(headSpread) + unitY * Math.sin(headSpread));
  const rightHeadY = endY - headLength * (unitY * Math.cos(headSpread) - unitX * Math.sin(headSpread));
  const labelY = appIcon.y + LABEL_OFFSET_Y;

  const half = layout.iconSize / 2;
  const preview = previewIcons
    ? `<img src="${previewIcons.app}" style="position:absolute;left:${appIcon.x - half}px;top:${appIcon.y - half}px;width:${layout.iconSize}px">
       <img src="${previewIcons.applications}" style="position:absolute;left:${applicationsIcon.x - half}px;top:${applicationsIcon.y - half}px;width:${layout.iconSize}px">
       <div class="label" style="left:${appIcon.x}px;top:${labelY}px">Bow</div>
       <div class="label" style="left:${applicationsIcon.x}px;top:${labelY}px">Applications</div>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: ${windowWidth}px; height: ${windowHeight}px; overflow: hidden; }
    body {
      position: relative;
      background: ${pictureBackground(windowWidth, windowHeight)};
      font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
    }
    svg { position: absolute; inset: 0; }
    .caption {
      position: absolute; left: 0; right: 0; top: 52px; text-align: center;
      font-size: 13px; font-weight: 500; letter-spacing: 0.2px; color: ${CAPTION_COLOR};
    }
    .label { position: absolute; transform: translateX(-50%); font-size: ${layout.textSize}px; white-space: nowrap; color: #000000; }
  </style></head><body>
    <svg width="${windowWidth}" height="${windowHeight}" viewBox="0 0 ${windowWidth} ${windowHeight}">
      <defs>
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <linearGradient id="arcColor" x1="${startX}" y1="0" x2="${endX}" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="${ARC_COLORS[0]}" />
          <stop offset="0.5" stop-color="${ARC_COLORS[1]}" />
          <stop offset="1" stop-color="${ARC_COLORS[2]}" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" filter="url(#grain)" opacity="${GRAIN_OPACITY}" />
      <path d="M ${startX} ${endY} Q ${controlX} ${controlY} ${dotsEndX.toFixed(2)} ${dotsEndY.toFixed(2)}" fill="none" stroke="url(#arcColor)"
        stroke-width="3" stroke-linecap="round" stroke-dasharray="0.1 9" opacity="0.9" />
      <path d="M ${leftHeadX.toFixed(2)} ${leftHeadY.toFixed(2)} L ${endX} ${endY} L ${rightHeadX.toFixed(2)} ${rightHeadY.toFixed(2)}"
        fill="none" stroke="${ARROW_COLOR}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />
    </svg>
    <div class="caption">Drag Bow into Applications</div>
    ${preview}
  </body></html>`;
}

/** Retina screens draw the window at twice its size; the 1x copy is scaled down from that drawing. */
const RETINA_SCALE = 2;

/** Draws a page at twice the window's size in one offscreen window (a second window fails to load here). */
async function capturePage(window, html) {
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, PAINT_WAIT_MS));
  const width = layout.windowWidth * RETINA_SCALE;
  const height = (layout.windowHeight + layout.pictureSpare) * RETINA_SCALE;
  const captured = await window.webContents.capturePage({ x: 0, y: 0, width: width, height: height });
  return captured.resize({ width: width, height: height, quality: "best" });
}

app.whenReady().then(async () => {
  const [outputFolder, appIconPath, applicationsIconPath] = process.argv.slice(2);
  const window = new BrowserWindow({
    width: layout.windowWidth * RETINA_SCALE,
    height: (layout.windowHeight + layout.pictureSpare) * RETINA_SCALE,
    useContentSize: true,
    show: false,
    frame: false,
    webPreferences: { offscreen: true, zoomFactor: RETINA_SCALE },
  });
  const retinaPicture = await capturePage(window, buildPage(null));
  const pictureHeight = layout.windowHeight + layout.pictureSpare;
  const picture = retinaPicture.resize({ width: layout.windowWidth, height: pictureHeight, quality: "best" });
  fs.writeFileSync(path.join(outputFolder, "background@2x.png"), retinaPicture.toPNG());
  fs.writeFileSync(path.join(outputFolder, "background.png"), picture.toPNG());
  if (appIconPath !== undefined && applicationsIconPath !== undefined) {
    const previewIcons = { app: imageDataAddress(appIconPath), applications: imageDataAddress(applicationsIconPath) };
    const preview = await capturePage(window, buildPage(previewIcons));
    fs.writeFileSync(path.join(outputFolder, "preview.png"), preview.toPNG());
  }
  app.quit();
});
