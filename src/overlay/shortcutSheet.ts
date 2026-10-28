/**
 * WHY this file exists:
 *   Draws Help › Keyboard Shortcuts: one column per menu with its shortcuts, keys on the left. Read-only; Escape or a
 *   click outside closes it like every panel.
 *
 * Data source:
 *   The "shortcuts" panel message (main/shortcutSheet.ts reads the app menu).
 *
 * Data flow:
 *   ⌘/ → main → "overlay:show" (shortcuts) → renderShortcutSheet()
 */
import type { OverlayPanel } from "../shared/overlay";
import { createElement } from "../renderer/dom.js";

type ShortcutsPanel = Extract<OverlayPanel, { kind: "shortcuts" }>;

/**
 * Builds the sheet.
 */
export function renderShortcutSheet(host: HTMLElement, panel: ShortcutsPanel): void {
  const sheet = createElement("div", "panel shortcut-sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "Keyboard Shortcuts");
  sheet.append(createElement("h1", "shortcut-sheet-title", "Keyboard Shortcuts"));
  const columns = createElement("div", "shortcut-columns");
  for (const group of panel.groups) {
    const section = createElement("section", "shortcut-group");
    section.append(createElement("h2", "shortcut-group-title", group.title));
    for (const line of group.lines) {
      const row = createElement("div", "shortcut-line");
      row.append(createElement("kbd", "shortcut-keys", line.keys), createElement("span", "shortcut-label", line.label));
      section.append(row);
    }
    columns.append(section);
  }
  sheet.append(columns);
  host.replaceChildren(sheet);
}
