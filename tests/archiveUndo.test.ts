// Undo after the sweep or Clear: the tabs go back where they were, in order, with the selection they had.
import { describe, expect, it } from "vitest";
import { captureArchiveBatch, undoArchiveBatch } from "../src/main/archiveUndo";
import { splitTabs } from "../src/main/split";
import { clearTodayTabs, listClearableTodayTabIds, moveTabsToArchive, restoreArchivedTab, setTabNeverArchived } from "../src/main/state";
import type { BrowserState, ItemId } from "../src/shared/types";
import { getTodayIds, ONE_PM, openTabs } from "./builders";

const LATER = ONE_PM + 60 * 60 * 1000;

/** Clears the active Space the way the sidebar's Clear does, and notes the places first. */
function clearWithBatch(state: BrowserState) {
  const batch = captureArchiveBatch(state, listClearableTodayTabIds(state));
  return { batch: batch, cleared: clearTodayTabs(state, ONE_PM) };
}

describe("undoArchiveBatch", () => {
  it("puts cleared tabs back in their places, around the ones that stayed, and selects what was selected", () => {
    const { state: built, tabIds } = openTabs(["https://a.example/", "https://b.example/", "https://c.example/", "https://d.example/"]);
    const before = setTabNeverArchived(built, tabIds[2] as ItemId, true);
    const { batch, cleared } = clearWithBatch(before);
    expect(getTodayIds(cleared)).toEqual([tabIds[2]]);

    const undone = undoArchiveBatch(cleared, batch, LATER);

    expect(getTodayIds(undone)).toEqual(getTodayIds(before));
    expect(undone.selectedTabIdBySpace).toEqual(before.selectedTabIdBySpace);
    expect(undone.archive).toEqual(before.archive);
    expect(undone.items[tabIds[0] as ItemId]?.kind === "tab" && undone.items[tabIds[0] as ItemId]).toMatchObject({ lastActiveAt: LATER });
  });

  it("brings a split view's tabs back side by side as plain rows, and the rows after it in order", () => {
    const { state: built, tabIds } = openTabs(["https://a.example/", "https://b.example/", "https://c.example/", "https://d.example/"]);
    const split = splitTabs(built, tabIds[3] as ItemId, tabIds[2] as ItemId, ONE_PM);
    const before = setTabNeverArchived(split, tabIds[1] as ItemId, true);
    const orderBefore = getTodayIds(before).flatMap((rowId) => {
      const row = before.items[rowId];
      return row?.kind === "split" ? row.childIds : [rowId];
    });
    const { batch, cleared } = clearWithBatch(before);

    const undone = undoArchiveBatch(cleared, batch, LATER);

    expect(getTodayIds(undone)).toEqual(orderBefore);
  });

  it("skips tabs restored from the Library meanwhile, and changes nothing when none is left", () => {
    const { state: built, tabIds } = openTabs(["https://a.example/", "https://b.example/"]);
    const { batch, cleared } = clearWithBatch(built);
    const oneRestored = restoreArchivedTab(cleared, tabIds[0] as ItemId, LATER);

    const undone = undoArchiveBatch(oneRestored, batch, LATER);
    expect(getTodayIds(undone).filter((tabId) => tabId === tabIds[0])).toHaveLength(1);
    expect(getTodayIds(undone)).toContain(tabIds[1]);
    expect(undoArchiveBatch(undone, batch, LATER)).toBe(undone);
  });

  it("leaves out tabs that were not in Today (a closed pinned tab is not part of the batch)", () => {
    const { state: built, tabIds } = openTabs(["https://a.example/"]);
    const batch = captureArchiveBatch(built, [tabIds[0] as ItemId, "tab-elsewhere"]);
    expect(batch.places.map((place) => place.tabId)).toEqual([tabIds[0]]);
    const archived = moveTabsToArchive(built, [tabIds[0] as ItemId], ONE_PM, "auto");
    expect(getTodayIds(undoArchiveBatch(archived, batch, LATER))).toEqual(getTodayIds(built));
  });
});
