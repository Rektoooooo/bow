/**
 * WHY this file exists:
 *   The row above the page, like the user's Arc with "Show toolbar" on: back, forward, reload, the page's address
 *   (click it to edit, like ⌘L), extensions, site controls and split view. It redraws from the state and the runtime
 *   facts.
 *
 * Data source:
 *   The selected tab (BrowserState) and its runtime facts (can go back/forward, loading).
 *
 * Data flow:
 *   sidebar.ts renderAll() → renderToolbar() → morph.ts keeps the buttons → clicks handled by sidebarEvents.ts
 *   (navigate / openCommandBar / showExtensionsMenu / openSiteControls / showMenu / installWebStoreExtension)
 */
import type { BrowserState, ItemId, RuntimeState } from "../shared/types";
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
 * Builds the address pill: a link icon for https pages (Arc's), a globe otherwise, and the address. Clicking edits it.
 */
function createAddressPill(url: string | null): HTMLElement {
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "address-pill";
  pill.dataset.key = "address";
  pill.dataset.action = "open-command-bar";
  pill.dataset.mode = url === null ? "newTab" : "editUrl";
  pill.title = url ?? "";
  pill.setAttribute("aria-label", url === null ? "Search or enter address" : `Edit address ${url}`);

  const isSecure = url !== null && url.startsWith("https://");
  pill.append(createIcon(isSecure ? "link" : "globe", "icon address-icon"));
  const address = url === null ? "" : getDisplayAddress(url);
  const label = address === "" ? url ?? "Search or enter address" : address;
  pill.append(createElement("span", "address-text", label));
  return pill;
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
 * our stand-in for the page's own "Add to Chrome" button. Null everywhere else.
 */
function createAddExtensionPill(state: BrowserState, url: string | null): HTMLButtonElement | null {
  const extensionId = url === null ? null : findWebStoreExtensionId(url);
  const activeSpace = state.spaces.find((space) => space.id === state.activeSpaceId);
  const isAdded = (state.extensions ?? []).some((extension) => extension.id === extensionId && extension.profileId === activeSpace?.profileId && extension.isEnabled);
  if (extensionId === null || isAdded) {
    return null;
  }
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "toolbar-pill";
  pill.dataset.key = `add-extension:${extensionId}`;
  pill.dataset.action = "add-extension";
  pill.dataset.extensionId = extensionId;
  pill.title = "Download this extension from the Chrome Web Store and add it to this profile";
  pill.append(createIcon("puzzle"), createElement("span", "toolbar-pill-text", "Add Extension"));
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

  const leftGroup = createElement("div", "toolbar-group toolbar-left");
  leftGroup.dataset.key = "left";
  if (!state.settings.isSidebarVisible) {
    leftGroup.append(createActionButton("sidebar", "Show sidebar (⌘S)", "toolbar-button", "show-sidebar"));
  }
  const backButton = createActionButton("back", "Back (⌘[)", "toolbar-button", "navigate", { command: "back" });
  backButton.disabled = runtimeInfo?.canGoBack !== true;
  const forwardButton = createActionButton("forward", "Forward (⌘])", "toolbar-button", "navigate", { command: "forward" });
  forwardButton.disabled = runtimeInfo?.canGoForward !== true;
  const isLoading = runtimeInfo?.isLoading === true;
  const reloadButton = isLoading
    ? createActionButton("stop", "Stop (⌘.)", "toolbar-button", "navigate", { command: "stop" })
    : createActionButton("reload", "Reload (⌘R)", "toolbar-button", "navigate", { command: "reload" });
  reloadButton.disabled = selectedTab === null;
  leftGroup.append(backButton, forwardButton, reloadButton);

  const centerGroup = createElement("div", "toolbar-group toolbar-center");
  centerGroup.dataset.key = "center";
  centerGroup.append(createAddressPill(selectedTab === null ? null : selectedTab.url));

  const rightGroup = createElement("div", "toolbar-group toolbar-right");
  rightGroup.dataset.key = "right";
  const addExtensionPill = createAddExtensionPill(state, selectedTab === null ? null : selectedTab.url);
  if (addExtensionPill !== null) {
    rightGroup.append(addExtensionPill);
  }
  if (hasActiveExtensions(state)) {
    rightGroup.append(createActionButton("puzzle", "Extensions", "toolbar-button", "extensions-menu"));
  }
  const siteButton = createActionButton("sliders", "Site controls", "toolbar-button", "site-controls");
  siteButton.disabled = selectedTab === null;
  const splitButton = createActionButton("split", "Split view", "toolbar-button", "split-menu");
  splitButton.disabled = selectedTab === null;
  rightGroup.append(siteButton, splitButton);

  morphChildren(toolbar, [leftGroup, centerGroup, rightGroup], { animate: false });
  // Arc's loading glow: a moving line along the top of the page while it loads.
  toolbar.classList.toggle("is-loading", isLoading);
}
