/**
 * WHY this file exists:
 *   Arc's theme editor for a Space: one to three colors (a gradient), light / dark / automatic, and film grain, plus
 *   ready-made presets. Every change applies at once, so the sidebar beside the panel shows the result live.
 *
 * Data source:
 *   The "theme" panel message: the Space, its current theme, the presets and where the sidebar ends.
 *
 * Data flow:
 *   Space menu › Edit Theme… → "overlay:show" (theme) → renderThemeEditor() → edits → dispatch setSpaceTheme
 */
import type { OverlayPanel } from "../shared/overlay";
import type { SpaceTheme, ThemeAppearance } from "../shared/types";
import { createElement, createIconButton, createTextButton, dispatch } from "../renderer/dom.js";

type ThemePanel = Extract<OverlayPanel, { kind: "theme" }>;

/** Most colors in a theme, like Arc's gradient editor (ipc.ts refuses more). */
const MAX_COLORS = 3;

/** Space between the sidebar and the panel. */
const PANEL_GAP_PX = 12;

/** Wait this long after the last change before sending it, so dragging a color picker sends a few updates, not hundreds. */
const SEND_DELAY_MS = 80;

/** Color added by "+": a soft neutral that blends with most themes. Our choice. */
const NEW_COLOR = "#c8c3d9";

const APPEARANCE_CHOICES: { value: ThemeAppearance; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Automatic" },
];

/** The theme being edited and the pending send. */
let editedTheme: SpaceTheme | null = null;
let editedSpaceId = "";
let sendTimer: number | null = null;

/**
 * Sends the edited theme a moment after the last change.
 */
function sendSoon(): void {
  if (sendTimer !== null) {
    window.clearTimeout(sendTimer);
  }
  sendTimer = window.setTimeout(() => {
    sendTimer = null;
    if (editedTheme !== null) {
      dispatch({ type: "setSpaceTheme", spaceId: editedSpaceId, theme: editedTheme });
    }
  }, SEND_DELAY_MS);
}

/**
 * Builds the color swatches: one color picker per color, with + and − to change how many.
 */
function renderColorRow(panel: ThemePanel, host: HTMLElement): HTMLElement {
  const row = createElement("div", "theme-colors");
  const theme = editedTheme as SpaceTheme;
  theme.colors.forEach((color, index) => {
    const picker = document.createElement("input");
    picker.type = "color";
    picker.className = "theme-color";
    picker.value = color;
    picker.setAttribute("aria-label", `Color ${index + 1}`);
    picker.addEventListener("input", () => {
      const colors = [...(editedTheme as SpaceTheme).colors];
      colors[index] = picker.value;
      editedTheme = { ...(editedTheme as SpaceTheme), colors: colors };
      sendSoon();
    });
    row.append(picker);
  });
  if (theme.colors.length < MAX_COLORS) {
    row.append(
      createIconButton("plus", "Add a color (gradient)", "theme-round-button", () => {
        editedTheme = { ...(editedTheme as SpaceTheme), colors: [...(editedTheme as SpaceTheme).colors, NEW_COLOR] };
        sendSoon();
        renderThemeEditor(host, { ...panel, theme: editedTheme });
      }),
    );
  }
  if (theme.colors.length > 1) {
    row.append(
      createTextButton("−", "theme-round-button", () => {
        editedTheme = { ...(editedTheme as SpaceTheme), colors: (editedTheme as SpaceTheme).colors.slice(0, -1) };
        sendSoon();
        renderThemeEditor(host, { ...panel, theme: editedTheme });
      }),
    );
  }
  return row;
}

/**
 * Builds the light / dark / automatic switch.
 */
function renderAppearanceRow(panel: ThemePanel, host: HTMLElement): HTMLElement {
  const row = createElement("div", "theme-segmented");
  for (const choice of APPEARANCE_CHOICES) {
    const button = createTextButton(choice.label, "theme-segment", () => {
      editedTheme = { ...(editedTheme as SpaceTheme), appearance: choice.value };
      sendSoon();
      renderThemeEditor(host, { ...panel, theme: editedTheme });
    });
    button.classList.toggle("is-active", (editedTheme as SpaceTheme).appearance === choice.value);
    row.append(button);
  }
  return row;
}

/**
 * Builds the grain slider (0 to 1).
 */
function renderGrainRow(): HTMLElement {
  const row = createElement("label", "theme-grain");
  row.append(createElement("span", "theme-label", "Grain"));
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "1";
  slider.step = "0.05";
  slider.value = String((editedTheme as SpaceTheme).grain);
  slider.addEventListener("input", () => {
    editedTheme = { ...(editedTheme as SpaceTheme), grain: Number(slider.value) };
    sendSoon();
  });
  row.append(slider);
  return row;
}

/**
 * Builds the intensity slider (0 to 1), Arc's "how much of the color": less makes the frame quieter (themePalette.ts).
 */
function renderIntensityRow(): HTMLElement {
  const row = createElement("label", "theme-grain theme-intensity");
  row.append(createElement("span", "theme-label", "Intensity"));
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "1";
  slider.step = "0.05";
  slider.value = String((editedTheme as SpaceTheme).intensity ?? 1);
  slider.addEventListener("input", () => {
    editedTheme = { ...(editedTheme as SpaceTheme), intensity: Number(slider.value) };
    sendSoon();
  });
  row.append(slider);
  return row;
}

/**
 * Builds the preset chips; each shows its colors and applies them on click (grain stays as it is).
 */
function renderPresets(panel: ThemePanel, host: HTMLElement): HTMLElement {
  const row = createElement("div", "theme-presets");
  for (const preset of panel.presets) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "theme-preset";
    chip.title = preset.label;
    chip.setAttribute("aria-label", `Preset ${preset.label}`);
    // CSSOM (not a style attribute), so the page's content security policy allows it.
    const first = preset.colors[0] ?? NEW_COLOR;
    const last = preset.colors[preset.colors.length - 1] ?? first;
    chip.style.background = `linear-gradient(135deg, ${first}, ${last})`;
    chip.addEventListener("click", () => {
      editedTheme = { ...(editedTheme as SpaceTheme), colors: preset.colors, appearance: preset.appearance };
      sendSoon();
      renderThemeEditor(host, { ...panel, theme: editedTheme });
    });
    row.append(chip);
  }
  return row;
}

/**
 * Builds the theme editor beside the sidebar.
 */
export function renderThemeEditor(host: HTMLElement, panel: ThemePanel): void {
  editedTheme = panel.theme;
  editedSpaceId = panel.spaceId;
  const container = createElement("div", "panel theme-editor");
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-label", "Edit theme");
  container.style.left = `${panel.sidebarWidth + PANEL_GAP_PX}px`;

  const header = createElement("div", "theme-header");
  header.append(createElement("span", "theme-title", `${panel.spaceIcon}  ${panel.spaceName}`));
  header.append(createIconButton("close", "Done (Esc)", "theme-round-button", () => window.overlayApi.close()));
  container.append(
    header,
    createElement("span", "theme-label", "Colors"),
    renderColorRow(panel, host),
    createElement("span", "theme-label", "Appearance"),
    renderAppearanceRow(panel, host),
    renderIntensityRow(),
    renderGrainRow(),
    createElement("span", "theme-label", "Presets"),
    renderPresets(panel, host),
  );
  host.replaceChildren(container);
}
