// WHY this file exists:
//   Screenshots of the whole window without macOS screen recording permission: the window and each web view are
//   captured on their own (capturePage) and painted together at their real bounds, page views with the card's rounded
//   corners. Used by window-shot.mjs (README pictures) and arc-compare.mjs (side by side with Arc).
// Data source: the running app's BrowserWindow and its child views (through Playwright's app.evaluate).
// Data flow: captureWindow(app) → PNG buffer at the window's device pixels

/**
 * Captures the sidebar window with its web views painted in, as a PNG buffer.
 */
export async function captureWindow(app) {
  const pngBase64 = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
    const views = win.contentView.children.filter((child) => child.webContents && child.webContents !== win.webContents);
    const base = await win.capturePage();
    const layers = [];
    for (const view of views) {
      const bounds = view.getBounds();
      const isOverlay = view.webContents.getURL().endsWith("/overlay/overlay.html");
      if (bounds.width > 0) layers.push({ bounds, isOverlay, url: (await view.webContents.capturePage()).toDataURL() });
    }
    const contentWidth = win.getContentSize()[0];
    const helper = new BrowserWindow({ show: false, width: 400, height: 300 });
    await helper.loadURL("about:blank");
    const script = `(async () => {
      const load = (src) => new Promise((resolve) => { const image = new Image(); image.onload = () => resolve(image); image.src = src; });
      const baseImage = await load(${JSON.stringify(base.toDataURL())});
      const scale = baseImage.width / ${contentWidth};
      const canvas = document.createElement("canvas");
      canvas.width = baseImage.width; canvas.height = baseImage.height;
      const context = canvas.getContext("2d");
      context.drawImage(baseImage, 0, 0);
      for (const layer of ${JSON.stringify(layers)}) {
        const image = await load(layer.url);
        const b = layer.bounds;
        context.save();
        context.beginPath();
        context.roundRect(b.x * scale, b.y * scale, b.width * scale, b.height * scale, layer.isOverlay ? 0 : 10 * scale);
        context.clip();
        context.drawImage(image, b.x * scale, b.y * scale, b.width * scale, b.height * scale);
        context.restore();
      }
      return canvas.toDataURL("image/png").split(",")[1];
    })()`;
    const result = await helper.webContents.executeJavaScript(script);
    helper.destroy();
    return result;
  });
  return Buffer.from(pngBase64, "base64");
}
