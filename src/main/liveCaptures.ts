/**
 * WHY this file exists:
 *   Arc's Easels keep captures live: a capture of part of a page shows that part as it is now, not as it was. So a
 *   capture remembers where it came from (the page, its view size, scroll and zoom, the region; shared/easels.ts
 *   CaptureSource), and an easel can ask for it to be taken again: the page loads in a hidden window of the same size,
 *   in the Space's profile (its sign-ins), scrolls where it was, and the same region is captured.
 *
 * Data source:
 *   The page on screen when a capture is taken (its scroll position and size, read in an isolated world), and later
 *   the page loaded again in the hidden window.
 *
 * Data flow:
 *   Capture / Screenshot → describeCaptureSource(contents, region) → saved with the capture (captures.ts)
 *   easel opens or "Live" is clicked → IPC → retakeCapture(source, session) → hidden window → PNG data: URL → easel
 */
import { BrowserWindow } from "electron";
import type { Rectangle, Session, WebContents } from "electron";
import type { CaptureSource } from "../shared/easels";

/** The isolated world the page's size and scroll are read in (liveFolderRefresher.ts uses 1034 and 1035). */
const CAPTURE_WORLD_ID = 1036;

/** How long the page may draw after it loaded before the capture is taken again. Our choice: most pages settle by then. */
const SETTLE_AFTER_LOAD_MS = 1500;

/** How long after scrolling the capture waits, so lazy content drawn by the scroll is there. Our choice. */
const SETTLE_AFTER_SCROLL_MS = 400;

/** A page that does not load within this long gives no new capture. Our choice. */
const LOAD_TIMEOUT_MS = 30 * 1000;

/** Runs in the page: its view size in CSS pixels and how far it is scrolled. */
const READ_VIEW_SCRIPT = "({ width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY })";

/** Captures are taken again one at a time: each one is a whole page load. */
let previousRetake: Promise<unknown> = Promise.resolve();

/**
 * Waits a moment without blocking anything.
 */
function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

/**
 * Where a capture of a page comes from, so it can be taken again: the region (the whole view when none) in the
 * view's points. Null for pages that are not web pages or cannot be read.
 */
export async function describeCaptureSource(contents: WebContents, region?: Rectangle): Promise<CaptureSource | null> {
  const url = contents.getURL();
  if (!/^https?:\/\//.test(url)) {
    return null;
  }
  let view: unknown;
  try {
    view = await contents.executeJavaScriptInIsolatedWorld(CAPTURE_WORLD_ID, [{ code: READ_VIEW_SCRIPT }]);
  } catch {
    return null;
  }
  if (typeof view !== "object" || view === null) {
    return null;
  }
  const facts = view as Record<string, unknown>;
  const zoomFactor = contents.getZoomFactor();
  const cssWidth = typeof facts.width === "number" ? facts.width : 0;
  const cssHeight = typeof facts.height === "number" ? facts.height : 0;
  const viewport = { width: Math.round(cssWidth * zoomFactor), height: Math.round(cssHeight * zoomFactor) };
  const scroll = { x: typeof facts.scrollX === "number" ? facts.scrollX : 0, y: typeof facts.scrollY === "number" ? facts.scrollY : 0 };
  const wholeView = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const captured = region ?? wholeView;
  const roundedRegion = { x: Math.round(captured.x), y: Math.round(captured.y), width: Math.round(captured.width), height: Math.round(captured.height) };
  return { url: url, viewport: viewport, scroll: scroll, zoomFactor: zoomFactor, region: roundedRegion };
}

/**
 * Loads the page in a hidden window like the one it was captured in and captures the same region. Returns a PNG
 * data: URL, or null when the page could not load. The window never shows, cannot open others, makes no sound and is
 * destroyed before this returns.
 */
async function retakeNow(source: CaptureSource, profileSession: Session): Promise<string | null> {
  const hiddenWindow = new BrowserWindow({
    show: false,
    useContentSize: true,
    width: Math.max(source.viewport.width, 1),
    height: Math.max(source.viewport.height, 1),
    webPreferences: { session: profileSession, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const contents = hiddenWindow.webContents;
  contents.setAudioMuted(true);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  try {
    // Both settle to a word, so the one that loses the race can never fail later with nobody listening.
    const loaded = contents.loadURL(source.url).then(
      () => "loaded" as const,
      () => "failed" as const,
    );
    const timedOut = wait(LOAD_TIMEOUT_MS).then(() => "timedOut" as const);
    const outcome = await Promise.race([loaded, timedOut]);
    if (outcome !== "loaded") {
      return null;
    }
    contents.setZoomFactor(source.zoomFactor);
    await wait(SETTLE_AFTER_LOAD_MS);
    const scrollScript = `window.scrollTo(${Number(source.scroll.x)}, ${Number(source.scroll.y)})`;
    await contents.executeJavaScriptInIsolatedWorld(CAPTURE_WORLD_ID, [{ code: scrollScript }]);
    await wait(SETTLE_AFTER_SCROLL_MS);
    const image = await contents.capturePage(source.region, { stayHidden: true });
    return image.isEmpty() ? null : image.toDataURL();
  } catch {
    return null;
  } finally {
    hiddenWindow.destroy();
  }
}

/**
 * Takes a capture again (one at a time).
 */
export function retakeCapture(source: CaptureSource, profileSession: Session): Promise<string | null> {
  const retake = previousRetake.then(() => retakeNow(source, profileSession));
  previousRetake = retake.catch(() => null);
  return retake;
}
