// Sharing Boosts as files: what goes in a file, and that an imported one is checked and arrives with JavaScript off.
import { describe, expect, it } from "vitest";
import { createBoostFile, parseBoostFile } from "../src/main/boostFiles";
import { importBoost } from "../src/main/boosts";
import { createInitialState } from "../src/main/state";
import type { Boost } from "../src/shared/types";

const boost: Boost = {
  id: "boost-1",
  site: "news.example",
  css: "body { color: teal }",
  zappedSelectors: [".banner"],
  isEnabled: true,
  hueShift: 40,
  fontId: "serif",
  javascript: "document.title = 'boosted'",
  isJavaScriptOn: true,
};

describe("Boost files", () => {
  it("carry what a Boost changes, never whether its JavaScript was on", () => {
    const file = createBoostFile(boost);
    expect(file).toMatchObject({ format: "bow-boost", site: "news.example", css: boost.css, zappedSelectors: [".banner"], hueShift: 40, fontId: "serif", javascript: boost.javascript });
    expect(JSON.stringify(file)).not.toContain("isJavaScriptOn");
    expect(JSON.stringify(file)).not.toContain("boost-1");
  });

  it("read back with the JavaScript switched off", () => {
    const result = parseBoostFile(JSON.stringify(createBoostFile(boost)));
    expect(result.isValid).toBe(true);
    if (!result.isValid) {
      return;
    }
    expect(result.hasJavaScript).toBe(true);
    expect(result.boost.isJavaScriptOn).toBe(false);
    const state = importBoost(createInitialState(), result.boost, 1000);
    expect(state.boosts?.[0]).toMatchObject({ site: "news.example", isEnabled: true, isJavaScriptOn: false });
  });

  it("refuse other files, newer formats and damaged Boosts", () => {
    expect(parseBoostFile("not json").isValid).toBe(false);
    expect(parseBoostFile(JSON.stringify({ format: "bow-backup" })).isValid).toBe(false);
    expect(parseBoostFile(JSON.stringify({ ...createBoostFile(boost), formatVersion: 99 })).isValid).toBe(false);
    expect(parseBoostFile(JSON.stringify({ ...createBoostFile(boost), site: "javascript:alert(1)" })).isValid).toBe(false);
  });

  it("importing replaces the site's own Boost", () => {
    const withOld = { ...createInitialState(), boosts: [{ ...boost, css: "old" }] };
    const result = parseBoostFile(JSON.stringify(createBoostFile(boost)));
    if (!result.isValid) {
      throw new Error("Test setup problem");
    }
    const state = importBoost(withOld, result.boost, 1000);
    expect(state.boosts).toHaveLength(1);
    expect(state.boosts?.[0]?.css).toBe(boost.css);
  });
});
