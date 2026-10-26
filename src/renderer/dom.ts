/**
 * WHY this file exists:
 *   Every part of the sidebar builds elements and buttons the same way. These few helpers keep that in one place.
 *
 * Data source:
 *   None.
 *
 * Data flow:
 *   sidebar.ts / rows.ts / toolbar.ts → createElement() / createIconButton() → elements added to the page
 */
import type { BrowserAction } from "../shared/actions.js";
import type { BrowserApi } from "../shared/types";
import { createIcon } from "./icons.js";
import type { IconName } from "./icons.js";

declare global {
  interface Window {
    browserApi: BrowserApi;
  }
}

/**
 * Sends an action to the main process. Every click in the sidebar ends here.
 */
export function dispatch(action: BrowserAction): void {
  window.browserApi.dispatch(action);
}

/**
 * Creates an element with a class and optional text.
 */
export function createElement(tagName: string, className: string, text: string = ""): HTMLElement {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

/**
 * Creates a button showing an icon. The label becomes the tooltip and the accessible name.
 * The click does not reach the row underneath, so pressing "Close" on a tab does not also select it.
 */
export function createIconButton(icon: IconName, label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(createIcon(icon));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

/**
 * Creates an icon button that only names what it does (`data-action` plus extra data attributes). The click is
 * handled by a delegated listener (sidebarEvents.ts), which reads those attributes when it happens. Elements the
 * sidebar keeps across redraws must work this way: a click handler would remember data from when it was built.
 * Example: createActionButton("close", "Close tab", "row-action", "close-tab", { itemId: "tab-1" })
 */
export function createActionButton(icon: IconName, label: string, className: string, action: string, data: Record<string, string> = {}): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.dataset.action = action;
  for (const [name, value] of Object.entries(data)) {
    button.dataset[name] = value;
  }
  button.append(createIcon(icon));
  return button;
}

/**
 * Creates a button with text instead of an icon.
 */
export function createTextButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

/** Shown instead of a letter when a URL has no readable host name. */
const FALLBACK_SITE_INITIAL = "•";

/**
 * Icon addresses that failed to load. The sidebar redraws often; without this, every redraw would ask a site for
 * an icon it does not have.
 */
const failedIconUrls = new Set<string>();

/**
 * Returns a URL's host name without "www.", or "" when the URL cannot be read.
 * Example: "https://www.github.com/x" → "github.com"
 */
export function getDisplayHost(url: string): string {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    return "";
  }
  const wwwPrefix = "www.";
  if (hostname.startsWith(wwwPrefix)) {
    return hostname.slice(wwwPrefix.length);
  }
  return hostname;
}

/**
 * Returns the conventional icon address of a web page's site ("https://host/favicon.ico"), or null for other URLs.
 * Used for tabs that have not loaded yet, so they still show their site's icon.
 */
function guessFaviconUrl(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    const isWebPage = parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:";
    return isWebPage ? `${parsedUrl.origin}/favicon.ico` : null;
  } catch {
    return null;
  }
}

/**
 * Builds a site icon: the page's favicon, the site's /favicon.ico when the page has not reported one, or the first
 * letter of its host when neither loads.
 */
export function createFavicon(faviconUrl: string | null, url: string, className: string = "favicon"): HTMLElement {
  const wrapper = createElement("span", className);
  const host = getDisplayHost(url);
  const initial = host === "" ? FALLBACK_SITE_INITIAL : host.charAt(0).toUpperCase();
  const iconUrl = faviconUrl ?? guessFaviconUrl(url);
  wrapper.dataset.initial = initial;

  if (iconUrl === null || failedIconUrls.has(iconUrl)) {
    wrapper.textContent = initial;
    wrapper.classList.add("is-letter");
    return wrapper;
  }

  const image = document.createElement("img");
  image.src = iconUrl;
  image.alt = "";
  image.draggable = false;
  // Read when the error happens: the sidebar keeps this image across redraws (morph.ts), so its address and the
  // letter may have changed since it was built.
  image.addEventListener("error", () => {
    const failedUrl = image.getAttribute("src");
    if (failedUrl !== null) {
      failedIconUrls.add(failedUrl);
    }
    const holder = image.parentElement;
    image.remove();
    if (holder !== null) {
      holder.textContent = holder.dataset.initial ?? FALLBACK_SITE_INITIAL;
      holder.classList.add("is-letter");
    }
  });
  wrapper.append(image);
  return wrapper;
}
