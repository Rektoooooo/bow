/**
 * WHY this file exists:
 *   The app icon variants share one drawing; these tests check that every variant has its own colors in it and that
 *   an unknown choice falls back to the bundled (classic) icon.
 */
import { describe, expect, it } from "vitest";
import { APP_ICON_VARIANTS, buildAppIconSvg, DEFAULT_APP_ICON_ID, findAppIconVariant } from "../src/shared/appIconDrawing";

describe("app icon variants", () => {
  it("draw the bow in each variant's colors, whatever its style", () => {
    for (const variant of APP_ICON_VARIANTS) {
      const svg = buildAppIconSvg(variant);
      expect(svg).toContain(variant.tile[0]);
      expect(svg).toContain(variant.bow[1]);
    }
  });

  it("fall back to the default icon (Glass) for an unknown, removed or missing choice", () => {
    // Midnight was a variant until the bow icon (2026-10-27); a saved choice of it now shows the default.
    expect(findAppIconVariant("midnight").id).toBe(DEFAULT_APP_ICON_ID);
    expect(findAppIconVariant(undefined).id).toBe("glass");
  });

  it("give Glass and Classic a dark twin that exists, and keep the twins out of the choices", () => {
    expect(findAppIconVariant(findAppIconVariant("glass").darkVariantId).id).toBe("glass-dark");
    expect(findAppIconVariant(findAppIconVariant("classic").darkVariantId).id).toBe("graphite");
    expect(APP_ICON_VARIANTS.map((variant) => variant.id)).toEqual(["glass", "classic", "graphite", "pixel"]);
  });
});
