/**
 * WHY this file exists:
 *   Spaces hold the user's work; deleting or moving between them must never lose a tab silently.
 */
import { describe, expect, it } from "vitest";
import {
  createSpace,
  deleteSpace,
  moveItemToSpace,
  moveSpace,
  renameSpace,
  SPACES_LIMIT,
  switchSpaceByNumber,
  switchSpaceByOffset,
} from "../src/main/spaces";
import { createInitialState, getSelectedTabId } from "../src/main/state";
import { HOUR_MS } from "../src/shared/settings";
import type { BrowserState, ItemId, SpaceTheme } from "../src/shared/types";
import { getPinnedIds, getTodayIds, ONE_PM, openPinnedTabs, openTabs, PERSONAL_SPACE_ID, WORK_SPACE_ID } from "./builders";

const TWO_PM = ONE_PM + 1 * HOUR_MS;
const THEME: SpaceTheme = { colors: ["#c8e6c9"], appearance: "auto", grain: 0.2 };

describe("switching Spaces", () => {
  it("moves by offset and stops at the ends", () => {
    const state = createInitialState();

    const next = switchSpaceByOffset(state, 1, ONE_PM);
    const pastTheEnd = switchSpaceByOffset(next, 1, TWO_PM);

    expect(next.activeSpaceId).toBe(WORK_SPACE_ID);
    expect(pastTheEnd).toBe(next);
  });

  it("jumps by number (⌃1 … ⌃9) and ignores numbers without a Space", () => {
    const state = createInitialState();

    expect(switchSpaceByNumber(state, 2, ONE_PM).activeSpaceId).toBe(WORK_SPACE_ID);
    expect(switchSpaceByNumber(state, 7, ONE_PM)).toBe(state);
  });
});

describe("createSpace / renameSpace / moveSpace", () => {
  it("adds a Space at the end with the active Space's profile and switches to it", () => {
    const state = createSpace(createInitialState(), { name: " Side project ", icon: "🚀", theme: THEME }, ONE_PM);

    const newSpace = state.spaces[2];
    expect(newSpace?.name).toBe("Side project");
    expect(newSpace?.profileId).toBe(state.spaces[0]?.profileId);
    expect(state.activeSpaceId).toBe(newSpace?.id);
    expect(state.selectedTabIdBySpace[newSpace?.id as string]).toBeNull();
  });

  it(`refuses more than ${SPACES_LIMIT} Spaces`, () => {
    let state = createInitialState();
    for (let count = 0; count < SPACES_LIMIT + 2; count++) {
      state = createSpace(state, { name: `Space ${count}`, icon: "", theme: THEME }, ONE_PM + count);
    }

    expect(state.spaces).toHaveLength(SPACES_LIMIT);
  });

  it("ignores an empty name and reorders Spaces", () => {
    const state = createInitialState();

    expect(renameSpace(state, PERSONAL_SPACE_ID, "   ")).toBe(state);
    expect(moveSpace(state, WORK_SPACE_ID, 0).spaces.map((space) => space.id)).toEqual([WORK_SPACE_ID, PERSONAL_SPACE_ID]);
  });
});

describe("deleteSpace", () => {
  it("archives the Space's tabs, removes it and activates its neighbour", () => {
    const { state: withPinned } = openPinnedTabs(["https://a.example"]);
    const { state: withToday } = openTabs(["https://b.example"], withPinned);

    const state = deleteSpace(withToday, PERSONAL_SPACE_ID, TWO_PM);

    expect(state.spaces.map((space) => space.id)).toEqual([WORK_SPACE_ID]);
    expect(state.activeSpaceId).toBe(WORK_SPACE_ID);
    expect(state.archive).toHaveLength(2);
    expect(Object.keys(state.items)).toEqual([]);
    expect(state.selectedTabIdBySpace[PERSONAL_SPACE_ID]).toBeUndefined();
  });

  it("never deletes the last Space", () => {
    const onlyOne = deleteSpace(createInitialState(), WORK_SPACE_ID, ONE_PM);

    expect(deleteSpace(onlyOne, PERSONAL_SPACE_ID, TWO_PM)).toBe(onlyOne);
  });
});

describe("moveItemToSpace", () => {
  it("keeps the section: a Pinned tab stays Pinned and a Today tab stays Today", () => {
    const { state: withPinned, tabIds: pinnedIds } = openPinnedTabs(["https://a.example"]);
    const { state: withToday, tabIds: todayIds } = openTabs(["https://b.example"], withPinned);

    const movedPinned = moveItemToSpace(withToday, pinnedIds[0] as ItemId, WORK_SPACE_ID);
    const state = moveItemToSpace(movedPinned, todayIds[0] as ItemId, WORK_SPACE_ID);

    expect(getPinnedIds(state, WORK_SPACE_ID)).toEqual(pinnedIds);
    expect(getTodayIds(state, WORK_SPACE_ID)).toEqual(todayIds);
    expect(getPinnedIds(state, PERSONAL_SPACE_ID)).toEqual([]);
  });

  it("moves the selection when the selected tab leaves the Space", () => {
    const { state: withTabs, tabIds } = openTabs(["https://a.example", "https://b.example"]);
    const selectedBefore: BrowserState = withTabs;

    const state = moveItemToSpace(selectedBefore, tabIds[1] as ItemId, WORK_SPACE_ID);

    expect(getSelectedTabId(state)).toBe(tabIds[0]);
  });
});
