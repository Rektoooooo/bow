/**
 * WHY this file exists:
 *   Draws the Little Window's bar: back, the page's host (click to type another address), Copy Link and
 *   "Open in Space", which moves the page into the main window's active Space.
 *
 * Data source:
 *   Page info from littleWindow.ts through window.littleApi.
 *
 * Data flow:
 *   "little:info" → renderBar() → click → littleApi.moveToSpace() / navigate() / copyLink() / goBack()
 */
import type { SymbolImage } from "../shared/symbols";
import { createIcon, installSymbols } from "../renderer/icons.js";

/** What the bar learns about its page. */
interface LittlePageInfo {
  url: string;
  title: string;
  canGoBack: boolean;
}

/** The bridge littlePreload.ts provides. */
interface LittleApi {
  onInfo(listener: (info: LittlePageInfo) => void): void;
  navigate(typedText: string): Promise<void>;
  moveToSpace(): Promise<void>;
  copyLink(): Promise<void>;
  goBack(): Promise<void>;
  getSymbols(): Promise<Record<string, SymbolImage>>;
}

declare global {
  interface Window {
    littleApi: LittleApi;
  }
}

/** True while the address field has the keyboard, so page updates do not overwrite typing. */
let isEditingAddress = false;

/** A private window (⇧⌘N): shows a "Private" badge and cannot move its page into a Space. */
const isPrivateWindow = new URLSearchParams(window.location.search).get("private") === "1";

/**
 * Returns the host of an address, or the address itself when it has none.
 */
function getHost(url: string): string {
  try {
    const host = new URL(url).host;
    return host === "" ? url : host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Builds a bar button with an icon and optional text.
 */
function createBarButton(iconName: Parameters<typeof createIcon>[0], label: string, text: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "little-button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(createIcon(iconName));
  if (text !== "") {
    button.append(document.createTextNode(text));
  }
  button.addEventListener("click", onClick);
  return button;
}

/**
 * Draws the bar for the page's current address.
 */
function renderBar(info: LittlePageInfo): void {
  const bar = document.getElementById("little-bar");
  if (bar === null || isEditingAddress) {
    return;
  }
  document.title = info.title === "" ? "Little Window" : info.title;

  const backButton = createBarButton("back", "Back", "", () => window.littleApi.goBack());
  backButton.disabled = !info.canGoBack;

  const address = document.createElement("input");
  address.className = "little-address";
  address.value = info.url === "" ? "" : getHost(info.url);
  address.placeholder = "Search or enter address";
  address.title = info.url;
  address.spellcheck = false;
  address.addEventListener("focus", () => {
    isEditingAddress = true;
    address.value = info.url;
    address.select();
  });
  address.addEventListener("blur", () => {
    isEditingAddress = false;
    renderBar(info);
  });
  address.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      window.littleApi.navigate(address.value);
      address.blur();
    }
    if (event.key === "Escape") {
      address.blur();
    }
  });

  const copyButton = createBarButton("link", "Copy Link", "", () => window.littleApi.copyLink());
  copyButton.disabled = info.url === "";
  if (isPrivateWindow) {
    const badge = document.createElement("span");
    badge.className = "little-private";
    badge.textContent = "Private";
    badge.title = "Nothing from this window is saved: no history, cookies or archive.";
    bar.replaceChildren(badge, backButton, address, copyButton);
    return;
  }
  const moveButton = createBarButton("expand", "Open in Space (⌘O)", "Open in Space", () => window.littleApi.moveToSpace());
  moveButton.classList.add("little-move");
  moveButton.disabled = info.url === "";
  bar.replaceChildren(backButton, address, copyButton, moveButton);
}

/**
 * Entry point: draws an empty bar, and focuses the address field when the window opened without a page (⌥⌘N).
 */
function startLittleBar(): void {
  document.body.classList.toggle("is-private", isPrivateWindow);
  window.littleApi.getSymbols().then(installSymbols).catch(() => undefined);
  window.littleApi.onInfo(renderBar);
  renderBar({ url: "", title: "", canGoBack: false });
  const openedEmpty = new URLSearchParams(window.location.search).get("empty") === "1";
  if (openedEmpty) {
    document.querySelector<HTMLInputElement>(".little-address")?.focus();
  }
  document.addEventListener("keydown", (event) => {
    if (event.metaKey && event.key.toLowerCase() === "o" && !isPrivateWindow) {
      event.preventDefault();
      window.littleApi.moveToSpace();
    }
  });
}

startLittleBar();
