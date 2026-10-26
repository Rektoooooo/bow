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
 *   sidebar.ts renderAll() → renderToolbar() → buttons → dispatch(navigate / openCommandBar / showExtensionsMenu /
 *   openSiteControls / showMenu)
 */
import type { BrowserState, ItemId, RuntimeState } from "../shared/types";
import { createElement, createIconButton, dispatch, getDisplayHost } from "./dom.js";
import { createIcon } from "./icons.js";
import { findWebStoreExtensionId } from "../shared/webStore.js";

/**
 * Builds the address pill: a lock for https pages (a globe otherwise) and the host name. Clicking edits the address.
 */
function createAddressPill(url: string | null): HTMLElement {
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "address-pill";
  pill.title = url ?? "";
  pill.setAttribute("aria-label", url === null ? "Search or enter address" : `Edit address ${url}`);

  const isSecure = url !== null && url.startsWith("https://");
  pill.append(createIcon(isSecure ? "lock" : "globe", "icon address-icon"));
  const host = url === null ? "" : getDisplayHost(url);
  const label = host === "" ? url ?? "Search or enter address" : host;
  pill.append(createElement("span", "address-text", label));

  pill.addEventListener("click", () => {
    const mode = url === null ? "newTab" : "editUrl";
    dispatch({ type: "openCommandBar", mode: mode });
  });
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
  pill.title = "Download this extension from the Chrome Web Store and add it to this profile";
  pill.append(createIcon("puzzle"), createElement("span", "toolbar-pill-text", "Add Extension"));
  pill.addEventListener("click", () => {
    pill.disabled = true;
    pill.querySelector(".toolbar-pill-text")?.replaceChildren("Adding…");
    dispatch({ type: "installWebStoreExtension", extensionId: extensionId });
  });
  return pill;
}

/**
 * Builds the extensions button. The menu and an extension's popup open below it, so it sends where it sits.
 */
function createExtensionsButton(): HTMLButtonElement {
  const button = createIconButton("puzzle", "Extensions", "toolbar-button", () => {
    const box = button.getBoundingClientRect();
    const anchor = { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) };
    dispatch({ type: "showExtensionsMenu", anchor: anchor });
  });
  return button;
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
  if (!state.settings.isSidebarVisible) {
    leftGroup.append(createIconButton("sidebar", "Show sidebar (⌘S)", "toolbar-button", () => {
      dispatch({ type: "setSidebarVisible", isVisible: true });
    }));
  }
  const backButton = createIconButton("back", "Back (⌘[)", "toolbar-button", () => dispatch({ type: "navigate", command: "back" }));
  backButton.disabled = runtimeInfo?.canGoBack !== true;
  const forwardButton = createIconButton("forward", "Forward (⌘])", "toolbar-button", () => dispatch({ type: "navigate", command: "forward" }));
  forwardButton.disabled = runtimeInfo?.canGoForward !== true;
  const isLoading = runtimeInfo?.isLoading === true;
  const reloadButton = isLoading
    ? createIconButton("stop", "Stop (⌘.)", "toolbar-button", () => dispatch({ type: "navigate", command: "stop" }))
    : createIconButton("reload", "Reload (⌘R)", "toolbar-button", () => dispatch({ type: "navigate", command: "reload" }));
  reloadButton.disabled = selectedTab === null;
  leftGroup.append(backButton, forwardButton, reloadButton);

  const centerGroup = createElement("div", "toolbar-group toolbar-center");
  centerGroup.append(createAddressPill(selectedTab === null ? null : selectedTab.url));

  const rightGroup = createElement("div", "toolbar-group toolbar-right");
  const siteButton = createIconButton("sliders", "Site controls", "toolbar-button", () => dispatch({ type: "openSiteControls" }));
  siteButton.disabled = selectedTab === null;
  const splitButton = createIconButton("split", "Split view", "toolbar-button", () => dispatch({ type: "showMenu", request: { menu: "split" } }));
  splitButton.disabled = selectedTab === null;
  const addExtensionPill = createAddExtensionPill(state, selectedTab === null ? null : selectedTab.url);
  if (addExtensionPill !== null) {
    rightGroup.append(addExtensionPill);
  }
  if (hasActiveExtensions(state)) {
    rightGroup.append(createExtensionsButton());
  }
  rightGroup.append(siteButton, splitButton);

  toolbar.replaceChildren(leftGroup, centerGroup, rightGroup);
  // Arc's loading glow: a moving line along the top of the page while it loads.
  toolbar.classList.toggle("is-loading", isLoading);
}
