/**
 * WHY this file exists:
 *   Boosts change how sites look; these tests pin down which pages a Boost reaches and what CSS it produces.
 */
import { describe, expect, it } from "vitest";
import {
  addZappedSelector,
  buildBoostCss,
  deleteBoost,
  findBoostForUrl,
  getBoostJavaScript,
  MAX_BOOST_CSS_LENGTH,
  setBoostCss,
  setBoostEnabled,
  setBoostJavaScript,
  setBoostStyle,
} from "../src/main/boosts";
import { createInitialState } from "../src/main/state";
import { ONE_PM } from "./builders";

describe("Boosts", () => {
  it("apply to every page of their site", () => {
    const state = setBoostCss(createInitialState(), "github.com", "body { color: red }", ONE_PM);

    expect(findBoostForUrl(state, "https://gist.github.com/x")?.css).toBe("body { color: red }");
    expect(findBoostForUrl(state, "https://example.com/")).toBeUndefined();
  });

  it("build the user's CSS plus a rule hiding zapped elements, and nothing while disabled", () => {
    const withCss = setBoostCss(createInitialState(), "example.com", "h1 { color: red }", ONE_PM);
    const withZaps = addZappedSelector(addZappedSelector(withCss, "example.com", "#ad", ONE_PM), "example.com", "div.banner", ONE_PM);
    const boost = findBoostForUrl(withZaps, "https://example.com/")!;
    const disabled = findBoostForUrl(setBoostEnabled(withZaps, "example.com", false), "https://example.com/")!;

    expect(buildBoostCss(boost)).toBe("h1 { color: red }\n#ad,\ndiv.banner { display: none !important; }");
    expect(buildBoostCss(disabled)).toBe("");
  });

  it("ignore duplicate zaps and overlong CSS, and can be deleted", () => {
    const zapped = addZappedSelector(createInitialState(), "example.com", "#ad", ONE_PM);

    expect(addZappedSelector(zapped, "example.com", "#ad", ONE_PM)).toBe(zapped);
    expect(setBoostCss(zapped, "example.com", "x".repeat(MAX_BOOST_CSS_LENGTH + 1), ONE_PM)).toBe(zapped);
    expect(deleteBoost(zapped, "example.com").boosts).toEqual([]);
  });
});

describe("Boost colors, fonts and JavaScript", () => {
  it("shift colors or invert the page while pictures keep theirs, and swap the font", () => {
    const styled = setBoostStyle(createInitialState(), "example.com", { hueShift: 120, isInverted: false, fontId: "serif" }, ONE_PM);
    const css = buildBoostCss(findBoostForUrl(styled, "https://example.com/")!);
    const inverted = setBoostStyle(styled, "example.com", { hueShift: 0, isInverted: true, fontId: "" }, ONE_PM);
    const invertedCss = buildBoostCss(findBoostForUrl(inverted, "https://example.com/")!);

    expect(css).toContain("html { filter: hue-rotate(120deg) !important; }");
    expect(css).toContain("img, video, picture, canvas, iframe, svg image { filter: hue-rotate(-120deg) !important; }");
    expect(css).toContain("ui-serif");
    expect(invertedCss).toContain("invert(1) hue-rotate(180deg)");
    expect(invertedCss).not.toContain("font-family");
  });

  it("keep shifts on the color wheel and ignore unknown fonts; nothing changes when nothing differs", () => {
    const styled = setBoostStyle(createInitialState(), "example.com", { hueShift: 999, isInverted: false, fontId: "comic" }, ONE_PM);
    const boost = findBoostForUrl(styled, "https://example.com/")!;

    expect(boost.hueShift).toBe(359);
    expect(boost.fontId).toBeUndefined();
    expect(setBoostStyle(styled, "example.com", { hueShift: 359, isInverted: false, fontId: "comic" }, ONE_PM)).toBe(styled);
  });

  it("run JavaScript only while it is switched on and the Boost is on", () => {
    const withScript = setBoostJavaScript(createInitialState(), "example.com", "document.title = 'x';", false, ONE_PM);
    const switchedOn = setBoostJavaScript(withScript, "example.com", "document.title = 'x';", true, ONE_PM);
    const boostOff = setBoostEnabled(switchedOn, "example.com", false);

    expect(getBoostJavaScript(findBoostForUrl(withScript, "https://example.com/")!)).toBe("");
    expect(getBoostJavaScript(findBoostForUrl(switchedOn, "https://example.com/")!)).toBe("document.title = 'x';");
    expect(getBoostJavaScript(findBoostForUrl(boostOff, "https://example.com/")!)).toBe("");
  });
});
