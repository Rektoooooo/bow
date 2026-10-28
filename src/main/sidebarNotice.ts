/**
 * WHY this file exists:
 *   A short offer at the bottom of the sidebar, with one button, for a few seconds: "Cleared 4 tabs · Undo" after the
 *   sweep or Clear, "Switched to the tab you had open · Open Another" when an address was already open. One at a
 *   time; a new offer replaces the old one.
 *
 * Data source:
 *   Whoever offers it (archiveUndoController.ts, tabActions.ts) with its message, button and what the button does.
 *
 * Data flow:
 *   offerSidebarNotice() → RuntimeState.notice → the sidebar draws it → its button → action runNoticeAction →
 *   runSidebarNoticeAction() → the offer's own function; its time up or × → dismissSidebarNotice()
 */
import { setSidebarNotice } from "./browserCore";

/** What the shown notice's button does, or null when none is shown. */
let noticeAction: (() => void) | null = null;
let noticeTimer: NodeJS.Timeout | null = null;

/**
 * Shows a notice with one button for shownMs (a new one replaces the one on screen).
 */
export function offerSidebarNotice(message: string, buttonLabel: string, run: () => void, shownMs: number): void {
  noticeAction = run;
  setSidebarNotice({ message: message, buttonLabel: buttonLabel });
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer);
  }
  noticeTimer = setTimeout(() => dismissSidebarNotice(), shownMs);
}

/**
 * The notice's button: runs what it offered (once) and takes the notice away.
 */
export function runSidebarNoticeAction(): void {
  const run = noticeAction;
  dismissSidebarNotice();
  run?.();
}

/**
 * Takes the notice away (its time is up, or the user closed it).
 */
export function dismissSidebarNotice(): void {
  noticeAction = null;
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
  setSidebarNotice(null);
}
