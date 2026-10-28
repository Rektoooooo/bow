/**
 * WHY this file exists:
 *   The shortcut editor (Library › Shortcuts): any app-menu command can get keys of your own, or none. A command is
 *   known by its place in the menu ("View › Toggle Sidebar"); your changes are kept as overrides of the defaults in
 *   appMenu.ts, and the menu is built from both, so the menu, the ⌘/ sheet and the keys always agree. macOS's own
 *   items (Quit, Hide, Copy, …) keep theirs, and keys already in use are refused, so one key never means two things.
 *
 * Data source:
 *   The app menu's template (appMenu.ts buildTemplate) and settings.shortcutOverrides; a key press while recording
 *   (shortcutRecorder.ts, Electron's before-input-event).
 *
 * Data flow:
 *   menu template + overrides → applyShortcutOverrides() → Menu.buildFromTemplate
 *   Library › Shortcuts → listShortcutCommands() / findShortcutConflict() → rows; a key press → toAccelerator()
 *
 * Rules: pure (the template is plain data).
 */
import type { MenuItemConstructorOptions } from "electron";
import { formatAccelerator } from "../shared/shortcuts";

/** An app-menu command whose keys can be changed. */
export interface ShortcutCommand {
  /** Its place in the menu: "View › Toggle Sidebar". */
  path: string;
  /** The menu it is in ("View"), and its own name. */
  menu: string;
  label: string;
  /** Its keys in appMenu.ts (Electron's form), or null when it has none. */
  defaultAccelerator: string | null;
}

/** A key press as Electron's before-input-event reports it. */
export interface KeyPress {
  code: string;
  meta: boolean;
  control: boolean;
  alt: boolean;
  shift: boolean;
}

/** Most overrides kept. Our choice: more than the menu has commands. */
const MAX_OVERRIDES = 200;

/** Longest command path kept. Our choice. */
const MAX_PATH_LENGTH = 200;

/**
 * macOS's own menu items' keys (Quit, Hide, Edit's, full screen, minimize): never given to another command.
 */
export const SYSTEM_ACCELERATORS = [
  "Command+Q",
  "Command+H",
  "Alt+Command+H",
  "Command+Z",
  "Shift+Command+Z",
  "Command+X",
  "Command+C",
  "Command+V",
  "Alt+Shift+Command+V",
  "Command+A",
  "Control+Command+F",
  "Command+M",
];

/** Keys by their key code (the key's place on the keyboard, whatever its layout), as Electron names them. */
const KEY_NAMES_BY_CODE: Record<string, string> = {
  Space: "Space",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Enter: "Return",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
};

/** The modifiers' Electron names, in the order an accelerator writes them. */
const MODIFIER_NAMES = ["Control", "Alt", "Shift", "Command"];

/** An accelerator's key part: a letter, digit, function key or one of the named keys. */
const KEY_PATTERN = /^([A-Z]|[0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Return|Up|Down|Left|Right|Home|End|PageUp|PageDown|Plus|-|=|\[|\]|\\|;|'|,|\.|\/|`)$/;

/**
 * A menu's title in the menu bar ("Bow" for the app menu, "Help", "Window").
 */
function readMenuTitle(menu: MenuItemConstructorOptions): string {
  if (menu.label !== undefined) {
    return menu.label;
  }
  const titlesByRole: Record<string, string> = { appMenu: "Bow", windowMenu: "Window", help: "Help" };
  return titlesByRole[menu.role ?? ""] ?? "";
}

/**
 * Whether a menu item is a command of ours whose keys can change: it has a label and does something, is not one of
 * macOS's roles, and is shown (hidden items are second keys for a shown one, or ranges like Tab 1–9).
 */
function isEditable(item: MenuItemConstructorOptions): boolean {
  return item.label !== undefined && item.label !== "" && item.role === undefined && item.click !== undefined && item.visible !== false && item.submenu === undefined;
}

/**
 * Calls back for every item of a menu and its submenus, with the item's path.
 */
function visitItems(items: MenuItemConstructorOptions[], prefix: string, visit: (item: MenuItemConstructorOptions, path: string) => void): void {
  for (const item of items) {
    const path = `${prefix} › ${item.label ?? ""}`;
    if (Array.isArray(item.submenu)) {
      visitItems(item.submenu, path, visit);
      continue;
    }
    visit(item, path);
  }
}

/**
 * Every command whose keys can change, menu by menu, in menu order.
 */
export function listShortcutCommands(template: MenuItemConstructorOptions[]): ShortcutCommand[] {
  const commands: ShortcutCommand[] = [];
  for (const menu of template) {
    const title = readMenuTitle(menu);
    if (!Array.isArray(menu.submenu)) {
      continue;
    }
    visitItems(menu.submenu, title, (item, path) => {
      if (isEditable(item)) {
        commands.push({ path: path, menu: title, label: item.label as string, defaultAccelerator: item.accelerator === undefined ? null : String(item.accelerator) });
      }
    });
  }
  return commands;
}

/**
 * The template with your keys: an override replaces a command's keys ("" removes them). Other items stay as they are.
 */
export function applyShortcutOverrides(template: MenuItemConstructorOptions[], overrides: Record<string, string>): MenuItemConstructorOptions[] {
  const applyTo = (items: MenuItemConstructorOptions[], prefix: string): MenuItemConstructorOptions[] =>
    items.map((item) => {
      const path = `${prefix} › ${item.label ?? ""}`;
      if (Array.isArray(item.submenu)) {
        return { ...item, submenu: applyTo(item.submenu, path) };
      }
      const override = isEditable(item) && Object.hasOwn(overrides, path) ? overrides[path] : undefined;
      if (override === undefined) {
        return item;
      }
      const changed = { ...item };
      if (override === "") {
        delete changed.accelerator;
      } else {
        changed.accelerator = override;
      }
      return changed;
    });
  return template.map((menu) => (Array.isArray(menu.submenu) ? { ...menu, submenu: applyTo(menu.submenu, readMenuTitle(menu)) } : menu));
}

/**
 * The template with every item's keys shown but not registered with macOS (Electron's registerAccelerator), macOS's
 * own items too: while the editor records, a key press reaches the Library instead of running a command.
 */
export function withoutRegisteredKeys(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.map((item) => {
    const submenu = Array.isArray(item.submenu) ? withoutRegisteredKeys(item.submenu) : item.submenu;
    return { ...item, submenu: submenu, registerAccelerator: false };
  });
}

/**
 * Who already uses some keys in a template (with your keys applied): a command's path, "macOS" for the system's own,
 * or null when they are free. The command being changed does not count.
 * Example: ("Command+Shift+T", …) → "File › Reopen Closed Tab"
 */
export function findShortcutConflict(template: MenuItemConstructorOptions[], accelerator: string, exceptPath: string): string | null {
  const wanted = formatAccelerator(accelerator);
  if (SYSTEM_ACCELERATORS.some((system) => formatAccelerator(system) === wanted)) {
    return "macOS";
  }
  let conflict: string | null = null;
  for (const menu of template) {
    if (!Array.isArray(menu.submenu)) {
      continue;
    }
    visitItems(menu.submenu, readMenuTitle(menu), (item, path) => {
      const isSameKeys = item.accelerator !== undefined && formatAccelerator(String(item.accelerator)) === wanted;
      if (conflict === null && path !== exceptPath && isSameKeys) {
        conflict = path;
      }
    });
  }
  return conflict;
}

/**
 * Whether an accelerator is one the editor may set: modifiers in Electron's names and one key; a modifier is needed
 * unless the key is a function key (a plain letter would stop typing).
 */
export function isValidAccelerator(accelerator: string): boolean {
  const parts = accelerator.split("+");
  const key = parts.length > 1 && parts.at(-1) === "" ? "Plus" : (parts.at(-1) ?? "");
  const modifiers = parts.slice(0, -1);
  const areModifiersKnown = modifiers.every((modifier) => MODIFIER_NAMES.includes(modifier) || modifier === "CommandOrControl");
  const isFunctionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(key);
  return KEY_PATTERN.test(key) && areModifiersKnown && (modifiers.length > 0 || isFunctionKey);
}

/**
 * The accelerator a key press makes, or null when it is only a modifier or a key the editor does not take.
 * Example: { code: "KeyT", meta: true, shift: true } → "Shift+Command+T"
 */
export function toAccelerator(press: KeyPress): string | null {
  const letter = /^Key([A-Z])$/.exec(press.code);
  const digit = /^Digit([0-9])$/.exec(press.code);
  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(press.code) ? press.code : null;
  const key = letter?.[1] ?? digit?.[1] ?? functionKey ?? KEY_NAMES_BY_CODE[press.code] ?? null;
  if (key === null) {
    return null;
  }
  const modifiers: string[] = [];
  if (press.control) {
    modifiers.push("Control");
  }
  if (press.alt) {
    modifiers.push("Alt");
  }
  if (press.shift) {
    modifiers.push("Shift");
  }
  if (press.meta) {
    modifiers.push("Command");
  }
  return [...modifiers, key].join("+");
}

/**
 * Overrides from a file: command paths with valid accelerators or "" (none), at most MAX_OVERRIDES.
 */
export function checkShortcutOverrides(raw: unknown): Record<string, string> {
  const overrides: Record<string, string> = {};
  const record = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  for (const [path, value] of Object.entries(record).slice(0, MAX_OVERRIDES)) {
    const isPath = path.includes(" › ") && path.length <= MAX_PATH_LENGTH;
    const isKeys = typeof value === "string" && (value === "" || isValidAccelerator(value));
    if (isPath && isKeys) {
      overrides[path] = value as string;
    }
  }
  return overrides;
}
