/**
 * WHY this file exists:
 *   Every page of ours shows icons: back, reload, folder, archive, … They are Apple's SF Symbols, the same system
 *   icons Arc uses, rendered by macOS (src/main/symbols.ts) and shown as masks tinted with the text color, so hover
 *   and theme colors apply to them like to text. One icon has no SF Symbol (the open folder Arc draws itself); it
 *   stays a small path of our own drawn in the same weight.
 *
 * Data source:
 *   SYMBOL_NAMES (src/shared/symbols.ts) and the images each page receives from getSymbols().
 *
 * Data flow:
 *   page starts → installSymbols(await api.getSymbols()) → a stylesheet with one mask per symbol
 *   sidebar.ts / toolbar.ts / overlay → createIcon("folder") → <span class="icon icon-symbol" data-symbol="folder">
 */
import { SYMBOL_NAMES } from "../shared/symbols.js";
import type { SymbolIconName, SymbolImage } from "../shared/symbols";

/** Icons we draw ourselves because no SF Symbol fits: path data on a 16×16 grid, stroked like SF Symbols Regular. */
const OWN_ICON_PATHS = {
  folderOpen: "M2.25 12.75V4.25c0-.55.45-1 1-1h3.1l1.4 1.4h4.75c.55 0 1 .45 1 1v1.1M2.25 12.75l1.7-5.1c.14-.4.52-.65.95-.65h9.3c.68 0 1.16.67.95 1.32l-1.5 4.43H2.25z",
} as const;

export type IconName = SymbolIconName | keyof typeof OWN_ICON_PATHS;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Edge length of our own drawn icons, in CSS pixels. */
const OWN_ICON_SIZE_PX = 16;

/** Stroke width of our own drawn icons: close to SF Symbols' Regular weight at this size. */
const OWN_ICON_STROKE_WIDTH = 1.3;

/**
 * True for icons drawn from an SF Symbol.
 */
function isSymbolIcon(name: IconName): name is SymbolIconName {
  return name in SYMBOL_NAMES;
}

/**
 * Adds a stylesheet with one mask rule per rendered symbol. The sheet is built through the CSSOM (constructable
 * stylesheets), which our pages' Content-Security-Policy allows, unlike an inline <style>. Icons drawn before this
 * runs simply appear once it has.
 */
export function installSymbols(images: Record<string, SymbolImage>): void {
  const rules: string[] = [];
  for (const [name, image] of Object.entries(images)) {
    const url = `url("${image.url}")`;
    rules.push(
      `.icon-symbol[data-symbol="${name}"] { -webkit-mask-image: ${url}; mask-image: ${url}; ` +
        `--symbol-width: ${image.width}px; --symbol-height: ${image.height}px; }`,
    );
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(rules.join("\n"));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

/**
 * Builds an icon. SF Symbols become a masked <span> (sized and tinted by CSS), our own icons an <svg>. Both are
 * hidden from screen readers, because the button around them carries the label.
 */
export function createIcon(name: IconName, className: string = "icon"): Element {
  if (isSymbolIcon(name)) {
    const symbol = document.createElement("span");
    symbol.className = `${className} icon-symbol`;
    symbol.dataset.symbol = name;
    symbol.setAttribute("aria-hidden", "true");
    return symbol;
  }
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", `0 0 ${OWN_ICON_SIZE_PX} ${OWN_ICON_SIZE_PX}`);
  svg.setAttribute("width", String(OWN_ICON_SIZE_PX));
  svg.setAttribute("height", String(OWN_ICON_SIZE_PX));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", className);
  const path = document.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute("d", OWN_ICON_PATHS[name]);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", String(OWN_ICON_STROKE_WIDTH));
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}
