// WHY this file exists:
//   Every Mach-O program carries a build UUID (its LC_UUID load command), and macOS's Local Network privacy tracks
//   programs by it: "If your main executable has no UUID, or shares a UUID with other programs, local network privacy
//   may behave weirdly" (Apple's TN3179). Bow's executables are Electron's prebuilt ones, renamed, so they had the
//   UUIDs of every app built on the same Electron version, among them the Electron.app that `npm start` and every e2e
//   run start (2026-11-28: that Electron was allowed on the local network, Bow was never asked, and pages on other
//   devices failed). The packager calls makeBuildUuidsOwn() right after it unpacks Electron, before anything is
//   renamed or signed, and each executable gets a UUID of its own.
//
// Data source:
//   The executables in the unpacked Electron.app (Contents/MacOS and each helper app's), Bow's bundle id and version.
//
// Data flow:
//   tools/package-mac.mjs afterExtract → makeBuildUuidsOwn(folder) → each executable: new UUID = SHA-256 of
//   bundle id, Bow and Electron versions, architecture, release or local build, and the executable's name (16 bytes)
//   → written in place → the packager renames and signs as before
//
// The UUID is derived, not random: packaging the same version twice gives the same UUIDs, and a new version or
// another Electron gives new ones, as a linker does for a new build.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** MH_MAGIC_64 (mach-o/loader.h): a 64-bit Mach-O of one architecture, as read little-endian. */
const MACH_HEADER_64_MAGIC = 0xfeedfacf;
/** The size of mach_header_64; load commands follow it. */
const MACH_HEADER_64_SIZE = 32;
/** Where mach_header_64 keeps ncmds (the number of load commands) and sizeofcmds (their bytes together). */
const LOAD_COMMAND_COUNT_OFFSET = 16;
const LOAD_COMMANDS_SIZE_OFFSET = 20;
/** Every load command starts with cmd (its kind) and cmdsize (its bytes), 4 bytes each. */
const COMMAND_SIZE_OFFSET_IN_COMMAND = 4;
const SMALLEST_COMMAND_SIZE = 8;
/** LC_UUID (mach-o/loader.h): a uuid_command of 24 bytes, whose 16 UUID bytes follow cmd and cmdsize. */
const UUID_LOAD_COMMAND = 0x1b;
const UUID_COMMAND_SIZE = 24;
const UUID_OFFSET_IN_COMMAND = 8;
const UUID_LENGTH = 16;

/**
 * Where the 16 UUID bytes are in a thin 64-bit Mach-O. Throws for anything else (a universal binary, another
 * format, no LC_UUID, load commands that do not fit), so packaging stops instead of signing an executable that still
 * shares Electron's UUID or was patched half.
 */
export function findUuidOffset(executable) {
  if (executable.length < MACH_HEADER_64_SIZE || executable.readUInt32LE(0) !== MACH_HEADER_64_MAGIC) {
    throw new Error("not a thin 64-bit Mach-O executable");
  }
  const commandCount = executable.readUInt32LE(LOAD_COMMAND_COUNT_OFFSET);
  const commandsEnd = MACH_HEADER_64_SIZE + executable.readUInt32LE(LOAD_COMMANDS_SIZE_OFFSET);
  if (commandsEnd > executable.length) {
    throw new Error("the load commands do not fit in the executable");
  }
  let commandOffset = MACH_HEADER_64_SIZE;
  for (let commandIndex = 0; commandIndex < commandCount; commandIndex++) {
    if (commandOffset + SMALLEST_COMMAND_SIZE > commandsEnd) {
      throw new Error("a load command runs past the load commands");
    }
    const command = executable.readUInt32LE(commandOffset);
    const commandSize = executable.readUInt32LE(commandOffset + COMMAND_SIZE_OFFSET_IN_COMMAND);
    if (commandSize < SMALLEST_COMMAND_SIZE || commandOffset + commandSize > commandsEnd) {
      throw new Error("a load command has a size that does not fit");
    }
    if (command === UUID_LOAD_COMMAND) {
      if (commandSize < UUID_COMMAND_SIZE) {
        throw new Error("LC_UUID is too short");
      }
      return commandOffset + UUID_OFFSET_IN_COMMAND;
    }
    commandOffset = commandOffset + commandSize;
  }
  throw new Error("the executable has no LC_UUID");
}

/** The UUID as macOS writes it ("4C4C44AA-5555-3144-A1ED-37CD3F6B77D3"), for logs and tests. */
export function formatUuid(uuidBytes) {
  const hex = uuidBytes.toString("hex").toUpperCase();
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
}

/**
 * The UUID for one executable of one build: the first 16 bytes of a SHA-256 of what identifies it. The build kind
 * ("release" or "local") keeps an ad-hoc package apart from the signed release of the same version, which may be
 * installed on the same Mac.
 */
export function deriveUuid(bundleId, appVersion, electronVersion, architecture, buildKind, executableName) {
  const identity = [bundleId, appVersion, electronVersion, architecture, buildKind, executableName].join("\n");
  const digest = crypto.createHash("sha256").update(identity).digest();
  return digest.subarray(0, UUID_LENGTH);
}

/** The executable with its UUID replaced (a copy; the input stays as it was). */
export function replaceUuid(executable, uuidBytes) {
  const uuidOffset = findUuidOffset(executable);
  const changed = Buffer.from(executable);
  uuidBytes.copy(changed, uuidOffset);
  return changed;
}

/** Contents/MacOS/<app> and Contents/Frameworks/<helper>.app/Contents/MacOS/<helper> in an unpacked app. */
function listAppExecutables(appPath) {
  const executables = [];
  const mainFolder = path.join(appPath, "Contents", "MacOS");
  for (const name of fs.readdirSync(mainFolder)) {
    executables.push(path.join(mainFolder, name));
  }
  const frameworksFolder = path.join(appPath, "Contents", "Frameworks");
  const frameworkEntries = fs.readdirSync(frameworksFolder);
  const helperApps = frameworkEntries.filter((name) => name.endsWith(".app"));
  for (const helperApp of helperApps) {
    const helperFolder = path.join(frameworksFolder, helperApp, "Contents", "MacOS");
    for (const name of fs.readdirSync(helperFolder)) {
      executables.push(path.join(helperFolder, name));
    }
  }
  return executables;
}

/**
 * Gives the main executable and each helper in the unpacked Electron.app under `buildPath` a UUID of its own.
 * Returns what changed, as "<name>: <old UUID> → <new UUID>" lines.
 */
export function makeBuildUuidsOwn(buildPath, bundleId, appVersion, electronVersion, architecture, buildKind) {
  const appPath = path.join(buildPath, "Electron.app");
  const changes = [];
  for (const executablePath of listAppExecutables(appPath)) {
    const executable = fs.readFileSync(executablePath);
    const uuidOffset = findUuidOffset(executable);
    const oldUuid = Buffer.from(executable.subarray(uuidOffset, uuidOffset + UUID_LENGTH));
    const executableName = path.basename(executablePath);
    const newUuid = deriveUuid(bundleId, appVersion, electronVersion, architecture, buildKind, executableName);
    fs.writeFileSync(executablePath, replaceUuid(executable, newUuid));
    changes.push(`${executableName}: ${formatUuid(oldUuid)} → ${formatUuid(newUuid)}`);
  }
  return changes;
}
