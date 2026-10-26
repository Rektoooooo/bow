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
import { createElement, createTextButton, dispatch } from "../renderer/dom.js";
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
 * Sums up a site's Boost in a few words, e.g. "On · 2 zapped · custom CSS".
 */
function describeBoost(boost: NonNullable<SiteInfo["boost"]>): string {
  const parts = [boost.isEnabled ? "On" : "Off"];
  if (boost.zapCount > 0) {
    parts.push(`${boost.zapCount} zapped`);
  }
  if (boost.hasCss) {
    parts.push("custom CSS");
  }
  return parts.join(" · ");
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

  const boostRow = createElement("div", "site-row site-row-column");
  const boostHeader = createElement("div", "site-boost-header");
  boostHeader.append(createElement("span", "site-row-label", "Boost"));
  const boostSummary = site.boost === null ? "Change how this site looks" : describeBoost(site.boost);
  boostHeader.append(createElement("span", "site-row-note", boostSummary));
  const boostButtons = createElement("div", "site-buttons");
  const zapButton = createTextButton("Zap Elements", "site-button", () => window.overlayApi.siteCommand("zap"));
  zapButton.title = "Click elements on the page to hide them for good; Escape when done";
  zapButton.disabled = !site.isLoaded || site.site === null;
  const editButton = createTextButton("Edit CSS…", "site-button", () => dispatch({ type: "openBoostEditor" }));
  editButton.disabled = site.site === null;
  boostButtons.append(zapButton, editButton);
  boostRow.append(boostHeader, boostButtons);
  if (site.boost !== null && site.site !== null) {
    const boostSite = site.site;
    const isEnabled = site.boost.isEnabled;
    const manageButtons = createElement("div", "site-buttons");
    manageButtons.append(
      createTextButton(isEnabled ? "Turn Off" : "Turn On", "site-button", () => {
        dispatch({ type: "setBoostEnabled", site: boostSite, isEnabled: !isEnabled });
        window.overlayApi.close();
      }),
      createTextButton("Reset Boost", "site-button", () => {
        dispatch({ type: "deleteBoost", site: boostSite });
        window.overlayApi.close();
      }),
    );
    boostRow.append(manageButtons);
  }

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

  panel.append(header, tiles, zoomRow, boostRow, permissionsRow, buttons, createElement("p", "site-url", site.url));
  host.replaceChildren(panel);
}
