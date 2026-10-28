/**
 * WHY this file exists:
 *   A few menu commands act on the page itself rather than on the sidebar: zoom, developer tools, copying the
 *   address. They need a page's WebContents, so they live apart from the pure state functions.
 *
 * Data source:
 *   The WebContents of the selected tab (tabViews.ts) and the selected tab's saved URL and name.
 *
 * Data flow:
 *   appMenu.ts ⌘+ → main.ts → zoomPage(contents, "in") → the zoom is remembered for the page's host (siteZoom.ts)
 *   a page's dom-ready → applySiteZoom(contents) → its host's remembered zoom
 *   File › Save Page As… / Export as PDF… → save dialog (in the download folder) → savePage / printToPDF → file
 */
import { app, clipboard, dialog } from "electron";
import type { BrowserWindow, SaveDialogOptions, WebContents } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDownloadFolder } from "./downloads";
import { applyChange, getState } from "./browserCore";
import { findSessionProfileId } from "./profiles";
import { DEFAULT_ZOOM_FACTOR, readSiteZoom, setSiteZoom } from "./siteZoom";
import type { DeveloperTool } from "../shared/actions";
import type { TabItem } from "../shared/types";

/** Developer tools start in their own page; wait for their API up to this many times this long (our choice). */
const DEVTOOLS_READY_ATTEMPTS = 40;
const DEVTOOLS_READY_WAIT_MS = 100;

/** Zoom steps, the same ladder Chrome uses, so ⌘+ and ⌘- feel familiar. */
const ZOOM_FACTORS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

/**
 * The zoom one step in or out from the current one, or 100%.
 */
function findNextZoom(currentFactor: number, direction: "in" | "out" | "reset"): number {
  if (direction === "reset") {
    return DEFAULT_ZOOM_FACTOR;
  }
  if (direction === "in") {
    const nextFactor = ZOOM_FACTORS.find((factor) => factor > currentFactor + 0.001);
    return nextFactor ?? currentFactor;
  }
  const smallerFactors = ZOOM_FACTORS.filter((factor) => factor < currentFactor - 0.001);
  return smallerFactors[smallerFactors.length - 1] ?? currentFactor;
}

/**
 * Moves the page's zoom one step in or out, or back to 100%, and remembers it for the page's host, except in a
 * private window, which keeps nothing.
 */
export function zoomPage(contents: WebContents, direction: "in" | "out" | "reset"): void {
  const zoomFactor = findNextZoom(contents.getZoomFactor(), direction);
  contents.setZoomFactor(zoomFactor);
  const isPrivate = findSessionProfileId(contents.session) === null;
  if (isPrivate) {
    return;
  }
  const url = contents.getURL();
  applyChange((state) => setSiteZoom(state, url, zoomFactor));
}

/**
 * Gives a page its host's remembered zoom (or 100%) once its document is ready.
 */
export function applySiteZoom(contents: WebContents): void {
  const zoomFactor = readSiteZoom(getState(), contents.getURL());
  if (Math.abs(contents.getZoomFactor() - zoomFactor) > 0.001) {
    contents.setZoomFactor(zoomFactor);
  }
}

/** Longest file name taken from a page's title. Our choice: Finder shows about this much. */
const MAX_FILE_NAME_LENGTH = 100;

/**
 * A file name from a page's title: no slashes or colons (Finder's separators), not too long, never empty.
 * Example: "Docs: Getting started / Intro" → "Docs - Getting started - Intro"
 */
function toFileName(title: string): string {
  const withoutSeparators = title.replace(/[/:\\]+/g, " - ");
  const singleSpaced = withoutSeparators.replace(/\s+/g, " ");
  const trimmed = singleSpaced.trim();
  const shortened = trimmed.slice(0, MAX_FILE_NAME_LENGTH);
  return shortened === "" ? "Page" : shortened;
}

/**
 * Asks where to save, over the window (or on its own without one). Null when cancelled.
 */
async function askWhereToSave(window: BrowserWindow | null, options: SaveDialogOptions): Promise<string | null> {
  const result = window === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(window, options);
  return result.canceled || result.filePath === undefined ? null : result.filePath;
}

/**
 * File › Save Page As… (⇧⌘S): the page with its pictures and styles, as an HTML file and a folder beside it.
 */
export async function savePageAs(contents: WebContents, window: BrowserWindow | null): Promise<void> {
  const filePath = await askWhereToSave(window, {
    title: "Save Page As",
    defaultPath: path.join(getDownloadFolder(), `${toFileName(contents.getTitle())}.html`),
    filters: [{ name: "Web Page, Complete", extensions: ["html"] }],
  });
  if (filePath !== null) {
    await contents.savePage(filePath, "HTMLComplete");
  }
}

/**
 * File › Export as PDF…: the page as a PDF, with its backgrounds.
 */
export async function exportPageAsPdf(contents: WebContents, window: BrowserWindow | null): Promise<void> {
  const filePath = await askWhereToSave(window, {
    title: "Export as PDF",
    defaultPath: path.join(getDownloadFolder(), `${toFileName(contents.getTitle())}.pdf`),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (filePath === null) {
    return;
  }
  const pdf = await contents.printToPDF({ printBackground: true });
  await fs.promises.writeFile(filePath, pdf);
}

/**
 * Opens the page's developer tools in their own window, or closes them.
 */
export function toggleDevTools(contents: WebContents): void {
  if (contents.isDevToolsOpened()) {
    contents.closeDevTools();
    return;
  }
  contents.openDevTools({ mode: "detach" });
}

/**
 * Developer Mode's toolbar: opens the page's developer tools on a panel (Console, Network) or starts picking an
 * element (Inspect). DevToolsAPI is the embedder interface Chromium's developer tools expose to their host.
 */
export async function openDeveloperTool(contents: WebContents, tool: DeveloperTool): Promise<void> {
  if (!contents.isDevToolsOpened()) {
    const opened = new Promise<void>((resolve) => contents.once("devtools-opened", () => resolve()));
    contents.openDevTools({ mode: "detach" });
    await opened;
  }
  const devTools = contents.devToolsWebContents;
  if (devTools === null) {
    return;
  }
  devTools.focus();
  const script = tool === "inspect" ? "DevToolsAPI.enterInspectElementMode()" : `DevToolsAPI.showPanel(${JSON.stringify(tool)})`;
  // The developer tools page may still be starting; it accepts the call once its API is there.
  for (let attempt = 0; attempt < DEVTOOLS_READY_ATTEMPTS; attempt++) {
    const isReady = await devTools.executeJavaScript("typeof DevToolsAPI !== 'undefined' && typeof DevToolsAPI.showPanel === 'function'");
    if (isReady === true) {
      await devTools.executeJavaScript(script);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, DEVTOOLS_READY_WAIT_MS));
  }
}

/** Google Translate's page translator: it shows the page translated, links included. A third-party service. */
const TRANSLATE_URL = "https://translate.google.com/translate";

/**
 * Translates the page into the Mac's language through Google Translate (Arc's "Translate page" used a translation
 * service too). Pages that are not on the web are left alone.
 */
export function translatePage(contents: WebContents): void {
  const pageUrl = contents.getURL();
  if (!pageUrl.startsWith("http://") && !pageUrl.startsWith("https://")) {
    return;
  }
  const systemLanguage = app.getPreferredSystemLanguages()[0] ?? "en";
  const targetLanguage = systemLanguage.split("-")[0] ?? "en";
  const translateUrl = `${TRANSLATE_URL}?sl=auto&tl=${encodeURIComponent(targetLanguage)}&u=${encodeURIComponent(pageUrl)}`;
  contents.loadURL(translateUrl).catch(() => undefined);
}

/**
 * Copies a tab's address, plain or as a Markdown link "[name](url)" (Arc's ⇧⌘C and ⌥⇧⌘C).
 */
export function copyTabUrl(tab: TabItem, format: "plain" | "markdown"): void {
  if (format === "plain") {
    clipboard.writeText(tab.url);
    return;
  }
  const name = tab.customTitle ?? tab.title;
  // Square brackets in the name would end the link text early.
  const safeName = name.replaceAll("[", "(").replaceAll("]", ")");
  clipboard.writeText(`[${safeName}](${tab.url})`);
}
