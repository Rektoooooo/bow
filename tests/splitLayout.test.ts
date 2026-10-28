// Split view layouts: sizes the user dragged, the 2×2 grid, and the dividers the sidebar page draws in the gaps.
import { describe, expect, it } from "vitest";
import { computePaneBounds, computeSplitDividers, equalPaneSizes, readPaneSizes, resizeSplit } from "../src/shared/splitLayout";
import { SPLIT_GAP_PX, SPLIT_MIN_PANE_PX } from "../src/shared/settings";

const card = { x: 100, y: 50, width: 1006, height: 806 };

describe("split layout", () => {
  it("sizes panes by the saved fractions, filling the card exactly", () => {
    const panes = computePaneBounds(card, 2, "horizontal", [0.3, 0.7]);
    expect(panes.map((pane) => pane.width)).toEqual([300, 700]);
    expect(panes[1]?.x).toBe(card.x + 300 + SPLIT_GAP_PX);
  });

  it("falls back to equal panes when saved sizes no longer fit", () => {
    expect(readPaneSizes("horizontal", [0.3, 0.7], 3)).toEqual(equalPaneSizes("horizontal", 3));
    expect(readPaneSizes("horizontal", [0.5, 0.9], 2)).toEqual([0.5, 0.5]);
    expect(readPaneSizes("vertical", [Number.NaN, 1], 2)).toEqual([0.5, 0.5]);
  });

  it("lays 4 panes in a 2×2 grid, and 3 with the third across the bottom", () => {
    const four = computePaneBounds(card, 4, "grid");
    expect(four.map((pane) => [pane.x, pane.y])).toEqual([
      [100, 50],
      [100 + 500 + SPLIT_GAP_PX, 50],
      [100, 50 + 400 + SPLIT_GAP_PX],
      [100 + 500 + SPLIT_GAP_PX, 50 + 400 + SPLIT_GAP_PX],
    ]);
    const three = computePaneBounds(card, 3, "grid");
    expect(three[2]).toEqual({ x: 100, y: 50 + 400 + SPLIT_GAP_PX, width: card.width, height: 400 });
  });

  it("a grid of two is just side by side", () => {
    expect(computePaneBounds(card, 2, "grid")).toEqual(computePaneBounds(card, 2, "horizontal"));
  });

  it("puts each divider in the gap between its panes", () => {
    const panes = computePaneBounds(card, 3, "horizontal", [0.2, 0.5, 0.3]);
    const dividers = computeSplitDividers(card, 3, "horizontal", [0.2, 0.5, 0.3]);
    expect(dividers.map((divider) => divider.rect.x)).toEqual([(panes[0]?.x ?? 0) + (panes[0]?.width ?? 0), (panes[1]?.x ?? 0) + (panes[1]?.width ?? 0)]);
    expect(computeSplitDividers(card, 4, "grid").map((divider) => divider.kind)).toEqual(["column", "row"]);
  });

  it("dragging a divider shares the two panes' space anew, never below the smallest pane", () => {
    const divider = computeSplitDividers(card, 2, "horizontal")[0];
    if (divider === undefined) {
      throw new Error("Test setup problem: no divider");
    }
    expect(resizeSplit(card, 2, "horizontal", undefined, divider, card.x + 300 + SPLIT_GAP_PX / 2, 0)).toEqual([0.3, 0.7]);
    const squeezed = resizeSplit(card, 2, "horizontal", undefined, divider, card.x + 10, 0);
    expect(squeezed[0]).toBeCloseTo(SPLIT_MIN_PANE_PX / 1000, 3);
    const total = squeezed.reduce((sum, size) => sum + size, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("dragging a grid line moves the whole column or row", () => {
    const column = computeSplitDividers(card, 4, "grid")[0];
    if (column === undefined) {
      throw new Error("Test setup problem: no divider");
    }
    expect(resizeSplit(card, 4, "grid", undefined, column, card.x + 250 + SPLIT_GAP_PX / 2, 0)).toEqual([0.25, 0.5]);
  });
});
