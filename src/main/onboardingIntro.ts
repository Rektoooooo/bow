/**
 * WHY this file exists:
 *   Bow's first start begins on the desktop, before any window: a soft glow in Bow's colors appears in the middle of
 *   the screen and breathes, then grows into a rounded sheet at the onboarding window's exact place and size, and the
 *   real window takes over there. The glow lives in a see-through window over the screen that ignores the mouse and
 *   never takes the keyboard. It keeps breathing until the onboarding window has painted, so a slow first start just
 *   breathes longer; then it grows (its page says when it is done) and goes.
 *
 * Data source:
 *   The onboarding window's bounds and whether it starts dark (onboardingWindow.ts).
 *
 * Data flow:
 *   onboardingWindow.ts openOnboarding(true) → playIntro(bounds, isDark, onboarding painted) → intro.html breathes →
 *   window.growIntoWindow() → resolves → the onboarding window shows → the returned close() removes the intro
 */
import { BrowserWindow, screen } from "electron";
import type { Rectangle } from "electron";
import * as path from "node:path";

/** The glow breathes at least this long before it grows, so it reads as a moment and not a flicker. Our choice. */
const INTRO_MIN_BREATHE_MS = 1500;

/** If the page never says its growth ended (it lasts about 1 s), the onboarding window shows anyway. */
const INTRO_GROW_TIMEOUT_MS = 3000;

/**
 * Waits a while.
 */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Plays the intro over the screen that holds `target` (the onboarding window's bounds): the glow appears and breathes
 * until `targetPainted` and the shortest breath are both done, then grows into `target`. Resolves with a function that
 * removes the intro (called once the onboarding window shows in its place).
 */
export async function playIntro(target: Rectangle, isDark: boolean, targetPainted: Promise<void>): Promise<() => void> {
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
  const close = (): void => {
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
    dark: isDark ? "1" : "0",
  };
  try {
    await intro.loadFile(pagePath, { query: query });
    await Promise.all([introShown, targetPainted, delay(INTRO_MIN_BREATHE_MS)]);
    const grown = intro.webContents.executeJavaScript("window.growIntoWindow()");
    await Promise.race([grown, delay(INTRO_GROW_TIMEOUT_MS)]);
  } catch (error) {
    // The intro is only a flourish: whatever went wrong, the onboarding still shows.
    console.error("The intro could not play:", error);
    await targetPainted;
  }
  return close;
}
