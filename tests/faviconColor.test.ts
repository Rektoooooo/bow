/**
 * WHY this file exists:
 *   The selected Favorite's border takes the favicon's colour: a logo's colour must win over its white and black
 *   parts, transparent corners must not count, and a black-and-white icon must give no colour at all.
 */
import { describe, expect, it } from "vitest";
import { getFaviconAddress, getHexLuminance, pickAccentColor } from "../src/shared/faviconColor";

/** A BGRA bitmap (premultiplied, like macOS's) from a list of [red, green, blue, alpha] pixels. */
function makePixels(colors: [number, number, number, number][]): Uint8Array {
  const pixels = new Uint8Array(colors.length * 4);
  colors.forEach((color, index) => {
    const alpha = color[3];
    pixels[index * 4] = Math.round((color[2] * alpha) / 255);
    pixels[index * 4 + 1] = Math.round((color[1] * alpha) / 255);
    pixels[index * 4 + 2] = Math.round((color[0] * alpha) / 255);
    pixels[index * 4 + 3] = alpha;
  });
  return pixels;
}

function repeat(color: [number, number, number, number], count: number): [number, number, number, number][] {
  return Array.from({ length: count }, () => color);
}

describe("a favicon's colour", () => {
  it("is the logo's colour, not its white parts or its transparent corners", () => {
    const pixels = makePixels([...repeat([255, 0, 0, 255], 10), ...repeat([255, 255, 255, 255], 6), ...repeat([0, 0, 0, 0], 4)]);

    expect(pickAccentColor(pixels, 20, 1)).toBe("#ff0000");
  });

  it("is the most common colour when there are several", () => {
    const pixels = makePixels([...repeat([30, 215, 96, 255], 12), ...repeat([0, 0, 255, 255], 3)]);

    expect(pickAccentColor(pixels, 15, 1)).toBe("#1ed760");
  });

  it("reads half-transparent edge pixels by their real colour", () => {
    const pixels = makePixels(repeat([255, 0, 0, 160], 4));

    expect(pickAccentColor(pixels, 4, 1)).toBe("#ff0000");
  });

  it("is the logo's colour when the most common one is a black square behind it (X: 5 % white)", () => {
    const pixels = makePixels([...repeat([0, 0, 0, 255], 90), ...repeat([8, 8, 8, 255], 4), ...repeat([255, 255, 255, 255], 6)]);

    expect(pickAccentColor(pixels, 100, 1)).toBe("#ffffff");
  });

  it("is black for an all-black logo, and white for an all-white one: every icon gets a colour", () => {
    expect(pickAccentColor(makePixels(repeat([0, 0, 0, 255], 8)), 8, 1)).toBe("#000000");
    expect(pickAccentColor(makePixels([...repeat([255, 255, 255, 255], 8), ...repeat([0, 0, 0, 0], 8)]), 16, 1)).toBe("#ffffff");
  });

  it("is none only for an icon with nothing visible", () => {
    expect(pickAccentColor(makePixels(repeat([0, 0, 0, 0], 8)), 8, 1)).toBeNull();
  });
});

describe("a colour's brightness", () => {
  it("runs from 0 for black to 1 for white, green counting most", () => {
    expect(getHexLuminance("#000000")).toBe(0);
    expect(getHexLuminance("#ffffff")).toBeCloseTo(1);
    expect(getHexLuminance("#00ff00")).toBeGreaterThan(getHexLuminance("#ff0000"));
  });
});

describe("a favicon's address", () => {
  it("is the page's own icon, else the site's /favicon.ico, else none", () => {
    expect(getFaviconAddress("https://cdn.example/icon.png", "https://example.com/a")).toBe("https://cdn.example/icon.png");
    expect(getFaviconAddress(null, "https://example.com/a/b")).toBe("https://example.com/favicon.ico");
    expect(getFaviconAddress(null, "about:blank")).toBeNull();
    expect(getFaviconAddress(null, "http://example.com/a")).toBe("https://example.com/favicon.ico");
    expect(getFaviconAddress(null, "http://localhost:3000/")).toBe("http://localhost:3000/favicon.ico");
  });
});
