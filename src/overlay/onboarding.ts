/**
 * WHY this file exists:
 *   Bow's first start: a full-window onboarding instead of an empty window. Six short scenes: hello, bring your things
 *   (Arc or another browser, imported right here with the result on its card), make it yours (a Space look with a live
 *   preview that tints the whole scene), the essentials (a tour with small looping demos), a few good defaults, and
 *   you're all set, which dissolves into the browser. Every scene can be skipped; it shows once, and again from
 *   Help › Welcome to Bow….
 *
 * Data source:
 *   The "welcome" panel (WelcomeData, built by overlayController.ts), then "overlay:welcome-update" whenever
 *   something it shows changed (the theme, an import, a switch, the system's appearance).
 *
 * Data flow:
 *   overlay.ts showPanel → renderOnboarding() → scenes → buttons dispatch actions (import, setSpaceTheme, switches)
 *   → main changes the state → updateOnboarding(data): the scenes change in place, nothing restarts
 *   Start Browsing / Skip / Escape → the outro plays → overlayApi.close() → main records that it was seen
 */
import type { OverlayPanel } from "../shared/overlay";
import type { OnboardingScene, WelcomeData, WelcomeImportSource, WelcomePreset } from "../shared/onboarding";
import { ARC_IMPORT_SOURCE_ID, BOW_WASH_COLORS, ONBOARDING_SCENES, describeImportSummary, pickWashColors, stepScene, vividWashColor } from "../shared/onboarding.js";
import type { SpaceTheme, ThemeAppearance } from "../shared/types";
import { isThemeDark } from "../shared/themePalette.js";
import { buildAppIconSvg, findAppIconVariant } from "../shared/appIconDrawing.js";
import { createElement, createTextButton, dispatch } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";
import type { IconName } from "../renderer/icons.js";
import { TOUR_DEMO_CYCLE_MS, createMiniWindow, createTourItems, prefersLessMotion } from "./onboardingScenes.js";
import type { MiniWindow, TourItem } from "./onboardingScenes.js";

type WelcomePanel = Extract<OverlayPanel, { kind: "welcome" }>;

/** The onboarding's easing curves (onboarding.css --ease-out and --ease-emphasized). */
const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const EASE_EMPHASIZED = "cubic-bezier(0.3, 0, 0, 1)";
const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)";

/** Scene change: the old scene leaves, the new one arrives a little later, its parts one after another. Our choice. */
const SCENE_LEAVE_MS = 200;
const SCENE_ENTER_DELAY_MS = 120;
const SCENE_ENTER_MS = 520;
const SCENE_SHIFT_PX = 28;
const REVEAL_STAGGER_MS = 55;
const REVEAL_RISE_PX = 14;

/** The first scene's entrance: the icon settles, then the title's words rise one by one. Our choice. */
const ICON_ENTER_MS = 1100;
const TITLE_WORD_STAGGER_MS = 70;
const TITLE_ENTER_DELAY_MS = 380;

/** The outro: the scene lifts away and the wash opens up and fades, uncovering the browser. Our choice. */
const OUTRO_CONTENT_MS = 320;
const OUTRO_WASH_MS = 700;

/** The tour moves to its next item after one loop of the demo, until an item is picked by hand. */
const TOUR_ADVANCE_MS = TOUR_DEMO_CYCLE_MS;

/** With less motion, everything only fades, this fast. */
const REDUCED_FADE_MS = 180;

/** The last scene's ripples around the icon: how long one takes, the second's delay, how many times. Our choice. */
const RIPPLE_MS = 1700;
const RIPPLE_SECOND_DELAY_MS = 550;
const RIPPLE_REPEATS = 2;

/** What each scene's main button says. */
const NEXT_LABELS: Record<OnboardingScene, string> = {
  hello: "Get Started",
  import: "Continue",
  look: "Continue",
  essentials: "Continue",
  defaults: "Continue",
  ready: "Start Browsing",
};

/** Read aloud when a scene arrives (VoiceOver), and the progress marks' names. */
const SCENE_NAMES: Record<OnboardingScene, string> = {
  hello: "Welcome",
  import: "Bring your things",
  look: "Make it yours",
  essentials: "The essentials",
  defaults: "A few good defaults",
  ready: "You're all set",
};

/** One scene: its element, how it shows fresh data, and what runs while it is on screen. */
interface SceneView {
  element: HTMLElement;
  update(data: WelcomeData): void;
  enter(): void;
  leave(): void;
}

/** The onboarding on screen. */
interface Onboarding {
  root: HTMLElement;
  scenes: SceneView[];
  sceneIndex: number;
  data: WelcomeData;
  /** The wash keeps Bow's colors until a look is picked here; then it takes the Space's. */
  hasPickedLook: boolean;
  isLeaving: boolean;
  progressMarks: HTMLElement[];
  backButton: HTMLButtonElement;
  nextButton: HTMLButtonElement;
  announcer: HTMLElement;
}

let onboarding: Onboarding | null = null;

/**
 * Moves an element in with the scene's rise: from a little lower and transparent to its place.
 */
function reveal(element: Element, delayMs: number, durationMs: number = SCENE_ENTER_MS): Animation {
  if (prefersLessMotion()) {
    return element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_FADE_MS, delay: delayMs, fill: "backwards" });
  }
  const frames = [
    { opacity: 0, transform: `translateY(${REVEAL_RISE_PX}px)`, filter: "blur(3px)" },
    { opacity: 1, transform: "translateY(0)", filter: "blur(0)" },
  ];
  return element.animate(frames, { duration: durationMs, delay: delayMs, easing: EASE_EMPHASIZED, fill: "backwards" });
}

/**
 * Reveals a scene's parts in order (those marked data-reveal), one after another.
 */
function revealParts(scene: HTMLElement, startDelayMs: number): void {
  const parts = Array.from(scene.querySelectorAll("[data-reveal]"));
  parts.forEach((part, index) => reveal(part, startDelayMs + index * REVEAL_STAGGER_MS));
}

/**
 * A title whose words rise one by one (the first scene's), read as one heading.
 */
function createWordTitle(text: string): HTMLElement {
  const title = createElement("h1", "onboarding-title onboarding-title-hero");
  title.setAttribute("aria-label", text);
  for (const word of text.split(" ")) {
    const wordElement = createElement("span", "onboarding-word", word);
    wordElement.setAttribute("aria-hidden", "true");
    title.append(wordElement, document.createTextNode(" "));
  }
  return title;
}

/**
 * A scene's heading and sentence, each revealed in turn.
 */
function createSceneHeader(title: string, text: string): HTMLElement {
  const header = createElement("header", "onboarding-header");
  const heading = createElement("h1", "onboarding-title", title);
  const sentence = createElement("p", "onboarding-lede", text);
  heading.dataset.reveal = "";
  sentence.dataset.reveal = "";
  header.append(heading, sentence);
  return header;
}

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

// ---------- Scene 1: hello ----------

/**
 * The first scene: the icon settles in with its glow, and the welcome rises word by word.
 */
function createHelloScene(): SceneView {
  const element = createElement("section", "onboarding-scene scene-hello");
  const iconHolder = createElement("div", "hello-icon-holder");
  const glow = createElement("span", "hello-glow");
  const icon = createAppIcon("hello-icon");
  iconHolder.append(glow, icon);
  const title = createWordTitle("Welcome to Bow");
  const lede = createElement("p", "onboarding-lede", "A calm browser that keeps your tabs, your Spaces and your day in order. Let's set it up together — it takes a minute.");
  element.append(iconHolder, title, lede);
  const enter = (): void => {
    if (prefersLessMotion()) {
      [iconHolder, title, lede].forEach((part) => reveal(part, 0));
      return;
    }
    icon.animate(
      [
        { opacity: 0, transform: "translateY(18px) scale(0.82)", filter: "blur(10px)" },
        { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0)" },
      ],
      { duration: ICON_ENTER_MS, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "backwards" },
    );
    glow.animate([{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "scale(1)" }], { duration: ICON_ENTER_MS * 1.4, easing: EASE_OUT, fill: "backwards" });
    const words = Array.from(title.querySelectorAll(".onboarding-word"));
    words.forEach((word, index) => reveal(word, TITLE_ENTER_DELAY_MS + index * TITLE_WORD_STAGGER_MS, 700));
    reveal(lede, TITLE_ENTER_DELAY_MS + words.length * TITLE_WORD_STAGGER_MS + 120, 700);
  };
  return { element: element, update: () => undefined, enter: enter, leave: () => undefined };
}

// ---------- Scene 2: bring your things ----------

/**
 * Two letters for a browser's tile (no logos: they are not ours): "Arc" → "Ar", "Google Chrome" → "GC".
 */
function monogramFor(label: string): string {
  const words = label.split(/\s+/).filter((word) => word.length > 0);
  if (words.length > 1) {
    return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  }
  const word = words[0] ?? "?";
  return `${word[0]?.toUpperCase() ?? ""}${word[1]?.toLowerCase() ?? ""}`;
}

/** A source card and the parts an update changes. */
interface ImportCard {
  sourceId: string;
  button: HTMLButtonElement;
  status: HTMLElement;
}

/**
 * Starts importing one source, telling main it came from the onboarding (its card shows the progress and result).
 */
function startImport(sourceId: string): void {
  if (sourceId === ARC_IMPORT_SOURCE_ID) {
    dispatch({ type: "importFromArc", fromWelcome: true });
    return;
  }
  dispatch({ type: "importFromBrowser", sourceId: sourceId, fromWelcome: true });
}

/**
 * One card: the browser's monogram and name, and a line that says what importing it does, is doing or did.
 */
function createImportCard(source: WelcomeImportSource, isRecommended: boolean): ImportCard {
  const button = createTextButton("", "import-card", () => startImport(source.id));
  button.dataset.reveal = "";
  button.dataset.source = source.id;
  const mark = createElement("span", "import-mark", monogramFor(source.label));
  mark.dataset.hue = String(source.label.length % 6);
  const name = createElement("span", "import-name", source.label);
  const status = createElement("span", "import-status");
  const state = createElement("span", "import-state");
  state.append(createElement("span", "import-spinner"), createIcon("checkmark", "icon import-check"));
  const text = createElement("span", "import-text");
  text.append(name, status);
  button.append(mark, text, state);
  if (isRecommended) {
    button.append(createElement("span", "import-tag", "Recommended"));
  }
  return { sourceId: source.id, button: button, status: status };
}

/**
 * The second scene: what this Mac has to import from, imported with one click, the result shown on the card.
 */
function createImportScene(data: WelcomeData): SceneView {
  const element = createElement("section", "onboarding-scene scene-import");
  const header = createSceneHeader("Bring your things", "Your bookmarks and history come along. From Arc, your Spaces, pinned tabs and folders too.");
  const grid = createElement("div", "import-grid");
  const cards = data.importSources.map((source, index) => createImportCard(source, index === 0 && source.id === ARC_IMPORT_SOURCE_ID));
  grid.append(...cards.map((card) => card.button));
  element.append(header, grid);
  if (cards.length === 0) {
    const none = createElement("p", "import-none", "No other browser on this Mac to bring things from. You can import later from File › Import.");
    none.dataset.reveal = "";
    element.append(none);
  }
  const update = (fresh: WelcomeData): void => {
    for (const card of cards) {
      const importState = fresh.imports[card.sourceId];
      const phase = importState?.phase ?? "idle";
      card.button.dataset.phase = phase;
      card.button.disabled = phase === "running";
      if (phase === "running") {
        card.status.textContent = "Bringing it over…";
      } else if (phase === "done" && importState?.summary) {
        card.status.textContent = describeImportSummary(importState.summary);
      } else if (phase === "failed") {
        card.status.textContent = "Couldn't import. Try again from File › Import.";
      } else {
        card.status.textContent = card.sourceId === ARC_IMPORT_SOURCE_ID ? "Spaces, tabs, history and extensions" : "Bookmarks and history";
      }
    }
  };
  update(data);
  return { element: element, update: update, enter: () => revealParts(element, 0), leave: () => undefined };
}

// ---------- Scene 3: make it yours ----------

/**
 * True when a theme shows a preset's colors (the swatch for it is the chosen one).
 */
function isPresetChosen(theme: SpaceTheme, preset: WelcomePreset): boolean {
  return theme.colors.join(",").toLowerCase() === preset.colors.join(",").toLowerCase();
}

/**
 * The third scene: the presets as swatches, light / dark / automatic, and a small Bow window wearing the choice.
 */
function createLookScene(data: WelcomeData, onLookPicked: () => void): SceneView {
  const element = createElement("section", "onboarding-scene scene-look");
  const controls = createElement("div", "look-controls");
  const header = createSceneHeader("Make it yours", "Every Space has its own colors. Pick a look for this one — you can change it any time from the Space's name.");
  const swatches = createElement("div", "look-swatches");
  swatches.dataset.reveal = "";
  swatches.setAttribute("role", "radiogroup");
  swatches.setAttribute("aria-label", "Colors");
  let current: WelcomeData = data;
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
  const appearance = createElement("div", "look-appearance");
  appearance.dataset.reveal = "";
  appearance.setAttribute("role", "radiogroup");
  appearance.setAttribute("aria-label", "Appearance");
  const appearanceChoices: { value: ThemeAppearance; label: string; icon: IconName }[] = [
    { value: "auto", label: "Automatic", icon: "sparkles" },
    { value: "light", label: "Light", icon: "sun" },
    { value: "dark", label: "Dark", icon: "moonStars" },
  ];
  const appearanceButtons = appearanceChoices.map((choice) => {
    const button = createTextButton("", "look-appearance-choice", () => {
      onLookPicked();
      dispatch({ type: "setSpaceTheme", spaceId: current.spaceId, theme: { ...current.theme, appearance: choice.value } });
    });
    button.setAttribute("role", "radio");
    button.append(createIcon(choice.icon, "icon"), createElement("span", "", choice.label));
    appearance.append(button);
    return { value: choice.value, button: button };
  });
  controls.append(header, swatches, appearance);
  const preview: MiniWindow = createMiniWindow();
  const stage = createElement("div", "look-preview");
  stage.dataset.reveal = "";
  stage.append(preview.element);
  element.append(controls, stage);
  const update = (fresh: WelcomeData): void => {
    current = fresh;
    preview.paint(fresh.theme, fresh.isSystemDark);
    for (const swatch of swatchButtons) {
      swatch.button.setAttribute("aria-checked", String(isPresetChosen(fresh.theme, swatch.preset)));
    }
    for (const choice of appearanceButtons) {
      choice.button.setAttribute("aria-checked", String(fresh.theme.appearance === choice.value));
    }
  };
  update(data);
  return { element: element, update: update, enter: () => revealParts(element, 0), leave: () => undefined };
}

// ---------- Scene 4: the essentials ----------

/**
 * The fourth scene: the tour's items on the left, the chosen one's demo on the right. It moves on by itself after
 * each demo's loop until an item is picked by hand.
 */
function createEssentialsScene(data: WelcomeData): SceneView {
  const element = createElement("section", "onboarding-scene scene-essentials");
  const header = createSceneHeader("The essentials", "Five things that make Bow feel fast. You'll find them all in the Command Bar, too.");
  const tour = createElement("div", "tour");
  const list = createElement("div", "tour-list");
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", "The essentials");
  list.dataset.reveal = "";
  const stage = createElement("div", "tour-stage");
  stage.dataset.reveal = "";
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
      if (!element.isConnected) {
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
  tour.append(list, stage);
  element.append(header, tour);
  const update = (fresh: WelcomeData): void => {
    for (const item of items) {
      item.demo.paint(fresh.theme, fresh.isSystemDark);
    }
  };
  update(data);
  const enter = (): void => {
    revealParts(element, 0);
    isPickedByHand = false;
    choose(0);
  };
  const leave = (): void => {
    stopAdvancing();
    items[activeIndex]?.demo.stop();
  };
  return { element: element, update: update, enter: enter, leave: leave };
}

// ---------- Scene 5: a few good defaults ----------

/** A defaults row and the parts an update changes. */
interface DefaultRow {
  element: HTMLElement;
  text: HTMLElement;
  note: HTMLElement;
}

/**
 * One row: an icon, a name, a sentence, a note for when something is in the way, and its control on the right.
 */
function createDefaultRow(icon: IconName, title: string, text: string, control: HTMLElement): DefaultRow {
  const row = createElement("div", "default-row");
  row.dataset.reveal = "";
  const mark = createElement("span", "default-mark");
  mark.append(createIcon(icon, "icon"));
  const words = createElement("div", "default-words");
  const textElement = createElement("span", "default-text", text);
  const note = createElement("span", "default-note");
  words.append(createElement("span", "default-title", title), textElement, note);
  row.append(mark, words, control);
  return { element: row, text: textElement, note: note };
}

/**
 * What the default-browser row offers: a button, a check once Bow is the default, or nothing in a build from source
 * (macOS only lets the installed app become the default).
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

/**
 * A switch (role=switch) that dispatches its new value; the next update shows the state main settled on.
 */
function createSwitch(label: string, onChange: (isOn: boolean) => void): HTMLButtonElement {
  const button = createTextButton("", "default-switch", () => onChange(button.getAttribute("aria-checked") !== "true"));
  button.setAttribute("role", "switch");
  button.setAttribute("aria-label", label);
  button.append(createElement("span", "default-switch-knob"));
  return button;
}

/**
 * The fifth scene: make Bow the default browser, block ads and trackers, and open Bow from any app.
 */
function createDefaultsScene(data: WelcomeData): SceneView {
  const element = createElement("section", "onboarding-scene scene-defaults");
  const header = createSceneHeader("A few good defaults", "All optional, and all in Settings later.");
  let current: WelcomeData = data;
  const defaultButton = createTextButton("Make Default", "default-action", () => dispatch({ type: "setAsDefaultBrowser" }));
  const defaultDone = createElement("span", "default-done");
  defaultDone.append(createIcon("checkmark", "icon"), createElement("span", "", "Default"));
  const defaultControl = createElement("div", "default-control");
  defaultControl.append(defaultButton, defaultDone);
  const browserRow = createDefaultRow("globe", "Make Bow your default browser", "Links from other apps open here, in the right Space.", defaultControl);
  const adBlockSwitch = createSwitch("Block ads and trackers", (isOn) => dispatch({ type: "setAdBlock", isOn: isOn }));
  const adBlockRow = createDefaultRow("shield", "Block ads and trackers", "Faster pages and fewer trackers, with the EasyList filters.", adBlockSwitch);
  const shortcutSwitch = createSwitch("Open Bow from any app", (isOn) =>
    dispatch({ type: "setGlobalShortcut", accelerator: isOn ? current.globalShortcut.accelerator : null, opens: "commandBar" }),
  );
  const shortcutRow = createDefaultRow("keyboard", "Open Bow from any app", "", shortcutSwitch);
  const list = createElement("div", "defaults-list");
  list.append(browserRow.element, adBlockRow.element, shortcutRow.element);
  element.append(header, list);
  const update = (fresh: WelcomeData): void => {
    current = fresh;
    const defaultState = describeDefaultBrowserState(fresh);
    defaultControl.dataset.state = defaultState;
    browserRow.note.textContent = defaultState === "unavailable" ? "Available in the installed app." : "";
    adBlockSwitch.setAttribute("aria-checked", String(fresh.isAdBlockOn));
    shortcutRow.text.textContent = `Press ${fresh.globalShortcut.label} anywhere to bring up the Command Bar.`;
    shortcutSwitch.setAttribute("aria-checked", String(fresh.globalShortcut.status !== "off"));
    shortcutRow.note.textContent = fresh.globalShortcut.status === "taken" ? `Another app uses ${fresh.globalShortcut.label}. Pick other keys in Settings.` : "";
  };
  update(data);
  return { element: element, update: update, enter: () => revealParts(element, 0), leave: () => undefined };
}

// ---------- Scene 6: you're all set ----------

/**
 * The last scene: the icon again, with ripples, and the one key to remember.
 */
function createReadyScene(): SceneView {
  const element = createElement("section", "onboarding-scene scene-ready");
  const iconHolder = createElement("div", "ready-icon-holder");
  iconHolder.dataset.reveal = "";
  const ripples = [createElement("span", "ready-ripple"), createElement("span", "ready-ripple")];
  iconHolder.append(...ripples, createAppIcon("ready-icon"));
  const title = createElement("h1", "onboarding-title onboarding-title-hero", "You're all set");
  title.dataset.reveal = "";
  const lede = createElement("p", "onboarding-lede");
  lede.dataset.reveal = "";
  lede.append(document.createTextNode("Press "), createElement("kbd", "onboarding-key", "⌘T"), document.createTextNode(" to open your first tab. Happy browsing."));
  element.append(iconHolder, title, lede);
  const enter = (): void => {
    revealParts(element, 0);
    if (prefersLessMotion()) {
      return;
    }
    ripples.forEach((ripple, index) =>
      ripple.animate([{ opacity: 0.55, transform: "scale(0.85)" }, { opacity: 0, transform: "scale(1.9)" }], {
        duration: RIPPLE_MS,
        delay: SCENE_ENTER_DELAY_MS + index * RIPPLE_SECOND_DELAY_MS,
        iterations: RIPPLE_REPEATS,
        easing: EASE_OUT,
      }),
    );
  };
  return { element: element, update: () => undefined, enter: enter, leave: () => undefined };
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
}

/**
 * Shows the progress marks and the buttons for the scene on screen.
 */
function drawChrome(state: Onboarding): void {
  const scene = ONBOARDING_SCENES[state.sceneIndex] ?? "hello";
  state.progressMarks.forEach((mark, index) => {
    mark.classList.toggle("is-active", index === state.sceneIndex);
    mark.classList.toggle("is-done", index < state.sceneIndex);
  });
  state.backButton.classList.toggle("is-hidden", state.sceneIndex === 0);
  state.backButton.disabled = state.sceneIndex === 0;
  state.nextButton.textContent = NEXT_LABELS[scene];
  state.announcer.textContent = `${SCENE_NAMES[scene]}, step ${state.sceneIndex + 1} of ${ONBOARDING_SCENES.length}`;
}

/**
 * Moves `delta` scenes (+1 on, −1 back): the old one slides away toward where it came from, the new one arrives from
 * the other side with its parts one after another.
 */
function goToScene(state: Onboarding, delta: number): void {
  const nextIndex = stepScene(state.sceneIndex, delta, state.scenes.length);
  if (nextIndex === state.sceneIndex || state.isLeaving) {
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
  const leaveFrames = isReduced ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: `translateX(${-direction * SCENE_SHIFT_PX}px)` }];
  const leaveAnimation = leaving.element.animate(leaveFrames, { duration: isReduced ? REDUCED_FADE_MS : SCENE_LEAVE_MS, easing: EASE_IN, fill: "forwards" });
  leaveAnimation.finished
    .then(() => {
      leaving.element.hidden = true;
      leaveAnimation.cancel();
    })
    .catch(() => undefined);
  state.sceneIndex = nextIndex;
  arriving.element.hidden = false;
  if (!isReduced) {
    arriving.element.animate([{ transform: `translateX(${direction * SCENE_SHIFT_PX}px)` }, { transform: "translateX(0)" }], {
      duration: SCENE_ENTER_MS,
      delay: SCENE_ENTER_DELAY_MS,
      easing: EASE_EMPHASIZED,
      fill: "backwards",
    });
  }
  arriving.element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: isReduced ? REDUCED_FADE_MS : SCENE_ENTER_MS / 2, delay: isReduced ? 0 : SCENE_ENTER_DELAY_MS, fill: "backwards" });
  arriving.enter();
  drawChrome(state);
  // The scene takes the keyboard (↩ goes on), without a focus ring on any button until Tab is pressed.
  state.root.focus({ preventScroll: true });
}

/**
 * Ends the onboarding: the scene lifts away, the wash opens up and fades, then the overlay closes over the browser
 * (main records that the onboarding was seen).
 */
function finishOnboarding(state: Onboarding): void {
  if (state.isLeaving) {
    return;
  }
  state.isLeaving = true;
  state.scenes[state.sceneIndex]?.leave();
  if (prefersLessMotion()) {
    const fade = state.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REDUCED_FADE_MS, fill: "forwards" });
    fade.finished.then(() => window.overlayApi.close()).catch(() => window.overlayApi.close());
    return;
  }
  const content = state.root.querySelector(".onboarding-content");
  const wash = state.root.querySelector(".onboarding-wash");
  content?.animate([{ opacity: 1, transform: "translateY(0) scale(1)" }, { opacity: 0, transform: "translateY(-12px) scale(0.985)" }], { duration: OUTRO_CONTENT_MS, easing: EASE_IN, fill: "forwards" });
  const washAnimation = wash?.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(1.12)" }], { duration: OUTRO_WASH_MS, delay: OUTRO_CONTENT_MS / 2, easing: EASE_OUT, fill: "forwards" });
  const backdrop = state.root.querySelector(".onboarding-base");
  backdrop?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: OUTRO_WASH_MS, delay: OUTRO_CONTENT_MS / 2, easing: EASE_OUT, fill: "forwards" });
  const done = washAnimation?.finished ?? Promise.resolve();
  done.then(() => window.overlayApi.close()).catch(() => window.overlayApi.close());
}

/**
 * The onboarding's keys: ↩ and → go on, ← goes back, Escape skips to the browser. Keys in a group of choices (the
 * swatches, the tour) stay theirs.
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
    goToScene(state, -1);
    return;
  }
  // Return on a button presses that button (the browser does it); elsewhere it means Continue.
  const isOnButton = target instanceof HTMLButtonElement;
  if (event.key === "Enter" && !isOnButton) {
    event.preventDefault();
    goForward(state);
  }
}

/**
 * Continue: the next scene, or on the last one, the browser.
 */
function goForward(state: Onboarding): void {
  if (state.sceneIndex === state.scenes.length - 1) {
    finishOnboarding(state);
    return;
  }
  goToScene(state, 1);
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
 * Builds the onboarding into the overlay's panel host and plays its entrance.
 */
export function renderOnboarding(host: HTMLElement, panel: WelcomePanel): void {
  onboarding?.scenes[onboarding.sceneIndex]?.leave();
  const root = createElement("div", "onboarding");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Welcome to Bow");
  root.tabIndex = -1;
  const content = createElement("div", "onboarding-content");
  const top = createElement("div", "onboarding-top");
  const progress = createElement("div", "onboarding-progress");
  progress.setAttribute("aria-hidden", "true");
  const progressMarks = ONBOARDING_SCENES.map(() => createElement("span", "onboarding-mark"));
  progress.append(...progressMarks);
  const skipButton = createTextButton("Skip", "onboarding-skip", () => {
    if (onboarding !== null) {
      finishOnboarding(onboarding);
    }
  });
  top.append(progress, skipButton);
  const stageElement = createElement("div", "onboarding-stage");
  const bottom = createElement("div", "onboarding-bottom");
  const backButton = createTextButton("Back", "onboarding-back", () => {
    if (onboarding !== null) {
      goToScene(onboarding, -1);
    }
  });
  const nextButton = createTextButton("", "onboarding-next", () => {
    if (onboarding !== null) {
      goForward(onboarding);
    }
  });
  bottom.append(backButton, nextButton);
  const announcer = createElement("div", "onboarding-announcer");
  announcer.setAttribute("aria-live", "polite");
  content.append(top, stageElement, bottom);
  root.append(...createWash(), content, announcer);
  // The tour's progress line (onboarding.css) fills in the time the tour waits before moving on.
  root.style.setProperty("--tour-advance", `${TOUR_ADVANCE_MS}ms`);

  const state: Onboarding = {
    root: root,
    scenes: [],
    sceneIndex: 0,
    data: panel.data,
    hasPickedLook: false,
    isLeaving: false,
    progressMarks: progressMarks,
    backButton: backButton,
    nextButton: nextButton,
    announcer: announcer,
  };
  const markLookPicked = (): void => {
    state.hasPickedLook = true;
  };
  state.scenes = [
    createHelloScene(),
    createImportScene(panel.data),
    createLookScene(panel.data, markLookPicked),
    createEssentialsScene(panel.data),
    createDefaultsScene(panel.data),
    createReadyScene(),
  ];
  state.scenes.forEach((scene, index) => {
    scene.element.hidden = index !== 0;
    stageElement.append(scene.element);
  });
  root.addEventListener("keydown", (event) => handleKey(state, event));
  onboarding = state;
  host.replaceChildren(root);
  paintAtmosphere(state);
  drawChrome(state);
  if (!prefersLessMotion()) {
    root.querySelector(".onboarding-wash")?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ICON_ENTER_MS, easing: EASE_OUT });
    top.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: ICON_ENTER_MS * 0.6, fill: "backwards" });
    bottom.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 600, delay: ICON_ENTER_MS * 0.7, easing: EASE_EMPHASIZED, fill: "backwards" });
  }
  state.scenes[0]?.enter();
  root.focus({ preventScroll: true });
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
  for (const scene of onboarding.scenes) {
    scene.update(data);
  }
}
