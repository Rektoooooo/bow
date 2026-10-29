/**
 * WHY this file exists:
 *   The onboarding window's page starts here: it installs the SF Symbols the icons use, asks main for what to show,
 *   draws the onboarding (onboarding.ts) and keeps it current as main sends changes.
 *
 * Data source:
 *   window.onboardingApi (preload/onboardingPreload.ts).
 *
 * Data flow:
 *   onboarding.html → startOnboarding() → getData() → renderOnboarding(); "onboarding:data" → updateOnboarding()
 *   "onboarding:shown" (the window is on screen) → startEntrance(), once it is drawn
 */
import type { OnboardingApi } from "../shared/onboarding";
import { installSymbols } from "../renderer/icons.js";
import { renderOnboarding, startEntrance, updateOnboarding } from "./onboarding.js";

declare global {
  interface Window {
    onboardingApi: OnboardingApi;
  }
}

/**
 * Draws the onboarding once main has said what to show; later changes update it in place. Its entrance plays when the
 * window is on screen, whichever of the two comes last.
 */
async function startOnboarding(): Promise<void> {
  let shownAfterIntro: boolean | null = null;
  let isDrawn = false;
  window.onboardingApi.getSymbols().then(installSymbols).catch(() => undefined);
  window.onboardingApi.onData(updateOnboarding);
  window.onboardingApi.onShown((isAfterIntro) => {
    shownAfterIntro = isAfterIntro;
    if (isDrawn) {
      startEntrance(isAfterIntro);
    }
  });
  const data = await window.onboardingApi.getData();
  const host = document.getElementById("onboarding-host");
  if (data === null || host === null) {
    return;
  }
  renderOnboarding(host, data);
  isDrawn = true;
  if (shownAfterIntro !== null) {
    startEntrance(shownAfterIntro);
  }
}

startOnboarding().catch((error) => console.error("The onboarding could not start:", error));
