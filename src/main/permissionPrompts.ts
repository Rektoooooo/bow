/**
 * WHY this file exists:
 *   Asks the user when a site wants the camera, microphone, location, notifications or the clipboard, like the prompt
 *   Arc (Chromium) shows under the address bar, and remembers the answer per profile and site. Private windows ask
 *   every time and remember nothing. Links to apps (mailto:, zoommtg:, steam:) ask every time. Our own pages never
 *   get here: profiles.ts refuses them first.
 *
 * Data source:
 *   Requests from profiles.ts's permission handlers; saved answers in BrowserState.sitePermissions (sitePermissions.ts).
 *
 * Data flow:
 *   page asks → profiles.ts → request() → saved answer, or a queued prompt → overlay panel "permission"
 *   → Allow / Block (action answerPermissionPrompt) → answerPermissionPrompt() → applyChange(setPermissionAnswer)
 *   → the page gets its answer. Escape or a click outside refuses this once and saves nothing.
 */
import { app } from "electron";
import type { WebContents } from "electron";
import type { ProfileId, SitePermissionKind } from "../shared/types";
import { applyChange, getState } from "./browserCore";
import { isOverlayShown } from "./overlay";
import { closePermissionPrompt, isPanelShown, onPanelEnded, openPermissionPrompt } from "./overlayController";
import { setPermissionDecider } from "./profiles";
import { findPermissionAnswer, setPermissionAnswer } from "./sitePermissions";

/** How often a waiting prompt checks whether the overlay is free again (it can be busy with a Peek). */
const BUSY_RETRY_MS = 1000;

/** A question waiting for the user. Several requests for the same thing share one prompt. */
interface PendingPrompt {
  id: string;
  /** Null for a private window: the answer is not saved. */
  profileId: ProfileId | null;
  origin: string;
  kinds: SitePermissionKind[];
  /** For a link to an app: the app's name. Such answers are never saved. */
  appName: string | null;
  answerRequests: ((isAllowed: boolean) => void)[];
}

/** Questions in the order they came; the first one is on screen when shownPromptId is set. */
const pendingPrompts: PendingPrompt[] = [];

let shownPromptId: string | null = null;
let promptCounter = 0;
let retryTimer: NodeJS.Timeout | null = null;

/**
 * Connects the prompts to the permission handlers and to the overlay. Runs once at startup.
 */
export function initializePermissionPrompts(): void {
  setPermissionDecider({
    isAllowed: (profileId, origin, kinds) =>
      profileId !== null && kinds.every((kind) => findPermissionAnswer(getState(), profileId, origin, kind) === true),
    request: (contents, profileId, origin, kinds) => request(contents, profileId, origin, kinds),
    requestOpenApp: (contents, origin, externalUrl) => requestOpenApp(contents, origin, externalUrl),
  });
  onPanelEnded((panel, reason) => {
    if (panel.kind === "permission" && panel.requestId === shownPromptId) {
      shownPromptId = null;
      if (reason === "closed") {
        // Escape or a click outside: refused this time, nothing saved, the site may ask again.
        settlePrompt(panel.requestId, false, false);
      }
    }
    showNextPrompt();
  });
}

/**
 * Answers a request from its saved answer, or queues a prompt. Any saved "block" refuses; all saved "allow" grants.
 */
function request(contents: WebContents | null, profileId: ProfileId | null, origin: string, kinds: SitePermissionKind[]): Promise<boolean> {
  if (profileId !== null) {
    const answers = kinds.map((kind) => findPermissionAnswer(getState(), profileId, origin, kind));
    if (answers.includes(false)) {
      return Promise.resolve(false);
    }
    if (answers.every((answer) => answer === true)) {
      return Promise.resolve(true);
    }
  }
  return askUser(contents, profileId, origin, kinds, null);
}

/**
 * A link to an app: asks every time, naming the app macOS would open. Refused without asking when no app handles it.
 */
function requestOpenApp(contents: WebContents | null, origin: string, externalUrl: string): Promise<boolean> {
  const appName = externalUrl === "" ? "" : app.getApplicationNameForProtocol(externalUrl);
  if (appName === "") {
    return Promise.resolve(false);
  }
  return askUser(contents, null, origin, [], appName);
}

/**
 * Queues a prompt, or joins the same question already waiting.
 */
function askUser(contents: WebContents | null, profileId: ProfileId | null, origin: string, kinds: SitePermissionKind[], appName: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    const sameQuestion = pendingPrompts.find(
      (prompt) => prompt.profileId === profileId && prompt.origin === origin && prompt.kinds.join() === kinds.join() && prompt.appName === appName,
    );
    if (sameQuestion !== undefined) {
      sameQuestion.answerRequests.push(resolve);
      return;
    }
    promptCounter = promptCounter + 1;
    const prompt: PendingPrompt = { id: `permission-${promptCounter}`, profileId: profileId, origin: origin, kinds: kinds, appName: appName, answerRequests: [resolve] };
    pendingPrompts.push(prompt);
    // A tab that closes while its question waits takes the question with it.
    contents?.once("destroyed", () => settlePrompt(prompt.id, false, false));
    showNextPrompt();
  });
}

/**
 * Shows the first waiting prompt when nothing else is on the overlay.
 */
function showNextPrompt(): void {
  const next = pendingPrompts[0];
  if (shownPromptId !== null || next === undefined) {
    return;
  }
  if (isPanelShown() || isOverlayShown()) {
    if (retryTimer === null) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        showNextPrompt();
      }, BUSY_RETRY_MS);
    }
    return;
  }
  shownPromptId = next.id;
  openPermissionPrompt(next.id, new URL(next.origin).host, next.kinds, next.appName);
}

/**
 * Gives every request waiting on a prompt its answer, saves it when asked to, and takes the prompt off screen.
 */
function settlePrompt(requestId: string, isAllowed: boolean, isSaved: boolean): void {
  const index = pendingPrompts.findIndex((prompt) => prompt.id === requestId);
  if (index === -1) {
    return;
  }
  const [prompt] = pendingPrompts.splice(index, 1);
  if (prompt === undefined) {
    return;
  }
  const profileId = prompt.profileId;
  if (isSaved && profileId !== null) {
    applyChange((state) => prompt.kinds.reduce((next, kind) => setPermissionAnswer(next, profileId, prompt.origin, kind, isAllowed), state));
  }
  for (const answerRequest of prompt.answerRequests) {
    answerRequest(isAllowed);
  }
  if (shownPromptId === requestId) {
    closePermissionPrompt(requestId);
  }
}

/**
 * Allow or Block on a prompt: answers the site and remembers it (not in private windows).
 */
export function answerPermissionPrompt(requestId: string, isAllowed: boolean): void {
  settlePrompt(requestId, isAllowed, true);
}
