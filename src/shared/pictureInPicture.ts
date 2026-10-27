/**
 * WHY this file exists:
 *   Our picture-in-picture window has a small controls page of its own (src/pip) on top of the video. This file
 *   lists the messages between that page and the main process (main/pictureInPicture.ts), so both sides agree on
 *   their shape.
 *
 * Data source:
 *   None. Types and channel names only.
 *
 * Data flow:
 *   pictureInPicture.ts → "pip:status" / "pip:hover" → pip.ts draws the controls
 *   pip.ts → pipApi.command / seek → pictureInPicture.ts
 */

/** Channel names between the controls page and the main process. pipPreload.ts repeats them. */
export const PIP_CHANNELS = {
  status: "pip:status",
  hover: "pip:hover",
  command: "pip:command",
  seek: "pip:seek",
} as const;

/** The controls' buttons. */
export const PIP_COMMANDS = ["togglePlayback", "toggleMute", "backToTab", "close"] as const;

export type PictureInPictureCommand = (typeof PIP_COMMANDS)[number];

/** What the controls show: the tab, and where its video is. */
export interface PictureInPictureStatus {
  title: string;
  faviconUrl: string | null;
  isPaused: boolean;
  isMuted: boolean;
  /** Seconds played. */
  currentTime: number;
  /** Seconds in all; null for a live stream or before the video knows (the controls then show no progress). */
  duration: number | null;
}
