/**
 * WHY this file exists:
 *   Handoff, like Arc's: the page you are reading shows up on your iPhone or iPad (and other Macs) so you can carry
 *   on there. macOS does it for a browsing "user activity" with the page's address; we keep that activity on the
 *   selected web page. Handoff itself depends on the devices and on the app's signing, which we cannot check here.
 *
 * Data source:
 *   The selected tab's address, after every state change.
 *
 * Data flow:
 *   state changes → the selected page's address changed → app.setUserActivity(browsing web, address)
 */
import { app } from "electron";
import type { BrowserState } from "../shared/types";
import { onStateChanged, getState } from "./browserCore";
import { getSelectedTabId } from "./state";
import { findTab } from "./tree";

/** macOS's activity type for browsing a web page (it hands the page to Safari on the other device). */
const BROWSING_ACTIVITY_TYPE = "NSUserActivityTypeBrowsingWeb";

let handedOffUrl: string | null = null;

/**
 * Offers the selected web page to the user's other devices, or stops offering when there is none.
 */
function updateHandoff(state: BrowserState): void {
  const selectedTabId = getSelectedTabId(state);
  const tab = selectedTabId === null ? undefined : findTab(state, selectedTabId);
  const url = tab !== undefined && (tab.url.startsWith("https://") || tab.url.startsWith("http://")) ? tab.url : null;
  if (url === handedOffUrl || process.platform !== "darwin") {
    return;
  }
  handedOffUrl = url;
  if (url === null) {
    app.invalidateCurrentActivity();
    return;
  }
  app.setUserActivity(BROWSING_ACTIVITY_TYPE, {}, url);
}

/**
 * Starts following the selected page. Runs once at startup.
 */
export function startHandoff(): void {
  updateHandoff(getState());
  onStateChanged(updateHandoff);
}
