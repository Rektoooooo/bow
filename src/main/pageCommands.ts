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
import { clipboard } from "electron";
import type { WebContents } from "electron";
import type { TabItem } from "../shared/types";

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
