/**
 * WHY this file exists:
 *   The parts of a Peek that are not the page itself: the dimmed background, a shadow around the floating card, and
 *   the header above it with the page's host and Arc's buttons (Open as Tab ⌘O, Split View, Close). The page is a
 *   separate view that main.ts places exactly inside `frame`.
 *
 * Data source:
 *   The "peek" panel message: where the card is, and the page's address and title.
 *
 * Data flow:
 *   peek.ts showPeekFrame() → "overlay:show" (peek) → renderPeekFrame() → button → overlayApi.peekCommand()
 */
import type { OverlayPanel } from "../shared/overlay";
import { createElement, createFavicon, createIconButton, getDisplayHost } from "../renderer/dom.js";

/** Height of the header above the card. Must fit inside PEEK_HEADER_SPACE_PX in peek.ts. */
const HEADER_HEIGHT_PX = 40;

/** Gap between the header and the card. */
const HEADER_GAP_PX = 6;

/**
 * Draws the Peek's shadow and header around the card position main.ts chose.
 */
export function renderPeekFrame(host: HTMLElement, panel: Extract<OverlayPanel, { kind: "peek" }>): void {
  const frame = panel.frame;
  const shadow = createElement("div", "peek-shadow");
  shadow.style.left = `${frame.x}px`;
  shadow.style.top = `${frame.y}px`;
  shadow.style.width = `${frame.width}px`;
  shadow.style.height = `${frame.height}px`;

  const header = createElement("div", "peek-header");
  header.style.left = `${frame.x}px`;
  header.style.top = `${frame.y - HEADER_HEIGHT_PX - HEADER_GAP_PX}px`;
  header.style.width = `${frame.width}px`;
  header.style.height = `${HEADER_HEIGHT_PX}px`;

  const titleBlock = createElement("div", "peek-title");
  titleBlock.append(createFavicon(null, panel.url));
  const pageHost = getDisplayHost(panel.url);
  titleBlock.append(createElement("span", "peek-host", pageHost === "" ? panel.url : pageHost));
  if (panel.title !== "" && panel.title !== panel.url) {
    titleBlock.append(createElement("span", "peek-page-title", panel.title));
  }

  const buttons = createElement("div", "peek-buttons");
  buttons.append(
    createIconButton("expand", "Open as Tab (⌘O)", "peek-button", () => window.overlayApi.peekCommand("openAsTab")),
    createIconButton("split", "Open in Split View", "peek-button", () => window.overlayApi.peekCommand("split")),
    createIconButton("close", "Close (Esc)", "peek-button", () => window.overlayApi.peekCommand("close")),
  );
  header.append(titleBlock, buttons);
  host.replaceChildren(shadow, header);
}
