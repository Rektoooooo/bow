/**
 * WHY this file exists:
 *   Most tests need a state with a few tabs in known places. These builders make that short, so each test shows
 *   only what it is about.
 */
import { createInitialState, openTab, pinTab } from "../src/main/state";
import type { BrowserState, ItemId, TabItem } from "../src/shared/types";
import { findTab } from "../src/main/tree";

/** 2026-10-26 13:00 UTC, a fixed "now" so tests never depend on the clock. */
export const ONE_PM = Date.UTC(2026, 9, 26, 13, 0, 0);

/** The id of the first Space in createInitialState(). */
export const PERSONAL_SPACE_ID = "space-personal";

/** The id of the second Space in createInitialState(). */
export const WORK_SPACE_ID = "space-work";

/**
 * Returns the tab with this id, failing the test if it is missing, so checks can read its fields.
 */
export function getTab(state: BrowserState, tabId: ItemId): TabItem {
  const tab = findTab(state, tabId);
  if (tab === undefined) {
    throw new Error(`Test setup problem: tab ${tabId} is missing`);
  }
  return tab;
}

/**
 * Returns a Space's Today ids, failing the test if the Space is missing.
 */
export function getTodayIds(state: BrowserState, spaceId: ItemId = PERSONAL_SPACE_ID): ItemId[] {
  const space = state.spaces.find((candidate) => candidate.id === spaceId);
  if (space === undefined) {
    throw new Error(`Test setup problem: Space ${spaceId} is missing`);
  }
  return space.todayIds;
}

/**
 * Returns a Space's Pinned ids, failing the test if the Space is missing.
 */
export function getPinnedIds(state: BrowserState, spaceId: ItemId = PERSONAL_SPACE_ID): ItemId[] {
  const space = state.spaces.find((candidate) => candidate.id === spaceId);
  if (space === undefined) {
    throw new Error(`Test setup problem: Space ${spaceId} is missing`);
  }
  return space.pinnedIds;
}

/** A state plus the ids of the tabs it was built with, in the order they were opened. */
export interface BuiltState {
  state: BrowserState;
  tabIds: ItemId[];
}

/**
 * Opens one Today tab per URL in the active Space, one hour apart starting at ONE_PM.
 * The last one opened is selected and sits at the top of Today.
 * Example: openTabs(["https://a.example", "https://b.example"]).tabIds → [idA, idB]; Today shows [B, A]
 */
export function openTabs(urls: string[], startState: BrowserState = createInitialState()): BuiltState {
  let state = startState;
  const tabIds: ItemId[] = [];
  urls.forEach((url, index) => {
    const openedAt = ONE_PM + index * 60 * 60 * 1000;
    state = openTab(state, url, openedAt);
    const newTabId = getTodayIds(state, state.activeSpaceId)[0] as ItemId;
    tabIds.push(newTabId);
  });
  return { state: state, tabIds: tabIds };
}

/**
 * Opens tabs and pins them all, in order.
 */
export function openPinnedTabs(urls: string[], startState: BrowserState = createInitialState()): BuiltState {
  const built = openTabs(urls, startState);
  let state = built.state;
  for (const tabId of built.tabIds) {
    state = pinTab(state, tabId);
  }
  return { state: state, tabIds: built.tabIds };
}
