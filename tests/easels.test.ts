/**
 * WHY this file exists:
 *   Easels are tabs with an address of our own; these tests pin down the address rules (the id names a file) and how
 *   a new easel is created.
 */
import { describe, expect, it } from "vitest";
import { createEaselUrl, getEaselId, isEaselUrl, NEW_EASEL_TITLE } from "../src/shared/easels";
import { createEasel, createInitialState, getSelectedTabId } from "../src/main/state";
import { findTab } from "../src/main/tree";
import { ONE_PM } from "./builders";

describe("easels", () => {
  it("have their own address, and only safe ids count", () => {
    expect(isEaselUrl(createEaselUrl("easel-1-2"))).toBe(true);
    expect(getEaselId("sidebar-easel:easel-1-2")).toBe("easel-1-2");
    expect(getEaselId("sidebar-easel:../x")).toBeNull();
  });

  it("open at the top of Today, selected, named New Easel", () => {
    const state = createEasel(createInitialState(), "easel-1-2", ONE_PM);
    const tab = findTab(state, getSelectedTabId(state)!)!;

    expect(tab.url).toBe("sidebar-easel:easel-1-2");
    expect(tab.title).toBe(NEW_EASEL_TITLE);
  });
});
