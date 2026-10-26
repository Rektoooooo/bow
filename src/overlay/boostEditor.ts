/**
 * WHY this file exists:
 *   The Boost editor, like Arc's: change how one site looks for good. Colors (a shift round the color wheel, or
 *   light and dark swapped; pictures keep their colors), a font of your choice, Zap to hide elements, and code of
 *   your own: CSS, and JavaScript that runs only when you switch it on. Colors and fonts apply as you choose them;
 *   the code is saved with Save. The panel sits at the side without dimming, so the page shows the change.
 *
 * Data source:
 *   The "boost" panel message: the site and its current Boost.
 *
 * Data flow:
 *   Control Center › Boost → "overlay:show" (boost) → renderBoostEditor() → setBoostStyle at once / setBoostCss and
 *   setBoostJavaScript on Save → boostPages.ts updates the site's pages
 */
import type { OverlayPanel } from "../shared/overlay";
import { BOOST_FONTS } from "../shared/boostFonts.js";
import { createElement, createTextButton, dispatch } from "../renderer/dom.js";

type BoostPanel = Extract<OverlayPanel, { kind: "boost" }>;

/** Shown in an empty CSS editor, so people see what a Boost can do. */
const EXAMPLE_CSS = "/* Example: bigger text and no sidebar on this site */\nbody { font-size: 18px !important; }\naside { display: none !important; }";

/** Shown in an empty JavaScript editor. */
const EXAMPLE_JAVASCRIPT = "// Runs in each page of this site once it has loaded.\n// Example: open every link in the same tab\ndocument.querySelectorAll('a[target]').forEach((link) => link.removeAttribute('target'));";

/** While the hue slider moves, send at most one change per this many milliseconds. Our choice: smooth, not flooding. */
const SLIDER_SEND_INTERVAL_MS = 80;

/**
 * A titled section of the editor.
 */
function createSection(title: string): HTMLElement {
  const section = createElement("section", "boost-section");
  section.append(createElement("h2", "boost-section-title", title));
  return section;
}

/**
 * Builds the Boost editor panel.
 */
export function renderBoostEditor(host: HTMLElement, panel: BoostPanel): void {
  const style = { hueShift: panel.hueShift, isInverted: panel.isInverted, fontId: panel.fontId };
  let lastSentAt = 0;
  let pendingSend: number | null = null;
  const sendStyle = (): void => {
    dispatch({ type: "setBoostStyle", site: panel.site, hueShift: style.hueShift, isInverted: style.isInverted, fontId: style.fontId });
    lastSentAt = performance.now();
  };
  const sendStyleSoon = (): void => {
    const waited = performance.now() - lastSentAt;
    if (waited >= SLIDER_SEND_INTERVAL_MS) {
      sendStyle();
      return;
    }
    if (pendingSend === null) {
      pendingSend = window.setTimeout(() => {
        pendingSend = null;
        sendStyle();
      }, SLIDER_SEND_INTERVAL_MS - waited);
    }
  };

  const container = createElement("div", "panel boost-editor");
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-label", `Boost for ${panel.site}`);
  const header = createElement("div", "boost-header");
  header.append(createElement("span", "boost-title", `Boost · ${panel.site}`));
  header.append(createElement("span", "boost-note", "Changes how this site looks, on every page"));

  // Colors: the hue slider and Invert.
  const colors = createSection("Colors");
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "boost-hue";
  slider.min = "0";
  slider.max = "359";
  slider.value = String(style.hueShift);
  slider.setAttribute("aria-label", "Shift colors");
  slider.addEventListener("input", () => {
    style.hueShift = Number(slider.value);
    sendStyleSoon();
  });
  const invertButton = createTextButton("Invert", style.isInverted ? "site-button boost-chip is-active" : "site-button boost-chip", () => {
    style.isInverted = !style.isInverted;
    invertButton.classList.toggle("is-active", style.isInverted);
    sendStyle();
  });
  invertButton.title = "Light turns dark and dark turns light; pictures keep their colors";
  const resetColorsButton = createTextButton("Original Colors", "site-button boost-chip", () => {
    style.hueShift = 0;
    style.isInverted = false;
    slider.value = "0";
    invertButton.classList.remove("is-active");
    sendStyle();
  });
  const colorButtons = createElement("div", "boost-row");
  colorButtons.append(invertButton, resetColorsButton);
  colors.append(slider, colorButtons);

  // Font: the site's own, or one of ours (each chip shows itself in its font).
  const fonts = createSection("Font");
  const fontRow = createElement("div", "boost-row boost-fonts");
  const fontChoices = [{ id: "", label: "Original", stack: "inherit" }, ...BOOST_FONTS];
  for (const font of fontChoices) {
    const chip = createTextButton(font.label, "site-button boost-chip", () => {
      style.fontId = font.id;
      for (const other of fontRow.children) {
        other.classList.toggle("is-active", other === chip);
      }
      sendStyle();
    });
    chip.style.fontFamily = font.stack;
    chip.classList.toggle("is-active", font.id === style.fontId);
    fontRow.append(chip);
  }
  fonts.append(fontRow);

  // Zap: hide elements by clicking them.
  const zap = createSection("Zap");
  const zapRow = createElement("div", "boost-row");
  const zapButton = createTextButton("Zap Elements", "site-button boost-zap", () => window.overlayApi.siteCommand("zap"));
  zapButton.title = "Click elements on the page to hide them for good; Escape when done";
  zapRow.append(zapButton, createElement("span", "boost-note", panel.zapCount === 1 ? "1 element hidden" : `${panel.zapCount} elements hidden`));
  zap.append(zapRow);

  // Code: CSS and JavaScript, saved together.
  const code = createSection("Code");
  const codeTabs = createElement("div", "boost-row boost-code-tabs");
  const cssEditor = document.createElement("textarea");
  cssEditor.className = "boost-css";
  cssEditor.spellcheck = false;
  cssEditor.value = panel.css;
  cssEditor.placeholder = EXAMPLE_CSS;
  cssEditor.setAttribute("aria-label", "Boost CSS");
  const javascriptEditor = document.createElement("textarea");
  javascriptEditor.className = "boost-css boost-javascript";
  javascriptEditor.spellcheck = false;
  javascriptEditor.value = panel.javascript;
  javascriptEditor.placeholder = EXAMPLE_JAVASCRIPT;
  javascriptEditor.setAttribute("aria-label", "Boost JavaScript");
  javascriptEditor.hidden = true;
  const runLabel = createElement("label", "boost-run");
  const runCheckbox = document.createElement("input");
  runCheckbox.type = "checkbox";
  runCheckbox.checked = panel.isJavaScriptOn;
  runLabel.append(runCheckbox, document.createTextNode(` Run this JavaScript on ${panel.site}`));
  runLabel.hidden = true;
  const cssTab = createTextButton("CSS", "site-button boost-chip is-active", () => showCode(false));
  const javascriptTab = createTextButton("JavaScript", "site-button boost-chip", () => showCode(true));
  const showCode = (isJavaScript: boolean): void => {
    cssEditor.hidden = isJavaScript;
    javascriptEditor.hidden = !isJavaScript;
    runLabel.hidden = !isJavaScript;
    cssTab.classList.toggle("is-active", !isJavaScript);
    javascriptTab.classList.toggle("is-active", isJavaScript);
  };
  codeTabs.append(cssTab, javascriptTab);
  code.append(codeTabs, cssEditor, javascriptEditor, runLabel);

  const save = (): void => {
    dispatch({ type: "setBoostCss", site: panel.site, css: cssEditor.value });
    dispatch({ type: "setBoostJavaScript", site: panel.site, javascript: javascriptEditor.value, isOn: runCheckbox.checked });
    window.overlayApi.close();
  };
  for (const editor of [cssEditor, javascriptEditor]) {
    editor.addEventListener("keydown", (event) => {
      // ⌘S saves; Tab inserts two spaces instead of leaving the field.
      if (event.metaKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
      }
      if (event.key === "Tab") {
        event.preventDefault();
        editor.setRangeText("  ", editor.selectionStart, editor.selectionEnd, "end");
      }
    });
  }

  const buttons = createElement("div", "boost-buttons");
  buttons.append(
    createTextButton("Delete Boost", "site-button boost-delete", () => {
      dispatch({ type: "deleteBoost", site: panel.site });
      window.overlayApi.close();
    }),
    createTextButton("Done", "site-button", () => window.overlayApi.close()),
    createTextButton("Save Code (⌘S)", "site-button boost-save", save),
  );
  container.append(header, colors, fonts, zap, code, buttons);
  host.replaceChildren(container);
}
