/**
 * WHY this file exists:
 *   The first start's intro page (intro.html, in a see-through window over the screen, main/onboardingIntro.ts): the
 *   glow appears where the onboarding window will be and breathes until main asks it to grow; then a sheet drawn like
 *   the onboarding's background opens out of it, from a circle the glow's size to the window's exact frame, and the
 *   real window takes over. With less motion the sheet only fades in.
 *
 * Data source:
 *   The address's query: the onboarding window's place in this window (x, y, width, height) and whether it is dark.
 *
 * Data flow:
 *   load → place the frame → the glow appears and breathes → main runs window.growIntoWindow() → the sheet opens →
 *   the promise resolves → main shows the onboarding window and closes this one
 */

/** The glow fades and swells in this fast. Our choice. */
const GLOW_APPEAR_MS = 900;

/** The sheet opens out of the glow in this long, on a curve that starts quick and settles softly. Our choice. */
const GROW_MS = 1000;
const GROW_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

/** The sheet starts as a circle about the glow's size. Our choice. */
const START_SIZE_PX = 200;

/** With less motion, the sheet only fades in, this fast. */
const REDUCED_FADE_MS = 220;

declare global {
  interface Window {
    growIntoWindow(): Promise<boolean>;
  }
}

/**
 * A number from the query, or 0 when it is missing or not a number.
 */
function readNumber(parameters: URLSearchParams, name: string): number {
  const value = Number(parameters.get(name));
  return Number.isFinite(value) ? value : 0;
}

/**
 * True when macOS asks for less motion.
 */
function prefersLessMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Opens the sheet out of the glow to the window's frame. Resolves when it is done.
 */
async function growIntoWindow(frame: HTMLElement): Promise<boolean> {
  const sheet = frame.querySelector<HTMLElement>(".intro-sheet");
  const glow = frame.querySelector<HTMLElement>(".intro-glow");
  const shadow = frame.querySelector<HTMLElement>(".intro-shadow");
  if (sheet === null || glow === null || shadow === null) {
    return false;
  }
  if (prefersLessMotion()) {
    const fade = sheet.animate([{ opacity: 0, clipPath: "none" }, { opacity: 1, clipPath: "none" }], { duration: REDUCED_FADE_MS, fill: "forwards" });
    glow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REDUCED_FADE_MS, fill: "forwards" });
    await fade.finished;
    return true;
  }
  const corner = getComputedStyle(frame).getPropertyValue("--intro-corner").trim() || "16px";
  const insetX = Math.max(0, (frame.clientWidth - START_SIZE_PX) / 2);
  const insetY = Math.max(0, (frame.clientHeight - START_SIZE_PX) / 2);
  const sheetFrames = [
    { opacity: 0, clipPath: `inset(${insetY}px ${insetX}px round ${START_SIZE_PX / 2}px)`, offset: 0 },
    { opacity: 1, offset: 0.3 },
    { opacity: 1, clipPath: `inset(0px 0px round ${corner})`, offset: 1 },
  ];
  const opening = sheet.animate(sheetFrames, { duration: GROW_MS, easing: GROW_EASING, fill: "forwards" });
  glow.animate([{ opacity: 1, scale: "1" }, { opacity: 0, scale: "3.2" }], { duration: GROW_MS * 0.8, easing: GROW_EASING, fill: "forwards" });
  shadow.animate([{ opacity: 0 }, { opacity: 0, offset: 0.55 }, { opacity: 1 }], { duration: GROW_MS, fill: "forwards" });
  await opening.finished;
  return true;
}

/**
 * Places the frame where the onboarding window will be, and lets the glow appear and breathe.
 */
function startIntro(): void {
  const parameters = new URLSearchParams(window.location.search);
  document.body.classList.toggle("dark", parameters.get("dark") === "1");
  const frame = document.getElementById("intro-frame");
  if (frame === null) {
    return;
  }
  frame.style.left = `${readNumber(parameters, "x")}px`;
  frame.style.top = `${readNumber(parameters, "y")}px`;
  frame.style.width = `${readNumber(parameters, "width")}px`;
  frame.style.height = `${readNumber(parameters, "height")}px`;
  window.growIntoWindow = () => growIntoWindow(frame);
  const glow = frame.querySelector<HTMLElement>(".intro-glow");
  if (glow === null) {
    return;
  }
  // `scale` and `opacity` here, so the breathing (a CSS `transform` animation) keeps running underneath.
  glow.animate([{ opacity: 0, scale: "0.4" }, { opacity: 1, scale: "1" }], { duration: GLOW_APPEAR_MS, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" });
  glow.classList.add("is-breathing");
}

startIntro();

export {};
