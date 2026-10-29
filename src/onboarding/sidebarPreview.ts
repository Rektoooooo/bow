/**
 * WHY this file exists:
 *   Beside "Bring your things." and "Choose a color." the onboarding shows a glass sidebar at the window's right edge:
 *   empty at first ("Your sidebar fills in here."), then filling with the Favorites and Pinned tabs an import
 *   actually brought, each one arriving in turn, and tinted with the Space's colors once a color is picked. It shows
 *   what the user is about to get, with their own things.
 *
 * Data source:
 *   WelcomeData.sidebar (the active Space's name, its profile's Favorites, its first Pinned items) and its theme.
 *
 * Data flow:
 *   onboarding.ts → createSidebarPreview() → update(data) on every "onboarding:data" → new items rise in
 */
import type { WelcomeData, WelcomeSidebar } from "../shared/onboarding";
import { computeFramePalette } from "../shared/themePalette.js";
import { createElement } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";
import { prefersLessMotion } from "./onboardingScenes.js";
import { EASE_EMPHASIZED } from "./sceneParts.js";

/** The Favorites grid always shows this many tiles (two rows of four), filled or empty. Our choice. */
const FAVORITE_SLOTS = 8;

/** Items that arrive rise in one after another, this far apart, taking this long. Our choice. */
const ARRIVAL_STAGGER_MS = 90;
const ARRIVAL_MS = 520;

/** The glass sidebar and how it shows fresh data. */
export interface SidebarPreview {
  element: HTMLElement;
  update(data: WelcomeData): void;
}

/**
 * A site's icon: its favicon, or its first letter when it has none (or the icon does not load).
 */
function createSiteIcon(title: string, iconUrl: string | null, className: string): HTMLElement {
  const holder = createElement("span", className);
  const letter = createElement("span", "preview-letter", title.trim().charAt(0).toUpperCase());
  if (iconUrl === null) {
    holder.append(letter);
    return holder;
  }
  const image = document.createElement("img");
  image.alt = "";
  image.src = iconUrl;
  image.addEventListener("error", () => image.replaceWith(letter));
  holder.append(image);
  return holder;
}

/**
 * What one item looks like, as text: an item whose look is unchanged is left alone on an update.
 */
function describeItem(title: string, iconUrl: string | null, isFolder: boolean): string {
  return `${isFolder ? "folder" : "tab"}|${title}|${iconUrl ?? ""}`;
}

/**
 * Makes newly arrived items rise in, one after another.
 */
function animateArrivals(elements: HTMLElement[]): void {
  if (prefersLessMotion()) {
    return;
  }
  elements.forEach((element, index) => {
    const frames = [
      { opacity: 0, transform: "translateY(8px) scale(0.96)", filter: "blur(4px)" },
      { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0)" },
    ];
    element.animate(frames, { duration: ARRIVAL_MS, delay: index * ARRIVAL_STAGGER_MS, easing: EASE_EMPHASIZED, fill: "backwards" });
  });
}

/**
 * Builds the glass sidebar: an address field, the Favorites grid, the Space's name and its Pinned rows.
 */
export function createSidebarPreview(): SidebarPreview {
  const element = createElement("div", "sidebar-preview");
  element.setAttribute("aria-hidden", "true");
  const field = createElement("div", "preview-field");
  field.append(createIcon("search", "icon preview-field-icon"), createElement("span", "preview-field-text", "Search or type a URL"));
  const favorites = createElement("div", "preview-favorites");
  const slots: HTMLElement[] = [];
  for (let index = 0; index < FAVORITE_SLOTS; index++) {
    const slot = createElement("span", "preview-favorite");
    slots.push(slot);
    favorites.append(slot);
  }
  const spaceName = createElement("div", "preview-space-name");
  const pinned = createElement("div", "preview-pinned");
  const empty = createElement("p", "preview-empty", "Your sidebar fills in here.");
  element.append(field, favorites, spaceName, pinned, empty);

  let favoriteLooks: string[] = [];
  let pinnedLooks: string[] = [];
  // What is there when the onboarding opens is simply there; only what arrives later rises in.
  let isFirstDraw = true;

  const drawFavorites = (sidebar: WelcomeSidebar): HTMLElement[] => {
    const arrivals: HTMLElement[] = [];
    slots.forEach((slot, index) => {
      const favorite = sidebar.favorites[index];
      const look = favorite === undefined ? "" : describeItem(favorite.title, favorite.iconUrl, false);
      if (look === favoriteLooks[index]) {
        return;
      }
      slot.replaceChildren();
      slot.classList.toggle("is-filled", favorite !== undefined);
      if (favorite !== undefined) {
        slot.append(createSiteIcon(favorite.title, favorite.iconUrl, "preview-favorite-icon"));
        arrivals.push(slot);
      }
    });
    favoriteLooks = slots.map((_slot, index) => {
      const favorite = sidebar.favorites[index];
      return favorite === undefined ? "" : describeItem(favorite.title, favorite.iconUrl, false);
    });
    return arrivals;
  };

  const drawPinned = (sidebar: WelcomeSidebar): HTMLElement[] => {
    const looks = sidebar.pinned.map((item) => describeItem(item.title, item.iconUrl, item.isFolder));
    if (looks.join("\n") === pinnedLooks.join("\n")) {
      return [];
    }
    const rows = sidebar.pinned.map((item) => {
      const row = createElement("div", "preview-row");
      const icon = item.isFolder ? createIcon("folder", "icon preview-row-icon") : createSiteIcon(item.title, item.iconUrl, "preview-row-icon");
      row.append(icon, createElement("span", "preview-row-title", item.title));
      return row;
    });
    pinned.replaceChildren(...rows);
    const arrivals = rows.filter((_row, index) => looks[index] !== pinnedLooks[index]);
    pinnedLooks = looks;
    return arrivals;
  };

  const update = (data: WelcomeData): void => {
    const palette = computeFramePalette(data.theme, data.isSystemDark, true);
    element.style.setProperty("--preview-1", palette.colors[0]);
    element.style.setProperty("--preview-2", palette.colors[1]);
    element.classList.toggle("is-dark", palette.isDark);
    spaceName.textContent = data.sidebar.spaceName;
    const isEmpty = data.sidebar.favorites.length === 0 && data.sidebar.pinned.length === 0;
    element.classList.toggle("is-empty", isEmpty);
    const arrivals = [...drawFavorites(data.sidebar), ...drawPinned(data.sidebar)];
    if (!isFirstDraw) {
      animateArrivals(arrivals);
    }
    isFirstDraw = false;
  };

  return { element: element, update: update };
}
