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
 */
import { app, autoUpdater, dialog } from "electron";
import { APP_UPDATE_FEED_BASE_URL, APP_UPDATE_FIRST_CHECK_MS, APP_UPDATE_INTERVAL_MS } from "../shared/settings";
import { getWindow, setUpdateReadyVersion } from "./browserCore";

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

/** True while a download runs after a check found an update. */
let isDownloading = false;

/** Answers a check the user asked for once it has an outcome, or null when nobody waits for one. */
let answerWaitingUser: ((outcome: CheckOutcome) => void) | null = null;

/**
 * Picks the feed. Builds made from source (npm start) and the tests' throwaway profiles never check: the first is
 * not signed for updates, the second must not reach GitHub. --update-feed overrides both checks for the package
 * check's local feed.
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
  // One feed per processor type, so an Intel build can be added later without changing installed apps.
  return { kind: "feed", url: `${APP_UPDATE_FEED_BASE_URL}/update-darwin-${process.arch}.json` };
}

/**
 * Tells the user waiting for a check (if any) what it found.
 */
function answerUser(outcome: CheckOutcome): void {
  const answer = answerWaitingUser;
  answerWaitingUser = null;
  answer?.(outcome);
}

/**
 * Listens to the updater. The download starts by itself after "update-available".
 */
function listenToUpdater(onReadyToInstall: () => void): void {
  autoUpdater.on("update-available", () => {
    isChecking = false;
    isDownloading = true;
    answerUser({ kind: "downloading" });
  });
  autoUpdater.on("update-not-available", () => {
    isChecking = false;
    answerUser({ kind: "newest" });
  });
  // The feed's "name" is the bare version number (tools/release-mac.sh writes it so).
  autoUpdater.on("update-downloaded", (_event, _releaseNotes, releaseName) => {
    isDownloading = false;
    readyVersion = releaseName;
    setUpdateReadyVersion(releaseName);
    onReadyToInstall();
  });
  autoUpdater.on("error", (error) => {
    isChecking = false;
    isDownloading = false;
    console.warn("Update check failed:", error.message);
    answerUser({ kind: "failed", message: error.message });
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
    answerWaitingUser = resolve;
  });
  checkInBackground();
  await showOutcome(await outcome);
}
