/**
 * WHY this file exists:
 *   A few menu commands act on the page itself rather than on the sidebar: zoom, developer tools, copying the
 *   address. They need a page's WebContents, so they live apart from the pure state functions.
 *
 * Data source:
 *   The WebContents of the selected tab (tabViews.ts) and the selected tab's saved URL and name.
 *
 * Data flow:
 *   appMenu.ts ⌘+ → main.ts → zoomPage(contents, "in")
 */
import { app, clipboard } from "electron";
import type { WebContents } from "electron";
import type { DeveloperTool } from "../shared/actions";
import type { TabItem } from "../shared/types";

/** Developer tools start in their own page; wait for their API up to this many times this long (our choice). */
const DEVTOOLS_READY_ATTEMPTS = 40;
const DEVTOOLS_READY_WAIT_MS = 100;

/** Zoom steps, the same ladder Chrome uses, so ⌘+ and ⌘- feel familiar. */
const ZOOM_FACTORS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

/** 100%. */
const DEFAULT_ZOOM_FACTOR = 1;

/**
 * Moves the page's zoom one step in or out, or back to 100%.
 */
export function zoomPage(contents: WebContents, direction: "in" | "out" | "reset"): void {
  if (direction === "reset") {
    contents.setZoomFactor(DEFAULT_ZOOM_FACTOR);
    return;
  }
  const currentFactor = contents.getZoomFactor();
  if (direction === "in") {
    const nextFactor = ZOOM_FACTORS.find((factor) => factor > currentFactor + 0.001);
    contents.setZoomFactor(nextFactor ?? currentFactor);
    return;
  }
  const smallerFactors = ZOOM_FACTORS.filter((factor) => factor < currentFactor - 0.001);
  const previousFactor = smallerFactors[smallerFactors.length - 1];
  contents.setZoomFactor(previousFactor ?? currentFactor);
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
