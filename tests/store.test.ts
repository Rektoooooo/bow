/**
 * WHY this file exists:
 *   Upgrading the saved state rewrites the user's sidebar. These tests pin down that the file as it was before an
 *   upgrade stays next to it (an older Bow can open it again), and that an up-to-date file makes no copy.
 *
 * Data source:
 *   A temporary folder with state files built from createInitialState().
 *
 * Data flow:
 *   file on disk → loadState() → upgraded state + browser-state.version-<n>-<time>.json
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInitialState } from "../src/main/state";
import { loadState } from "../src/main/store";

const NOW = 1_800_000_000_000;

let folder = "";

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "store-test-"));
});

afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

/** A version 4 file: Favorites still on the profile. */
function writeVersion4File(filePath: string): string {
  const current = createInitialState();
  const spaces = current.spaces.map(({ favoriteIds: _favoriteIds, ...space }) => space);
  const profiles = current.profiles.map((profile) => ({ ...profile, favoriteIds: [] }));
  const fileText = JSON.stringify({ ...current, version: 4, spaces: spaces, profiles: profiles });
  fs.writeFileSync(filePath, fileText, "utf8");
  return fileText;
}

describe("loadState", () => {
  it("keeps the file as it was before an upgrade, next to it", () => {
    const filePath = path.join(folder, "browser-state.json");
    const originalText = writeVersion4File(filePath);
    const state = loadState(filePath, NOW);
    expect(state.version).toBe(5);
    const copyPath = path.join(folder, `browser-state.version-4-${NOW}.json`);
    expect(fs.existsSync(copyPath)).toBe(true);
    expect(fs.readFileSync(copyPath, "utf8")).toBe(originalText);
  });

  it("makes no copy for an up-to-date file", () => {
    const filePath = path.join(folder, "browser-state.json");
    fs.writeFileSync(filePath, JSON.stringify(createInitialState()), "utf8");
    loadState(filePath, NOW);
    const copies = fs.readdirSync(folder).filter((name) => name.startsWith("browser-state.version-"));
    expect(copies).toEqual([]);
  });
});
