/**
 * WHY this file exists:
 *   Arc's tab tooltip: resting on a tab in the sidebar shows its title in a small black box beside the pointer, with
 *   "Double-click to rename" under it on the selected tab. It reaches over the page, so the overlay draws it. It never
 *   takes the keyboard.
 *
 * Data source:
 *   The "tabTooltip" panel message: the title and whether the rename hint shows (the sidebar sized the box for them).
 *
 * Data flow:
 *   sidebar hover (renderer/tabTooltipHover.ts) → action showTabTooltip → overlayController.ts → "overlay:show"
 *   (tabTooltip) → renderTabTooltip() ; the pointer moves on → hideTabTooltip → the box goes
 */
import type { OverlayPanel } from "../shared/overlay";
import { TAB_TOOLTIP_RENAME_HINT } from "../shared/settings.js";
import { createElement } from "../renderer/dom.js";

type TooltipPanel = Extract<OverlayPanel, { kind: "tabTooltip" }>;

/**
 * Draws the tooltip; the overlay is exactly its size.
 */
export function renderTabTooltip(host: HTMLElement, panel: TooltipPanel): void {
  const box = createElement("div", "panel tab-tooltip");
  box.setAttribute("role", "tooltip");
  box.append(createElement("span", "tab-tooltip-title", panel.title));
  if (panel.showsRenameHint) {
    box.append(createElement("span", "tab-tooltip-hint", TAB_TOOLTIP_RENAME_HINT));
  }
  host.replaceChildren(box);
}
