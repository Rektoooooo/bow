/**
 * WHY this file exists:
 *   Bow's first start: an onboarding in its own window (main/onboardingWindow.ts). Six short scenes, each a column
 *   of text on the left with one clear button and one quiet one, and something to look at on the right: welcome, bring
 *   your things (importScene.ts, with a glass sidebar that fills in), choose a color (the whole window takes it), the
 *   essentials (small looping demos), make Bow your default browser, and you're all set, which fades into the
 *   browser. Every scene can be skipped; it shows once, and again from Help › Welcome to Bow….
 *
 * Data source:
 *   WelcomeData (built by onboardingWindow.ts), first from onboardingApi.getData(), then "onboarding:data" whenever
 *   something it shows changed (the theme, an import, a switch, the system's appearance).
 *
 * Data flow:
 *   onboardingPage.ts → renderOnboarding() → scenes → buttons dispatch actions (setSpaceTheme, switches) or call
 *   onboardingApi (imports) → main changes the state → updateOnboarding(data): the scenes change in place
 *   Open Bow / Skip setup / Escape → the outro plays → onboardingApi.close() → main records that it was seen
 */
import type { OnboardingScene, WelcomeData, WelcomePreset } from "../shared/onboarding";
import { BOW_WASH_COLORS, ONBOARDING_SCENES, pickWashColors, stepScene, vividWashColor } from "../shared/onboarding.js";
import type { SpaceTheme, ThemeAppearance } from "../shared/types";
import { isThemeDark } from "../shared/themePalette.js";
import { buildAppIconSvg, findAppIconVariant } from "../shared/appIconDrawing.js";
import { createElement, createTextButton, dispatch } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";
import { createImportScene } from "./importScene.js";
import { TOUR_DEMO_CYCLE_MS, createLinkDemo, createTourItems, prefersLessMotion } from "./onboardingScenes.js";
import type { TourItem } from "./onboardingScenes.js";
import { EASE_EMPHASIZED, EASE_IN, EASE_OUT, REDUCED_FADE_MS, createSceneActions, createSceneFrame, createSceneLede, createSceneNote, createSceneTitle, markReveal, reveal, revealParts } from "./sceneParts.js";
import type { SceneView } from "./sceneParts.js";
import { createSidebarPreview } from "./sidebarPreview.js";
import type { SidebarPreview } from "./sidebarPreview.js";

/** Scene change: the old scene leaves, the new one arrives a little later, its parts one after another. Our choice. */
const SCENE_LEAVE_MS = 220;
const SCENE_ENTER_DELAY_MS = 140;
const SCENE_SHIFT_PX = 24;

/**
 * The first scene's entrance: Bow's mark draws itself and settles, the title sharpens out of a blur, then the sentence
 * and the small round button. Our choice, timed by eye against the user's recording of Arc's first launch.
 */
const MARK_DRAW_MS = 1150;
const MARK_SETTLE_MS = 1500;
const TITLE_ENTER_DELAY_MS = 850;
const TITLE_ENTER_MS = 900;
const LEDE_ENTER_DELAY_MS = 1150;
const HELLO_BUTTON_DELAY_MS = 1500;

/** The frame's parts (Skip setup, the dots) and, without the intro, the wash fade in this long. Our choice. */
const CHROME_ENTER_MS = 600;
const WASH_ENTER_MS = 1100;

/** The outro: the scene lifts away; then main fades the window out (and the browser in). Our choice. */
const OUTRO_CONTENT_MS = 320;

/** Bow's mark as the app icon draws it (shared/appIconDrawing.ts): a half circle, thick and rounded, in Bow's colors. */
const MARK_VIEW_BOX = "190 318 644 394";
const MARK_PATH = "M262 640 A250 250 0 0 1 762 640";
const MARK_STROKE_WIDTH = 116;

/** The tour moves to its next item after one loop of the demo, until an item is picked by hand. */
const TOUR_ADVANCE_MS = TOUR_DEMO_CYCLE_MS;

/** The scenes that show the glass sidebar at the window's right edge. */
const SCENES_WITH_PREVIEW: OnboardingScene[] = ["import", "look"];

/** Read aloud when a scene arrives (VoiceOver), and the progress dots' names. */
const SCENE_NAMES: Record<OnboardingScene, string> = {
  hello: "Welcome",
  import: "Bring your things",
  look: "Choose a color",
  essentials: "The essentials",
  defaults: "Your default browser",
  ready: "You're all set",
};

/** The onboarding on screen. */
interface Onboarding {
  root: HTMLElement;
  scenes: SceneView[];
  sceneIndex: number;
  /** The furthest scene reached: the dots go back to any scene up to it. */
  furthestIndex: number;
  data: WelcomeData;
  /** The wash keeps Bow's colors until a color is picked here; then it takes the Space's. */
  hasPickedLook: boolean;
  isLeaving: boolean;
  /** The entrance has played (it waits until the window is on screen: onboardingApi.onShown). */
  hasEntered: boolean;
  dots: HTMLButtonElement[];
  skipButton: HTMLButtonElement;
  preview: SidebarPreview;
  announcer: HTMLElement;
}

let onboarding: Onboarding | null = null;

/**
 * Bow's app icon, drawn from our own icon drawing, as a picture element.
 */
function createAppIcon(className: string): HTMLElement {
  const icon = createElement("div", className);
  const drawing = encodeURIComponent(buildAppIconSvg(findAppIconVariant(undefined)));
  icon.style.backgroundImage = `url("data:image/svg+xml;utf8,${drawing}")`;
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", "Bow");
  return icon;
}

// ---------- Scene 1: welcome ----------

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * Bow's mark as a drawing whose stroke can draw itself: the half circle with a gradient in Bow's colors.
 */
function createBowMark(): { element: SVGSVGElement; stroke: SVGPathElement } {
  const element = document.createElementNS(SVG_NAMESPACE, "svg");
  element.setAttribute("viewBox", MARK_VIEW_BOX);
  element.setAttribute("class", "hello-mark");
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", "Bow");
  const gradient = document.createElementNS(SVG_NAMESPACE, "linearGradient");
  gradient.id = "hello-mark-colors";
  BOW_WASH_COLORS.forEach((color, index) => {
    const stop = document.createElementNS(SVG_NAMESPACE, "stop");
    stop.setAttribute("offset", String(index / (BOW_WASH_COLORS.length - 1)));
    stop.setAttribute("stop-color", color);
    gradient.append(stop);
  });
  const definitions = document.createElementNS(SVG_NAMESPACE, "defs");
  definitions.append(gradient);
  const stroke = document.createElementNS(SVG_NAMESPACE, "path");
  stroke.setAttribute("d", MARK_PATH);
  stroke.setAttribute("fill", "none");
  stroke.setAttribute("stroke", "url(#hello-mark-colors)");
  stroke.setAttribute("stroke-width", String(MARK_STROKE_WIDTH));
  stroke.setAttribute("stroke-linecap", "round");
  // Measured as 1, so drawing it is a dash offset from 1 to 0.
  stroke.setAttribute("pathLength", "1");
  stroke.setAttribute("stroke-dasharray", "1");
  element.append(definitions, stroke);
  return { element: element, stroke: stroke };
}

/**
 * The first scene: Bow's mark draws itself and settles in its glow, the title sharpens out of a blur, then a small
 * round button.
 */
function createHelloScene(goNext: () => void): SceneView {
  const frame = createSceneFrame("hello", true);
  const markHolder = createElement("div", "hello-mark-holder");
  const glow = createElement("span", "hello-glow");
  const mark = createBowMark();
  markHolder.append(glow, mark.element);
  const title = createElement("h1", "scene-title scene-title-hero", "Welcome to Bow.");
  const lede = createElement("p", "scene-lede", "A calm browser for your tabs, your Spaces and your day.");
  const goButton = createTextButton("", "hello-go scene-primary", goNext);
  goButton.setAttribute("aria-label", "Get started");
  goButton.append(createIcon("forward", "icon"));
  frame.text.append(markHolder, title, lede, goButton);
  const enter = (): void => {
    if (prefersLessMotion()) {
      [markHolder, title, lede, goButton].forEach((part) => reveal(part, 0));
      return;
    }
    mark.stroke.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: MARK_DRAW_MS, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "backwards" });
    mark.element.animate(
      [
        { opacity: 0, transform: "scale(0.9)" },
        { opacity: 1, transform: "scale(0.96)", offset: 0.15 },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: MARK_SETTLE_MS, easing: EASE_OUT, fill: "backwards" },
    );
    glow.animate([{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "scale(1)" }], { duration: MARK_SETTLE_MS, delay: MARK_DRAW_MS / 2, easing: EASE_OUT, fill: "backwards" });
    title.animate(
      [
        { opacity: 0, filter: "blur(14px)", transform: "scale(1.03)" },
        { opacity: 1, filter: "blur(0)", transform: "scale(1)" },
      ],
      { duration: TITLE_ENTER_MS, delay: TITLE_ENTER_DELAY_MS, easing: EASE_OUT, fill: "backwards" },
    );
    reveal(lede, LEDE_ENTER_DELAY_MS, TITLE_ENTER_MS);
    goButton.animate([{ opacity: 0, transform: "scale(0.8)" }, { opacity: 1, transform: "scale(1)" }], { duration: 520, delay: HELLO_BUTTON_DELAY_MS, easing: EASE_EMPHASIZED, fill: "backwards" });
  };
  return { element: frame.element, update: () => undefined, enter: enter, leave: () => undefined };
}

// ---------- Scene 3: choose a color ----------

/**
 * True when a theme shows a preset's colors (the swatch for it is the chosen one).
 */
function isPresetChosen(theme: SpaceTheme, preset: WelcomePreset): boolean {
  return theme.colors.join(",").toLowerCase() === preset.colors.join(",").toLowerCase();
}

/**
 * The third scene: the presets as round swatches and Auto / Light / Dark. The whole window and the glass sidebar take
 * the color as it is picked.
 */
function createLookScene(data: WelcomeData, onLookPicked: () => void, goNext: () => void): SceneView {
  const frame = createSceneFrame("look", false);
  let current: WelcomeData = data;
  const swatches = markReveal(createElement("div", "look-swatches"));
  swatches.setAttribute("role", "radiogroup");
  swatches.setAttribute("aria-label", "Colors");
  const swatchButtons = data.presets.map((preset) => {
    const swatch = createTextButton("", "look-swatch", () => {
      onLookPicked();
      const theme: SpaceTheme = { ...current.theme, colors: preset.colors, appearance: preset.appearance };
      dispatch({ type: "setSpaceTheme", spaceId: current.spaceId, theme: theme });
    });
    swatch.setAttribute("role", "radio");
    swatch.setAttribute("aria-label", preset.label);
    swatch.title = preset.label;
    const fill = preset.colors.length === 1 ? `${preset.colors[0]}, ${preset.colors[0]}` : preset.colors.join(", ");
    swatch.style.setProperty("--swatch", `linear-gradient(135deg, ${fill})`);
    swatches.append(swatch);
    return { preset: preset, button: swatch };
  });
  const appearance = markReveal(createElement("div", "look-appearance"));
  appearance.setAttribute("role", "radiogroup");
  appearance.setAttribute("aria-label", "Appearance");
  const appearanceChoices: { value: ThemeAppearance; label: string }[] = [
    { value: "auto", label: "Auto" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];
  const appearanceButtons = appearanceChoices.map((choice) => {
    const button = createTextButton(choice.label, "look-appearance-choice", () => {
      onLookPicked();
      dispatch({ type: "setSpaceTheme", spaceId: current.spaceId, theme: { ...current.theme, appearance: choice.value } });
    });
    button.setAttribute("role", "radio");
    appearance.append(button);
    return { value: choice.value, button: button };
  });
  const actions = createSceneActions("Continue", goNext, "Pick one later", goNext);
  frame.text.append(createSceneTitle("Choose a color."), createSceneLede("Each Space can have its own. This one is yours to color."), swatches, appearance, actions.element);
  const update = (fresh: WelcomeData): void => {
    current = fresh;
    for (const swatch of swatchButtons) {
      swatch.button.setAttribute("aria-checked", String(isPresetChosen(fresh.theme, swatch.preset)));
    }
    for (const choice of appearanceButtons) {
      choice.button.setAttribute("aria-checked", String(fresh.theme.appearance === choice.value));
    }
  };
  update(data);
  return { element: frame.element, update: update, enter: () => revealParts(frame.text, 0), leave: () => undefined };
}

// ---------- Scene 4: the essentials ----------

/**
 * The fourth scene: the tour's items on the left, the chosen one's demo on the right. It moves on by itself after
 * each demo's loop until an item is picked by hand.
 */
function createEssentialsScene(data: WelcomeData, goNext: () => void): SceneView {
  const frame = createSceneFrame("essentials", false);
  const list = markReveal(createElement("div", "tour-list"));
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", "The essentials");
  const stage = createElement("div", "tour-stage");
  const items: TourItem[] = createTourItems();
  let activeIndex = 0;
  let advanceTimer: number | null = null;
  let isPickedByHand = false;
  const buttons = items.map((item, index) => {
    const button = createTextButton("", "tour-item", () => {
      isPickedByHand = true;
      choose(index);
    });
    button.setAttribute("role", "tab");
    const heading = createElement("span", "tour-item-heading");
    heading.append(createIcon(item.icon, "icon tour-item-icon"), createElement("span", "tour-item-title", item.title), createElement("kbd", "tour-item-keys", item.keys));
    button.append(heading, createElement("span", "tour-item-text", item.text), createElement("span", "tour-item-progress"));
    list.append(button);
    item.demo.element.classList.add("tour-demo");
    stage.append(item.demo.element);
    return button;
  });
  const stopAdvancing = (): void => {
    if (advanceTimer !== null) {
      window.clearTimeout(advanceTimer);
      advanceTimer = null;
    }
  };
  // The tour moves on by itself while it is on screen and nobody picked an item.
  const scheduleAdvance = (): void => {
    stopAdvancing();
    if (isPickedByHand || prefersLessMotion()) {
      return;
    }
    advanceTimer = window.setTimeout(() => {
      if (!frame.element.isConnected) {
        return;
      }
      choose((activeIndex + 1) % items.length);
    }, TOUR_ADVANCE_MS);
  };
  const choose = (index: number): void => {
    const previous = items[activeIndex];
    previous?.demo.stop();
    activeIndex = index;
    buttons.forEach((button, buttonIndex) => {
      const isActive = buttonIndex === index;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.classList.toggle("is-auto", isActive && !isPickedByHand && !prefersLessMotion());
    });
    items.forEach((item, itemIndex) => item.demo.element.classList.toggle("is-active", itemIndex === index));
    items[index]?.demo.play();
    scheduleAdvance();
  };
  // ↑ and ↓ move through the items (← and → move between scenes).
  const TOUR_KEY_STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
  list.addEventListener("keydown", (event) => {
    const step = TOUR_KEY_STEPS[event.key];
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    isPickedByHand = true;
    const next = (activeIndex + step + items.length) % items.length;
    choose(next);
    buttons[next]?.focus();
  });
  const actions = createSceneActions("Continue", goNext, "", () => undefined);
  frame.text.append(createSceneTitle("The essentials."), createSceneLede("Five things that make Bow quick. All of them are in the Command Bar, too."), list, actions.element);
  frame.art.append(markReveal(stage));
  const update = (fresh: WelcomeData): void => {
    for (const item of items) {
      item.demo.paint(fresh.theme, fresh.isSystemDark);
    }
  };
  update(data);
  const enter = (): void => {
    revealParts(frame.element, 0);
    isPickedByHand = false;
    choose(0);
  };
  const leave = (): void => {
    stopAdvancing();
    items[activeIndex]?.demo.stop();
  };
  return { element: frame.element, update: update, enter: enter, leave: leave };
}

// ---------- Scene 5: your default browser ----------

/**
 * What the default-browser button offers: to ask macOS, a check once Bow is the default, or nothing in a build from
 * source (macOS only lets the installed app become the default).
 */
function describeDefaultBrowserState(data: WelcomeData): "ask" | "done" | "unavailable" {
  if (data.isDefaultBrowser) {
    return "done";
  }
  if (data.isPackaged) {
    return "ask";
  }
  return "unavailable";
}

/** A quiet switch row under the default-browser question, and the parts an update changes. */
interface SwitchRow {
  element: HTMLElement;
  toggle: HTMLButtonElement;
  label: HTMLElement;
  note: HTMLElement;
}

/**
 * A row with a switch (role=switch) that dispatches its new value; the next update shows the state main settled on.
 */
function createSwitchRow(label: string, onChange: (isOn: boolean) => void): SwitchRow {
  const element = markReveal(createElement("div", "switch-row"));
  const toggle = createTextButton("", "default-switch", () => onChange(toggle.getAttribute("aria-checked") !== "true"));
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-label", label);
  toggle.append(createElement("span", "default-switch-knob"));
  const words = createElement("span", "switch-row-words");
  const labelElement = createElement("span", "switch-row-label", label);
  const note = createElement("span", "switch-row-note");
  words.append(labelElement, note);
  element.append(toggle, words);
  return { element: element, toggle: toggle, label: labelElement, note: note };
}

/**
 * The fifth scene: make Bow the default browser (macOS asks to confirm), and two quiet switches: block ads and
 * trackers, open Bow from any app. Beside it, a message whose link opens in a Little Window.
 */
function createDefaultsScene(data: WelcomeData, goNext: () => void): SceneView {
  const frame = createSceneFrame("defaults", false);
  let current: WelcomeData = data;
  const actions = createSceneActions(
    "Make default",
    () => {
      if (describeDefaultBrowserState(current) === "ask") {
        dispatch({ type: "setAsDefaultBrowser" });
        return;
      }
      goNext();
    },
    "Not now",
    goNext,
  );
  const note = createSceneNote("");
  const adBlock = createSwitchRow("Block ads and trackers", (isOn) => dispatch({ type: "setAdBlock", isOn: isOn }));
  const shortcut = createSwitchRow("Open Bow from any app", (isOn) =>
    dispatch({ type: "setGlobalShortcut", accelerator: isOn ? current.globalShortcut.accelerator : null, opens: "commandBar" }),
  );
  const switches = createElement("div", "scene-switches");
  switches.append(adBlock.element, shortcut.element);
  frame.text.append(
    createSceneTitle("Make Bow your default browser?"),
    createSceneLede("Links you open in Mail, Messages or Slack open in a Little Window, in the right Space."),
    actions.element,
    note,
    switches,
  );
  const linkDemo = createLinkDemo();
  frame.art.append(markReveal(linkDemo.element));
  const update = (fresh: WelcomeData): void => {
    current = fresh;
    const defaultState = describeDefaultBrowserState(fresh);
    actions.element.dataset.state = defaultState;
    actions.primary.disabled = defaultState === "unavailable";
    actions.primary.textContent = defaultState === "done" ? "Continue" : "Make default";
    actions.secondary.hidden = defaultState === "done";
    note.classList.toggle("is-positive", defaultState === "done");
    if (defaultState === "done") {
      note.textContent = "Bow is your default browser.";
    } else if (defaultState === "unavailable") {
      note.textContent = "Only the installed app can be the default. Open Bow from Applications to set it.";
    } else {
      note.textContent = "macOS asks you to confirm.";
    }
    adBlock.toggle.setAttribute("aria-checked", String(fresh.isAdBlockOn));
    shortcut.toggle.setAttribute("aria-checked", String(fresh.globalShortcut.status !== "off"));
    shortcut.label.textContent = `Open Bow from any app with ${fresh.globalShortcut.label}`;
    shortcut.note.textContent = fresh.globalShortcut.status === "taken" ? `Another app uses ${fresh.globalShortcut.label}. Pick other keys in Settings.` : "";
    linkDemo.paint(fresh.theme, fresh.isSystemDark);
  };
  update(data);
  const enter = (): void => {
    revealParts(frame.element, 0);
    linkDemo.play();
  };
  return { element: frame.element, update: update, enter: enter, leave: () => linkDemo.stop() };
}

// ---------- Scene 6: you're all set ----------

/**
 * The last scene: the icon again, the one key to remember, and the button into the browser.
 */
function createReadyScene(onOpen: () => void): SceneView {
  const frame = createSceneFrame("ready", true);
  const icon = markReveal(createAppIcon("ready-icon"));
  const lede = markReveal(createElement("p", "scene-lede"));
  lede.append(createElement("kbd", "onboarding-key", "⌘T"), document.createTextNode(" opens anything. Happy browsing."));
  const actions = createSceneActions("Open Bow", onOpen, "", () => undefined);
  frame.text.append(icon, createSceneTitle("You're all set."), lede, actions.element);
  return { element: frame.element, update: () => undefined, enter: () => revealParts(frame.text, 0), leave: () => undefined };
}

// ---------- Navigation, updates and the outro ----------

/**
 * Paints the wash and the light or dark tokens for the current data.
 */
function paintAtmosphere(state: Onboarding): void {
  const isDark = isThemeDark(state.data.theme, state.data.isSystemDark);
  document.body.classList.toggle("dark", isDark);
  const themeColors = pickWashColors(state.data.theme.colors).map((color) => vividWashColor(color, isDark));
  const colors = state.hasPickedLook ? themeColors : BOW_WASH_COLORS;
  state.root.style.setProperty("--wash-1", colors[0] ?? BOW_WASH_COLORS[0]);
  state.root.style.setProperty("--wash-2", colors[1] ?? BOW_WASH_COLORS[1]);
  state.root.style.setProperty("--wash-3", colors[2] ?? BOW_WASH_COLORS[2]);
  state.root.classList.toggle("has-picked-look", state.hasPickedLook);
}

/**
 * Shows the dots, Skip setup and the sidebar preview for the scene on screen.
 */
function drawChrome(state: Onboarding): void {
  const scene = ONBOARDING_SCENES[state.sceneIndex] ?? "hello";
  state.root.dataset.scene = scene;
  state.root.classList.toggle("shows-preview", SCENES_WITH_PREVIEW.includes(scene));
  state.dots.forEach((dot, index) => {
    dot.classList.toggle("is-active", index === state.sceneIndex);
    dot.disabled = index > state.furthestIndex || index === state.sceneIndex;
    dot.setAttribute("aria-current", index === state.sceneIndex ? "step" : "false");
  });
  state.skipButton.classList.toggle("is-hidden", scene === "ready");
  state.announcer.textContent = `${SCENE_NAMES[scene]}, step ${state.sceneIndex + 1} of ${ONBOARDING_SCENES.length}`;
}

/**
 * Moves to a scene: the old one slides away toward where it came from, the new one arrives from the other side with
 * its parts one after another.
 */
function goToScene(state: Onboarding, nextIndex: number): void {
  if (nextIndex === state.sceneIndex || state.isLeaving || nextIndex < 0 || nextIndex >= state.scenes.length) {
    return;
  }
  const direction = nextIndex > state.sceneIndex ? 1 : -1;
  const leaving = state.scenes[state.sceneIndex];
  const arriving = state.scenes[nextIndex];
  if (leaving === undefined || arriving === undefined) {
    return;
  }
  leaving.leave();
  const isReduced = prefersLessMotion();
  const leaveFrames = isReduced
    ? [{ opacity: 1 }, { opacity: 0 }]
    : [
        { opacity: 1, transform: "translateX(0)", filter: "blur(0)" },
        { opacity: 0, transform: `translateX(${-direction * SCENE_SHIFT_PX}px)`, filter: "blur(6px)" },
      ];
  const leaveAnimation = leaving.element.animate(leaveFrames, { duration: isReduced ? REDUCED_FADE_MS : SCENE_LEAVE_MS, easing: EASE_IN, fill: "forwards" });
  leaveAnimation.finished
    .then(() => {
      leaving.element.hidden = true;
      leaveAnimation.cancel();
    })
    .catch(() => undefined);
  state.sceneIndex = nextIndex;
  state.furthestIndex = Math.max(state.furthestIndex, nextIndex);
  arriving.element.hidden = false;
  if (!isReduced) {
    arriving.element.animate([{ transform: `translateX(${direction * SCENE_SHIFT_PX}px)` }, { transform: "translateX(0)" }], {
      duration: 560,
      delay: SCENE_ENTER_DELAY_MS,
      easing: EASE_EMPHASIZED,
      fill: "backwards",
    });
  }
  arriving.element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: isReduced ? REDUCED_FADE_MS : 280, delay: isReduced ? 0 : SCENE_ENTER_DELAY_MS, fill: "backwards" });
  arriving.enter();
  drawChrome(state);
  // The scene takes the keyboard (↩ goes on), without a focus ring on any button until Tab is pressed.
  state.root.focus({ preventScroll: true });
}

/**
 * Ends the onboarding: the scene lifts away, then main fades the window out (at the first start while the browser
 * fades in) and closes it, and records that the onboarding was seen.
 */
function finishOnboarding(state: Onboarding): void {
  if (state.isLeaving) {
    return;
  }
  state.isLeaving = true;
  state.scenes[state.sceneIndex]?.leave();
  const content = state.root.querySelector(".onboarding-content");
  if (prefersLessMotion() || content === null) {
    window.onboardingApi.close().catch(() => undefined);
    return;
  }
  const lift = content.animate([{ opacity: 1, transform: "translateY(0) scale(1)" }, { opacity: 0, transform: "translateY(-12px) scale(0.985)" }], { duration: OUTRO_CONTENT_MS, easing: EASE_IN, fill: "forwards" });
  lift.finished
    .catch(() => undefined)
    .then(() => window.onboardingApi.close())
    .catch(() => undefined);
}

/**
 * Continue: the next scene, or on the last one, the browser.
 */
function goForward(state: Onboarding): void {
  if (state.sceneIndex === state.scenes.length - 1) {
    finishOnboarding(state);
    return;
  }
  goToScene(state, stepScene(state.sceneIndex, 1, state.scenes.length));
}

/**
 * The onboarding's keys: ↩ and → go on, ← goes back, Escape skips to the browser. Keys in a group of choices (the
 * swatches, the tour, the profiles) stay theirs, and Return on a button presses that button.
 */
function handleKey(state: Onboarding, event: KeyboardEvent): void {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const group = target === null ? null : target.closest("[role=radiogroup], [role=tablist]");
  const isInGroup = group !== null;
  if (event.key === "Escape") {
    event.preventDefault();
    finishOnboarding(state);
    return;
  }
  if (event.key === "ArrowRight" && !isInGroup) {
    event.preventDefault();
    goForward(state);
    return;
  }
  if (event.key === "ArrowLeft" && !isInGroup) {
    event.preventDefault();
    goToScene(state, stepScene(state.sceneIndex, -1, state.scenes.length));
    return;
  }
  const isOnButton = target instanceof HTMLButtonElement;
  if (event.key === "Enter" && !isOnButton) {
    event.preventDefault();
    goForward(state);
  }
}

/**
 * The wash behind every scene: three soft colored lights drifting slowly, and grain, over the base color.
 */
function createWash(): HTMLElement[] {
  const base = createElement("div", "onboarding-base");
  const wash = createElement("div", "onboarding-wash");
  wash.setAttribute("aria-hidden", "true");
  wash.append(createElement("span", "wash-light wash-light-1"), createElement("span", "wash-light wash-light-2"), createElement("span", "wash-light wash-light-3"), createElement("span", "wash-grain"));
  return [base, wash];
}

/**
 * Builds the onboarding into its page and plays its entrance.
 */
export function renderOnboarding(host: HTMLElement, data: WelcomeData): void {
  onboarding?.scenes[onboarding.sceneIndex]?.leave();
  const root = createElement("div", "onboarding");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Welcome to Bow");
  root.tabIndex = -1;
  const content = createElement("div", "onboarding-content");
  const top = createElement("div", "onboarding-top");
  const skipButton = createTextButton("Skip setup", "onboarding-skip", () => {
    if (onboarding !== null) {
      finishOnboarding(onboarding);
    }
  });
  top.append(skipButton);
  const stageElement = createElement("div", "onboarding-stage");
  const preview = createSidebarPreview();
  const dotsElement = createElement("nav", "onboarding-dots");
  dotsElement.setAttribute("aria-label", "Steps");
  const dots = ONBOARDING_SCENES.map((scene, index) => {
    const dot = createTextButton("", "onboarding-dot", () => {
      if (onboarding !== null) {
        goToScene(onboarding, index);
      }
    });
    dot.setAttribute("aria-label", SCENE_NAMES[scene]);
    return dot;
  });
  dotsElement.append(...dots);
  const announcer = createElement("div", "onboarding-announcer");
  announcer.setAttribute("aria-live", "polite");
  content.append(top, stageElement, preview.element, dotsElement);
  root.append(...createWash(), content, announcer);
  // The tour's progress line (onboarding.css) fills in the time the tour waits before moving on.
  root.style.setProperty("--tour-advance", `${TOUR_ADVANCE_MS}ms`);

  const state: Onboarding = {
    root: root,
    scenes: [],
    sceneIndex: 0,
    furthestIndex: 0,
    data: data,
    hasPickedLook: false,
    isLeaving: false,
    hasEntered: false,
    dots: dots,
    skipButton: skipButton,
    preview: preview,
    announcer: announcer,
  };
  const markLookPicked = (): void => {
    state.hasPickedLook = true;
  };
  const goNext = (): void => goForward(state);
  state.scenes = [
    createHelloScene(goNext),
    createImportScene(data, goNext),
    createLookScene(data, markLookPicked, goNext),
    createEssentialsScene(data, goNext),
    createDefaultsScene(data, goNext),
    createReadyScene(() => finishOnboarding(state)),
  ];
  state.scenes.forEach((scene, index) => {
    scene.element.hidden = index !== 0;
    stageElement.append(scene.element);
  });
  root.addEventListener("keydown", (event) => handleKey(state, event));
  onboarding = state;
  host.replaceChildren(root);
  preview.update(data);
  paintAtmosphere(state);
  drawChrome(state);
  root.focus({ preventScroll: true });
}

/**
 * Plays the entrance once the window is on screen (until then the scene stays hidden, so nothing plays unseen). After
 * the first start's intro the background is already there (the intro's sheet showed it); otherwise it fades in.
 */
export function startEntrance(isAfterIntro: boolean): void {
  if (onboarding === null || onboarding.hasEntered) {
    return;
  }
  const state = onboarding;
  state.hasEntered = true;
  state.root.classList.add("has-entered");
  if (!prefersLessMotion()) {
    if (!isAfterIntro) {
      state.root.querySelector(".onboarding-wash")?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: WASH_ENTER_MS, easing: EASE_OUT });
    }
    state.root.querySelector(".onboarding-top")?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CHROME_ENTER_MS, delay: HELLO_BUTTON_DELAY_MS, fill: "backwards" });
    state.root.querySelector(".onboarding-dots")?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CHROME_ENTER_MS, delay: HELLO_BUTTON_DELAY_MS, fill: "backwards" });
  }
  state.scenes[state.sceneIndex]?.enter();
}

/**
 * Fresh data from main: every scene shows it in place (nothing is rebuilt, nothing restarts).
 */
export function updateOnboarding(data: WelcomeData): void {
  if (onboarding === null || !onboarding.root.isConnected) {
    return;
  }
  onboarding.data = data;
  paintAtmosphere(onboarding);
  onboarding.preview.update(data);
  for (const scene of onboarding.scenes) {
    scene.update(data);
  }
}
