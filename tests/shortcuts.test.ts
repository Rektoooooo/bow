// Help › Keyboard Shortcuts shows the menu's accelerators the way macOS's menus do.
import { describe, expect, it } from "vitest";
import { formatAccelerator } from "../src/shared/shortcuts";

describe("formatAccelerator", () => {
  it("puts modifiers in macOS's order, ⌃ ⌥ ⇧ ⌘, whatever order the menu wrote them in", () => {
    expect(formatAccelerator("CommandOrControl+Shift+T")).toBe("⇧⌘T");
    expect(formatAccelerator("CommandOrControl+Shift+Alt+C")).toBe("⌥⇧⌘C");
    expect(formatAccelerator("Control+Shift+=")).toBe("⌃⇧=");
  });

  it("shows arrows, Tab and Plus as symbols and letters in capitals", () => {
    expect(formatAccelerator("CommandOrControl+Alt+Down")).toBe("⌥⌘↓");
    expect(formatAccelerator("Control+Tab")).toBe("⌃⇥");
    expect(formatAccelerator("CommandOrControl+Plus")).toBe("⌘+");
    expect(formatAccelerator("CommandOrControl+,")).toBe("⌘,");
    expect(formatAccelerator("CommandOrControl+l")).toBe("⌘L");
  });
});
