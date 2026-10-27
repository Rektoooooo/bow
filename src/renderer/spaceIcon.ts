/**
 * WHY this file exists:
 *   A Space shows an emoji or one of our icons (shared/spaceIcons.ts), in the sidebar's Space title, the Space
 *   switcher and the Library. This draws either, the same way everywhere.
 *
 * Data source:
 *   Space.icon: an emoji, or "icon:<name>".
 *
 * Data flow:
 *   sidebar.ts / overlay pages → createSpaceIcon(space.icon, className) → an element tinted by CSS like the text
 */
import { findSpaceIconChoice, SPACE_ICON_PREFIX } from "../shared/spaceIcons.js";
import { createIcon } from "./icons.js";

/** What a Space with an icon name this version does not know shows. Our default Space mark. */
const UNKNOWN_ICON_TEXT = "✦";

/**
 * Builds a Space's icon inside a <span class="className">: the symbol (macOS draws it, data-symbol "space:<name>"),
 * our own drawing, or the emoji as text.
 */
export function createSpaceIcon(icon: string, className: string): HTMLElement {
  const holder = document.createElement("span");
  holder.className = className;
  const choice = findSpaceIconChoice(icon);
  if (choice === null) {
    holder.textContent = icon.startsWith(SPACE_ICON_PREFIX) ? UNKNOWN_ICON_TEXT : icon;
    return holder;
  }
  holder.classList.add("is-symbol");
  if (choice.symbol === null) {
    holder.append(createIcon("planet", "space-icon-drawing"));
    return holder;
  }
  const symbol = document.createElement("span");
  symbol.className = "icon-symbol space-icon-symbol";
  symbol.dataset.symbol = `space:${choice.name}`;
  symbol.setAttribute("aria-hidden", "true");
  holder.append(symbol);
  return holder;
}
