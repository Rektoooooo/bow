/**
 * WHY this file exists:
 *   bow:// addresses come from any app (and, after asking, web pages), so only the few harmless commands may come
 *   through. These tests pin down the commands, their parameters, the Space lookup, and that the Raycast scripts ask
 *   for addresses Bow understands.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { findSpaceByNameOrNumber, parseBowUrl } from "../src/main/bowUrls";
import { createInitialState } from "../src/main/state";
import { ONE_PM, PERSONAL_SPACE_ID, WORK_SPACE_ID } from "./builders";

describe("bow:// addresses", () => {
  it("read the five commands and their parameters", () => {
    expect(parseBowUrl("bow://open?url=github.com%2Fpulls&space=Work")).toEqual({ kind: "open", text: "github.com/pulls", spaceName: "Work" });
    expect(parseBowUrl("bow://open?url=best%20pizza")).toEqual({ kind: "open", text: "best pizza", spaceName: null });
    expect(parseBowUrl("bow://space?name=2")).toEqual({ kind: "switchSpace", spaceName: "2" });
    expect(parseBowUrl("bow://search-tabs?q=docs")).toEqual({ kind: "searchTabs", query: "docs" });
    expect(parseBowUrl("bow://command-bar?q=weather")).toEqual({ kind: "commandBar", text: "weather" });
    expect(parseBowUrl("bow://little")).toEqual({ kind: "little", text: null });
    expect(parseBowUrl("BOW://Space?name=Work")).toEqual({ kind: "switchSpace", spaceName: "Work" });
  });

  it("refuse anything else", () => {
    for (const address of ["bow://delete?all=1", "bow://open", "bow://open?url=", "bow://space", "https://example.com/", "bow-nonsense", `bow://open?url=${"a".repeat(5000)}`]) {
      expect(parseBowUrl(address), address).toBeNull();
    }
  });

  it("find a Space by its name, the start of it, or its number", () => {
    const state = createInitialState(ONE_PM);
    expect(findSpaceByNameOrNumber(state, "work")?.id).toBe(WORK_SPACE_ID);
    expect(findSpaceByNameOrNumber(state, "Pers")?.id).toBe(PERSONAL_SPACE_ID);
    expect(findSpaceByNameOrNumber(state, "2")?.id).toBe(state.spaces[1]?.id);
    expect(findSpaceByNameOrNumber(state, "9")).toBeNull();
    expect(findSpaceByNameOrNumber(state, "Holidays")).toBeNull();
  });

  it("the Raycast scripts ask for addresses Bow understands", () => {
    const folder = path.join(import.meta.dirname, "..", "integrations", "raycast");
    const scripts = fs.readdirSync(folder).filter((name) => name.endsWith(".sh"));
    expect(scripts.length).toBe(3);
    for (const script of scripts) {
      const text = fs.readFileSync(path.join(folder, script), "utf8");
      expect(text, script).toContain("@raycast.schemaVersion 1");
      const opened = /open "(bow:\/\/[^"]+)"/.exec(text)?.[1] ?? "";
      // The script's address with its parameters filled in, as encode() would.
      const filled = opened.replace(/\$\(encode "\$1"\)/g, "Work").replace(/\$\(encode "\$2"\)/g, "");
      expect(parseBowUrl(filled), script).not.toBeNull();
    }
  });
});
