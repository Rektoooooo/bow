/**
 * WHY this file exists:
 *   The permission prompt: "meet.google.com wants to use your camera and microphone" (or "zoom.us wants to open
 *   zoom.us") with Block and Allow, in a small card at the page's top left, like Arc's (Chromium's) bubble.
 *
 * Data source:
 *   The "permission" panel from permissionPrompts.ts (which site, what it wants, the request id).
 *
 * Data flow:
 *   "overlay:show" (permission) → renderPermissionPrompt() → Allow / Block → dispatch answerPermissionPrompt
 *   Escape or a click outside closes it: refused this time, nothing saved.
 */
import type { OverlayPanel } from "../shared/overlay";
import type { SitePermissionKind } from "../shared/types";
import { createElement, createTextButton, dispatch } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";

/** What each kind lets a site do, as the end of "… wants to". */
const KIND_PHRASES: Record<SitePermissionKind, string> = {
  camera: "use your camera",
  microphone: "use your microphone",
  notifications: "show notifications",
  location: "know your location",
  clipboard: "see what you copy",
};

/**
 * Turns the kinds into one phrase. Camera and microphone together read as one request, the way people say it.
 * Example: ["camera", "microphone"] → "use your camera and microphone"
 */
export function describePermissionKinds(kinds: SitePermissionKind[]): string {
  if (kinds.length === 2 && kinds.includes("camera") && kinds.includes("microphone")) {
    return "use your camera and microphone";
  }
  const phrases = kinds.map((kind) => KIND_PHRASES[kind]);
  if (phrases.length <= 1) {
    return phrases[0] ?? "";
  }
  return `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
}

/**
 * Builds the prompt card.
 */
export function renderPermissionPrompt(host: HTMLElement, panel: Extract<OverlayPanel, { kind: "permission" }>): void {
  const card = createElement("div", "panel permission-prompt");
  card.setAttribute("role", "alertdialog");
  card.setAttribute("aria-label", "Permission request");
  const text = createElement("div", "permission-text");
  text.append(createIcon("lock", "icon permission-icon"));
  const message = createElement("p", "permission-message");
  const wish = panel.appName === null ? describePermissionKinds(panel.kinds) : `open ${panel.appName}`;
  message.append(createElement("strong", "permission-host", panel.host), ` wants to ${wish}`);
  text.append(message);
  const buttons = createElement("div", "permission-buttons");
  buttons.append(
    createTextButton("Block", "permission-button", () => dispatch({ type: "answerPermissionPrompt", requestId: panel.requestId, isAllowed: false })),
    createTextButton("Allow", "permission-button is-primary", () => dispatch({ type: "answerPermissionPrompt", requestId: panel.requestId, isAllowed: true })),
  );
  card.append(text, buttons);
  host.replaceChildren(card);
}
