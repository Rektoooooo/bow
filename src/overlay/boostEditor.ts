/**
 * WHY this file exists:
 *   The Boost editor: CSS of your own for the current site (Arc's "code" Boost), saved per site and applied to all of
 *   its pages at once.
 *
 * Data source:
 *   The "boost" panel message: the site and its current CSS.
 *
 * Data flow:
 *   Control Center › Boost → "overlay:show" (boost) → renderBoostEditor() → Save → dispatch setBoostCss → pages
 *   Zap Elements → overlayApi.siteCommand("zap") → click elements on the page to hide them
 */
import type { OverlayPanel } from "../shared/overlay";
import { createElement, createTextButton, dispatch } from "../renderer/dom.js";

type BoostPanel = Extract<OverlayPanel, { kind: "boost" }>;

/** Shown in an empty editor, so people see what a Boost can do. */
const EXAMPLE_CSS = "/* Example: bigger text and no sidebar on this site */\nbody { font-size: 18px !important; }\naside { display: none !important; }";

/**
 * Builds the Boost editor panel.
 */
export function renderBoostEditor(host: HTMLElement, panel: BoostPanel): void {
  const container = createElement("div", "panel boost-editor");
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-label", `Boost for ${panel.site}`);

  const header = createElement("div", "boost-header");
  header.append(createElement("span", "boost-title", `Boost · ${panel.site}`));
  header.append(createElement("span", "boost-note", "CSS for every page of this site"));

  const editor = document.createElement("textarea");
  editor.className = "boost-css";
  editor.spellcheck = false;
  editor.value = panel.css;
  editor.placeholder = EXAMPLE_CSS;
  editor.setAttribute("aria-label", "Boost CSS");
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

  const save = (): void => {
    dispatch({ type: "setBoostCss", site: panel.site, css: editor.value });
    window.overlayApi.close();
  };
  const buttons = createElement("div", "boost-buttons");
  const zapButton = createTextButton("Zap Elements", "site-button boost-zap", () => window.overlayApi.siteCommand("zap"));
  zapButton.title = "Click elements on the page to hide them for good; Escape when done";
  buttons.append(
    zapButton,
    createTextButton("Delete Boost", "site-button boost-delete", () => {
      dispatch({ type: "deleteBoost", site: panel.site });
      window.overlayApi.close();
    }),
    createTextButton("Cancel", "site-button", () => window.overlayApi.close()),
    createTextButton("Save (⌘S)", "site-button boost-save", save),
  );
  container.append(header, editor, buttons);
  host.replaceChildren(container);
  requestAnimationFrame(() => editor.focus());
}
