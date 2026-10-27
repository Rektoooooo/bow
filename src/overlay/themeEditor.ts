/**
 * WHY this file exists:
 *   Arc's theme editor for a Space, as the popover the user's Arc shows above the sidebar's bottom bar (their screen
 *   recording, 2026-10-27): a dotted pad with one handle per color (up to three, − and + below them) and the
 *   automatic / light / dark switch at its top, a row of preset colors with ‹ › to page, and at the bottom a wavy
 *   slider for the intensity and a dial for the film grain. Every change applies at once, so the sidebar beside it
 *   shows the result live.
 *
 * Data source:
 *   The "theme" panel message: the Space, its current theme, our gradient presets and where the sidebar ends.
 *   Which control is which (slider = intensity, dial = grain) is read from the user's black Space: intensity 1 put
 *   the slider at its end, no grain left the dial at its start.
 *
 * Data flow:
 *   Space menu › Edit Theme… → "overlay:show" (theme) → renderThemeEditor() → drags and clicks → dispatch setSpaceTheme
 */
import type { OverlayPanel } from "../shared/overlay";
import { colorAtPadPoint, padPointOfColor } from "../shared/themePad.js";
import type { SpaceTheme, ThemeAppearance } from "../shared/types";
import type { IconName } from "../renderer/icons.js";
import { createElement, createIconButton, dispatch } from "../renderer/dom.js";

type ThemePanel = Extract<OverlayPanel, { kind: "theme" }>;

/** Most colors in a theme, like Arc's (ipc.ts refuses more). */
const MAX_COLORS = 3;

/** The popover's distance from the sidebar's edge and from the window's bottom: 14 pt in the user's Arc. */
const POPOVER_MARGIN_PX = 14;

/** Wait this long after the last change before sending it, so a drag sends a few updates, not hundreds. */
const SEND_DELAY_MS = 80;

/** Arc's first page of preset colors, measured from the user's recording (sRGB, about ±3). */
const ARC_PRESET_COLORS = ["#ece7de", "#ef8fb0", "#9a6591", "#ed525f", "#fc774b", "#f5cc4b", "#2ae289", "#5a9fba", "#585a7c"];

/** Preset dots per page, like Arc's row. */
const PRESETS_PER_PAGE = 9;

/** A color added by "+": a medium blue on the pad. Our choice. */
const NEW_COLOR_POINT = { x: 0.45, y: 0.3 };

/** The intensity slider's wave: periods over the whole track, height and line width. Measured: 6, 34 pt, 4 pt. */
const WAVE_PERIODS = 6;
const WAVE_HEIGHT_PX = 34;

/** Dots around the grain dial (the user's Arc shows 24). */
const DIAL_DOT_COUNT = 24;

/** The appearance switch, in Arc's order: automatic (sparkles), light (sun), dark (moon and stars). */
const APPEARANCE_CHOICES: { value: ThemeAppearance; icon: IconName; label: string }[] = [
  { value: "auto", icon: "sparkles", label: "Automatic" },
  { value: "light", icon: "sun", label: "Light" },
  { value: "dark", icon: "moonStars", label: "Dark" },
];

/** One preset dot: its colors (one for Arc's, two or three for our gradients) and the appearance it sets, if any. */
interface PresetDot {
  colors: string[];
  label: string;
  appearance: ThemeAppearance | null;
}

/** The theme being edited, which handle is selected, the preset page and the pending send. */
let editedTheme: SpaceTheme | null = null;
let editedSpaceId = "";
let selectedColorIndex = 0;
let presetPage = 0;
let sendTimer: number | null = null;

/**
 * The theme being edited (set by renderThemeEditor before anything reads it).
 */
function getTheme(): SpaceTheme {
  return editedTheme as SpaceTheme;
}

/**
 * Changes the edited theme and sends it a moment after the last change.
 */
function updateTheme(changes: Partial<SpaceTheme>): void {
  editedTheme = { ...getTheme(), ...changes };
  if (sendTimer !== null) {
    window.clearTimeout(sendTimer);
  }
  sendTimer = window.setTimeout(() => {
    sendTimer = null;
    dispatch({ type: "setSpaceTheme", spaceId: editedSpaceId, theme: getTheme() });
  }, SEND_DELAY_MS);
}

/**
 * Where a pointer event falls on an element, from -1 to 1 on both axes (the middle at 0).
 */
function readPadPoint(event: PointerEvent, pad: HTMLElement): { x: number; y: number } {
  const box = pad.getBoundingClientRect();
  const radius = Math.min(box.width, box.height) / 2;
  return { x: (event.clientX - box.left - box.width / 2) / radius, y: (event.clientY - box.top - box.height / 2) / radius };
}

/**
 * Puts a handle where its color sits on the pad, filled with that color.
 */
function placeHandle(handle: HTMLElement, color: string): void {
  const point = padPointOfColor(color);
  // The pad's circle of colors touches the middle of each side: 50 % ± half the size.
  handle.style.left = `${50 + point.x * 50}%`;
  handle.style.top = `${50 + point.y * 50}%`;
  handle.style.setProperty("--handle-color", color);
}

/**
 * The pad: one handle per color. A drag moves the handle it starts on (or, off the handles, the selected one).
 */
function renderPad(panel: ThemePanel, host: HTMLElement): HTMLElement {
  const pad = createElement("div", "theme-pad");
  const field = createElement("div", "theme-pad-field");
  const handles = getTheme().colors.map((color, index) => {
    const handle = createElement("div", "theme-handle");
    handle.dataset.colorIndex = String(index);
    handle.classList.toggle("is-selected", index === selectedColorIndex);
    placeHandle(handle, color);
    return handle;
  });
  field.append(...handles);

  const moveSelectedHandle = (event: PointerEvent): void => {
    const color = colorAtPadPoint(readPadPoint(event, field));
    const colors = [...getTheme().colors];
    colors[selectedColorIndex] = color;
    updateTheme({ colors: colors });
    const handle = handles[selectedColorIndex];
    if (handle !== undefined) {
      placeHandle(handle, color);
    }
  };
  field.addEventListener("pointerdown", (event) => {
    const touched = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".theme-handle") : null;
    selectedColorIndex = touched === null ? selectedColorIndex : Number(touched.dataset.colorIndex);
    handles.forEach((handle, index) => handle.classList.toggle("is-selected", index === selectedColorIndex));
    field.setPointerCapture(event.pointerId);
    moveSelectedHandle(event);
  });
  field.addEventListener("pointermove", (event) => {
    if (field.hasPointerCapture(event.pointerId)) {
      moveSelectedHandle(event);
    }
  });

  pad.append(field, renderAppearanceSwitch(panel, host), renderColorCount(panel, host));
  return pad;
}

/**
 * The automatic / light / dark switch at the pad's top.
 */
function renderAppearanceSwitch(panel: ThemePanel, host: HTMLElement): HTMLElement {
  const row = createElement("div", "theme-appearance");
  for (const choice of APPEARANCE_CHOICES) {
    const button = createIconButton(choice.icon, choice.label, "theme-appearance-button", () => {
      updateTheme({ appearance: choice.value });
      renderThemeEditor(host, { ...panel, theme: getTheme() });
    });
    button.classList.toggle("is-active", getTheme().appearance === choice.value);
    row.append(button);
  }
  return row;
}

/**
 * − and + at the pad's bottom: remove the selected color, add one (one to three colors).
 */
function renderColorCount(panel: ThemePanel, host: HTMLElement): HTMLElement {
  const row = createElement("div", "theme-count");
  const colors = getTheme().colors;
  const removeButton = createIconButton("minus", "Remove this color", "theme-count-button", () => {
    const remaining = getTheme().colors.filter((_color, index) => index !== selectedColorIndex);
    selectedColorIndex = Math.max(0, selectedColorIndex - 1);
    updateTheme({ colors: remaining });
    renderThemeEditor(host, { ...panel, theme: getTheme() });
  });
  removeButton.disabled = colors.length <= 1;
  const addButton = createIconButton("plus", "Add a color (gradient)", "theme-count-button", () => {
    const added = [...getTheme().colors, colorAtPadPoint(NEW_COLOR_POINT)];
    selectedColorIndex = added.length - 1;
    updateTheme({ colors: added });
    renderThemeEditor(host, { ...panel, theme: getTheme() });
  });
  addButton.disabled = colors.length >= MAX_COLORS;
  row.append(removeButton, addButton);
  return row;
}

/**
 * Every preset dot: Arc's single colors first (they recolor the selected handle), then our gradients (they replace
 * the theme's colors and appearance).
 */
function listPresetDots(panel: ThemePanel): PresetDot[] {
  const arcDots: PresetDot[] = ARC_PRESET_COLORS.map((color) => ({ colors: [color], label: color, appearance: null }));
  const gradientDots: PresetDot[] = panel.presets.map((preset) => ({ colors: preset.colors, label: preset.label, appearance: preset.appearance }));
  return [...arcDots, ...gradientDots];
}

/**
 * Applies a preset dot to the edited theme.
 */
function applyPresetDot(dot: PresetDot): void {
  if (dot.appearance !== null) {
    selectedColorIndex = 0;
    updateTheme({ colors: dot.colors, appearance: dot.appearance });
    return;
  }
  const colors = [...getTheme().colors];
  colors[selectedColorIndex] = dot.colors[0] ?? colors[selectedColorIndex] ?? "#000000";
  updateTheme({ colors: colors });
}

/**
 * The preset row: ‹, one page of dots, ›.
 */
function renderPresets(panel: ThemePanel, host: HTMLElement): HTMLElement {
  const row = createElement("div", "theme-presets");
  const dots = listPresetDots(panel);
  const pageCount = Math.ceil(dots.length / PRESETS_PER_PAGE);
  const pageDots = dots.slice(presetPage * PRESETS_PER_PAGE, (presetPage + 1) * PRESETS_PER_PAGE);
  const previousButton = createIconButton("chevronLeft", "Previous colors", "theme-page-button", () => {
    presetPage = Math.max(0, presetPage - 1);
    renderThemeEditor(host, { ...panel, theme: getTheme() });
  });
  previousButton.disabled = presetPage === 0;
  const nextButton = createIconButton("chevronRight", "More colors", "theme-page-button", () => {
    presetPage = Math.min(pageCount - 1, presetPage + 1);
    renderThemeEditor(host, { ...panel, theme: getTheme() });
  });
  nextButton.disabled = presetPage >= pageCount - 1;

  const dotRow = createElement("div", "theme-preset-dots");
  for (const dot of pageDots) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-preset";
    button.title = dot.label;
    button.setAttribute("aria-label", `Color ${dot.label}`);
    const first = dot.colors[0] ?? "#000000";
    const last = dot.colors[dot.colors.length - 1] ?? first;
    // CSSOM (not a style attribute), so the page's content security policy allows it.
    button.style.background = `linear-gradient(135deg, ${first}, ${last})`;
    button.addEventListener("click", () => {
      applyPresetDot(dot);
      renderThemeEditor(host, { ...panel, theme: getTheme() });
    });
    dotRow.append(button);
  }
  row.append(previousButton, dotRow, nextButton);
  return row;
}

/**
 * The wave drawn from the slider's start to its handle: an SVG path of sine periods spread over the whole track.
 */
function buildWavePath(drawnWidth: number, trackWidth: number): string {
  const steps = Math.max(2, Math.round(drawnWidth));
  const middle = WAVE_HEIGHT_PX / 2;
  const amplitude = WAVE_HEIGHT_PX / 2 - 2;
  const radiansPerPixel = (WAVE_PERIODS * 2 * Math.PI) / Math.max(trackWidth, 1);
  const points: string[] = [];
  for (let step = 0; step <= steps; step++) {
    const x = (step / steps) * drawnWidth;
    const y = middle - Math.sin(x * radiansPerPixel) * amplitude;
    const command = step === 0 ? "M" : "L";
    points.push(`${command}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return points.join(" ");
}

/**
 * The intensity slider: a track with a wave up to a white pill, dragged sideways (0 at the left, 1 at the right).
 */
function renderIntensitySlider(): HTMLElement {
  const slider = createElement("div", "theme-intensity");
  slider.setAttribute("role", "slider");
  slider.setAttribute("aria-label", "Intensity");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("theme-wave");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.append(path);
  const pill = createElement("div", "theme-intensity-pill");
  slider.append(svg, pill);

  const show = (intensity: number): void => {
    const trackWidth = slider.clientWidth - pill.offsetWidth;
    const pillLeft = Math.max(0, trackWidth) * intensity;
    pill.style.left = `${pillLeft}px`;
    svg.setAttribute("width", String(Math.max(pillLeft, 1)));
    svg.setAttribute("height", String(WAVE_HEIGHT_PX));
    path.setAttribute("d", buildWavePath(pillLeft, trackWidth));
    slider.setAttribute("aria-valuenow", intensity.toFixed(2));
  };
  const moveTo = (event: PointerEvent): void => {
    const box = slider.getBoundingClientRect();
    const usable = Math.max(1, box.width - pill.offsetWidth);
    const intensity = Math.max(0, Math.min(1, (event.clientX - box.left - pill.offsetWidth / 2) / usable));
    updateTheme({ intensity: intensity });
    show(intensity);
  };
  slider.addEventListener("pointerdown", (event) => {
    slider.setPointerCapture(event.pointerId);
    moveTo(event);
  });
  slider.addEventListener("pointermove", (event) => {
    if (slider.hasPointerCapture(event.pointerId)) {
      moveTo(event);
    }
  });
  // Measured once it is on the page.
  requestAnimationFrame(() => show(getTheme().intensity ?? 1));
  return slider;
}

/**
 * The grain dial: a ring of dots with a tick, turned by dragging around it (0 at the top, clockwise to 1).
 */
function renderGrainDial(): HTMLElement {
  const dial = createElement("div", "theme-grain-dial");
  dial.setAttribute("role", "slider");
  dial.setAttribute("aria-label", "Grain");
  for (let index = 0; index < DIAL_DOT_COUNT; index++) {
    const dot = createElement("span", "theme-dial-dot");
    dot.style.setProperty("--dot-turn", `${index / DIAL_DOT_COUNT}turn`);
    dial.append(dot);
  }
  const tick = createElement("span", "theme-dial-tick");
  dial.append(createElement("span", "theme-dial-center"), tick);

  const show = (grain: number): void => {
    tick.style.setProperty("--tick-turn", `${grain}turn`);
    dial.setAttribute("aria-valuenow", grain.toFixed(2));
  };
  const turnTo = (event: PointerEvent): void => {
    const box = dial.getBoundingClientRect();
    const angle = Math.atan2(event.clientX - box.left - box.width / 2, -(event.clientY - box.top - box.height / 2));
    const grain = (angle < 0 ? angle + 2 * Math.PI : angle) / (2 * Math.PI);
    updateTheme({ grain: grain });
    show(grain);
  };
  dial.addEventListener("pointerdown", (event) => {
    dial.setPointerCapture(event.pointerId);
    turnTo(event);
  });
  dial.addEventListener("pointermove", (event) => {
    if (dial.hasPointerCapture(event.pointerId)) {
      turnTo(event);
    }
  });
  show(getTheme().grain);
  return dial;
}

/**
 * Builds the popover above the sidebar's bottom bar, just right of the sidebar.
 */
export function renderThemeEditor(host: HTMLElement, panel: ThemePanel): void {
  if (panel.spaceId !== editedSpaceId) {
    selectedColorIndex = 0;
    presetPage = 0;
  }
  editedTheme = panel.theme;
  editedSpaceId = panel.spaceId;
  selectedColorIndex = Math.min(selectedColorIndex, panel.theme.colors.length - 1);
  const container = createElement("div", "panel theme-editor");
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-label", `Edit theme of ${panel.spaceName}`);
  container.style.left = `${panel.sidebarWidth + POPOVER_MARGIN_PX}px`;
  container.style.bottom = `${POPOVER_MARGIN_PX}px`;

  const bottomRow = createElement("div", "theme-bottom");
  bottomRow.append(renderIntensitySlider(), renderGrainDial());
  container.append(renderPad(panel, host), renderPresets(panel, host), bottomRow);
  host.replaceChildren(container);
}
