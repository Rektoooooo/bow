/**
 * WHY this file exists:
 *   Two small guards: the card and split-pane arithmetic (a mistake shows as overlapping or clipped pages), and the
 *   IPC action checks (a mistake lets a bad message from the sidebar reach the state).
 */
import { describe, expect, it } from "vitest";
import { parseAction } from "../src/main/ipc";
import { computeCardBounds, computePaneBounds } from "../src/main/layout";
import { CARD_INSET_PX, SIDEBAR_WIDTH_PX, SPLIT_GAP_PX, TOOLBAR_HEIGHT_PX } from "../src/shared/settings";

describe("computeCardBounds", () => {
  it("places the card right of the sidebar and below the toolbar", () => {
    const card = computeCardBounds(1280, 820, { isSidebarVisible: true, isToolbarVisible: true });

    expect(card).toEqual({
      x: SIDEBAR_WIDTH_PX + CARD_INSET_PX,
      y: TOOLBAR_HEIGHT_PX,
      width: 1280 - SIDEBAR_WIDTH_PX - 2 * CARD_INSET_PX,
      height: 820 - TOOLBAR_HEIGHT_PX - CARD_INSET_PX,
    });
  });

  it("fills the window when the sidebar is hidden, and never goes negative", () => {
    const card = computeCardBounds(1280, 820, { isSidebarVisible: false, isToolbarVisible: false });
    const tiny = computeCardBounds(10, 10, { isSidebarVisible: true, isToolbarVisible: true });

    expect(card.x).toBe(CARD_INSET_PX);
    expect(tiny.width).toBe(0);
    expect(tiny.height).toBe(0);
  });
});

describe("computePaneBounds", () => {
  const card = { x: 100, y: 40, width: 1000, height: 600 };

  it("splits side by side with a gap and fills the card exactly", () => {
    const panes = computePaneBounds(card, 3, "horizontal");

    const lastPane = panes[2];
    expect(panes).toHaveLength(3);
    expect(panes[1]?.x).toBe((panes[0]?.x ?? 0) + (panes[0]?.width ?? 0) + SPLIT_GAP_PX);
    expect((lastPane?.x ?? 0) + (lastPane?.width ?? 0)).toBe(card.x + card.width);
  });

  it("stacks panes for a vertical split", () => {
    const panes = computePaneBounds(card, 2, "vertical");

    expect(panes[0]?.width).toBe(card.width);
    expect(panes[1]?.y).toBe(card.y + (panes[0]?.height ?? 0) + SPLIT_GAP_PX);
  });
});

describe("parseAction", () => {
  it("accepts a well-formed action", () => {
    const action = { type: "moveItem", itemId: "tab-1", target: { kind: "today", spaceId: "space-work" }, index: 0 };

    expect(parseAction(action)).toEqual(action);
  });

  it("refuses unknown types, missing fields and wrong field types", () => {
    expect(parseAction({ type: "formatDisk" })).toBeNull();
    expect(parseAction({ type: "selectTab" })).toBeNull();
    expect(parseAction({ type: "selectTab", tabId: 42 })).toBeNull();
    expect(parseAction({ type: "moveItem", itemId: "tab-1", target: { kind: "elsewhere" }, index: 0 })).toBeNull();
    expect(parseAction("selectTab")).toBeNull();
  });

  it("refuses an archive threshold that is not one of the menu choices", () => {
    expect(parseAction({ type: "setArchiveAfter", archiveAfterMs: 0 })).toBeNull();
    expect(parseAction({ type: "setArchiveAfter", archiveAfterMs: null })).not.toBeNull();
  });

  it("refuses theme colors that are not plain hex, because they end up in CSS", () => {
    const badTheme = { colors: ["red; background: url(https://evil.example)"], appearance: "auto", grain: 0 };
    const goodTheme = { colors: ["#112233", "#445566"], appearance: "dark", grain: 0.5 };

    expect(parseAction({ type: "setSpaceTheme", spaceId: "space-work", theme: badTheme })).toBeNull();
    expect(parseAction({ type: "setSpaceTheme", spaceId: "space-work", theme: goodTheme })).not.toBeNull();
  });
});
