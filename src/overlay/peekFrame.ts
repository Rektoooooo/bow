/**
 * WHY this file exists:
 *   The parts of Arc's Peek that are not the page itself: the page card dimmed behind it, the card's own toolbar row
 *   (back, forward, reload and the address) in the frame's color, 10 pt below the window's top, and Arc's round
 *   buttons stacked right of the card (Close, Open as Tab ⌘O, Split View). The page is a separate view that peek.ts
 *   places exactly inside `frame`.
 *
 * Data source:
 *   The "peek" panel message: where the page and the page card are, the frame's color, the page's address and
 *   whether it can go back or forward.
 *
 * Data flow:
 *   peek.ts showPeekFrame() → "overlay:show" (peek) → renderPeekFrame() → button → overlayApi.peekCommand()
 */
import type { OverlayPanel, PeekCommand } from "../shared/overlay";
import { PEEK_TOOLBAR_HEIGHT_PX } from "../shared/settings.js";
import type { IconName } from "../renderer/icons";
import { createElement, createIconButton, getDisplayHost } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";

type PeekPanel = Extract<OverlayPanel, { kind: "peek" }>;

/** Arc's round buttons: 12 pt right of the card, the first 20 pt from the window's top (the user's recording). */
const BUTTONS_GAP_PX = 12;
const BUTTONS_TOP_PX = 20;

/**
 * Places an element at a rectangle of the window.
 */
function placeAt(element: HTMLElement, x: number, y: number, width: number, height: number): void {
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
}

/**
 * One button of the Peek, sending its command to the main process.
 */
function createPeekButton(icon: IconName, label: string, className: string, command: PeekCommand): HTMLButtonElement {
  return createIconButton(icon, label, className, () => window.overlayApi.peekCommand(command));
}

/**
 * The toolbar row above the Peek's page: back, forward and reload on the left, the address in the middle.
 */
function createToolbarRow(panel: PeekPanel): HTMLElement {
  const toolbar = createElement("div", "peek-toolbar");
  const navigation = createElement("div", "peek-navigation");
  const backButton = createPeekButton("back", "Back", "peek-toolbar-button", "back");
  backButton.disabled = !panel.canGoBack;
  const forwardButton = createPeekButton("forward", "Forward", "peek-toolbar-button", "forward");
  forwardButton.disabled = !panel.canGoForward;
  navigation.append(backButton, forwardButton, createPeekButton("reload", "Reload", "peek-toolbar-button", "reload"));

  const address = createElement("div", "peek-address");
  address.title = panel.url;
  const isSecure = panel.url.startsWith("https://");
  const pageHost = getDisplayHost(panel.url);
  address.append(createIcon(isSecure ? "link" : "globe", "icon peek-address-icon"), createElement("span", "peek-host", pageHost === "" ? panel.url : pageHost));
  toolbar.append(navigation, address);
  return toolbar;
}

/**
 * Draws the Peek's dimmed page card, its card with the toolbar row and its buttons, around the page main placed.
 */
export function renderPeekFrame(host: HTMLElement, panel: PeekPanel): void {
  // A redraw of the Peek that shows (a new address, the window's focus changed) must not grow in again.
  const isRedraw = host.querySelector(".peek-card") !== null;
  host.classList.toggle("is-peek-redraw", isRedraw);
  const frame = panel.frame;
  const dim = createElement("div", "peek-dim");
  placeAt(dim, panel.card.x, panel.card.y, panel.card.width, panel.card.height);

  // The card holds the toolbar row and frames the page view main placed in `frame` below it.
  const card = createElement("div", "peek-card");
  placeAt(card, frame.x, frame.y - PEEK_TOOLBAR_HEIGHT_PX, frame.width, PEEK_TOOLBAR_HEIGHT_PX + frame.height);
  card.style.setProperty("--peek-chrome", panel.chromeColor);
  card.append(createToolbarRow(panel));

  const buttons = createElement("div", "peek-buttons");
  buttons.style.left = `${frame.x + frame.width + BUTTONS_GAP_PX}px`;
  buttons.style.top = `${BUTTONS_TOP_PX}px`;
  buttons.append(
    createPeekButton("close", "Close (Esc)", "peek-button", "close"),
    createPeekButton("expand", "Open as Tab (⌘O)", "peek-button", "openAsTab"),
    createPeekButton("split", "Open in Split View", "peek-button", "split"),
  );
  host.replaceChildren(dim, card, buttons);
}
