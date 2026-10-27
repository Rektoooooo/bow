/**
 * WHY this file exists:
 *   Each main window keeps its own Space and selection while sharing one sidebar. A swap that loses or mixes up a
 *   window's choices would show the wrong page; a parked choice pointing at a closed tab would show nothing.
 */
import { describe, expect, it } from "vitest";
import { deleteSpace, switchSpace } from "../src/main/spaces";
import { closeTab, createInitialState, getSelectedTabId, selectTab } from "../src/main/state";
import { closeWindow, collectSelectedTabIdsOfAllWindows, focusWindow, listWindowIds, openWindow, projectStateForWindow, repairOtherWindows } from "../src/main/windows";
import { FIRST_WINDOW_ID, HOUR_MS } from "../src/shared/settings";
import { ONE_PM, openTabs, PERSONAL_SPACE_ID, WORK_SPACE_ID } from "./builders";

const TWO_PM = ONE_PM + 1 * HOUR_MS;
const SECOND_WINDOW_ID = "window-second";

/**
 * Two windows: the first selected tab B in Personal, then a second window opened and focused (nothing selected).
 */
function buildTwoWindows() {
  const built = openTabs(["https://a.example", "https://b.example"]);
  const twoWindows = openWindow(built.state, SECOND_WINDOW_ID);
  return { state: twoWindows, tabIds: built.tabIds };
}

describe("opening a window", () => {
  it("focuses the new window on the same Space with nothing selected, and parks the first window's choices", () => {
    const { state, tabIds } = buildTwoWindows();

    expect(state.focusedWindowId).toBe(SECOND_WINDOW_ID);
    expect(state.activeSpaceId).toBe(PERSONAL_SPACE_ID);
    expect(getSelectedTabId(state)).toBeNull();
    expect(state.otherWindows).toEqual([
      { id: FIRST_WINDOW_ID, activeSpaceId: PERSONAL_SPACE_ID, selectedTabIdBySpace: { [PERSONAL_SPACE_ID]: tabIds[1], [WORK_SPACE_ID]: null } },
    ]);
    expect(listWindowIds(state)).toEqual([SECOND_WINDOW_ID, FIRST_WINDOW_ID]);
  });

  it("does nothing for an id that is already open", () => {
    const { state } = buildTwoWindows();

    expect(openWindow(state, FIRST_WINDOW_ID)).toBe(state);
    expect(openWindow(state, SECOND_WINDOW_ID)).toBe(state);
  });
});

describe("focusing a window", () => {
  it("swaps the windows' Spaces and selections without touching tabs", () => {
    const { state, tabIds } = buildTwoWindows();
    const secondOnWork = switchSpace(state, WORK_SPACE_ID, TWO_PM);

    const firstFocused = focusWindow(secondOnWork, FIRST_WINDOW_ID);

    expect(firstFocused.focusedWindowId).toBe(FIRST_WINDOW_ID);
    expect(firstFocused.activeSpaceId).toBe(PERSONAL_SPACE_ID);
    expect(getSelectedTabId(firstFocused)).toBe(tabIds[1]);
    expect(firstFocused.otherWindows[0]).toMatchObject({ id: SECOND_WINDOW_ID, activeSpaceId: WORK_SPACE_ID });
    expect(firstFocused.items).toBe(secondOnWork.items);
  });

  it("returns to the same choices after focusing back", () => {
    const { state } = buildTwoWindows();

    const roundTrip = focusWindow(focusWindow(state, FIRST_WINDOW_ID), SECOND_WINDOW_ID);

    expect(roundTrip.activeSpaceId).toBe(state.activeSpaceId);
    expect(roundTrip.selectedTabIdBySpace).toEqual(state.selectedTabIdBySpace);
    expect(roundTrip.otherWindows).toEqual(state.otherWindows);
  });

  it("does nothing for the focused window or an unknown one", () => {
    const { state } = buildTwoWindows();

    expect(focusWindow(state, SECOND_WINDOW_ID)).toBe(state);
    expect(focusWindow(state, "window-unknown")).toBe(state);
  });
});

describe("projecting the state for one window", () => {
  it("shows a parked window's Space and selection and leaves the focused window's state as it is", () => {
    const { state, tabIds } = buildTwoWindows();
    const secondOnWork = switchSpace(state, WORK_SPACE_ID, TWO_PM);

    const firstWindowView = projectStateForWindow(secondOnWork, FIRST_WINDOW_ID);

    expect(firstWindowView.activeSpaceId).toBe(PERSONAL_SPACE_ID);
    expect(getSelectedTabId(firstWindowView)).toBe(tabIds[1]);
    expect(projectStateForWindow(secondOnWork, SECOND_WINDOW_ID)).toBe(secondOnWork);
  });
});

describe("closing a window", () => {
  it("drops a parked window", () => {
    const { state } = buildTwoWindows();

    const closed = closeWindow(state, FIRST_WINDOW_ID);

    expect(listWindowIds(closed)).toEqual([SECOND_WINDOW_ID]);
    expect(closed.activeSpaceId).toBe(state.activeSpaceId);
  });

  it("hands the focus to the most recently focused other window when the focused one closes", () => {
    const { state, tabIds } = buildTwoWindows();

    const closed = closeWindow(state, SECOND_WINDOW_ID);

    expect(closed.focusedWindowId).toBe(FIRST_WINDOW_ID);
    expect(getSelectedTabId(closed)).toBe(tabIds[1]);
    expect(closed.otherWindows).toEqual([]);
  });

  it("keeps the last window, so the next start opens it again", () => {
    const state = createInitialState();

    expect(closeWindow(state, FIRST_WINDOW_ID)).toBe(state);
  });
});

describe("repairing parked windows", () => {
  it("replaces a parked selection whose tab was closed in the focused window", () => {
    const { state, tabIds } = buildTwoWindows();
    const closedInSecond = closeTab(state, tabIds[1] as string, TWO_PM);

    const repaired = repairOtherWindows(closedInSecond);

    expect(repaired.otherWindows[0]?.selectedTabIdBySpace[PERSONAL_SPACE_ID]).toBe(tabIds[0]);
  });

  it("moves a parked window off a deleted Space and forgets that Space's selection", () => {
    const built = openTabs(["https://a.example"]);
    const firstOnWork = switchSpace(built.state, WORK_SPACE_ID, ONE_PM);
    const twoWindows = switchSpace(openWindow(firstOnWork, SECOND_WINDOW_ID), PERSONAL_SPACE_ID, TWO_PM);
    const workDeleted = deleteSpace(twoWindows, WORK_SPACE_ID, TWO_PM);

    const repaired = repairOtherWindows(workDeleted);

    expect(repaired.otherWindows[0]?.activeSpaceId).toBe(PERSONAL_SPACE_ID);
    expect(Object.keys(repaired.otherWindows[0]?.selectedTabIdBySpace ?? {})).toEqual([PERSONAL_SPACE_ID]);
  });

  it("returns the same state when every parked choice is still valid", () => {
    const { state } = buildTwoWindows();

    expect(repairOtherWindows(state)).toBe(state);
  });
});

describe("selected tabs of all windows", () => {
  it("includes the tabs parked windows show", () => {
    const { state, tabIds } = buildTwoWindows();
    const secondSelectsA = selectTab(state, tabIds[0] as string, TWO_PM);

    const selected = collectSelectedTabIdsOfAllWindows(secondSelectsA);

    expect([...selected].sort()).toEqual([tabIds[0], tabIds[1]].sort());
  });
});
