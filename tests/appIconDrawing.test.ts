/**
 * WHY this file exists:
 *   The app icon variants share one drawing; these tests check that every variant has its own colors in it and that
 *   an unknown choice falls back to the bundled (classic) icon.
 */
import { describe, expect, it } from "vitest";
import { APP_ICON_VARIANTS, buildAppIconSvg, findAppIconVariant } from "../src/shared/appIconDrawing";

describe("app icon variants", () => {
  it("draw the same bow in each variant's colors", () => {
    for (const variant of APP_ICON_VARIANTS) {
      const svg = buildAppIconSvg(variant);
      expect(svg).toContain(variant.tile[0]);
      expect(svg).toContain(variant.bow[1]);
    }
  });

  it("fall back to the classic icon for an unknown or missing choice", () => {
    expect(findAppIconVariant("neon").id).toBe("classic");
    expect(findAppIconVariant(undefined).id).toBe("classic");
  });
});
