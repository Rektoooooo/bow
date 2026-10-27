import { describe, expect, it } from "vitest";
import { isRunningFromDiskImage } from "../src/main/appLocation";

describe("isRunningFromDiskImage", () => {
  it("is true for Bow opened from its mounted disk image", () => {
    expect(isRunningFromDiskImage("/Volumes/Bow/Bow.app/Contents/MacOS/Bow")).toBe(true);
  });

  it("is true for macOS's translocated copy of a downloaded app", () => {
    const translocatedPath = "/private/var/folders/xy/abc123/T/AppTranslocation/0F1E2D3C/d/Bow.app/Contents/MacOS/Bow";
    expect(isRunningFromDiskImage(translocatedPath)).toBe(true);
  });

  it("is false for Bow in Applications", () => {
    expect(isRunningFromDiskImage("/Applications/Bow.app/Contents/MacOS/Bow")).toBe(false);
  });

  it("is false for a copy built and kept in the user's own folders", () => {
    expect(isRunningFromDiskImage("/Users/someone/Developer/bow/release/Bow-darwin-arm64/Bow.app/Contents/MacOS/Bow")).toBe(false);
  });
});
