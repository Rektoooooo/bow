/**
 * WHY this file exists:
 *   Some pages draw their content with scripts after they load (GitHub's newer list pages do), so their HTML has no
 *   links to read. This file opens such a page in a hidden window, in the profile's session (its cookies, its
 *   sign-ins), waits until the items a caller counts stop changing, reads every link and closes the window again.
 *
 * Data source:
 *   The page as Chromium renders it. The links are read in an isolated world, so the page's scripts cannot change
 *   our reading code; what comes back is still untrusted and is checked field by field here.
 *
 * Data flow:
 *   liveFolderRefresher.ts → readRenderedLinks(url, session, countItems) → hidden window → links → window closed
 */
import { BrowserWindow } from "electron";
import type { Session } from "electron";
import type { PageLink } from "./gitHubLists";

/** A rendered page: where it ended up, and its links. */
export interface RenderedPage {
  pageUrl: string;
  links: PageLink[];
}

/** The isolated world our reading script runs in (media.ts and boostPages.ts use 1031–1033). */
const LINKS_WORLD_ID = 1034;

/** How long the page may take to draw its items after it loaded. Our choice: GitHub's lists take one to three seconds. */
const RENDER_WAIT_MS = 10 * 1000;

/** How often the page is read while it draws. Our choice. */
const RENDER_POLL_MS = 500;

/** The hidden window's size: a desktop width, so pages draw their full list rather than a phone layout. Our choice. */
const HIDDEN_WINDOW_WIDTH = 1280;
const HIDDEN_WINDOW_HEIGHT = 900;

/** At most this many links are read, and this much of each link's text. Our choice; a list page has a few hundred. */
const MAX_LINKS = 3000;
const MAX_LINK_TEXT_LENGTH = 500;

/** Runs in the page: every link's absolute address and text. */
const READ_LINKS_SCRIPT = `(() => {
  const links = [];
  for (const anchor of document.querySelectorAll("a[href]")) {
    links.push({ href: anchor.href, text: (anchor.textContent || "").slice(0, ${MAX_LINK_TEXT_LENGTH}) });
    if (links.length >= ${MAX_LINKS}) break;
  }
  return { pageUrl: location.href, links: links };
})()`;

/**
 * Checks what the reading script returned, keeping only well-formed links.
 */
function toRenderedPage(value: unknown): RenderedPage | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.pageUrl !== "string" || !Array.isArray(record.links)) {
    return null;
  }
  const links: PageLink[] = [];
  for (const rawLink of record.links.slice(0, MAX_LINKS)) {
    const link = rawLink as Record<string, unknown> | null;
    if (link !== null && typeof link.href === "string" && typeof link.text === "string") {
      links.push({ href: link.href, text: link.text.slice(0, MAX_LINK_TEXT_LENGTH) });
    }
  }
  return { pageUrl: record.pageUrl, links: links };
}

/**
 * Waits a moment without blocking anything.
 */
function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

/**
 * Opens a page in a hidden window and reads its links once the number of items `countItems` finds is above zero and
 * the same twice in a row (the list finished drawing), or when RENDER_WAIT_MS ran out (then the last reading, maybe
 * with no items: an empty list). Returns null when the page could not load. The window never shows, cannot open
 * other windows or leave the page's site, makes no sound, and is destroyed before this returns.
 */
export async function readRenderedLinks(url: string, profileSession: Session, countItems: (page: RenderedPage) => number): Promise<RenderedPage | null> {
  const siteOrigin = new URL(url).origin;
  const hiddenWindow = new BrowserWindow({
    show: false,
    width: HIDDEN_WINDOW_WIDTH,
    height: HIDDEN_WINDOW_HEIGHT,
    webPreferences: { session: profileSession, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const contents = hiddenWindow.webContents;
  contents.setAudioMuted(true);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  const keepOnSite = (event: Electron.Event, targetUrl: string): void => {
    const isSameSite = URL.canParse(targetUrl) && new URL(targetUrl).origin === siteOrigin;
    if (!isSameSite) {
      event.preventDefault();
    }
  };
  contents.on("will-navigate", keepOnSite);
  contents.on("will-redirect", keepOnSite);

  try {
    await contents.loadURL(url);
    const deadline = Date.now() + RENDER_WAIT_MS;
    let lastPage: RenderedPage | null = null;
    let lastCount = 0;
    while (Date.now() < deadline) {
      const result: unknown = await contents.executeJavaScriptInIsolatedWorld(LINKS_WORLD_ID, [{ code: READ_LINKS_SCRIPT }]);
      const page = toRenderedPage(result);
      const count = page === null ? 0 : countItems(page);
      if (count > 0 && count === lastCount) {
        return page;
      }
      lastPage = page;
      lastCount = count;
      await wait(RENDER_POLL_MS);
    }
    return lastPage;
  } catch {
    return null;
  } finally {
    hiddenWindow.destroy();
  }
}
