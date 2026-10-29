/**
 * WHY this file exists:
 *   The onboarding's rules without a screen: keys must never step past its first or last scene, a source's sentence
 *   must say only what it holds (numbers bold, no dashes), the browsers it lists must come in a steady order, and the
 *   wash must always get three colors (Bow's own until a look is picked).
 */
import { describe, expect, it } from "vitest";
import {
  BOW_WASH_COLORS,
  IMPORT_PART_LABELS,
  IMPORT_PART_ORDER,
  ONBOARDING_SCENES,
  SUPPORTED_BROWSERS,
  describeFound,
  describeImportProfilesButton,
  describePartCount,
  describeProfileCounts,
  describeProfilesDone,
  describeProfilesFound,
  formatCount,
  orderBrowsers,
  pickWashColors,
  profileNounFor,
  stepScene,
  swatchColor,
  vividWashColor,
} from "../src/shared/onboarding";
import type { ImportFound, WelcomeBrowser } from "../src/shared/onboarding";

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

describe("counts", () => {
  it("counts with the right noun and groups thousands", () => {
    expect(formatCount(1, "tab")).toBe("1 tab");
    expect(formatCount(0, "tab")).toBe("0 tabs");
    expect(formatCount(2341, "page")).toBe("2,341 pages");
  });
});

/** The sentence as the page shows it (the bold parts are only drawn differently). */
function sentenceText(found: ImportFound): string {
  return describeFound(found)
    .map((part) => part.text)
    .join("");
}

const ARC_FOUND: ImportFound = {
  parts: ["spaces", "favorites", "archive", "extensions", "history"],
  counts: { spaces: 3, favorites: 6, archive: 40, extensions: 4, history: 4812 },
  tabs: 25,
};

describe("what a source holds, in one sentence", () => {
  it("lists everything an Arc import found, the last part joined with 'and'", () => {
    expect(sentenceText(ARC_FOUND)).toBe("Found 3 Spaces with 25 tabs, 6 Favorites, 40 archived tabs, 4 extensions and 4,812 sites from your history.");
  });

  it("says what a browser holds", () => {
    const found: ImportFound = { parts: ["bookmarks", "history"], counts: { bookmarks: 214, history: 1 }, tabs: 0 };
    expect(sentenceText(found)).toBe("Found 214 bookmarks and 1 site from your history.");
  });

  it("says a single part without a list", () => {
    const found: ImportFound = { parts: ["history"], counts: { history: 12 }, tabs: 0 };
    expect(sentenceText(found)).toBe("Found 12 sites from your history.");
  });

  it("uses one noun for one", () => {
    const found: ImportFound = { parts: ["spaces"], counts: { spaces: 1 }, tabs: 1 };
    expect(sentenceText(found)).toBe("Found 1 Space with 1 tab.");
  });

  it("says when there is nothing new", () => {
    const found: ImportFound = { parts: [], counts: { bookmarks: 0, history: 0 }, tabs: 0 };
    expect(sentenceText(found)).toBe("Nothing new to bring over.");
  });

  it("makes the numbers and their nouns bold, the joining words plain", () => {
    const boldParts = describeFound(ARC_FOUND)
      .filter((part) => part.isBold)
      .map((part) => part.text);
    expect(boldParts).toEqual(["3 Spaces", "25 tabs", "6 Favorites", "40 archived tabs", "4 extensions", "4,812 sites"]);
  });

  it("never uses a dash", () => {
    const texts = [sentenceText(ARC_FOUND), ...IMPORT_PART_ORDER.map((part) => IMPORT_PART_LABELS[part].title), ...IMPORT_PART_ORDER.map((part) => describePartCount(part, ARC_FOUND))];
    for (const text of texts) {
      expect(text).not.toMatch(/[-\u2013\u2014]/);
    }
  });
});

describe("a browser with several profiles", () => {
  it("calls Dia's profiles spaces, the others' profiles", () => {
    expect(profileNounFor("dia")).toBe("space");
    expect(profileNounFor("chrome")).toBe("profile");
  });

  it("says how many it found and what the button brings", () => {
    expect(describeProfilesFound(4, "dia", "Dia")).toBe("Found 4 spaces in Dia.");
    expect(describeImportProfilesButton(4, 4, "dia")).toBe("Import all 4 spaces");
    expect(describeImportProfilesButton(3, 4, "dia")).toBe("Import 3 spaces");
    expect(describeImportProfilesButton(1, 2, "chrome")).toBe("Import 1 profile");
  });

  it("counts each profile in one line, and says when it is done", () => {
    expect(describeProfileCounts({ parts: ["bookmarks", "history"], counts: { bookmarks: 120, history: 1240 }, tabs: 0 })).toBe("120 bookmarks, 1,240 sites");
    expect(describeProfileCounts({ parts: ["bookmarks"], counts: { bookmarks: 1, history: 0 }, tabs: 0 })).toBe("1 bookmark");
    expect(describeProfileCounts({ parts: [], counts: {}, tabs: 0 })).toBe("Nothing new");
    expect(describeProfilesDone(4, "dia", "Dia")).toBe("Done. Your 4 spaces from Dia are in Bow.");
    expect(describeProfilesDone(1, "dia", "Dia")).toBe("Done. Your 1 space from Dia is in Bow.");
  });

  it("never uses a dash", () => {
    const texts = [describeProfilesFound(2, "brave", "Brave"), describeImportProfilesButton(2, 3, "edge"), describeProfilesDone(3, "vivaldi", "Vivaldi")];
    for (const text of texts) {
      expect(text).not.toMatch(/[-\u2013\u2014]/);
    }
  });
});

describe("the checklist", () => {
  it("counts each part under its name", () => {
    expect(describePartCount("spaces", ARC_FOUND)).toBe("3 Spaces, 25 tabs");
    expect(describePartCount("favorites", ARC_FOUND)).toBe("6 sites");
    expect(describePartCount("history", ARC_FOUND)).toBe("4,812 sites");
    expect(describePartCount("extensions", ARC_FOUND)).toBe("4 extensions");
  });
});

describe("the browsers", () => {
  it("lists every browser Bow imports from", () => {
    expect(SUPPORTED_BROWSERS.map((browser) => browser.id)).toEqual(["arc", "dia", "chrome", "safari", "firefox", "brave", "edge", "vivaldi", "opera", "chromium"]);
  });

  it("lists an even number, for two even rows of tiles", () => {
    expect(SUPPORTED_BROWSERS.length % 2).toBe(0);
  });

  it("puts the browsers with something to import first, each group in the usual order", () => {
    const browsers: WelcomeBrowser[] = SUPPORTED_BROWSERS.map((browser) => ({ ...browser, sources: [] }));
    const withSafari = browsers.map((browser) => (browser.id === "safari" || browser.id === "brave" ? { ...browser, sources: [{ id: browser.id, profileName: null }] } : browser));
    const ordered = orderBrowsers(withSafari).map((browser) => browser.id);
    expect(ordered).toEqual(["safari", "brave", "arc", "dia", "chrome", "firefox", "edge", "vivaldi", "opera", "chromium"]);
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

describe("swatch colors", () => {
  /** HSL lightness (0…1) of "#rrggbb". */
  const lightnessOf = (hex: string): number => {
    const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
    return (Math.max(...channels) + Math.min(...channels)) / 2;
  };

  it("draws a near-white preset clearly light, but visible", () => {
    const lightness = lightnessOf(swatchColor("#cfe0f4", false));
    expect(lightness).toBeGreaterThanOrEqual(0.69);
    expect(lightness).toBeLessThanOrEqual(0.79);
  });

  it("draws a near-black preset clearly dark, but never black", () => {
    const lightness = lightnessOf(swatchColor("#1f3a2e", true));
    expect(lightness).toBeGreaterThanOrEqual(0.33);
    expect(lightness).toBeLessThanOrEqual(0.43);
  });

  it("keeps greys grey and leaves what is not a color alone", () => {
    const grey = swatchColor("#3a3a3c", true);
    expect(grey.slice(1, 3)).toBe(grey.slice(3, 5));
    expect(swatchColor("red", false)).toBe("red");
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
