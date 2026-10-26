/**
 * WHY this file exists:
 *   Two small guards: the card and split-pane arithmetic (a mistake shows as overlapping or clipped pages), and the
 *   IPC action checks (a mistake lets a bad message from the sidebar reach the state).
 */
import { describe, expect, it } from "vitest";
import { parseAction } from "../src/main/ipc";
import { computeCardBounds, computePaneBounds } from "../src/main/layout";
import { CARD_GAP_PX, CARD_INSET_PX, DEVELOPER_TOOLBAR_HEIGHT_PX, SIDEBAR_WIDTH_PX, SPLIT_GAP_PX, TOOLBAR_HEIGHT_PX } from "../src/shared/settings";

describe("computeCardBounds", () => {
  it("places the page right of the sidebar, below the card's toolbar, inset like Arc's card", () => {
    const card = computeCardBounds(1280, 820, { isSidebarVisible: true, isToolbarVisible: true });

    expect(card).toEqual({
      x: SIDEBAR_WIDTH_PX + CARD_GAP_PX,
      y: CARD_INSET_PX + TOOLBAR_HEIGHT_PX,
      width: 1280 - SIDEBAR_WIDTH_PX - CARD_GAP_PX - CARD_INSET_PX,
      height: 820 - CARD_INSET_PX - TOOLBAR_HEIGHT_PX - CARD_INSET_PX,
    });
  });

  it("puts the page lower under Developer Mode's taller toolbar", () => {
    const card = computeCardBounds(1280, 820, { isSidebarVisible: true, isToolbarVisible: true, isDeveloperToolbar: true });

    expect(card.y).toBe(CARD_INSET_PX + DEVELOPER_TOOLBAR_HEIGHT_PX);
    expect(card.height).toBe(820 - CARD_INSET_PX - DEVELOPER_TOOLBAR_HEIGHT_PX - CARD_INSET_PX);
  });

  it("slides the card right without resizing it while the hidden sidebar peeks", () => {
    const hidden = computeCardBounds(1280, 820, { isSidebarVisible: false, isToolbarVisible: true });
    const peeking = computeCardBounds(1280, 820, { isSidebarVisible: false, isToolbarVisible: true, isSidebarPeeking: true });

    expect(peeking.x).toBe(hidden.x + SIDEBAR_WIDTH_PX);
    expect(peeking.width).toBe(hidden.width);
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

  it("accepts Developer Mode's actions only with known tools, commands and plain site names", () => {
    expect(parseAction({ type: "setDeveloperMode", site: "example.com", isOn: true })).not.toBeNull();
    expect(parseAction({ type: "setDeveloperMode", site: "Example.com/<x>", isOn: true })).toBeNull();
    expect(parseAction({ type: "openDeveloperTool", tool: "network" })).not.toBeNull();
    expect(parseAction({ type: "openDeveloperTool", tool: "sources" })).toBeNull();
    expect(parseAction({ type: "runSiteCommand", command: "capture" })).not.toBeNull();
    expect(parseAction({ type: "runSiteCommand", command: "clearSiteData" })).toBeNull();
    expect(parseAction({ type: "navigate", command: "emptyCacheAndReload" })).not.toBeNull();
    expect(parseAction({ type: "showMenu", request: { menu: "reload" } })).not.toBeNull();
  });

  it("checks the import source, the Boost editor's site and the sound switch", () => {
    expect(parseAction({ type: "importFromBrowser", sourceId: "chromium:chrome:Profile 2" })).not.toBeNull();
    expect(parseAction({ type: "importFromBrowser", sourceId: "chromium:chrome:../../etc" })).toBeNull();
    expect(parseAction({ type: "openBoostEditor" })).not.toBeNull();
    expect(parseAction({ type: "openBoostEditor", site: "example.com" })).not.toBeNull();
    expect(parseAction({ type: "openBoostEditor", site: "<script>" })).toBeNull();
    expect(parseAction({ type: "setSoundEffects", isOn: "yes" })).toBeNull();
  });

  it("refuses theme colors that are not plain hex, because they end up in CSS", () => {
    const badTheme = { colors: ["red; background: url(https://evil.example)"], appearance: "auto", grain: 0 };
    const goodTheme = { colors: ["#112233", "#445566"], appearance: "dark", grain: 0.5 };

    expect(parseAction({ type: "setSpaceTheme", spaceId: "space-work", theme: badTheme })).toBeNull();
    expect(parseAction({ type: "setSpaceTheme", spaceId: "space-work", theme: goodTheme })).not.toBeNull();
  });
});
