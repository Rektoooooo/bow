/**
 * WHY this file exists:
 *   The onboarding hands over to the browser by cross-fading their windows (macOS has no animation for that, and a
 *   window that just appears is abrupt). Every window fade goes through here, so the e2e checks' background mode
 *   (backgroundTesting.ts keeps every window at opacity 0, invisible) can never be undone by a fade: there it does
 *   nothing.
 *
 * Data source:
 *   The window's own opacity.
 *
 * Data flow:
 *   onboardingWindow.ts / mainWindows.ts → fadeWindow(window, opacity, ms) → setOpacity() about every frame
 */
import type { BaseWindow } from "electron";
import { isBackgroundTestRun } from "./backgroundTesting";

/** How often the opacity steps: about once per frame on a 60 Hz screen. */
const FADE_FRAME_MS = 16;

/**
 * Fades a window to an opacity (0…1) over a time, easing out. Resolves when done, at once in the e2e background mode
 * or when the window is gone.
 */
export function fadeWindow(window: BaseWindow, toOpacity: number, durationMs: number): Promise<void> {
  if (isBackgroundTestRun() || window.isDestroyed()) {
    return Promise.resolve();
  }
  const fromOpacity = window.getOpacity();
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (window.isDestroyed()) {
        clearInterval(timer);
        resolve();
        return;
      }
      const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      window.setOpacity(fromOpacity + (toOpacity - fromOpacity) * eased);
      if (progress >= 1) {
        clearInterval(timer);
        resolve();
      }
    }, FADE_FRAME_MS);
  });
}

/**
 * Makes a window see-through before it shows, so it can fade in (not in the e2e background mode, which keeps it so).
 */
export function prepareFadeIn(window: BaseWindow): void {
  if (isBackgroundTestRun() || window.isDestroyed()) {
    return;
  }
  window.setOpacity(0);
}
