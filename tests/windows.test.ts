/**
 * WHY this file exists:
 *   Each main window keeps its own Space and selection while sharing one sidebar. A swap that loses or mixes up a
 *   window's choices would show the wrong page; a parked choice pointing at a closed tab would show nothing.
 */
import { describe, expect, it } from "vitest";
import { deleteSpace, switchSpace } from "../src/main/spaces";
import { closeTab, createFolder, createInitialState, deleteItem, getSelectedTabId, selectTab, setPinnedSectionOpen, setSidebarVisible, setSidebarWidth, toggleFolder } from "../src/main/state";
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
    expect(state.otherWindows).toMatchObject([
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

  it("keeps the last window, so the next start opens it again, and remembers its sidebar for new windows", () => {
    const state = createInitialState();

    const closed = closeWindow(state, FIRST_WINDOW_ID);

    expect(listWindowIds(closed)).toEqual([FIRST_WINDOW_ID]);
    expect(closed.newWindowSidebar).toEqual({ isSidebarVisible: true, sidebarWidth: undefined });
    expect(closeWindow(closed, FIRST_WINDOW_ID)).toBe(closed);
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

describe("each window's own sidebar, Pinned sections and folders (Arc's StorableWindows)", () => {
  it("hides the sidebar (⌘S) and sets its width in the focused window only", () => {
    const { state } = buildTwoWindows();
    const secondHidden = setSidebarWidth(setSidebarVisible(state, false), 300);

    const firstFocused = focusWindow(secondHidden, FIRST_WINDOW_ID);

    expect(firstFocused.settings.isSidebarVisible).toBe(true);
    expect(firstFocused.settings.sidebarWidth).toBeUndefined();
    expect(projectStateForWindow(firstFocused, SECOND_WINDOW_ID).settings).toMatchObject({ isSidebarVisible: false, sidebarWidth: 300 });
    expect(focusWindow(firstFocused, SECOND_WINDOW_ID).settings).toMatchObject({ isSidebarVisible: false, sidebarWidth: 300 });
  });

  it("collapses a Pinned section and closes a folder in the focused window only", () => {
    const withFolder = createFolder(openTabs(["https://a.example"]).state, "Folder", ONE_PM);
    const folderId = Object.values(withFolder.items).find((item) => item.kind === "folder")?.id as string;
    const twoWindows = openWindow(withFolder, SECOND_WINDOW_ID);
    const changedInSecond = toggleFolder(setPinnedSectionOpen(twoWindows, PERSONAL_SPACE_ID, false), folderId);

    const firstWindowView = projectStateForWindow(changedInSecond, FIRST_WINDOW_ID);
    const firstFocused = focusWindow(changedInSecond, FIRST_WINDOW_ID);

    expect(firstWindowView.spaces[0]?.isPinnedOpen).toBe(true);
    expect(firstWindowView.items[folderId]).toMatchObject({ isOpen: true });
    expect(firstFocused.items[folderId]).toMatchObject({ isOpen: true });
    expect(firstFocused.otherWindows[0]).toMatchObject({ id: SECOND_WINDOW_ID, collapsedPinnedSpaceIds: [PERSONAL_SPACE_ID], openFolderIds: [] });
    expect(changedInSecond.otherWindows[0]).toMatchObject({ collapsedPinnedSpaceIds: [], openFolderIds: [folderId] });
  });

  it("opens a new window with the sidebar of the last window closed, like Arc's sidebarViewPreferences", () => {
    const { state } = buildTwoWindows();
    const secondHidden = setSidebarWidth(setSidebarVisible(state, false), 320);
    const secondClosed = closeWindow(secondHidden, SECOND_WINDOW_ID);

    const thirdWindow = openWindow(secondClosed, "window-third");

    expect(secondClosed.newWindowSidebar).toEqual({ isSidebarVisible: false, sidebarWidth: 320 });
    expect(thirdWindow.settings).toMatchObject({ isSidebarVisible: false, sidebarWidth: 320 });
    expect(projectStateForWindow(thirdWindow, FIRST_WINDOW_ID).settings.isSidebarVisible).toBe(true);
  });

  it("opens a new window with the sidebar shown when no window was closed yet, whatever the focused one shows", () => {
    const hiddenFirst = setSidebarVisible(createInitialState(), false);

    const secondWindow = openWindow(hiddenFirst, SECOND_WINDOW_ID);

    expect(secondWindow.settings.isSidebarVisible).toBe(true);
    expect(secondWindow.otherWindows[0]).toMatchObject({ id: FIRST_WINDOW_ID, isSidebarVisible: false });
  });

  it("forgets deleted folders and Spaces in parked windows", () => {
    const withFolder = createFolder(openTabs(["https://a.example"]).state, "Folder", ONE_PM);
    const folderId = Object.values(withFolder.items).find((item) => item.kind === "folder")?.id as string;
    const collapsedWork = setPinnedSectionOpen(withFolder, WORK_SPACE_ID, false);
    const twoWindows = openWindow(collapsedWork, SECOND_WINDOW_ID);
    const deleted = deleteSpace(deleteItem(twoWindows, folderId, TWO_PM), WORK_SPACE_ID, TWO_PM);

    const repaired = repairOtherWindows(deleted);

    expect(repaired.otherWindows[0]).toMatchObject({ collapsedPinnedSpaceIds: [], openFolderIds: [] });
  });
});
