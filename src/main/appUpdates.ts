/**
 * WHY this file exists:
 *   Bow updates itself from its GitHub releases, so people who installed the disk image get fixes without watching
 *   the repository. Electron's updater on macOS (Squirrel.Mac) downloads the new version in the background, checks
 *   that it is signed by the same Developer ID as the running app, and swaps it in when Bow quits or restarts. The
 *   feed is a small JSON file that tools/release-mac.sh attaches to every release; GitHub serves the newest release's
 *   copy at a fixed address, so no update server of our own (or anyone else's) is involved. Squirrel only updates
 *   when the feed's version is newer than the running one, and checks the download's SHA-256 and size from the feed.
 *
 * Data source:
 *   The feed at APP_UPDATE_FEED_BASE_URL (settings.ts), or --update-feed=<url> (the package check serves its own).
 *
 * Data flow:
 *   startup (packaged app) → startAppUpdates() → a check shortly after, then every few hours → a newer version
 *   downloads by itself → "update-downloaded" → RuntimeState.updateReadyVersion (the sidebar's notice) and the app
 *   menu's "Restart to Update" → restartToUpdate() → quitAndInstall()
 *   Bow › Check for Updates… → checkForUpdatesNow() → a dialog says what the check found
 *   startup from the disk image → offerMoveToApplications() → Electron moves Bow and starts it again
 */
import { app, autoUpdater, dialog } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { APP_UPDATE_FEED_BASE_URL, APP_UPDATE_FIRST_CHECK_MS, APP_UPDATE_INTERVAL_MS } from "../shared/settings";
import { isRunningFromDiskImage } from "./appLocation";
import { getWindow, setUpdateReadyVersion } from "./browserCore";

/** The Info.plist key tools/package-mac.sh writes into release builds; only those update themselves. */
const RELEASE_BUILD_KEY = "<key>BowUpdatesFromGitHub</key>";

/**
 * True when this app was built for a release (signed with a Developer ID by tools/release-mac.sh). Info.plist is the
 * XML file the packager wrote, next to the Resources folder.
 */
function isReleaseBuild(): boolean {
  const infoPlistPath = path.join(process.resourcesPath, "..", "Info.plist");
  try {
    return fs.readFileSync(infoPlistPath, "utf8").includes(RELEASE_BUILD_KEY);
  } catch {
    return false;
  }
}

/** Where updates come from, or why this run never updates. */
type UpdateSource = { kind: "feed"; url: string } | { kind: "off"; reason: string };

/** What the last check found, for the dialog of a check the user asked for. */
type CheckOutcome = { kind: "newest" } | { kind: "downloading" } | { kind: "failed"; message: string };

/** The feed set on the updater, or null before startAppUpdates() (or when updates are off). */
let feedUrl: string | null = null;

/** Why updates are off in this run, shown when the user asks for a check anyway. */
let offReason = "";

/** The version that has downloaded and is installed on the next restart, or null. */
let readyVersion: string | null = null;

/** True while a check runs: a second check meanwhile would download the update twice (Squirrel starts a new one). */
let isChecking = false;

/** Ends a check that never got an answer (no network reply, no event), so later checks are not blocked forever. */
let checkTimeout: NodeJS.Timeout | null = null;

/** A check gets this long to say whether there is an update. Our choice: the feed is one small file. */
const CHECK_TIMEOUT_MS = 60 * 1000;

/** True while a download runs after a check found an update. */
let isDownloading = false;

/** The user's checks waiting for an outcome (a second "Check for Updates…" joins the first). */
let waitingAnswers: ((outcome: CheckOutcome) => void)[] = [];

/**
 * Picks the feed. Builds made from source (npm start), copies packaged on this Mac (npm run package, signed ad hoc)
 * and the tests' throwaway profiles never check: the first two cannot accept a Developer ID update, the last must
 * not reach GitHub. --update-feed overrides all three for the package check's local feed.
 */
function chooseUpdateSource(): UpdateSource {
  const feedOverride = app.commandLine.getSwitchValue("update-feed");
  if (feedOverride !== "") {
    return { kind: "feed", url: feedOverride };
  }
  if (!app.isPackaged) {
    return { kind: "off", reason: "Bow built from source does not update itself. Pull the newest code instead." };
  }
  if (app.commandLine.hasSwitch("user-data-dir")) {
    return { kind: "off", reason: "Updates are off while Bow runs with its own data folder (--user-data-dir)." };
  }
  if (!isReleaseBuild()) {
    return { kind: "off", reason: "This copy of Bow was built on this Mac (npm run package). Only the downloaded app updates itself." };
  }
  // One feed per processor type, so an Intel build can be added later without changing installed apps.
  return { kind: "feed", url: `${APP_UPDATE_FEED_BASE_URL}/update-darwin-${process.arch}.json` };
}

/**
 * A check has its outcome: it is no longer running, and everyone waiting for it hears what it found.
 */
function finishCheck(outcome: CheckOutcome): void {
  isChecking = false;
  if (checkTimeout !== null) {
    clearTimeout(checkTimeout);
    checkTimeout = null;
  }
  const answers = waitingAnswers;
  waitingAnswers = [];
  for (const answer of answers) {
    answer(outcome);
  }
}

/**
 * Listens to the updater. The download starts by itself after "update-available".
 */
function listenToUpdater(onReadyToInstall: () => void): void {
  autoUpdater.on("update-available", () => {
    isDownloading = true;
    finishCheck({ kind: "downloading" });
  });
  autoUpdater.on("update-not-available", () => {
    finishCheck({ kind: "newest" });
  });
  // The feed's "name" is the bare version number (tools/release-mac.sh writes it so); a feed without one still works.
  autoUpdater.on("update-downloaded", (_event, _releaseNotes, releaseName) => {
    isDownloading = false;
    const version = releaseName.trim() === "" ? "(new version)" : releaseName;
    readyVersion = version;
    setUpdateReadyVersion(version);
    onReadyToInstall();
  });
  autoUpdater.on("error", (error) => {
    isDownloading = false;
    console.warn("Update check failed:", error.message);
    finishCheck({ kind: "failed", message: error.message });
  });
}

/**
 * Asks the feed for a newer version, unless a check or download is already running or an update waits for a
 * restart.
 */
function checkInBackground(): void {
  if (feedUrl === null || isChecking || isDownloading || readyVersion !== null) {
    return;
  }
  isChecking = true;
  checkTimeout = setTimeout(() => {
    checkTimeout = null;
    finishCheck({ kind: "failed", message: "The update feed did not answer. Check your connection and try again." });
  }, CHECK_TIMEOUT_MS);
  autoUpdater.checkForUpdates();
}

/**
 * Starts updating: sets the feed, then checks shortly after startup and every few hours. onReadyToInstall runs once
 * an update has downloaded (main.ts rebuilds the app menu with "Restart to Update").
 */
export function startAppUpdates(onReadyToInstall: () => void): void {
  const source = chooseUpdateSource();
  if (source.kind === "off") {
    offReason = source.reason;
    return;
  }
  try {
    // Squirrel refuses a running app it cannot read a signature from (an unsigned build).
    autoUpdater.setFeedURL({ url: source.url, serverType: "json" });
  } catch (error) {
    offReason = `Bow cannot update itself: ${error instanceof Error ? error.message : String(error)}`;
    console.warn(offReason);
    return;
  }
  feedUrl = source.url;
  listenToUpdater(onReadyToInstall);
  setTimeout(checkInBackground, APP_UPDATE_FIRST_CHECK_MS);
  setInterval(checkInBackground, APP_UPDATE_INTERVAL_MS);
}

/**
 * The version waiting for a restart, or null.
 */
export function getReadyUpdateVersion(): string | null {
  return readyVersion;
}

/**
 * Quits and starts the downloaded version (Squirrel swaps the app while Bow is closed).
 */
export function restartToUpdate(): void {
  if (readyVersion === null) {
    return;
  }
  autoUpdater.quitAndInstall();
}

/**
 * Shows a short message on top of the main window.
 */
async function showMessage(message: string, detail: string): Promise<void> {
  const window = getWindow();
  const options = { type: "info" as const, message: message, detail: detail };
  if (window === null) {
    await dialog.showMessageBox(options);
    return;
  }
  await dialog.showMessageBox(window, options);
}

/**
 * Turns a check's outcome into the dialog's words.
 */
async function showOutcome(outcome: CheckOutcome): Promise<void> {
  if (outcome.kind === "newest") {
    await showMessage("Bow is up to date", `Version ${app.getVersion()} is the newest.`);
    return;
  }
  if (outcome.kind === "downloading") {
    await showMessage("A new version of Bow is downloading", "The sidebar shows when it is ready; restart Bow then.");
    return;
  }
  await showMessage("Bow could not check for updates", outcome.message);
}

/**
 * True when the folder holding Bow.app can be written to: an app kept on an external drive (also under /Volumes) is
 * installed there on purpose, while a disk image and macOS's translocated copy are read-only.
 */
function isAppFolderWritable(): boolean {
  // process.execPath is …/Bow.app/Contents/MacOS/Bow.
  const appBundlePath = path.resolve(process.execPath, "..", "..", "..");
  try {
    fs.accessSync(path.dirname(appBundlePath), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Bow opened from its disk image (or macOS's read-only copy of it): offers to move it to Applications, where it keeps
 * working after the image is ejected and can update itself. A sheet on the window, so the browser is usable behind
 * it. Electron's move replaces an older Bow there, or switches to it when that one is running.
 */
export async function offerMoveToApplications(): Promise<void> {
  if (!app.isPackaged || !isRunningFromDiskImage(process.execPath) || isAppFolderWritable()) {
    return;
  }
  console.log(`Bow runs from ${process.execPath}; offering to move it to Applications.`);
  const window = getWindow();
  const options = {
    type: "question" as const,
    message: "Move Bow to your Applications folder?",
    detail: "Bow is running from its disk image. In Applications it keeps working after you eject the disk image, and it can update itself.",
    buttons: ["Move to Applications", "Not Now"],
    defaultId: 0,
    cancelId: 1,
  };
  const answer = window === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(window, options);
  if (answer.response !== 0) {
    return;
  }
  try {
    app.moveToApplicationsFolder();
  } catch (error) {
    await showMessage("Bow could not move itself", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Bow › Check for Updates…: checks now and says what it found.
 */
export async function checkForUpdatesNow(): Promise<void> {
  if (readyVersion !== null) {
    await showMessage(`Bow ${readyVersion} is ready`, "Restart Bow to start using it.");
    return;
  }
  if (feedUrl === null) {
    await showMessage("Bow does not update itself here", offReason);
    return;
  }
  if (isDownloading) {
    await showOutcome({ kind: "downloading" });
    return;
  }
  const outcome = new Promise<CheckOutcome>((resolve) => {
    waitingAnswers.push(resolve);
  });
  checkInBackground();
  await showOutcome(await outcome);
}
