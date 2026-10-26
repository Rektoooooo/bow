/**
 * WHY this file exists:
 *   Arc lets you pick another app icon. Ours draws the chosen variant of our own icon (shared/appIconDrawing.ts) in
 *   a hidden window and gives it to the Dock while the app runs. The Finder keeps the bundled icon: changing that
 *   needs a Dock tile plug-in, which an Electron app cannot ship.
 *
 * Data source:
 *   BrowserState.settings.appIcon (the variant id).
 *
 * Data flow:
 *   startup / setting changed → applyAppIcon(variantId) → hidden offscreen window draws the SVG → capturePage
 *   → app.dock.setIcon(image)
 */
import { app, BrowserWindow } from "electron";
import { APP_ICON_SIZE_PX, buildAppIconSvg, findAppIconVariant } from "../shared/appIconDrawing";

/** Wait this long after loading the drawing before capturing it, so it has painted. Our choice. */
const PAINT_WAIT_MS = 200;

/** The variant now in the Dock, so an unchanged setting draws nothing. */
let shownVariantId: string | null = null;

/**
 * Draws a variant of our icon into an image.
 */
async function drawAppIcon(variantId: string | undefined): Promise<Electron.NativeImage> {
  const svg = buildAppIconSvg(findAppIconVariant(variantId));
  const drawingWindow = new BrowserWindow({
    width: APP_ICON_SIZE_PX,
    height: APP_ICON_SIZE_PX,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true, sandbox: true, javascript: false },
  });
  try {
    const page = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
    await drawingWindow.loadURL(`data:text/html,${encodeURIComponent(page)}`);
    await new Promise((resolve) => setTimeout(resolve, PAINT_WAIT_MS));
    const image = await drawingWindow.webContents.capturePage({ x: 0, y: 0, width: APP_ICON_SIZE_PX, height: APP_ICON_SIZE_PX });
    return image.resize({ width: APP_ICON_SIZE_PX, height: APP_ICON_SIZE_PX, quality: "best" });
  } finally {
    drawingWindow.destroy();
  }
}

/**
 * Shows the chosen icon in the Dock. The bundled icon is the classic variant, so that one needs no drawing at
 * startup; switching back to it after another one draws it again.
 */
export async function applyAppIcon(variantId: string | undefined): Promise<void> {
  const variant = findAppIconVariant(variantId);
  const isFirstTime = shownVariantId === null;
  if (variant.id === shownVariantId || app.dock === undefined) {
    return;
  }
  shownVariantId = variant.id;
  if (isFirstTime && variant.id === "classic") {
    return;
  }
  app.dock.setIcon(await drawAppIcon(variant.id));
}
