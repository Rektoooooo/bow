/**
 * WHY this file exists:
 *   Draws the controls on top of the picture-in-picture video (the user's approved design): the tab's icon and
 *   title, back to the tab, close, play / pause, mute, and a progress bar to jump with. They show while the pointer
 *   is over the window.
 *
 * Data source:
 *   The status pictureInPicture.ts sends through window.pipApi (title, play state, time), and whether the pointer is
 *   over the window (the main process asks the screen: the window's background is a drag region, which hears no
 *   pointer events).
 *
 * Data flow:
 *   "pip:status" → renderStatus(); "pip:hover" → body.is-hovered
 *   button click → pipApi.command(); progress click → pipApi.seek(share)
 */
import type { PictureInPictureCommand, PictureInPictureStatus } from "../shared/pictureInPicture";
import type { SymbolImage } from "../shared/symbols";
import { createIcon, installSymbols } from "../renderer/icons.js";
import type { IconName } from "../renderer/icons.js";

/** The bridge pipPreload.ts provides. */
interface PipApi {
  onStatus(listener: (status: PictureInPictureStatus) => void): void;
  onHover(listener: (isHovered: boolean) => void): void;
  command(command: PictureInPictureCommand): Promise<void>;
  seek(fraction: number): Promise<void>;
  getSymbols(): Promise<Record<string, SymbolImage>>;
}

declare global {
  interface Window {
    pipApi: PipApi;
  }
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** The parts of the controls that change with the status. */
interface Controls {
  root: HTMLElement;
  favicon: HTMLImageElement;
  title: HTMLElement;
  playButton: HTMLButtonElement;
  muteButton: HTMLButtonElement;
  progress: HTMLElement;
  time: HTMLElement;
}

/**
 * "1:05", or "1:02:05" past an hour.
 */
function formatTime(totalSeconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(wholeSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((wholeSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = String(wholeSeconds % SECONDS_PER_MINUTE).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
  }
  return `${minutes}:${seconds}`;
}

/**
 * A round glass button with an icon that runs one command.
 */
function createButton(className: string, label: string, icon: IconName, command: PictureInPictureCommand): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `pip-button pip-glass ${className}`;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(createIcon(icon));
  button.addEventListener("click", () => {
    window.pipApi.command(command).catch(() => undefined);
  });
  return button;
}

/**
 * Swaps a button's icon and label (play ↔ pause, sound ↔ muted).
 */
function setButtonIcon(button: HTMLButtonElement, icon: IconName, label: string): void {
  if (button.getAttribute("aria-label") === label) {
    return;
  }
  button.setAttribute("aria-label", label);
  button.title = label;
  button.replaceChildren(createIcon(icon));
}

/**
 * Jumps to where the progress bar was clicked.
 */
function seekToPointer(progress: HTMLElement, event: MouseEvent): void {
  const box = progress.getBoundingClientRect();
  if (box.width <= 0) {
    return;
  }
  const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  window.pipApi.seek(share).catch(() => undefined);
}

/**
 * Builds the controls once; renderStatus() fills them in.
 */
function buildControls(root: HTMLElement): Controls {
  const site = document.createElement("div");
  site.className = "pip-site pip-glass";
  const favicon = document.createElement("img");
  favicon.className = "pip-favicon";
  favicon.alt = "";
  favicon.hidden = true;
  const title = document.createElement("span");
  title.className = "pip-title";
  site.append(favicon, title);

  const backButton = createButton("pip-back", "Back to Tab", "pictureInPictureExit", "backToTab");
  const closeButton = createButton("pip-close", "Close", "close", "close");
  const playButton = createButton("pip-play", "Pause", "pause", "togglePlayback");
  const muteButton = createButton("pip-mute", "Mute", "speaker", "toggleMute");

  const progress = document.createElement("div");
  progress.className = "pip-progress";
  const track = document.createElement("div");
  track.className = "pip-progress-track";
  const fill = document.createElement("div");
  fill.className = "pip-progress-fill";
  track.append(fill);
  progress.append(track);
  progress.addEventListener("click", (event) => seekToPointer(progress, event));

  const time = document.createElement("div");
  time.className = "pip-time";

  root.append(site, backButton, closeButton, playButton, muteButton, progress, time);
  return { root: root, favicon: favicon, title: title, playButton: playButton, muteButton: muteButton, progress: fill, time: time };
}

/**
 * Shows the newest status: title, play / pause, mute and the progress.
 */
function renderStatus(controls: Controls, status: PictureInPictureStatus): void {
  controls.title.textContent = status.title;
  // The icon shows once it loaded (start()): a site without one, or a broken one, leaves no gap.
  const faviconUrl = status.faviconUrl ?? "";
  if (controls.favicon.getAttribute("src") !== faviconUrl) {
    controls.favicon.hidden = true;
    controls.favicon.src = faviconUrl;
  }
  setButtonIcon(controls.playButton, status.isPaused ? "play" : "pause", status.isPaused ? "Play" : "Pause");
  setButtonIcon(controls.muteButton, status.isMuted ? "speakerMuted" : "speaker", status.isMuted ? "Unmute" : "Mute");
  const isLive = status.duration === null || status.duration <= 0;
  controls.root.classList.toggle("is-live", isLive);
  if (isLive || status.duration === null) {
    return;
  }
  const share = Math.min(1, status.currentTime / status.duration);
  controls.progress.style.setProperty("--progress", String(share));
  controls.time.textContent = `${formatTime(status.currentTime)} / ${formatTime(status.duration)}`;
}

/**
 * Starts the page: icons, the controls, and the two listeners.
 */
function start(): void {
  const root = document.getElementById("pip-controls");
  if (root === null) {
    return;
  }
  window.pipApi.getSymbols().then(installSymbols).catch(() => undefined);
  const controls = buildControls(root);
  controls.favicon.addEventListener("load", () => {
    controls.favicon.hidden = false;
  });
  window.pipApi.onStatus((status) => renderStatus(controls, status));
  window.pipApi.onHover((isHovered) => document.body.classList.toggle("is-hovered", isHovered));
}

start();
