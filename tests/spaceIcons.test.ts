/**
 * WHY this file exists:
 *   A Space's icon is stored as text that is either an emoji or "icon:<name>"; a wrong lookup would show "icon:star"
 *   in a menu, or nothing in the sidebar.
 */
import { describe, expect, it } from "vitest";
import { describeSpaceIconAsText, findSpaceIconChoice, SPACE_EMOJI_CHOICES, SPACE_ICON_CHOICES } from "../src/shared/spaceIcons";

describe("Space icons", () => {
  it("finds an icon by its name, and nothing for an emoji", () => {
    expect(findSpaceIconChoice("icon:star")?.symbol).toBe("star.fill");
    expect(findSpaceIconChoice("icon:planet")?.symbol).toBeNull();
    expect(findSpaceIconChoice("🏠")).toBeNull();
  });

  it("reads as an emoji in plain text, also for a name this version does not know", () => {
    expect(describeSpaceIconAsText("icon:planet")).toBe("🪐");
    expect(describeSpaceIconAsText("🏠")).toBe("🏠");
    expect(describeSpaceIconAsText("icon:from-a-newer-version")).toBe("✦");
  });

  it("offers full rows of eight, with unique names", () => {
    expect(SPACE_ICON_CHOICES.length % 8).toBe(0);
    expect(SPACE_EMOJI_CHOICES.length % 8).toBe(0);
    expect(new Set(SPACE_ICON_CHOICES.map((choice) => choice.name)).size).toBe(SPACE_ICON_CHOICES.length);
  });
});
