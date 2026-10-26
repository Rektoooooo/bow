/**
 * WHY this file exists:
 *   Hovering a tab in the sidebar for a moment shows a preview card next to it: a picture of the page from when it
 *   last showed, its name and its address, like Arc's tab previews. The card never takes the keyboard.
 *
 * Data source:
 *   The "preview" panel message: the tab's name, address, icon and picture (tabSnapshots.ts).
 *
 * Data flow:
 *   sidebar hover (sidebarEvents.ts) → action showTabPreview → overlayController.ts → "overlay:show" (preview)
 *   → renderTabPreview() ; pointer leaves the row → hideTabPreview → the card closes
 */
import type { OverlayPanel } from "../shared/overlay";
import { createElement, createFavicon, getDisplayHost } from "../renderer/dom.js";

type PreviewPanel = Extract<OverlayPanel, { kind: "preview" }>;

/**
 * Draws the preview card.
 */
export function renderTabPreview(host: HTMLElement, panel: PreviewPanel): void {
  const card = createElement("div", "panel tab-preview");
  card.setAttribute("role", "tooltip");
  const picture = createElement("div", "tab-preview-picture");
  const image = document.createElement("img");
  image.src = panel.snapshotUrl;
  image.alt = "";
  picture.append(image);
  const caption = createElement("div", "tab-preview-caption");
  const titleLine = createElement("div", "tab-preview-title-line");
  titleLine.append(createFavicon(panel.faviconUrl, panel.url), createElement("span", "tab-preview-title", panel.title));
  caption.append(titleLine, createElement("span", "tab-preview-address", getDisplayHost(panel.url)));
  card.append(picture, caption);
  host.replaceChildren(card);
}
