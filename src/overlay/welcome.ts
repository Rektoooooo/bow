/**
 * WHY this file exists:
 *   The first start, like Arc's welcome: a short tour instead of an empty window. Four steps: bring your bookmarks
 *   and history over (Arc, Chrome, Safari…), pick a look for your first Space, learn the few shortcuts that make the
 *   browser fast, and make it your default browser. Every step can be skipped; it shows once.
 *
 * Data source:
 *   The "welcome" panel message: the import sources found on this Mac, the theme presets, the first Space.
 *
 * Data flow:
 *   first start (overlayController.ts) → "overlay:show" (welcome) → buttons → dispatch(import / theme / default
 *   browser) → Done → dispatch(finishWelcome) → shown never again
 */
import type { OverlayPanel } from "../shared/overlay";
import { createElement, createTextButton, dispatch } from "../renderer/dom.js";

type WelcomePanel = Extract<OverlayPanel, { kind: "welcome" }>;

/** The shortcuts the tour teaches (ours are Arc's). */
const SHORTCUTS: { keys: string; text: string }[] = [
  { keys: "⌘T", text: "New tab: search or type an address" },
  { keys: "⌘S", text: "Hide or show the sidebar" },
  { keys: "⌘D", text: "Pin a tab, so it stays" },
  { keys: "⌃Tab", text: "Back to the tab you used last" },
  { keys: "⌃⇧=", text: "Split view: two pages side by side" },
  { keys: "⇧⌘C", text: "Copy the page's address" },
];

/** Today tabs you leave alone move to the Archive after this long, the tour says (the default). */
const ARCHIVE_EXPLANATION = "Tabs you open land in Today. Ones you don't use for 12 hours move to the Archive (⌘⇧L), so the sidebar stays tidy. Pin what you want to keep.";

/**
 * One step: a title, a sentence and its content.
 */
function createStep(title: string, text: string, content: HTMLElement[]): HTMLElement {
  const step = createElement("section", "welcome-step");
  step.append(createElement("h1", "welcome-title", title), createElement("p", "welcome-text", text), ...content);
  return step;
}

/**
 * Builds the welcome tour.
 */
export function renderWelcome(host: HTMLElement, panel: WelcomePanel): void {
  const container = createElement("div", "panel welcome");
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-label", "Welcome");

  const importButtons = createElement("div", "welcome-choices");
  importButtons.append(createTextButton("From Arc…", "welcome-choice", () => dispatch({ type: "importFromArc" })));
  for (const source of panel.importSources) {
    importButtons.append(createTextButton(`From ${source.label}…`, "welcome-choice", () => dispatch({ type: "importFromBrowser", sourceId: source.id })));
  }
  const themeButtons = createElement("div", "welcome-choices");
  for (const preset of panel.presets) {
    const button = createTextButton(preset.label, "welcome-choice welcome-theme", () =>
      dispatch({ type: "setSpaceTheme", spaceId: panel.spaceId, theme: { colors: preset.colors, appearance: preset.appearance, grain: 0 } }),
    );
    button.style.setProperty("--swatch", `linear-gradient(135deg, ${preset.colors.join(", ")}${preset.colors.length === 1 ? `, ${preset.colors[0]}` : ""})`);
    themeButtons.append(button);
  }
  const shortcutList = createElement("div", "welcome-shortcuts");
  for (const shortcut of SHORTCUTS) {
    const line = createElement("div", "welcome-shortcut");
    line.append(createElement("kbd", "", shortcut.keys), createElement("span", "", shortcut.text));
    shortcutList.append(line);
  }
  const defaultButton = createTextButton("Make It My Default Browser", "welcome-choice", () => dispatch({ type: "setAsDefaultBrowser" }));

  const steps = [
    createStep("Welcome", "A browser with your tabs in a sidebar, Spaces for each part of your life, and a Today list that tidies itself. Bring your bookmarks and history along:", [importButtons]),
    createStep("Pick a look", "Each Space has its own colors. Choose one for this Space; change it any time from the Space's name.", [themeButtons]),
    createStep("A few keys", ARCHIVE_EXPLANATION, [shortcutList]),
    createStep("Open links here", "Links from other apps can open in this browser, in the right Space.", [defaultButton]),
  ];
  let stepIndex = 0;
  const stepHolder = createElement("div", "welcome-body");
  const dots = createElement("div", "welcome-dots");
  const backButton = createTextButton("Back", "site-button", () => showStep(stepIndex - 1));
  const nextButton = createTextButton("Next", "site-button boost-save", () => {
    if (stepIndex === steps.length - 1) {
      dispatch({ type: "finishWelcome" });
      window.overlayApi.close();
      return;
    }
    showStep(stepIndex + 1);
  });
  const skipButton = createTextButton("Skip", "site-button welcome-skip", () => {
    dispatch({ type: "finishWelcome" });
    window.overlayApi.close();
  });
  const showStep = (index: number): void => {
    stepIndex = Math.min(Math.max(index, 0), steps.length - 1);
    stepHolder.replaceChildren(steps[stepIndex] as HTMLElement);
    dots.replaceChildren(...steps.map((_step, dotIndex) => createElement("span", dotIndex === stepIndex ? "welcome-dot is-active" : "welcome-dot")));
    backButton.disabled = stepIndex === 0;
    nextButton.textContent = stepIndex === steps.length - 1 ? "Start Browsing" : "Next";
  };
  const footer = createElement("div", "welcome-footer");
  footer.append(skipButton, dots, backButton, nextButton);
  container.append(stepHolder, footer);
  host.replaceChildren(container);
  showStep(0);
}
