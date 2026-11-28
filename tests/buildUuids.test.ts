/**
 * WHY this file exists:
 *   Packaging gives Electron's executables build UUIDs of their own (tools/build-uuids.mjs), because macOS's Local
 *   Network privacy tracks programs by that UUID. These tests pin down where the UUID is found in a Mach-O, that only
 *   those 16 bytes change, that the UUID is stable per build and differs per executable and version, and that
 *   anything but a thin 64-bit Mach-O stops packaging.
 */
import { describe, expect, it } from "vitest";
import { deriveUuid, findUuidOffset, formatUuid, replaceUuid } from "../tools/build-uuids.mjs";

/** A minimal thin 64-bit Mach-O: the header, one other load command, then LC_UUID. */
function makeExecutable(uuidHex: string): Buffer {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(2, 16);
  header.writeUInt32LE(24 + 24, 20);
  const otherCommand = Buffer.alloc(24);
  otherCommand.writeUInt32LE(0x19, 0);
  otherCommand.writeUInt32LE(24, 4);
  const uuidCommand = Buffer.alloc(24);
  uuidCommand.writeUInt32LE(0x1b, 0);
  uuidCommand.writeUInt32LE(24, 4);
  Buffer.from(uuidHex, "hex").copy(uuidCommand, 8);
  const code = Buffer.from("rest of the program");
  return Buffer.concat([header, otherCommand, uuidCommand, code]);
}

const ELECTRON_UUID = "4c4c44aa55553144a1ed37cd3f6b77d3";
const BUNDLE_ID = "io.github.rektoooooo.sidebar-browser";

describe("build UUIDs of our own", () => {
  it("finds LC_UUID after the other load commands", () => {
    const executable = makeExecutable(ELECTRON_UUID);
    const offset = findUuidOffset(executable);
    expect(offset).toBe(32 + 24 + 8);
    expect(formatUuid(executable.subarray(offset, offset + 16))).toBe("4C4C44AA-5555-3144-A1ED-37CD3F6B77D3");
  });

  it("changes only the 16 UUID bytes, in a copy", () => {
    const executable = makeExecutable(ELECTRON_UUID);
    const newUuid = deriveUuid(BUNDLE_ID, "0.2.2", "44.9.3", "arm64", "release", "Electron");
    const changed = replaceUuid(executable, newUuid);
    const offset = findUuidOffset(executable);
    expect(changed.subarray(offset, offset + 16).equals(newUuid)).toBe(true);
    expect(changed.subarray(0, offset).equals(executable.subarray(0, offset))).toBe(true);
    expect(changed.subarray(offset + 16).equals(executable.subarray(offset + 16))).toBe(true);
    expect(executable.subarray(offset, offset + 16).toString("hex")).toBe(ELECTRON_UUID);
  });

  it("gives the same build the same UUIDs, and each executable and version its own", () => {
    const main = deriveUuid(BUNDLE_ID, "0.2.2", "44.9.3", "arm64", "release", "Electron");
    expect(deriveUuid(BUNDLE_ID, "0.2.2", "44.9.3", "arm64", "release", "Electron").equals(main)).toBe(true);
    expect(deriveUuid(BUNDLE_ID, "0.2.2", "44.9.3", "arm64", "release", "Electron Helper").equals(main)).toBe(false);
    expect(deriveUuid(BUNDLE_ID, "0.2.3", "44.9.3", "arm64", "release", "Electron").equals(main)).toBe(false);
    expect(deriveUuid(BUNDLE_ID, "0.2.2", "45.0.0", "arm64", "release", "Electron").equals(main)).toBe(false);
    expect(deriveUuid(BUNDLE_ID, "0.2.2", "44.9.3", "x64", "release", "Electron").equals(main)).toBe(false);
    // A local ad-hoc package never shares UUIDs with the installed release of the same version.
    expect(deriveUuid(BUNDLE_ID, "0.2.2", "44.9.3", "arm64", "local", "Electron").equals(main)).toBe(false);
    expect(main.length).toBe(16);
    expect(main.toString("hex")).not.toBe(ELECTRON_UUID);
  });

  it("refuses a universal binary, another format or a Mach-O without LC_UUID", () => {
    const universal = Buffer.alloc(64);
    universal.writeUInt32BE(0xcafebabe, 0);
    expect(() => findUuidOffset(universal)).toThrow("not a thin 64-bit Mach-O");
    expect(() => findUuidOffset(Buffer.from("#!/bin/sh\n"))).toThrow("not a thin 64-bit Mach-O");
    const withoutUuid = Buffer.alloc(32);
    withoutUuid.writeUInt32LE(0xfeedfacf, 0);
    expect(() => findUuidOffset(withoutUuid)).toThrow("no LC_UUID");
  });

  it("refuses load commands that do not fit, instead of patching half or looping", () => {
    const zeroSized = makeExecutable(ELECTRON_UUID);
    zeroSized.writeUInt32LE(0, 32 + 4);
    expect(() => findUuidOffset(zeroSized)).toThrow("does not fit");
    const shortUuidCommand = makeExecutable(ELECTRON_UUID);
    shortUuidCommand.writeUInt32LE(16, 32 + 24 + 4);
    expect(() => findUuidOffset(shortUuidCommand)).toThrow("LC_UUID is too short");
    const cutOff = makeExecutable(ELECTRON_UUID).subarray(0, 32 + 24 + 12);
    expect(() => findUuidOffset(cutOff)).toThrow("do not fit in the executable");
  });
});
