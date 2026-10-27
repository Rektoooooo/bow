/**
 * WHY this file exists:
 *   People often open Bow straight from the downloaded disk image. From there it stops working once the image is
 *   ejected, and it cannot update itself (Squirrel refuses a read-only volume). macOS may also run a downloaded app
 *   from a hidden read-only copy (App Translocation) until it is moved. appUpdates.ts offers the move to Applications
 *   when this says Bow runs from such a place.
 *
 * Data source:
 *   The running executable's path (process.execPath).
 *
 * Data flow:
 *   startup → appUpdates.offerMoveToApplications() → isRunningFromDiskImage(path) → a sheet asks → Electron moves Bow
 *   to /Applications and starts it again
 */

/** Where macOS mounts disk images. */
const MOUNTED_VOLUMES_FOLDER = "/Volumes/";

/** The folder name macOS uses for its read-only copies of apps opened from a quarantined download. */
const TRANSLOCATION_FOLDER = "/AppTranslocation/";

/**
 * True when Bow runs from a mounted disk image or from macOS's translocated copy, not from where it was installed.
 */
export function isRunningFromDiskImage(executablePath: string): boolean {
  if (executablePath.startsWith(MOUNTED_VOLUMES_FOLDER)) {
    return true;
  }
  return executablePath.includes(TRANSLOCATION_FOLDER);
}
