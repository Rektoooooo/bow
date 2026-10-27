/**
 * WHY this file exists:
 *   The frame color is the first thing anyone compares with Arc; these tests pin the calibration (the user's black
 *   Space must come out as measured in their Arc: darker while the window is active) and how intensity and
 *   appearance change it.
 */
import { describe, expect, it } from "vitest";
import { computeFrameColor, computeFramePalette, isThemeDark } from "../src/shared/themePalette";

describe("frame palette", () => {
  it("renders a black theme at full intensity in dark mode as Arc does: #343434 in the background, #131313 active", () => {
    expect(computeFrameColor("#000000", 1, true)).toBe("#343434");
    expect(computeFrameColor("#000000", 1, true, true)).toBe("#131313");
  });

  it("leaves light frames the same in an active window (not measured in Arc)", () => {
    expect(computeFrameColor("#e9d8d4", 1, false, true)).toBe(computeFrameColor("#e9d8d4", 1, false, false));
  });

  it("matches Arc's saved dark palette for a colored theme (color × 0.37 per intensity, lifted)", () => {
    expect(computeFrameColor("#a6729d", 0.57, true)).toBe("#50474e");
  });

  it("shows a dark color as Arc's light grey in light mode instead of a black frame", () => {
    expect(computeFrameColor("#000000", 1, false)).toBe("#e6e6e6");
  });

  it("keeps a light theme's color at full intensity and fades it toward near-white below", () => {
    expect(computeFrameColor("#e9d8d4", 1, false)).toBe("#e9d8d4");
    expect(computeFrameColor("#e9d8d4", 0, false)).toBe("#f2e9e7");
    expect(computeFrameColor("#e9d8d4", undefined, false)).toBe("#e9d8d4");
  });

  it("follows the theme's appearance, and the system's for auto", () => {
    expect(isThemeDark({ colors: ["#000000"], appearance: "dark", grain: 0 }, false)).toBe(true);
    expect(isThemeDark({ colors: ["#000000"], appearance: "light", grain: 0 }, true)).toBe(false);
    expect(isThemeDark({ colors: ["#000000"], appearance: "auto", grain: 0 }, true)).toBe(true);
  });

  it("gives three gradient stops, repeating the last color, and falls back on bad colors", () => {
    const palette = computeFramePalette({ colors: ["#000000", "not-a-color"], appearance: "dark", grain: 0, intensity: 1 }, false);
    expect(palette.isDark).toBe(true);
    expect(palette.colors).toEqual(["#343434", "#5a5a5a", "#5a5a5a"]);
    expect(computeFramePalette({ colors: ["#000000"], appearance: "dark", grain: 0, intensity: 1 }, false, true).colors[0]).toBe("#131313");
  });
});
