/**
 * WHY this file exists:
 *   The row above the page, like the user's Arc with "Show toolbar" on: back, forward, reload, the page's address
 *   (click it to edit, like ⌘L), extensions, site controls and split view. A site in Developer Mode gets Arc's
 *   developer toolbar instead (shot 5): striped, the full address in monospace, copy / capture / screenshot and the
 *   developer tools; back, forward and reload move to the sidebar's top strip. It redraws from the state and the
 *   runtime facts.
 *
 * Data source:
 *   The selected tab (BrowserState) and its runtime facts (can go back/forward, loading), and the Web Store extensions
 *   being added.
 *
 * Data flow:
 *   sidebar.ts renderAll() → renderToolbar() → morph.ts keeps the buttons → clicks handled by sidebarEvents.ts
 *   (navigate / openCommandBar / showExtensionsMenu / openSiteControls / showMenu / installWebStoreExtension)
 */
import type { BrowserState, ItemId, RuntimeState, TabItem, TabRuntimeInfo } from "../shared/types";
import { isDeveloperModeOn } from "../shared/developerMode.js";
import { getSiteKey } from "../shared/siteKey.js";
import { isNoteUrl } from "../shared/notes.js";
import { isEaselUrl } from "../shared/easels.js";
import { createActionButton, createElement, getDisplayHost } from "./dom.js";
import { createIcon } from "./icons.js";
import { morphChildren } from "./morph.js";
import { findWebStoreExtensionId } from "../shared/webStore.js";

/**
 * The address as Arc's toolbar shows it: host without "www." and the path, no scheme, query or fragment
 * ("github.com/user/project"; a site's front page is just "example.com").
 */
function getDisplayAddress(url: string): string {
  const host = getDisplayHost(url);
  if (host === "") {
    return "";
  }
  let path = "";
  try {
    path = decodeURI(new URL(url).pathname);
  } catch {
    path = new URL(url).pathname;
  }
  const trimmedPath = path.endsWith("/") ? path.slice(0, -1) : path;
  return `${host}${trimmedPath}`;
}

/**
 * Builds the address pill: a link icon for https pages (Arc's), a globe otherwise, and the address (the whole of it
 * with "Show full URLs"). Clicking the icon copies the address (with the "Copied link" toast); clicking the rest
 * edits it. Clicks go to the innermost element with an action (sidebarEvents.ts), so the icon keeps its own.
 */
function createAddressPill(url: string | null, showsFullUrl: boolean, hasScriptBoost: boolean): HTMLElement {
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "address-pill";
  pill.dataset.key = "address";
  pill.dataset.action = "open-command-bar";
  pill.dataset.mode = url === null ? "newTab" : "editUrl";
  pill.title = url ?? "";
  pill.setAttribute("aria-label", url === null ? "Search or enter address" : `Edit address ${url}`);

  const isSecure = url !== null && url.startsWith("https://");
  const icon = createIcon(isSecure ? "link" : "globe", "icon address-icon");
  if (url === null) {
    pill.append(icon);
  } else {
    const copyButton = createElement("span", "address-copy");
    copyButton.dataset.action = "site-command";
    copyButton.dataset.command = "copyLink";
    copyButton.title = "Copy Address (⇧⌘C)";
    copyButton.append(icon);
    pill.append(copyButton);
  }
  const shortAddress = url === null ? "" : getDisplayAddress(url);
  const address = url !== null && showsFullUrl ? getFullAddress(url) : shortAddress;
  const label = address === "" ? url ?? "Search or enter address" : address;
  pill.append(createElement("span", "address-text", label));
  // A Boost runs its own JavaScript on this site: said plainly, so it is never a surprise.
  if (hasScriptBoost) {
    pill.append(createScriptBoostBadge());
  }
  return pill;
}

/**
 * The "JS" badge after the address while a JavaScript Boost runs on the page (the address pill and Developer Mode's
 * address both show it).
 */
function createScriptBoostBadge(): HTMLElement {
  const badge = createElement("span", "boost-script-badge", "JS");
  badge.title = "A JavaScript Boost runs on this site (Control Center › Boost to change it)";
  return badge;
}

/**
 * Whether a JavaScript Boost runs on a page: its site's Boost is on, has code, and the code is switched on.
 */
function hasScriptBoostFor(state: BrowserState, url: string | null): boolean {
  const site = url === null ? null : getSiteKey(url);
  const boost = site === null ? undefined : (state.boosts ?? []).find((candidate) => candidate.site === site);
  const hasCode = (boost?.javascript ?? "").trim() !== "";
  return boost !== undefined && boost.isEnabled && boost.isJavaScriptOn === true && hasCode;
}

/**
 * Back, forward and reload (stop while loading). In Developer Mode reload gets Arc's ▾ menu (hard reload, empty
 * cache). The sidebar's top strip uses them too.
 */
export function createNavigationButtons(selectedTab: TabItem | null, runtimeInfo: TabRuntimeInfo | undefined, className: string, withReloadMenu: boolean): HTMLElement[] {
  const backButton = createActionButton("back", "Back (⌘[)", className, "navigate", { command: "back" });
  backButton.disabled = runtimeInfo?.canGoBack !== true;
  const forwardButton = createActionButton("forward", "Forward (⌘])", className, "navigate", { command: "forward" });
  forwardButton.disabled = runtimeInfo?.canGoForward !== true;
  const isLoading = runtimeInfo?.isLoading === true;
  const reloadButton = isLoading
    ? createActionButton("stop", "Stop (⌘.)", className, "navigate", { command: "stop" })
    : createActionButton("reload", "Reload (⌘R)", className, "navigate", { command: "reload" });
  reloadButton.disabled = selectedTab === null;
  if (!withReloadMenu) {
    return [backButton, forwardButton, reloadButton];
  }
  const reloadMenuButton = createActionButton("chevronDown", "Reload options", `${className} reload-menu-button`, "reload-menu");
  reloadMenuButton.disabled = selectedTab === null;
  return [backButton, forwardButton, reloadButton, reloadMenuButton];
}

/**
 * The full address as Developer Mode shows it ("https://example.com/path?query"), without the lone "/" of a front page.
 */
function getFullAddress(url: string): string {
  try {
    const parsed = new URL(url);
    const isFrontPage = parsed.pathname === "/" && parsed.search === "" && parsed.hash === "";
    return isFrontPage ? `${parsed.protocol}//${parsed.host}` : url;
  } catch {
    return url;
  }
}

/**
 * Developer Mode's address: the lock (opens the Control Center, where Developer Mode is switched off) and the full
 * address in monospace (click to edit, like ⌘L).
 */
function createDeveloperAddress(url: string, hasScriptBoost: boolean): HTMLElement {
  const address = createElement("div", "developer-address");
  address.dataset.key = "developer-address";
  const isSecure = url.startsWith("https://");
  const lockButton = createActionButton(isSecure ? "lock" : "globe", "Site controls and Developer Mode", "toolbar-button developer-lock", "site-controls");
  const urlButton = document.createElement("button");
  urlButton.type = "button";
  urlButton.className = "developer-url";
  urlButton.dataset.action = "open-command-bar";
  urlButton.dataset.mode = "editUrl";
  urlButton.title = url;
  urlButton.setAttribute("aria-label", `Edit address ${url}`);
  urlButton.textContent = getFullAddress(url);
  address.append(lockButton, urlButton);
  if (hasScriptBoost) {
    address.append(createScriptBoostBadge());
  }
  return address;
}

/** A hairline between groups of developer buttons. */
function createSeparator(key: string): HTMLElement {
  const separator = createElement("span", "toolbar-separator");
  separator.dataset.key = key;
  return separator;
}

/**
 * Developer Mode's buttons, in Arc's groups: copy the address | capture, screenshot | console, network, inspect.
 */
function createDeveloperButtons(isLoaded: boolean): HTMLElement[] {
  const copyButton = createActionButton("link", "Copy Address (⇧⌘C)", "toolbar-button", "site-command", { command: "copyLink" });
  const captureButton = createActionButton("capture", "Capture Part of the Page", "toolbar-button", "site-command", { command: "capture" });
  const screenshotButton = createActionButton("camera", "Take Screenshot", "toolbar-button", "site-command", { command: "screenshot" });
  const consoleButton = createActionButton("terminal", "Console", "toolbar-button", "developer-tool", { tool: "console" });
  const networkButton = createActionButton("network", "Network", "toolbar-button", "developer-tool", { tool: "network" });
  const inspectButton = createActionButton("scope", "Inspect an Element", "toolbar-button", "developer-tool", { tool: "inspect" });
  for (const button of [captureButton, screenshotButton, consoleButton, networkButton, inspectButton]) {
    button.disabled = !isLoaded;
  }
  return [copyButton, createSeparator("separator-copy"), captureButton, screenshotButton, createSeparator("separator-capture"), consoleButton, networkButton, inspectButton, createSeparator("separator-tools")];
}

/**
 * True when the active Space's profile has an extension turned on (the toolbar then shows the extensions button).
 */
function hasActiveExtensions(state: BrowserState): boolean {
  const activeSpace = state.spaces.find((space) => space.id === state.activeSpaceId);
  return (state.extensions ?? []).some((extension) => extension.profileId === activeSpace?.profileId && extension.isEnabled);
}

/**
 * On a Chrome Web Store extension page whose extension this profile does not have yet: an "Add Extension" pill,
 * our stand-in for the page's own "Add to Chrome" button. It says "Adding…" while main downloads the extension for
 * this profile (a runtime fact, so redraws during the download keep it). Null everywhere else.
 */
function createAddExtensionPill(state: BrowserState, runtime: RuntimeState, url: string | null): HTMLButtonElement | null {
  const extensionId = url === null ? null : findWebStoreExtensionId(url);
  const activeSpace = state.spaces.find((space) => space.id === state.activeSpaceId);
  const isAdded = (state.extensions ?? []).some((extension) => extension.id === extensionId && extension.profileId === activeSpace?.profileId && extension.isEnabled);
  if (extensionId === null || isAdded) {
    return null;
  }
  const isBeingAdded = runtime.extensionsBeingAdded.some((entry) => entry.extensionId === extensionId && entry.profileId === activeSpace?.profileId);
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "toolbar-pill";
  pill.dataset.key = `add-extension:${extensionId}`;
  pill.dataset.action = "add-extension";
  pill.dataset.extensionId = extensionId;
  pill.disabled = isBeingAdded;
  pill.title = "Download this extension from the Chrome Web Store and add it to this profile";
  pill.append(createIcon("puzzle"), createElement("span", "toolbar-pill-text", isBeingAdded ? "Adding…" : "Add Extension"));
  return pill;
}

/**
 * Redraws the toolbar for the selected tab. With the sidebar hidden it also shows a button to bring it back,
 * placed after the window's traffic-light buttons.
 */
export function renderToolbar(state: BrowserState, runtime: RuntimeState, selectedTabId: ItemId | null): void {
  const toolbar = document.getElementById("toolbar");
  if (toolbar === null) {
    return;
  }

  const selectedItem = selectedTabId === null ? undefined : state.items[selectedTabId];
  const selectedTab = selectedItem !== undefined && selectedItem.kind === "tab" ? selectedItem : null;
  const runtimeInfo = selectedTabId === null ? undefined : runtime.tabs[selectedTabId];

  const isLoading = runtimeInfo?.isLoading === true;
  const isDeveloper = selectedTab !== null && isDeveloperModeOn(state, selectedTab.url);
  const isSidebarVisible = state.settings.isSidebarVisible;

  const leftGroup = createElement("div", "toolbar-group toolbar-left");
  leftGroup.dataset.key = "left";
  if (!isSidebarVisible) {
    leftGroup.append(createActionButton("sidebar", "Show sidebar (⌘S)", "toolbar-button", "show-sidebar"));
  }
  // In Developer Mode back/forward/reload sit in the sidebar's top strip, unless the sidebar is hidden.
  if (!isDeveloper || !isSidebarVisible) {
    leftGroup.append(...createNavigationButtons(selectedTab, runtimeInfo, "toolbar-button", isDeveloper));
  }
  if (isDeveloper && selectedTab !== null) {
    leftGroup.append(createDeveloperAddress(selectedTab.url, hasScriptBoostFor(state, selectedTab.url)));
  }

  const centerGroup = createElement("div", "toolbar-group toolbar-center");
  centerGroup.dataset.key = "center";
  const isNote = selectedTab !== null && isNoteUrl(selectedTab.url);
  const isEasel = selectedTab !== null && isEaselUrl(selectedTab.url);
  if (isNote || isEasel) {
    const pagePill = createElement("span", "address-pill note-pill");
    pagePill.dataset.key = isNote ? "note" : "easel";
    pagePill.append(createIcon(isNote ? "note" : "easel", "icon address-icon"), createElement("span", "address-text", isNote ? "Note" : "Easel"));
    centerGroup.append(pagePill);
  } else if (!isDeveloper) {
    const selectedUrl = selectedTab === null ? null : selectedTab.url;
    centerGroup.append(createAddressPill(selectedUrl, state.settings.showsFullUrls === true, hasScriptBoostFor(state, selectedUrl)));
  }

  const rightGroup = createElement("div", "toolbar-group toolbar-right");
  rightGroup.dataset.key = "right";
  if (isDeveloper) {
    rightGroup.append(...createDeveloperButtons(runtimeInfo?.isLoaded === true));
  }
  const addExtensionPill = createAddExtensionPill(state, runtime, selectedTab === null ? null : selectedTab.url);
  if (addExtensionPill !== null) {
    rightGroup.append(addExtensionPill);
  }
  if (hasActiveExtensions(state)) {
    rightGroup.append(createActionButton("puzzle", "Extensions", "toolbar-button", "extensions-menu"));
  }
  // In Developer Mode the lock opens the Control Center instead (Arc's shot 5 has no sliders button).
  if (!isDeveloper) {
    const siteButton = createActionButton("sliders", "Site controls", "toolbar-button", "site-controls");
    siteButton.disabled = selectedTab === null;
    rightGroup.append(siteButton);
  }
  const splitButton = createActionButton("split", "Split view", "toolbar-button", "split-menu");
  splitButton.disabled = selectedTab === null;
  rightGroup.append(splitButton);

  toolbar.classList.toggle("is-developer", isDeveloper);
  document.documentElement.classList.toggle("is-developer-page", isDeveloper);
  morphChildren(toolbar, [leftGroup, centerGroup, rightGroup], { animate: false });
  // Arc's loading glow: a moving line along the top of the page while it loads.
  toolbar.classList.toggle("is-loading", isLoading);
}
