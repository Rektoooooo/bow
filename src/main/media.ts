/**
 * WHY this file exists:
 *   Two Arc media behaviors. When a tab plays sound in the background, the sidebar shows a small player (play /
 *   pause, dismiss). When you leave a tab whose video is playing, the video continues in Picture-in-Picture, and
 *   comes back into the page when you return to the tab.
 *
 * Data source:
 *   Which tabs are on screen (tabViews.ts), which are audible (runtime facts), and the pages' <video>/<audio>
 *   elements, reached with small scripts run in an isolated world (the page's own scripts cannot interfere).
 *
 * Data flow:
 *   browserCore.syncViews() → handleShownTabsChanged(before, after) → Picture-in-Picture in / out
 *   browserCore.collectRuntimeState() → findMediaInfo() → sidebar player
 *   sidebar play/pause → toggleMediaPlayback() → script in the tab
 */
import type { MediaInfo, TabRuntimeInfo } from "../shared/types";
import type { ItemId } from "../shared/types";
import { getTabContents } from "./tabViews";

/** A world of our own inside the page: shares the page's DOM, not its JavaScript. Any number above 0 works. */
const MEDIA_SCRIPT_WORLD_ID = 1031;

/**
 * Puts the first playing video with sound into Picture-in-Picture. Resolves to true when it did. Muted videos (the
 * silent previews many sites autoplay) are left alone, like Arc does.
 */
const ENTER_PICTURE_IN_PICTURE_SCRIPT = `(async () => {
  const videos = Array.from(document.querySelectorAll("video"));
  const playingVideo = videos.find((video) => !video.paused && !video.ended && !video.muted && video.volume > 0 && !video.disablePictureInPicture);
  if (playingVideo === undefined || document.pictureInPictureElement !== null) {
    return false;
  }
  try {
    await playingVideo.requestPictureInPicture();
    return true;
  } catch {
    return false;
  }
})()`;

/** Brings a Picture-in-Picture video back into the page. */
const EXIT_PICTURE_IN_PICTURE_SCRIPT = `(async () => {
  if (document.pictureInPictureElement === null) {
    return false;
  }
  await document.exitPictureInPicture();
  return true;
})()`;

/** Pauses everything that plays, or resumes the media that was playing. Resolves to the new "is playing". */
const TOGGLE_PLAYBACK_SCRIPT = `(() => {
  const media = Array.from(document.querySelectorAll("video, audio"));
  const playing = media.filter((element) => !element.paused);
  if (playing.length > 0) {
    playing.forEach((element) => element.pause());
    return false;
  }
  const resumable = media.find((element) => element.currentTime > 0 && !element.ended) ?? media[0];
  if (resumable === undefined) {
    return false;
  }
  resumable.play();
  return true;
})()`;

/** Pauses everything that plays. */
const PAUSE_ALL_SCRIPT = `(() => {
  Array.from(document.querySelectorAll("video, audio")).forEach((element) => element.pause());
  return true;
})()`;

/** The tab the sidebar player controls, or null. */
let mediaTabId: ItemId | null = null;

/**
 * Whether the player's tab is playing. Chromium keeps reporting a background tab as audible for a while after its
 * media was paused, so "audible" only switches this on; the play / pause script's answer switches it either way.
 */
let isMediaPlaying = false;

/** The player tab's audible flag at the previous check, to notice when sound starts again. */
let wasAudible = false;

/** Tabs whose video we moved into Picture-in-Picture, so returning to them brings it back. */
const tabsInPictureInPicture = new Set<ItemId>();

/**
 * Runs one of the scripts above in a tab's isolated world. User gesture is set, because browsers only allow
 * Picture-in-Picture and play() after one.
 */
async function runMediaScript(tabId: ItemId, script: string): Promise<boolean> {
  const contents = getTabContents(tabId);
  if (contents === null) {
    return false;
  }
  try {
    const result: unknown = await contents.executeJavaScriptInIsolatedWorld(MEDIA_SCRIPT_WORLD_ID, [{ code: script }], true);
    return result === true;
  } catch {
    return false;
  }
}

/**
 * Called after the shown tabs changed. Tabs that left the screen while playing video go into Picture-in-Picture
 * (Arc's automatic Picture-in-Picture); tabs that came back leave it.
 */
export function handleShownTabsChanged(previousTabIds: ItemId[], shownTabIds: ItemId[]): void {
  for (const tabId of previousTabIds) {
    if (shownTabIds.includes(tabId)) {
      continue;
    }
    runMediaScript(tabId, ENTER_PICTURE_IN_PICTURE_SCRIPT).then((entered) => {
      if (entered) {
        tabsInPictureInPicture.add(tabId);
      }
    });
  }
  for (const tabId of shownTabIds) {
    if (!tabsInPictureInPicture.has(tabId)) {
      continue;
    }
    tabsInPictureInPicture.delete(tabId);
    runMediaScript(tabId, EXIT_PICTURE_IN_PICTURE_SCRIPT);
  }
}

/**
 * Decides what the sidebar player shows: the tab that plays sound in the background (the newest one if several),
 * or the tab it showed before while that tab's media is paused. Nothing while that tab is on screen.
 */
export function findMediaInfo(tabsRuntime: Record<ItemId, TabRuntimeInfo>, shownTabIds: ItemId[]): MediaInfo | null {
  if (mediaTabId !== null && tabsRuntime[mediaTabId] === undefined) {
    // Its page was closed.
    mediaTabId = null;
  }
  for (const [tabId, info] of Object.entries(tabsRuntime)) {
    const playsInBackground = info.isAudible && !shownTabIds.includes(tabId);
    const currentIsSilent = mediaTabId === null || tabsRuntime[mediaTabId]?.isAudible !== true;
    if (playsInBackground && currentIsSilent && tabId !== mediaTabId) {
      mediaTabId = tabId;
      isMediaPlaying = true;
      wasAudible = true;
    }
  }
  if (mediaTabId === null) {
    return null;
  }
  const isAudible = tabsRuntime[mediaTabId]?.isAudible === true;
  if (isAudible && !wasAudible) {
    // Sound started again (played from the page itself).
    isMediaPlaying = true;
  }
  wasAudible = isAudible;
  if (shownTabIds.includes(mediaTabId)) {
    return null;
  }
  return { tabId: mediaTabId, isPlaying: isMediaPlaying };
}

/**
 * The player's play / pause button.
 */
export async function toggleMediaPlayback(): Promise<void> {
  if (mediaTabId !== null) {
    isMediaPlaying = await runMediaScript(mediaTabId, TOGGLE_PLAYBACK_SCRIPT);
  }
}

/**
 * The player's × button: pauses the media and hides the player.
 */
export async function dismissMedia(): Promise<void> {
  if (mediaTabId === null) {
    return;
  }
  const tabId = mediaTabId;
  mediaTabId = null;
  isMediaPlaying = false;
  await runMediaScript(tabId, PAUSE_ALL_SCRIPT);
}
