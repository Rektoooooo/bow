/**
 * WHY this file exists:
 *   The first start's intro page (intro.html, in a see-through window over the screen, main/onboardingIntro.ts): the
 *   desktop dims and the blob appears where the onboarding window will be, breathing until main asks it to grow; then
 *   it swells and flows into the window's exact frame while its blur clears and its colors become the window's
 *   background, and the real window takes over. Last, the dimming lifts. With less motion everything only fades.
 *
 * Data source:
 *   The address's query: the onboarding window's place in this window (x, y, width, height).
 *
 * Data flow:
 *   load → place the frame → dim, the blob appears and breathes → main: window.growIntoWindow() → resolves when the
 *   shape is the window → main shows the onboarding window → window.leaveIntro() → resolves when the dimming is gone
 */

/** The dimming and the blob fade in this fast. Our choice, timed against the user's recording of Arc's start. */
const DIM_IN_MS = 700;
const BLOB_APPEAR_MS = 1000;

/** The grow: a slow swell, then a quick flow into the window that settles softly. Our choice. */
const GROW_MS = 1150;
const SWELL_AT = 0.32;
const SWELL_EASING = "cubic-bezier(0.45, 0, 0.55, 1)";
const FLOW_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** The swollen blob, before it flows into the window: wider than tall, like the window it is about to become. */
const SWELL_SHAPE =
  "inset(calc(50% - 250px) calc(50% - 352px) calc(50% - 238px) calc(50% - 340px) round 268px 238px 294px 256px / 240px 268px 250px 284px)";

/** The blur while it waits and swells; it clears as the shape lands. */
const BLOB_BLUR = "blur(30px)";
const SWELL_BLUR = "blur(36px)";

/** After the window shows, the sheet under it stays a moment (the window's first frame may still be on its way). */
const SHEET_HOLD_MS = 160;
const DIM_OUT_MS = 700;

/** With less motion, steps only fade, this fast. */
const REDUCED_FADE_MS = 220;

declare global {
  interface Window {
    growIntoWindow(): Promise<boolean>;
    leaveIntro(): Promise<boolean>;
  }
}

/** The page's parts. */
interface IntroParts {
  frame: HTMLElement;
  scrim: HTMLElement;
  hole: HTMLElement;
  shadow: HTMLElement;
  soft: HTMLElement;
  shape: HTMLElement;
  windowFill: HTMLElement;
  blobFill: HTMLElement;
  lights: HTMLElement[];
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
 * Finds the page's parts; null when the page is not the one expected.
 */
function findParts(): IntroParts | null {
  const frame = document.getElementById("intro-frame");
  const scrim = document.querySelector<HTMLElement>(".intro-scrim");
  if (frame === null || scrim === null) {
    return null;
  }
  const find = (selector: string): HTMLElement | null => frame.querySelector<HTMLElement>(selector);
  const hole = find(".intro-hole");
  const shadow = find(".intro-shadow");
  const soft = find(".intro-soft");
  const shape = find(".intro-shape");
  const windowFill = find(".intro-window-fill");
  const blobFill = find(".intro-blob-fill");
  if (hole === null || shadow === null || soft === null || shape === null || windowFill === null || blobFill === null) {
    return null;
  }
  const lights = Array.from(frame.querySelectorAll<HTMLElement>(".intro-highlight, .intro-glint"));
  return { frame, scrim, hole, shadow, soft, shape, windowFill, blobFill, lights };
}

/**
 * The window has landed: the plain scrim gives way to the one with a hole where the window is (identical elsewhere),
 * so whatever ends up above, the window itself is never dimmed.
 */
function openHoleInScrim(parts: IntroParts): void {
  parts.hole.style.opacity = "1";
  parts.scrim.style.opacity = "0";
  parts.scrim.getAnimations().forEach((animation) => animation.cancel());
}

/**
 * The shape flows from the blob into the window's frame. Resolves when it is the window.
 */
async function growIntoWindow(parts: IntroParts): Promise<boolean> {
  const corner = getComputedStyle(parts.frame).getPropertyValue("--intro-corner").trim() || "16px";
  const windowShape = `inset(0px 0px 0px 0px round ${corner} ${corner} ${corner} ${corner} / ${corner} ${corner} ${corner} ${corner})`;
  if (prefersLessMotion()) {
    parts.shape.classList.remove("is-breathing");
    parts.shape.style.clipPath = windowShape;
    parts.soft.style.filter = "none";
    parts.lights.forEach((light) => light.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REDUCED_FADE_MS, fill: "forwards" }));
    parts.blobFill.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REDUCED_FADE_MS, fill: "forwards" });
    const fade = parts.windowFill.animate([{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_FADE_MS, fill: "forwards" });
    await fade.finished;
    openHoleInScrim(parts);
    return true;
  }
  // Start from wherever the breathing is now, so the grow does not jump.
  const breathingShape = getComputedStyle(parts.shape).clipPath;
  parts.shape.classList.remove("is-breathing");
  const timing = { duration: GROW_MS, fill: "forwards" as const };
  const growth = parts.shape.animate(
    [
      { clipPath: breathingShape, offset: 0, easing: SWELL_EASING },
      { clipPath: SWELL_SHAPE, offset: SWELL_AT, easing: FLOW_EASING },
      { clipPath: windowShape, offset: 1 },
    ],
    timing,
  );
  parts.soft.animate(
    [
      { filter: BLOB_BLUR, offset: 0, easing: SWELL_EASING },
      { filter: SWELL_BLUR, offset: SWELL_AT, easing: FLOW_EASING },
      { filter: "blur(0px)", offset: 1 },
    ],
    timing,
  );
  // The blob's core and its lights go early, so no lighter spot is left in the middle while it becomes the window.
  parts.blobFill.animate([{ opacity: 1 }, { opacity: 1, offset: 0.12 }, { opacity: 0, offset: 0.42 }, { opacity: 0 }], timing);
  parts.windowFill.animate([{ opacity: 0 }, { opacity: 0, offset: 0.15 }, { opacity: 1, offset: 0.6 }, { opacity: 1 }], timing);
  parts.lights.forEach((light) => light.animate([{ opacity: 1 }, { opacity: 0, offset: 0.22 }, { opacity: 0 }], timing));
  parts.shadow.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], timing);
  await growth.finished;
  openHoleInScrim(parts);
  return true;
}

/**
 * The window has taken over: the sheet under it goes, and the dimming lifts. Resolves when the desktop is back.
 */
async function leaveIntro(parts: IntroParts): Promise<boolean> {
  const duration = prefersLessMotion() ? REDUCED_FADE_MS : DIM_OUT_MS;
  const lifting = parts.hole.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration, easing: "ease-out", fill: "forwards" });
  window.setTimeout(() => {
    parts.soft.style.visibility = "hidden";
    parts.shadow.style.visibility = "hidden";
  }, SHEET_HOLD_MS);
  await lifting.finished;
  return true;
}

/**
 * Places the frame where the onboarding window will be, dims the desktop and lets the blob appear and breathe.
 */
function startIntro(): void {
  const parameters = new URLSearchParams(window.location.search);
  const parts = findParts();
  if (parts === null) {
    return;
  }
  parts.frame.style.left = `${readNumber(parameters, "x")}px`;
  parts.frame.style.top = `${readNumber(parameters, "y")}px`;
  parts.frame.style.width = `${readNumber(parameters, "width")}px`;
  parts.frame.style.height = `${readNumber(parameters, "height")}px`;
  window.growIntoWindow = () => growIntoWindow(parts);
  window.leaveIntro = () => leaveIntro(parts);
  parts.scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DIM_IN_MS, easing: "ease-out", fill: "forwards" });
  const appearFrames = prefersLessMotion()
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
        { opacity: 0, transform: "scale(0.5)" },
        { opacity: 1, transform: "scale(1)" },
      ];
  parts.soft.animate(appearFrames, { duration: BLOB_APPEAR_MS, delay: DIM_IN_MS / 3, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" });
}

startIntro();

export {};
