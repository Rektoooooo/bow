/**
 * WHY this file exists:
 *   Arc's icon picker for a Space: a popover pointing at the Space's button in the bottom bar, with Emoji and Icon
 *   tabs, a trash button that goes back to the plain mark, and a grid eight wide. A click sets the icon at once; the
 *   popover stays open (Escape or a click outside closes it), like the user's Arc in their recording.
 *
 * Data source:
 *   The "spaceIcon" panel message: the Space, its icon and where its button sits. The choices are ours
 *   (shared/spaceIcons.ts).
 *
 * Data flow:
 *   Space menu › Change Space Icon… → sidebar finds the button → openSpaceIconPicker → renderSpaceIconPicker() →
 *   a click → dispatch setSpaceIcon
 */
import type { OverlayPanel } from "../shared/overlay";
import { SPACE_EMOJI_CHOICES, SPACE_ICON_CHOICES, SPACE_ICON_PREFIX } from "../shared/spaceIcons.js";
import { createElement, createIconButton, createTextButton, dispatch } from "../renderer/dom.js";
import { createSpaceIcon } from "../renderer/spaceIcon.js";

type SpaceIconPanel = Extract<OverlayPanel, { kind: "spaceIcon" }>;

/**
 * Measured on the user's recording (1 px per pt): 270 × 270, 14 pt from the window's left edge at the least, an
 * arrow pointing at the button. Our choice: the gap between the arrow's tip and the button.
 */
const POPOVER_SIZE_PX = 270;
const POPOVER_MIN_LEFT_PX = 14;
const ARROW_HEIGHT_PX = 11;
const ARROW_GAP_PX = 4;

/** What the trash button goes back to: our default Space mark (Arc removes the custom icon). */
const DEFAULT_SPACE_ICON = "✦";

/** The icon shown and the tab open, kept while the popover redraws after a click. */
let currentIcon = "";
let openTab: "emoji" | "icon" = "icon";

/**
 * Sets the Space's icon and redraws the popover with the new one selected.
 */
function chooseIcon(host: HTMLElement, panel: SpaceIconPanel, icon: string): void {
  currentIcon = icon;
  dispatch({ type: "setSpaceIcon", spaceId: panel.spaceId, icon: icon });
  renderGrid(host, panel);
}

/**
 * The Emoji / Icon switch and the trash button.
 */
function renderHeader(host: HTMLElement, panel: SpaceIconPanel): HTMLElement {
  const header = createElement("div", "space-picker-header");
  const tabs = createElement("div", "space-picker-tabs");
  for (const tab of ["emoji", "icon"] as const) {
    const button = createTextButton(tab === "emoji" ? "Emoji" : "Icon", "space-picker-tab", () => {
      openTab = tab;
      drawPopover(host, panel);
    });
    button.classList.toggle("is-active", openTab === tab);
    tabs.append(button);
  }
  const trash = createIconButton("trash", "Remove the icon", "space-picker-trash", () => chooseIcon(host, panel, DEFAULT_SPACE_ICON));
  header.append(tabs, trash);
  return header;
}

/**
 * The grid of the open tab, the Space's icon marked.
 */
function renderGrid(host: HTMLElement, panel: SpaceIconPanel): void {
  const grid = host.querySelector(".space-picker-grid");
  if (grid === null) {
    return;
  }
  const values = openTab === "icon" ? SPACE_ICON_CHOICES.map((choice) => `${SPACE_ICON_PREFIX}${choice.name}`) : SPACE_EMOJI_CHOICES;
  const cells = values.map((value) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "space-picker-cell";
    cell.classList.toggle("is-selected", value === currentIcon);
    cell.setAttribute("aria-label", value.startsWith(SPACE_ICON_PREFIX) ? value.slice(SPACE_ICON_PREFIX.length) : value);
    cell.append(createSpaceIcon(value, "space-picker-icon"));
    cell.addEventListener("click", () => chooseIcon(host, panel, value));
    return cell;
  });
  grid.replaceChildren(...cells);
}

/**
 * Opens the picker for a Space: its icon selected, on the tab that holds it.
 */
export function renderSpaceIconPicker(host: HTMLElement, panel: SpaceIconPanel): void {
  currentIcon = panel.icon;
  openTab = panel.icon.startsWith(SPACE_ICON_PREFIX) ? "icon" : "emoji";
  drawPopover(host, panel);
}

/**
 * Builds the popover above the Space's button, its arrow pointing at the button's middle.
 */
function drawPopover(host: HTMLElement, panel: SpaceIconPanel): void {
  const anchorMiddle = panel.anchor.x + panel.anchor.width / 2;
  const left = Math.max(POPOVER_MIN_LEFT_PX, Math.round(anchorMiddle - POPOVER_SIZE_PX / 2));
  const bottom = window.innerHeight - panel.anchor.y + ARROW_GAP_PX + ARROW_HEIGHT_PX;

  const container = createElement("div", "panel space-picker");
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-label", "Space icon");
  container.style.left = `${left}px`;
  container.style.bottom = `${bottom}px`;
  container.style.setProperty("--arrow-left", `${Math.round(anchorMiddle - left)}px`);
  container.append(renderHeader(host, panel), createElement("div", "space-picker-grid"));
  host.replaceChildren(container);
  renderGrid(host, panel);
}
