/**
 * WHY this file exists:
 *   Arc's Site Control Center: a popover from the toolbar with quick actions for the page you are on. Ours shows
 *   whether the connection is secure, copy link, screenshot, mute, inspect, zoom, the permission policy, reload and
 *   "clear site data".
 *
 * Data source:
 *   SiteInfo from overlayController.ts (address, host, secure, muted, zoom).
 *
 * Data flow:
 *   toolbar sliders button → "overlay:show" (siteControls) → renderSiteControls() → button → overlayApi.siteCommand
 */
import type { SiteCommand, SiteInfo } from "../shared/overlay";
import { createElement, createTextButton } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";
import type { IconName } from "../renderer/icons.js";

/**
 * Builds one square action button with an icon and a label underneath.
 */
function createActionTile(icon: IconName, label: string, command: SiteCommand, isEnabled: boolean): HTMLButtonElement {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "site-tile";
  tile.disabled = !isEnabled;
  tile.append(createIcon(icon), createElement("span", "site-tile-label", label));
  tile.addEventListener("click", () => window.overlayApi.siteCommand(command));
  return tile;
}

/**
 * Builds the site controls popover.
 */
export function renderSiteControls(host: HTMLElement, site: SiteInfo): void {
  const panel = createElement("div", "panel site-controls");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Site controls");

  const header = createElement("div", "site-header");
  header.append(createIcon(site.isSecure ? "lock" : "globe", "icon site-header-icon"));
  const headerText = createElement("div", "site-header-text");
  headerText.append(createElement("span", "site-host", site.host));
  headerText.append(createElement("span", "site-security", site.isSecure ? "Secure connection" : "Not secure"));
  header.append(headerText);

  const tiles = createElement("div", "site-tiles");
  tiles.append(
    createActionTile("link", "Copy Link", "copyLink", true),
    createActionTile("camera", "Screenshot", "screenshot", site.isLoaded),
    createActionTile(site.isMuted ? "speakerMuted" : "speaker", site.isMuted ? "Unmute" : "Mute", "toggleMute", true),
    createActionTile("code", "Inspect", "devTools", site.isLoaded),
  );

  const zoomRow = createElement("div", "site-row");
  zoomRow.append(createElement("span", "site-row-label", "Zoom"));
  const zoomControls = createElement("div", "site-zoom");
  const zoomOut = createTextButton("−", "site-zoom-button", () => window.overlayApi.siteCommand("zoomOut"));
  const zoomValue = createTextButton(`${site.zoomPercent}%`, "site-zoom-value", () => window.overlayApi.siteCommand("zoomReset"));
  zoomValue.title = "Reset to 100%";
  const zoomIn = createTextButton("+", "site-zoom-button", () => window.overlayApi.siteCommand("zoomIn"));
  for (const button of [zoomOut, zoomValue, zoomIn]) {
    button.disabled = !site.isLoaded;
  }
  zoomControls.append(zoomOut, zoomValue, zoomIn);
  zoomRow.append(zoomControls);

  const permissionsRow = createElement("div", "site-row site-row-column");
  permissionsRow.append(createElement("span", "site-row-label", "Permissions"));
  permissionsRow.append(
    createElement("span", "site-row-note", "Camera, microphone, location and notifications are blocked for every site. Full screen and copying are allowed."),
  );

  const buttons = createElement("div", "site-buttons");
  const reloadButton = createTextButton("Reload", "site-button", () => window.overlayApi.siteCommand("reload"));
  const clearButton = createTextButton("Clear Site Data & Reload", "site-button", () => window.overlayApi.siteCommand("clearSiteData"));
  reloadButton.disabled = !site.isLoaded;
  clearButton.disabled = !site.isLoaded;
  clearButton.title = "Deletes this site's cookies and storage in this profile, then reloads (you will be signed out)";
  buttons.append(reloadButton, clearButton);

  panel.append(header, tiles, zoomRow, permissionsRow, buttons, createElement("p", "site-url", site.url));
  host.replaceChildren(panel);
}
