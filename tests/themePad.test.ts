/**
 * WHY this file exists:
 *   The theme editor's pad must put the user's black Space in the middle and give the same color back for a handle
 *   that is only redrawn (a drift would change a theme just by opening the editor).
 */
import { describe, expect, it } from "vitest";
import { colorAtPadPoint, padPointOfColor } from "../src/shared/themePad";

describe("theme pad", () => {
  it("has black in the middle and full red at the top", () => {
    expect(colorAtPadPoint({ x: 0, y: 0 })).toBe("#000000");
    expect(colorAtPadPoint({ x: 0, y: -1 })).toBe("#ff0000");
  });

  it("counts points beyond the edge as on the edge", () => {
    expect(colorAtPadPoint({ x: 0, y: -2 })).toBe("#ff0000");
  });

  it("goes clockwise through the hues: right of the top is yellow-green, the bottom cyan", () => {
    expect(colorAtPadPoint({ x: 0, y: 1 })).toBe("#00ffff");
    expect(colorAtPadPoint({ x: 1, y: 0 })).toBe("#80ff00");
  });

  it("places a color's handle where the same color comes back", () => {
    for (const color of ["#000000", "#ff0000", "#3a7a26", "#5a9fba", "#9a6591"]) {
      const roundTrip = colorAtPadPoint(padPointOfColor(color));
      const point = padPointOfColor(roundTrip);
      expect(colorAtPadPoint(point)).toBe(roundTrip);
    }
    expect(padPointOfColor("#000000")).toEqual({ x: 0, y: 0 });
  });
});
