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
 */
import type { OnboardingApi } from "../shared/onboarding";
import { installSymbols } from "../renderer/icons.js";
import { renderOnboarding, updateOnboarding } from "./onboarding.js";

declare global {
  interface Window {
    onboardingApi: OnboardingApi;
  }
}

/**
 * Draws the onboarding once main has said what to show; later changes update it in place.
 */
async function startOnboarding(): Promise<void> {
  window.onboardingApi.getSymbols().then(installSymbols).catch(() => undefined);
  window.onboardingApi.onData(updateOnboarding);
  const data = await window.onboardingApi.getData();
  const host = document.getElementById("onboarding-host");
  if (data === null || host === null) {
    return;
  }
  renderOnboarding(host, data);
}

startOnboarding().catch((error) => console.error("The onboarding could not start:", error));
