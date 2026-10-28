/**
 * WHY this file exists:
 *   Help › Keyboard Shortcuts (⌘/): every shortcut of the app menu on one sheet. It is read from the installed menu,
 *   so whatever the menu does, the sheet says.
 *
 * Data source:
 *   Electron's application menu (appMenu.ts installs it).
 *
 * Data flow:
 *   ⌘/ → collectShortcutGroups() → overlayController.openShortcutSheet() → overlay/shortcutSheet.ts draws it
 */
import { Menu } from "electron";
import type { MenuItem } from "electron";
import { formatAccelerator } from "../shared/shortcuts";
import type { ShortcutGroup, ShortcutLine } from "../shared/shortcuts";

/**
 * Shortcuts the menu keeps hidden (one item per number would make the menus long), written out once each.
 */
const HIDDEN_RANGES: Record<string, ShortcutLine> = {
  Tabs: { keys: "⌘1 – ⌘9", label: "Tab 1 to 8; ⌘9 the last tab" },
  Spaces: { keys: "⌃1 – ⌃9", label: "Space 1 to 9" },
};

/**
 * The visible items with a shortcut in a menu and its submenus, in menu order.
 */
function collectLines(items: MenuItem[]): ShortcutLine[] {
  const lines: ShortcutLine[] = [];
  for (const item of items) {
    if (item.submenu !== undefined && item.submenu !== null) {
      lines.push(...collectLines(item.submenu.items));
      continue;
    }
    const accelerator = item.accelerator;
    if (!item.visible || accelerator === undefined || accelerator === null || item.label === "") {
      continue;
    }
    lines.push({ keys: formatAccelerator(String(accelerator)), label: item.label });
  }
  return lines;
}

/**
 * One group per top menu (File, Edit, View, …) that has shortcuts.
 */
export function collectShortcutGroups(): ShortcutGroup[] {
  const menu = Menu.getApplicationMenu();
  if (menu === null) {
    return [];
  }
  const groups: ShortcutGroup[] = [];
  for (const topItem of menu.items) {
    const submenuItems = topItem.submenu?.items ?? [];
    const lines = collectLines(submenuItems);
    const hiddenRange = HIDDEN_RANGES[topItem.label];
    if (hiddenRange !== undefined) {
      lines.push(hiddenRange);
    }
    if (lines.length > 0) {
      groups.push({ title: topItem.label, lines: lines });
    }
  }
  return groups;
}
