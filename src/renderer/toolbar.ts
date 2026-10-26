/**
 * WHY this file exists:
 *   The row above the page, like the user's Arc with "Show toolbar" on: back, forward, reload, the page's address
 *   (click it to edit, like ⌘L), site controls and split view. It redraws from the state and the runtime facts.
 *
 * Data source:
 *   The selected tab (BrowserState) and its runtime facts (can go back/forward, loading).
 *
 * Data flow:
 *   sidebar.ts renderAll() → renderToolbar() → buttons → dispatch(navigate / openCommandBar / openSiteControls / showMenu)
 */
import type { BrowserState, ItemId, RuntimeState } from "../shared/types";
import { createElement, createIconButton, dispatch, getDisplayHost } from "./dom.js";
import { createIcon } from "./icons.js";

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
  rightGroup.append(siteButton, splitButton);

  toolbar.replaceChildren(leftGroup, centerGroup, rightGroup);
  // Arc's loading glow: a moving line along the top of the page while it loads.
  toolbar.classList.toggle("is-loading", isLoading);
}
