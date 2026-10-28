/**
 * WHY this file exists:
 *   Help › Keyboard Shortcuts lists the app menu's shortcuts, read from the menu itself so the list can never drift
 *   from what the keys do. Electron writes them as "CommandOrControl+Shift+T"; people read "⇧⌘T", modifiers in the
 *   order macOS's menus use (⌃ ⌥ ⇧ ⌘).
 *
 * Data source:
 *   Accelerator strings from the app menu (main/shortcutSheet.ts).
 *
 * Data flow:
 *   main/shortcutSheet.ts → formatAccelerator() → the overlay's sheet (overlay/shortcutSheet.ts)
 */

/** One line of the sheet: the keys and what they do. */
export interface ShortcutLine {
  keys: string;
  label: string;
}

/** The lines of one menu (File, Edit, …). */
export interface ShortcutGroup {
  title: string;
  lines: ShortcutLine[];
}

/** Electron's modifier names → macOS's symbols. */
const MODIFIER_SYMBOLS: Record<string, string> = {
  Control: "⌃",
  Ctrl: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
  CommandOrControl: "⌘",
  CmdOrCtrl: "⌘",
  Command: "⌘",
  Cmd: "⌘",
};

/** The order macOS's menus show modifiers in. */
const MODIFIER_ORDER = ["⌃", "⌥", "⇧", "⌘"];

/** Electron's key names that macOS shows as a symbol. */
const KEY_SYMBOLS: Record<string, string> = {
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  Tab: "⇥",
  Enter: "↩",
  Return: "↩",
  Escape: "⎋",
  Esc: "⎋",
  Backspace: "⌫",
  Delete: "⌦",
  Plus: "+",
  Space: "Space",
};

/**
 * An accelerator as macOS shows it. Example: "CommandOrControl+Shift+T" → "⇧⌘T", "Control+Tab" → "⌃⇥".
 */
export function formatAccelerator(accelerator: string): string {
  const parts = accelerator.split("+");
  // "CommandOrControl+Plus" is written with the word; a trailing "+" would split into empty parts.
  const keyPart = parts.pop() ?? "";
  const modifiers = parts.map((part) => MODIFIER_SYMBOLS[part] ?? part);
  const orderedModifiers = MODIFIER_ORDER.filter((symbol) => modifiers.includes(symbol));
  const key = KEY_SYMBOLS[keyPart] ?? keyPart.toUpperCase();
  return `${orderedModifiers.join("")}${key}`;
}
