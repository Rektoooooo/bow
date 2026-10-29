import { describe, expect, it } from "vitest";
import type { AutofillItem } from "../src/shared/autofill";
import { POPUP_MAX_WIDTH_PX, POPUP_MIN_WIDTH_PX, POPUP_SIDE_MARGIN_PX, computePopupPlacement } from "../src/main/autofillPlacement";

const tabView = { x: 200, y: 80, width: 800, height: 600 };
const oneLogin: AutofillItem[] = [{ kind: "login", title: "alex@example.com" }];

describe("computePopupPlacement", () => {
  it("puts the list right below the field", () => {
    const placement = computePopupPlacement({ x: 20, y: 40, width: 300, height: 30 }, 1, tabView, oneLogin);
    expect(placement).not.toBeNull();
    expect(placement?.isAbove).toBe(false);
    expect(placement?.bounds.y).toBe(80 + 40 + 30);
    expect(placement?.bounds.x).toBe(200 + 20 - POPUP_SIDE_MARGIN_PX);
  });

  it("keeps the card between the minimum and maximum width", () => {
    const narrow = computePopupPlacement({ x: 20, y: 40, width: 50, height: 30 }, 1, tabView, oneLogin);
    const wide = computePopupPlacement({ x: 20, y: 40, width: 700, height: 30 }, 1, tabView, oneLogin);
    expect(narrow?.bounds.width).toBe(POPUP_MIN_WIDTH_PX + 2 * POPUP_SIDE_MARGIN_PX);
    expect(wide?.bounds.width).toBe(POPUP_MAX_WIDTH_PX + 2 * POPUP_SIDE_MARGIN_PX);
  });

  it("goes above the field when there is no room below", () => {
    const placement = computePopupPlacement({ x: 20, y: 540, width: 300, height: 30 }, 1, tabView, oneLogin);
    expect(placement?.isAbove).toBe(true);
    expect(placement?.bounds.y).toBeGreaterThanOrEqual(tabView.y);
    expect((placement?.bounds.y ?? 0) + (placement?.bounds.height ?? 0)).toBeLessThanOrEqual(80 + 540);
  });

  it("stays inside the tab's view horizontally", () => {
    const placement = computePopupPlacement({ x: 780, y: 40, width: 300, height: 30 }, 1, tabView, oneLogin);
    expect((placement?.bounds.x ?? 0) + (placement?.bounds.width ?? 0)).toBeLessThanOrEqual(tabView.x + tabView.width);
  });

  it("does not show a list for a field outside the view", () => {
    expect(computePopupPlacement({ x: 20, y: -500, width: 300, height: 30 }, 1, tabView, oneLogin)).toBeNull();
    expect(computePopupPlacement({ x: 5000, y: 40, width: 300, height: 30 }, 1, tabView, oneLogin)).toBeNull();
  });

  it("does not show a list that fits neither below nor above", () => {
    const manyLogins: AutofillItem[] = Array.from({ length: 8 }, () => ({ kind: "login", title: "a" }));
    const shortView = { x: 200, y: 80, width: 800, height: 200 };
    expect(computePopupPlacement({ x: 20, y: 90, width: 300, height: 30 }, 1, shortView, manyLogins)).toBeNull();
  });

  it("scales the field's place with the page zoom", () => {
    const placement = computePopupPlacement({ x: 20, y: 40, width: 300, height: 30 }, 2, tabView, oneLogin);
    expect(placement?.bounds.y).toBe(80 + 80 + 60);
  });
});
