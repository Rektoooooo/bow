/**
 * WHY this file exists:
 *   The extension list decides what each profile's session loads; these tests pin down adding, replacing, turning
 *   off and removing, and that one profile's extensions never leak into another.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE_ID } from "../src/shared/settings";
import type { BrowserState, InstalledExtension } from "../src/shared/types";
import {
  addExtension,
  findExtension,
  getProfileExtensions,
  MAX_EXTENSIONS_PER_PROFILE,
  removeExtension,
  setExtensionEnabled,
} from "../src/main/extensionList";
import { createInitialState } from "../src/main/state";

const WORK_PROFILE_ID = "profile-work";

/** A made-up extension in the default profile. */
function makeExtension(id: string, changes: Partial<InstalledExtension> = {}): InstalledExtension {
  return { id: id, profileId: DEFAULT_PROFILE_ID, name: `Extension ${id}`, version: "1.0", path: `/extensions/${id}`, isEnabled: true, source: "unpacked", ...changes };
}

/** The initial state plus a second profile. */
function stateWithTwoProfiles(): BrowserState {
  const state = createInitialState();
  return { ...state, profiles: [...state.profiles, { id: WORK_PROFILE_ID, name: "Work", favoriteIds: [] }] };
}

describe("extension list", () => {
  it("keeps each profile's extensions apart", () => {
    const state = addExtension(addExtension(stateWithTwoProfiles(), makeExtension("aaaa")), makeExtension("bbbb", { profileId: WORK_PROFILE_ID }));

    expect(getProfileExtensions(state, DEFAULT_PROFILE_ID).map((extension) => extension.id)).toEqual(["aaaa"]);
    expect(getProfileExtensions(state, WORK_PROFILE_ID).map((extension) => extension.id)).toEqual(["bbbb"]);
    expect(findExtension(state, WORK_PROFILE_ID, "aaaa")).toBeUndefined();
  });

  it("replaces an extension added again (a new version) in place", () => {
    const first = addExtension(addExtension(createInitialState(), makeExtension("aaaa")), makeExtension("bbbb"));
    const updated = addExtension(first, makeExtension("aaaa", { version: "2.0" }));

    expect(getProfileExtensions(updated, DEFAULT_PROFILE_ID).map((extension) => `${extension.id} ${extension.version}`)).toEqual(["aaaa 2.0", "bbbb 1.0"]);
  });

  it("refuses unknown profiles and more than the limit", () => {
    const initial = createInitialState();
    expect(addExtension(initial, makeExtension("aaaa", { profileId: "profile-missing" }))).toBe(initial);

    let full = initial;
    for (let index = 0; index < MAX_EXTENSIONS_PER_PROFILE; index++) {
      full = addExtension(full, makeExtension(`id${index}`));
    }
    expect(addExtension(full, makeExtension("one-more"))).toBe(full);
  });

  it("turns extensions off and on, and removes them", () => {
    const state = addExtension(createInitialState(), makeExtension("aaaa"));
    const off = setExtensionEnabled(state, DEFAULT_PROFILE_ID, "aaaa", false);

    expect(findExtension(off, DEFAULT_PROFILE_ID, "aaaa")?.isEnabled).toBe(false);
    expect(setExtensionEnabled(off, DEFAULT_PROFILE_ID, "aaaa", false)).toBe(off);
    expect(removeExtension(off, DEFAULT_PROFILE_ID, "aaaa").extensions).toEqual([]);
    expect(removeExtension(off, DEFAULT_PROFILE_ID, "missing")).toBe(off);
  });
});
