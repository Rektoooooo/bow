/**
 * WHY this file exists:
 *   The onboarding's rules without a screen: keys must never step past its first or last scene, an import's card must
 *   say in one line only what arrived, and the wash must always get three colors (Bow's own until a look is picked).
 */
import { describe, expect, it } from "vitest";
import { BOW_WASH_COLORS, ONBOARDING_SCENES, describeImportSummary, formatCount, pickWashColors, stepScene, vividWashColor } from "../src/shared/onboarding";

describe("onboarding scenes", () => {
  it("has six scenes, from hello to ready", () => {
    expect(ONBOARDING_SCENES).toEqual(["hello", "import", "look", "essentials", "defaults", "ready"]);
  });

  it("steps forward and back inside the scenes", () => {
    expect(stepScene(0, 1, 6)).toBe(1);
    expect(stepScene(3, -1, 6)).toBe(2);
    expect(stepScene(0, -1, 6)).toBe(0);
    expect(stepScene(5, 1, 6)).toBe(5);
  });
});

describe("import summary", () => {
  it("counts with the right noun and groups thousands", () => {
    expect(formatCount(1, "tab")).toBe("1 tab");
    expect(formatCount(0, "tab")).toBe("0 tabs");
    expect(formatCount(2341, "page")).toBe("2,341 pages");
  });

  it("says only what an Arc import brought", () => {
    expect(describeImportSummary({ spaces: 4, tabs: 120, bookmarks: 0, historyPages: 2341 })).toBe("4 Spaces · 120 tabs · 2,341 pages of history");
    expect(describeImportSummary({ spaces: 1, tabs: 1, bookmarks: 0, historyPages: 1 })).toBe("1 Space · 1 tab · 1 page of history");
  });

  it("says what a browser import brought", () => {
    expect(describeImportSummary({ spaces: 0, tabs: 0, bookmarks: 312, historyPages: 0 })).toBe("312 bookmarks");
  });

  it("says when nothing new arrived", () => {
    expect(describeImportSummary({ spaces: 0, tabs: 0, bookmarks: 0, historyPages: 0 })).toBe("Nothing new to bring over");
  });
});

describe("wash colors", () => {
  it("are Bow's own without a theme color", () => {
    expect(pickWashColors([])).toEqual(BOW_WASH_COLORS);
  });

  it("repeat a one-color theme and fill a two-color one", () => {
    expect(pickWashColors(["#cfe0f4"])).toEqual(["#cfe0f4", "#cfe0f4", "#cfe0f4"]);
    expect(pickWashColors(["#f3d5d3", "#e8c6dc"])).toEqual(["#f3d5d3", "#e8c6dc", "#f3d5d3"]);
    expect(pickWashColors(["#111111", "#222222", "#333333"])).toEqual(["#111111", "#222222", "#333333"]);
  });
});

describe("vivid wash colors", () => {
  it("keeps a color's hue but makes it glow on a light scene", () => {
    // Sky (#cfe0f4) is a pale blue: it stays blue, with more color and a little darker.
    expect(vividWashColor("#cfe0f4", false)).toBe("#9bbfe8");
  });

  it("lifts a deep color so it glows on a dark scene", () => {
    // Midnight's navy (#1f2b47) becomes a lit navy instead of vanishing on the dark background.
    expect(vividWashColor("#1f2b47", true)).toBe("#2e57b8");
  });

  it("leaves greys grey (only lighter or darker)", () => {
    const grey = vividWashColor("#3a3a3c", true);
    expect(grey.slice(1, 3)).toBe(grey.slice(3, 5));
  });

  it("returns something that is not a color unchanged", () => {
    expect(vividWashColor("red", true)).toBe("red");
  });
});
