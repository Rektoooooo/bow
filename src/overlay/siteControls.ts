/**
 * WHY this file exists:
 *   Arc's Site Control Center: a popover under the toolbar's sliders button with the page's quick actions (share,
 *   Boost, screenshot, capture), the profile's extensions, the site's settings (sound, zoom, Boost, what the site was
 *   allowed or refused) and the connection's security, with the rarer commands behind "…".
 *
 * Data source:
 *   SiteInfo from overlayController.ts (address, security, sound, zoom, Boost, permissions, extensions). The layout
 *   is measured from the user's Arc screenshot (shot 4): a 232 pt panel, 9 pt padding, a 4-column grid (49 pt
 *   columns, 6 pt apart) for the action buttons (33 pt tall) and the extension tiles (32 pt tall), 32 pt round
 *   setting icons (white when on, grey when off), a hairline and the footer.
 *
 * Data flow:
 *   toolbar sliders button → "overlay:show" (siteControls) → renderSiteControls() → a button → overlayApi.siteCommand
 *   / activateExtension / showSiteMenu, or an action through dispatch → main re-sends the panel → drawn again in place
 */
import type { SiteCommand, SiteInfo } from "../shared/overlay";
import type { SitePermissionKind } from "../shared/types";
import { createElement, dispatch } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";
import type { IconName } from "../renderer/icons.js";

/** How the permission kinds read, and their icons. */
const PERMISSIONS: Record<SitePermissionKind, { name: string; icon: IconName }> = {
  camera: { name: "Camera", icon: "video" },
  microphone: { name: "Microphone", icon: "microphone" },
  notifications: { name: "Notifications", icon: "bell" },
  location: { name: "Location", icon: "location" },
  clipboard: { name: "Clipboard", icon: "clipboard" },
};

/** One line under "Settings". */
interface SettingLine {
  icon: IconName;
  title: string;
  state: string;
  isOn: boolean;
  hint: string;
  run: () => void;
}

/**
 * Builds a button; its label is the tooltip and the accessible name.
 */
function createButton(className: string, label: string, run: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", run);
  return button;
}

/**
 * The box of an element, for anchoring a menu or an extension's popup to it.
 */
function getAnchor(element: HTMLElement): { x: number; y: number; width: number; height: number } {
  const box = element.getBoundingClientRect();
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

/**
 * One of the four action buttons on top.
 */
function createActionButton(icon: IconName, label: string, command: SiteCommand, isEnabled: boolean): HTMLButtonElement {
  const button = createButton("control-action", label, () => window.overlayApi.siteCommand(command));
  button.disabled = !isEnabled;
  button.append(createIcon(icon));
  return button;
}

/**
 * Share, Boost, Screenshot and Capture, like Arc's top row.
 */
function createActionRow(site: SiteInfo): HTMLElement {
  const row = createElement("div", "control-grid control-actions");
  const boostButton = createButton("control-action", "Boost this site", () => dispatch({ type: "openBoostEditor" }));
  boostButton.disabled = site.site === null;
  boostButton.append(createIcon("boost"));
  row.append(
    createActionButton("share", "Share", "share", true),
    boostButton,
    createActionButton("camera", "Take Screenshot", "screenshot", site.isLoaded),
    createActionButton("capture", "Capture Part of the Page", "capture", site.isLoaded),
  );
  return row;
}

/**
 * "Extensions": a tile per turned-on extension of this profile (click opens its popup) and "+" for more.
 */
function createExtensionsSection(site: SiteInfo): HTMLElement {
  const section = createElement("section", "control-section");
  section.append(createElement("h2", "control-heading", "Extensions"));
  const grid = createElement("div", "control-grid");
  for (const extension of site.extensions) {
    const tile = createButton("control-tile", extension.name, () => window.overlayApi.activateExtension(extension.id, getAnchor(tile)));
    if (extension.iconUrl === null) {
      tile.append(createIcon("puzzle"));
    } else {
      const image = document.createElement("img");
      image.className = "control-tile-image";
      image.src = extension.iconUrl;
      image.alt = "";
      tile.append(image);
    }
    grid.append(tile);
  }
  const addTile = createButton("control-tile", "Add Extensions from the Chrome Web Store", () => window.overlayApi.siteCommand("addExtension"));
  addTile.append(createIcon("plus"));
  grid.append(addTile);
  section.append(grid);
  return section;
}

/**
 * Sums up a site's Boost in a few words, e.g. "On · 2 zapped · CSS".
 */
function describeBoost(boost: NonNullable<SiteInfo["boost"]>): string {
  const parts = [boost.isEnabled ? "On" : "Off"];
  if (boost.zapCount > 0) {
    parts.push(`${boost.zapCount} zapped`);
  }
  if (boost.hasCss) {
    parts.push("CSS");
  }
  return parts.join(" · ");
}

/**
 * The site's settings: sound always; zoom, Boost and permission answers when the site has them.
 */
function collectSettingLines(site: SiteInfo): SettingLine[] {
  const lines: SettingLine[] = [
    {
      icon: site.isMuted ? "speakerMuted" : "speaker",
      title: "Sound",
      state: site.isMuted ? "Muted" : "On",
      isOn: !site.isMuted,
      hint: site.isMuted ? "Unmute this tab" : "Mute this tab",
      run: () => window.overlayApi.siteCommand("toggleMute"),
    },
  ];
  if (site.zoomPercent !== 100) {
    lines.push({ icon: "zoomIn", title: "Zoom", state: `${site.zoomPercent}%`, isOn: true, hint: "Back to 100%", run: () => window.overlayApi.siteCommand("zoomReset") });
  }
  const boost = site.boost;
  const boostSite = site.site;
  if (boost !== null && boostSite !== null) {
    lines.push({
      icon: "boost",
      title: "Boost",
      state: describeBoost(boost),
      isOn: boost.isEnabled,
      hint: boost.isEnabled ? "Turn this site's Boost off" : "Turn this site's Boost on",
      run: () => dispatch({ type: "setBoostEnabled", site: boostSite, isEnabled: !boost.isEnabled }),
    });
  }
  const origin = site.origin;
  for (const permission of site.permissions) {
    lines.push({
      icon: PERMISSIONS[permission.kind].icon,
      title: PERMISSIONS[permission.kind].name,
      state: permission.isAllowed ? "Allowed" : "Blocked",
      isOn: permission.isAllowed,
      hint: "Forget this answer; the site asks again next time",
      run: () => {
        if (origin !== null) {
          dispatch({ type: "removeSitePermission", profileId: site.profileId, origin: origin, kind: permission.kind });
        }
      },
    });
  }
  return lines;
}

/**
 * "Settings": a round icon (white when on, grey when off), the setting and its state.
 */
function createSettingsSection(site: SiteInfo): HTMLElement {
  const section = createElement("section", "control-section");
  section.append(createElement("h2", "control-heading", "Settings"));
  for (const line of collectSettingLines(site)) {
    const button = createButton("control-setting", line.hint, line.run);
    button.classList.toggle("is-on", line.isOn);
    const badge = createElement("span", "control-setting-badge");
    badge.append(createIcon(line.icon));
    const text = createElement("span", "control-setting-text");
    text.append(createElement("span", "control-setting-title", line.title), createElement("span", "control-setting-state", line.state));
    button.append(badge, text);
    section.append(button);
  }
  return section;
}

/**
 * The footer: "Secure" (or "Not Secure") with the full address on hover, and "…" for the rarer commands.
 */
function createFooter(site: SiteInfo): HTMLElement {
  const footer = createElement("div", "control-footer");
  const security = createElement("span", "control-security");
  security.title = site.isSecure ? `Your connection to ${site.host} is secure.\n${site.url}` : `Your connection to ${site.host} is not secure.\n${site.url}`;
  security.append(createIcon(site.isSecure ? "lock" : "globe"), createElement("span", "", site.isSecure ? "Secure" : "Not Secure"));
  const moreButton = createButton("control-more", "More", () => window.overlayApi.showSiteMenu(getAnchor(moreButton)));
  moreButton.append(createIcon("more"));
  footer.append(security, moreButton);
  return footer;
}

/**
 * Draws the Control Center. When it is already open (a setting changed), the same panel is filled again, so it
 * does not animate in a second time.
 */
export function renderSiteControls(host: HTMLElement, site: SiteInfo): void {
  const openPanel = host.querySelector<HTMLElement>(".control-center");
  const panel = openPanel ?? createElement("div", "panel site-controls control-center");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `Controls for ${site.host}`);
  panel.replaceChildren(
    createElement("span", "control-notch"),
    createActionRow(site),
    createExtensionsSection(site),
    createSettingsSection(site),
    createElement("div", "control-divider"),
    createFooter(site),
  );
  if (openPanel === null) {
    host.replaceChildren(panel);
  }
}
