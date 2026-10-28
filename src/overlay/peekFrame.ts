/**
 * WHY this file exists:
 *   The parts of Arc's Peek that are not the page itself: the page card dimmed behind it, the card's own toolbar row
 *   (back, forward, reload and the address) in the frame's color, 10 pt below the window's top, and Arc's round
 *   buttons stacked right of the card (Close, Open as Tab ⌘O, Split View). The page is a separate view that peek.ts
 *   places exactly inside `frame`. Like Arc's, the card grows out of the clicked link when the Peek opens (empty: the
 *   page view goes on top once it has grown) and shrinks back into it, showing a picture of the page, when it closes.
 *
 * Data source:
 *   The "peek" panel message: where the page, the page card and the clicked link are, the frame's and the page's
 *   colors, the page's address and whether it can go back or forward; the "peek closing" message with the link and
 *   the page's picture.
 *
 * Data flow:
 *   peek.ts showPeekFrame() → "overlay:show" (peek) → renderPeekFrame() → the card grows → peekCommand("grown")
 *   peek.ts playPeekClose() → "overlay:peek-closing" → playPeekClose() → peekCommand("closeReady") → the card shrinks
 *   button → overlayApi.peekCommand()
 */
import type { OverlayPanel, OverlayRect, PeekClosingMessage, PeekCommand } from "../shared/overlay";
import {
  PEEK_DIM_IN_MS,
  PEEK_DIM_OUT_MS,
  PEEK_GROW_DELAY_MS,
  PEEK_GROW_EASING,
  PEEK_GROW_MS,
  PEEK_SHRINK_FADE_MS,
  PEEK_SHRINK_MS,
  PEEK_START_SCALE,
  PEEK_TOOLBAR_HEIGHT_PX,
} from "../shared/settings.js";
import type { IconName } from "../renderer/icons";
import { createElement, createIconButton, getDisplayHost } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";

type PeekPanel = Extract<OverlayPanel, { kind: "peek" }>;

/** Arc's round buttons: 12 pt right of the card, the first 20 pt from the window's top (the user's recording). */
const BUTTONS_GAP_PX = 12;
const BUTTONS_TOP_PX = 20;

/** The buttons fade in over the grow's last stretch, so they arrive with the card. Our choice. */
const BUTTONS_FADE_IN_MS = 90;

/**
 * Places an element at a rectangle of the window.
 */
function placeAt(element: HTMLElement, box: OverlayRect): void {
  element.style.left = `${box.x}px`;
  element.style.top = `${box.y}px`;
  element.style.width = `${box.width}px`;
  element.style.height = `${box.height}px`;
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
 * The card's box: the toolbar row above the page's frame, and the frame.
 */
function computeCardBox(panel: PeekPanel): OverlayRect {
  return { x: panel.frame.x, y: panel.frame.y - PEEK_TOOLBAR_HEIGHT_PX, width: panel.frame.width, height: PEEK_TOOLBAR_HEIGHT_PX + panel.frame.height };
}

/**
 * Puts the dim, the card and the buttons where the panel says, in its colors.
 */
function placePeekFrame(dim: HTMLElement, card: HTMLElement, buttons: HTMLElement, panel: PeekPanel): void {
  placeAt(dim, panel.card);
  placeAt(card, computeCardBox(panel));
  card.style.setProperty("--peek-chrome", panel.chromeColor);
  card.style.setProperty("--peek-page", panel.pageColor);
  buttons.style.left = `${panel.frame.x + panel.frame.width + BUTTONS_GAP_PX}px`;
  buttons.style.top = `${BUTTONS_TOP_PX}px`;
}

/**
 * True when the user asked macOS for less motion: the Peek then appears and goes without growing or shrinking.
 */
function prefersLessMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The transform that lays a card (placed at `card`, transformed about its top left) over `target`.
 */
function transformOnto(card: OverlayRect, target: OverlayRect): string {
  const scaleX = target.width / Math.max(card.width, 1);
  const scaleY = target.height / Math.max(card.height, 1);
  return `translate(${target.x - card.x}px, ${target.y - card.y}px) scale(${scaleX}, ${scaleY})`;
}

/**
 * Arc's opening: the dim fades in while the empty card grows out of the clicked link; the buttons arrive with it.
 * Main puts the page on top once the card says it has grown.
 */
function playPeekOpen(dim: HTMLElement, card: HTMLElement, buttons: HTMLElement, cardBox: OverlayRect, growFrom: OverlayRect, peekNumber: number): void {
  if (prefersLessMotion()) {
    window.overlayApi.peekCommand("grown", peekNumber);
    return;
  }
  dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: PEEK_DIM_IN_MS, easing: "linear", fill: "backwards" });
  const grow = card.animate([{ transform: transformOnto(cardBox, growFrom) }, { transform: "none" }], {
    duration: PEEK_GROW_MS,
    delay: PEEK_GROW_DELAY_MS,
    easing: PEEK_GROW_EASING,
    fill: "backwards",
  });
  const buttonsDelay = PEEK_GROW_DELAY_MS + PEEK_GROW_MS - BUTTONS_FADE_IN_MS;
  buttons.animate([{ opacity: 0 }, { opacity: 1 }], { duration: BUTTONS_FADE_IN_MS, delay: buttonsDelay, easing: "linear", fill: "backwards" });
  sayGrownWhenDone(grow, card, peekNumber).catch(() => undefined);
}

/**
 * Tells main the card has grown once its animation is done, so the page goes on top. A card taken away meanwhile
 * (the Peek closed, or became a tab) has nothing left to show.
 */
async function sayGrownWhenDone(grow: Animation, card: HTMLElement, peekNumber: number): Promise<void> {
  await grow.finished;
  if (card.isConnected) {
    await window.overlayApi.peekCommand("grown", peekNumber);
  }
}

/**
 * Draws the Peek's dimmed page card, its card with the toolbar row and its buttons, around the page main placed. The
 * first draw of a Peek (it has `growFrom`) builds them and grows the card; later draws (a new address, the window's
 * focus changed, a resize) update them in place, so a grow in progress goes on.
 */
export function renderPeekFrame(host: HTMLElement, panel: PeekPanel): void {
  const dim = host.querySelector<HTMLElement>(".peek-dim");
  const card = host.querySelector<HTMLElement>(".peek-card");
  const buttons = host.querySelector<HTMLElement>(".peek-buttons");
  if (panel.growFrom === null && dim !== null && card !== null && buttons !== null) {
    placePeekFrame(dim, card, buttons, panel);
    card.querySelector(".peek-toolbar")?.replaceWith(createToolbarRow(panel));
    return;
  }

  const newDim = createElement("div", "peek-dim");
  // The card holds the toolbar row and, below it, the page's place: empty while it grows, then under the page view.
  const newCard = createElement("div", "peek-card");
  newCard.append(createToolbarRow(panel), createElement("div", "peek-body"));
  const newButtons = createElement("div", "peek-buttons");
  newButtons.append(
    createPeekButton("close", "Close (Esc)", "peek-button", "close"),
    createPeekButton("expand", "Open as Tab (⌘O)", "peek-button", "openAsTab"),
    createPeekButton("split", "Open in Split View", "peek-button", "split"),
  );
  placePeekFrame(newDim, newCard, newButtons, panel);
  host.replaceChildren(newDim, newCard, newButtons);
  if (panel.growFrom === null) {
    window.overlayApi.peekCommand("grown", panel.peekNumber);
    return;
  }
  playPeekOpen(newDim, newCard, newButtons, computeCardBox(panel), panel.growFrom, panel.peekNumber);
}

/**
 * Resolves after the next frame has been painted.
 */
function waitForPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/**
 * The box `box` scaled about its middle.
 */
function scaleAboutCenter(box: OverlayRect, scale: number): OverlayRect {
  const width = box.width * scale;
  const height = box.height * scale;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width: width, height: height };
}

/**
 * Arc's closing: a picture of the page takes the page's place in the card (main removes the page view once it shows),
 * then the card shrinks back into the link and fades, while the dim and the buttons fade out.
 */
export async function playPeekClose(host: HTMLElement, message: PeekClosingMessage): Promise<void> {
  const dim = host.querySelector<HTMLElement>(".peek-dim");
  const card = host.querySelector<HTMLElement>(".peek-card");
  const buttons = host.querySelector<HTMLElement>(".peek-buttons");
  if (dim === null || card === null || buttons === null) {
    window.overlayApi.peekCommand("closeReady", message.peekNumber);
    return;
  }
  if (message.pictureUrl !== null) {
    const picture = document.createElement("img");
    picture.className = "peek-picture";
    picture.alt = "";
    picture.src = message.pictureUrl;
    await picture.decode().catch(() => undefined);
    card.querySelector(".peek-body")?.append(picture);
    await waitForPaint();
  }
  window.overlayApi.peekCommand("closeReady", message.peekNumber);
  // A new Peek (or another panel) replaced this card while the picture loaded: nothing left to shrink.
  if (!card.isConnected || prefersLessMotion()) {
    return;
  }
  // Its place without any transform (the offset box ignores one, should a grow still be running).
  const cardBox = { x: card.offsetLeft, y: card.offsetTop, width: card.offsetWidth, height: card.offsetHeight };
  const target = message.target ?? scaleAboutCenter(cardBox, PEEK_START_SCALE);
  const shrunk = transformOnto(cardBox, target);
  const totalMs = PEEK_SHRINK_MS + PEEK_SHRINK_FADE_MS;
  card.animate(
    [
      { transform: "none", opacity: 1 },
      { transform: shrunk, opacity: 1, offset: PEEK_SHRINK_MS / totalMs },
      { transform: shrunk, opacity: 0 },
    ],
    { duration: totalMs, easing: "linear", fill: "forwards" },
  );
  dim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: PEEK_DIM_OUT_MS, easing: "linear", fill: "forwards" });
  buttons.animate([{ opacity: 1 }, { opacity: 0 }], { duration: PEEK_DIM_OUT_MS, easing: "linear", fill: "forwards" });
}
