/**
 * WHY this file exists:
 *   A page in a call or sharing the screen must not be put to sleep or archived just because it makes no sound (a
 *   muted call, a screen share with nobody talking), the way Chrome's Memory Saver and Edge's sleeping tabs exempt
 *   such pages. Electron does not say whether a page is capturing, but every camera, microphone and screen-share
 *   request passes our permission handler (profiles.ts), so a page is marked when one is granted.
 *
 * Data source:
 *   profiles.ts setPermissionRequestHandler (camera and microphone after the user's Allow, screen sharing before the
 *   system's picker); the page's own navigation and closing.
 *
 * Data flow:
 *   getUserMedia / getDisplayMedia granted → markCapturing(page) → activity.ts findTabsInUse() and
 *   tabViews.sleepTabView() treat it as in use → the page navigates to another document or closes → mark gone
 */
import type { WebContents } from "electron";

/** The pages (by web contents id) that were allowed the camera, the microphone or a screen share. */
const capturingContentsIds = new Set<number>();

/**
 * Marks a page as capturing until it loads another document or closes. A capture that ended earlier (the call was
 * left, the share stopped) keeps the mark until then: a page stays awake a little longer, never too short.
 */
export function markCapturing(contents: WebContents): void {
  if (contents.isDestroyed() || capturingContentsIds.has(contents.id)) {
    return;
  }
  const contentsId = contents.id;
  capturingContentsIds.add(contentsId);
  const forget = (): void => {
    capturingContentsIds.delete(contentsId);
  };
  contents.once("did-navigate", forget);
  contents.once("destroyed", forget);
}

/**
 * True when the page was allowed to capture and has not navigated away since.
 */
export function isCapturing(contents: WebContents): boolean {
  return capturingContentsIds.has(contents.id);
}
