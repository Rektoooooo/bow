/**
 * WHY this file exists:
 *   Every scene of the onboarding is built the same way: a column of text on the left (a bold title ending in a full
 *   stop, one sentence, then one clear button and one quiet one, and a small note), and something to look at on the
 *   right. These are those shared pieces, and the rise that reveals a scene's parts one after another, so the scenes
 *   (onboarding.ts, importScene.ts) read alike and move alike.
 *
 * Data source:
 *   None: the scenes pass their words and what their buttons do.
 *
 * Data flow:
 *   onboarding.ts / importScene.ts → these builders → elements in the scene; enter() → revealParts()
 */
import type { WelcomeData } from "../shared/onboarding";
import { createElement, createTextButton } from "../renderer/dom.js";
import { prefersLessMotion } from "./onboardingScenes.js";

/** The onboarding's easing curves (onboarding.css --ease-out and --ease-emphasized). */
export const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
export const EASE_EMPHASIZED = "cubic-bezier(0.3, 0, 0, 1)";
export const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)";

/** A part rises this far and sharpens from this much blur as it arrives, taking this long. Our choice. */
const REVEAL_RISE_PX = 12;
const REVEAL_BLUR_PX = 6;
export const REVEAL_MS = 620;

/** Parts of a scene arrive one after another, this far apart. Our choice. */
const REVEAL_STAGGER_MS = 60;

/** With less motion, everything only fades, this fast. */
export const REDUCED_FADE_MS = 180;

/** One scene: its element, how it shows fresh data, and what runs while it is on screen. */
export interface SceneView {
  element: HTMLElement;
  update(data: WelcomeData): void;
  enter(): void;
  leave(): void;
}

/** A scene's two buttons: the clear one (what most people want) and the quiet one beside it. */
export interface SceneActions {
  element: HTMLElement;
  primary: HTMLButtonElement;
  secondary: HTMLButtonElement;
}

/**
 * Moves an element in: from a little lower, blurred and transparent, to its place.
 */
export function reveal(element: Element, delayMs: number, durationMs: number = REVEAL_MS): Animation {
  if (prefersLessMotion()) {
    return element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_FADE_MS, delay: delayMs, fill: "backwards" });
  }
  const frames = [
    { opacity: 0, transform: `translateY(${REVEAL_RISE_PX}px)`, filter: `blur(${REVEAL_BLUR_PX}px)` },
    { opacity: 1, transform: "translateY(0)", filter: "blur(0)" },
  ];
  return element.animate(frames, { duration: durationMs, delay: delayMs, easing: EASE_EMPHASIZED, fill: "backwards" });
}

/**
 * Reveals the visible parts of a scene marked data-reveal, one after another.
 */
export function revealParts(container: HTMLElement, startDelayMs: number): void {
  const parts = Array.from(container.querySelectorAll<HTMLElement>("[data-reveal]"));
  const shownParts = parts.filter((part) => part.offsetParent !== null);
  shownParts.forEach((part, index) => reveal(part, startDelayMs + index * REVEAL_STAGGER_MS));
}

/**
 * Marks an element as one of the parts its scene reveals in turn.
 */
export function markReveal<Part extends HTMLElement>(element: Part): Part {
  element.dataset.reveal = "";
  return element;
}

/**
 * A scene's title: bold, ending in a full stop.
 */
export function createSceneTitle(text: string): HTMLElement {
  return markReveal(createElement("h1", "scene-title", text));
}

/**
 * The sentence under a title.
 */
export function createSceneLede(text: string): HTMLElement {
  return markReveal(createElement("p", "scene-lede", text));
}

/**
 * The small line under the buttons (what happens next, or what to keep in mind).
 */
export function createSceneNote(text: string): HTMLElement {
  return markReveal(createElement("p", "scene-note", text));
}

/**
 * A scene's buttons: the clear one, and the quiet one beside it.
 */
export function createSceneActions(primaryLabel: string, onPrimary: () => void, secondaryLabel: string, onSecondary: () => void): SceneActions {
  const element = markReveal(createElement("div", "scene-actions"));
  const primary = createTextButton(primaryLabel, "scene-primary", onPrimary);
  const secondary = createTextButton(secondaryLabel, "scene-secondary", onSecondary);
  secondary.hidden = secondaryLabel === "";
  element.append(primary, secondary);
  return { element: element, primary: primary, secondary: secondary };
}

/**
 * A scene: the text column, and beside it what the scene shows (none for the centred scenes).
 */
export function createSceneFrame(sceneId: string, isCentred: boolean): { element: HTMLElement; text: HTMLElement; art: HTMLElement } {
  const element = createElement("section", `onboarding-scene scene-${sceneId}`);
  element.dataset.scene = sceneId;
  element.classList.toggle("is-centred", isCentred);
  const text = createElement("div", "scene-text");
  const art = createElement("div", "scene-art");
  art.setAttribute("aria-hidden", "true");
  element.append(text, art);
  return { element: element, text: text, art: art };
}
