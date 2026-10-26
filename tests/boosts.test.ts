/**
 * WHY this file exists:
 *   Boosts change how sites look; these tests pin down which pages a Boost reaches and what CSS it produces.
 */
import { describe, expect, it } from "vitest";
import { addZappedSelector, buildBoostCss, deleteBoost, findBoostForUrl, MAX_BOOST_CSS_LENGTH, setBoostCss, setBoostEnabled } from "../src/main/boosts";
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
