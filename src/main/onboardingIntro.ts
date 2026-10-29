/**
 * WHY this file exists:
 *   Bow's first start begins on the desktop, before any window: the desktop dims, one soft blob in Bow's colors
 *   appears in the middle and breathes, then it swells and flows into the onboarding window's exact place and size,
 *   where the real window takes over; the desktop brightens again while the welcome plays. All of it lives in a
 *   see-through window over the screen that ignores the mouse and never takes the keyboard. It breathes until the
 *   onboarding window has painted (a slow first start just breathes longer), but never longer than a ceiling: a stuck
 *   page must not leave the desktop dimmed.
 *
 * Data source:
 *   The onboarding window's bounds (onboardingWindow.ts).
 *
 * Data flow:
 *   onboardingWindow.ts openOnboarding(true) → playIntro(bounds, onboarding painted) → intro.html dims and breathes →
 *   window.growIntoWindow() → the onboarding window shows → the returned leave() → window.leaveIntro() → closed
 */
import { BrowserWindow, screen } from "electron";
import type { Rectangle } from "electron";
import * as path from "node:path";

/** The blob breathes at least this long before it grows, so it reads as a moment and not a flicker. Our choice. */
const INTRO_MIN_BREATHE_MS = 1600;

/** The longest the intro waits for the onboarding window to paint; then it grows anyway. Our choice. */
const INTRO_MAX_WAIT_MS = 10_000;

/** If the page never says its growth (about 1.1 s) or its leaving (about 0.7 s) ended, main goes on after these. */
const INTRO_GROW_TIMEOUT_MS = 3000;
const INTRO_LEAVE_TIMEOUT_MS = 2000;

/**
 * Waits a while.
 */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Asks the intro's page to run one of its steps (it resolves when the step is done), waiting at most `timeoutMs`.
 * A page that is gone or fails just ends the wait.
 */
async function runIntroStep(intro: BrowserWindow, script: string, timeoutMs: number): Promise<void> {
  if (intro.isDestroyed()) {
    return;
  }
  const step = intro.webContents.executeJavaScript(script).catch((error) => console.error("An intro step failed:", error));
  await Promise.race([step, delay(timeoutMs)]);
}

/**
 * Plays the intro over the screen that holds `target` (the onboarding window's bounds): the desktop dims, the blob
 * appears and breathes until `targetPainted` (at most INTRO_MAX_WAIT_MS) and the shortest breath are both done, then
 * grows into `target`. Resolves with leave(): it lifts the dimming and removes the intro, to call once the onboarding
 * window shows in its place.
 */
export async function playIntro(target: Rectangle, targetPainted: Promise<void>): Promise<() => Promise<void>> {
  const area = screen.getDisplayMatching(target).workArea;
  const intro = new BrowserWindow({
    ...area,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const leave = async (): Promise<void> => {
    await runIntroStep(intro, "window.leaveIntro()", INTRO_LEAVE_TIMEOUT_MS);
    if (!intro.isDestroyed()) {
      intro.destroy();
    }
  };
  // Our own page, without a bridge: it never navigates away and opens no windows.
  intro.webContents.on("will-navigate", (event) => event.preventDefault());
  intro.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  intro.setIgnoreMouseEvents(true);
  const introShown = new Promise<void>((resolve) => {
    intro.once("ready-to-show", () => {
      intro.showInactive();
      resolve();
    });
  });
  // __dirname is dist/node/main when running, so this path points into the build output.
  const pagePath = path.join(__dirname, "..", "..", "web", "onboarding", "intro.html");
  const query = {
    x: String(target.x - area.x),
    y: String(target.y - area.y),
    width: String(target.width),
    height: String(target.height),
  };
  try {
    await intro.loadFile(pagePath, { query: query });
    const paintedOrGivenUp = Promise.race([targetPainted, delay(INTRO_MAX_WAIT_MS)]);
    await Promise.all([introShown, paintedOrGivenUp, delay(INTRO_MIN_BREATHE_MS)]);
    await runIntroStep(intro, "window.growIntoWindow()", INTRO_GROW_TIMEOUT_MS);
  } catch (error) {
    // The intro is only a flourish: whatever went wrong, the onboarding still shows (the dimming goes with leave()).
    console.error("The intro could not play:", error);
    await Promise.race([targetPainted, delay(INTRO_MAX_WAIT_MS)]);
  }
  return leave;
}
