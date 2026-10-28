/**
 * WHY this file exists:
 *   The shortcut editor changes the menu's keys. These tests pin down which commands can change, how your keys apply,
 *   which keys are refused (in use, macOS's own, no modifier), how a key press becomes keys, and that Bow's own
 *   default keys never clash.
 */
import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";
import { buildDefaultMenuTemplate } from "../src/main/appMenu";
import type { AppMenuCommands } from "../src/main/appMenu";
import { applyShortcutOverrides, checkShortcutOverrides, findShortcutConflict, isValidAccelerator, listShortcutCommands, SYSTEM_ACCELERATORS, toAccelerator } from "../src/main/shortcutOverrides";
import { formatAccelerator } from "../src/shared/shortcuts";

const doNothing = (): void => undefined;

/** A small menu in the real one's shape: the app menu, a File menu with a submenu, a hidden second key. */
const TEMPLATE: MenuItemConstructorOptions[] = [
  { role: "appMenu", submenu: [{ role: "about" }, { label: "Settings…", accelerator: "CommandOrControl+,", click: doNothing }, { role: "quit" }] },
  {
    label: "File",
    submenu: [
      { label: "New Tab", accelerator: "CommandOrControl+T", click: doNothing },
      { label: "Export", submenu: [{ label: "As PDF…", click: doNothing }] },
      { label: "Tab 1", accelerator: "CommandOrControl+1", visible: false, acceleratorWorksWhenHidden: true, click: doNothing },
      { type: "separator" },
    ],
  },
];

describe("the shortcut editor's commands", () => {
  it("lists shown commands of ours by their place in the menu, not macOS's roles or hidden keys", () => {
    expect(listShortcutCommands(TEMPLATE)).toEqual([
      { path: "Bow › Settings…", menu: "Bow", label: "Settings…", defaultAccelerator: "CommandOrControl+," },
      { path: "File › New Tab", menu: "File", label: "New Tab", defaultAccelerator: "CommandOrControl+T" },
      { path: "File › Export › As PDF…", menu: "File", label: "As PDF…", defaultAccelerator: null },
    ]);
  });

  it("applies your keys, removes keys with an empty override, and leaves the rest alone", () => {
    const applied = applyShortcutOverrides(TEMPLATE, { "File › New Tab": "", "File › Export › As PDF…": "Shift+Command+P", "File › Tab 1": "Command+9" });
    const commands = listShortcutCommands(applied);
    expect(commands.find((command) => command.label === "New Tab")?.defaultAccelerator).toBeNull();
    expect(commands.find((command) => command.label === "As PDF…")?.defaultAccelerator).toBe("Shift+Command+P");
    const hidden = (applied[1]?.submenu as MenuItemConstructorOptions[])[2];
    expect(hidden?.accelerator).toBe("CommandOrControl+1");
  });

  it("finds who uses keys: another command, a hidden one, or macOS", () => {
    expect(findShortcutConflict(TEMPLATE, "Command+T", "File › Export › As PDF…")).toBe("File › New Tab");
    expect(findShortcutConflict(TEMPLATE, "Command+T", "File › New Tab")).toBeNull();
    expect(findShortcutConflict(TEMPLATE, "Command+1", "File › New Tab")).toBe("File › Tab 1");
    expect(findShortcutConflict(TEMPLATE, "Command+Q", "File › New Tab")).toBe("macOS");
    expect(findShortcutConflict(TEMPLATE, "Shift+Command+Y", "File › New Tab")).toBeNull();
  });
});

describe("keys", () => {
  it("turn a key press into keys by the key's place, modifiers in macOS's order", () => {
    expect(toAccelerator({ code: "KeyT", meta: true, control: false, alt: false, shift: true })).toBe("Shift+Command+T");
    expect(toAccelerator({ code: "Digit5", meta: false, control: true, alt: true, shift: false })).toBe("Control+Alt+5");
    expect(toAccelerator({ code: "BracketLeft", meta: true, control: false, alt: false, shift: false })).toBe("Command+[");
    expect(toAccelerator({ code: "F5", meta: false, control: false, alt: false, shift: false })).toBe("F5");
    expect(toAccelerator({ code: "ShiftLeft", meta: false, control: false, alt: false, shift: true })).toBeNull();
  });

  it("need a modifier, unless the key is a function key", () => {
    expect(isValidAccelerator("Command+T")).toBe(true);
    expect(isValidAccelerator("F5")).toBe(true);
    expect(isValidAccelerator("T")).toBe(false);
    expect(isValidAccelerator("Command+Foo")).toBe(false);
    expect(isValidAccelerator("Hyper+T")).toBe(false);
  });

  it("from a file keep only command paths with valid keys", () => {
    expect(checkShortcutOverrides({ "File › New Tab": "Command+Y", "View › Zoom": "", "nonsense": "Command+T", "File › Bad": "Q" })).toEqual({ "File › New Tab": "Command+Y", "View › Zoom": "" });
    expect(checkShortcutOverrides(["Command+T"])).toEqual({});
  });
});

describe("Bow's own menu", () => {
  it("has no two commands on the same keys, and none on macOS's own", () => {
    // Commands that do nothing; the ones that build a submenu build an empty one.
    const commands = new Proxy({}, { get: (_target, name) => (String(name).startsWith("build") ? () => [] : () => null) }) as AppMenuCommands;
    const template = buildDefaultMenuTemplate(commands);
    const seen = new Map<string, string>();
    const systemKeys = SYSTEM_ACCELERATORS.map((accelerator) => formatAccelerator(accelerator));
    const walk = (items: MenuItemConstructorOptions[], prefix: string): void => {
      for (const item of items) {
        const path = `${prefix} › ${item.label ?? item.role ?? ""}`;
        if (Array.isArray(item.submenu)) {
          walk(item.submenu, path);
          continue;
        }
        if (item.accelerator === undefined) {
          continue;
        }
        const keys = formatAccelerator(String(item.accelerator));
        expect(seen.get(keys), `${path} and ${seen.get(keys)} share ${keys}`).toBeUndefined();
        expect(systemKeys, path).not.toContain(keys);
        seen.set(keys, path);
      }
    };
    walk(template, "");
    expect(seen.size).toBeGreaterThan(30);
  });
});
