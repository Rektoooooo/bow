/**
 * WHY this file exists:
 *   Every page of ours shows icons: back, reload, folder, archive, … They are Apple's SF Symbols, the same system
 *   icons Arc uses, rendered by macOS (src/main/symbols.ts) and shown as masks tinted with the text color, so hover
 *   and theme colors apply to them like to text. Folders are drawn by us: Arc's folders are its own drawings (taller
 *   than SF Symbols' folder, with a dark inside), so ours are our own paths in the same proportions, measured from
 *   the user's screenshots (closed 19 × 19 pt, open 22 × 17 pt).
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

/**
 * One part of an icon we draw: an outline in the text color, filled with nothing, a soft wash of the text color
 * (the back of an open folder) or near-black (the inside of a folder; near-white in light mode, see sidebar.css).
 * A "solid" part is filled in the text color and has no outline (the planet's sphere: its edges must stay exact).
 */
interface OwnIconPart {
  path: string;
  fill: "none" | "soft" | "dark" | "solid";
}

interface OwnIcon {
  width: number;
  height: number;
  parts: OwnIconPart[];
}

/** Icons we draw ourselves, in CSS pixels. */
const OWN_ICONS = {
  folderClosed: {
    width: 19,
    height: 19,
    parts: [
      { path: "M1.25 5.25V3.25C1.25 2.15 2.15 1.25 3.25 1.25H6.9C7.45 1.25 7.95 1.5 8.3 1.9L9.4 3.25H15.75C16.85 3.25 17.75 4.15 17.75 5.25Z", fill: "soft" },
      { path: "M1.25 5.25H17.75V15.5C17.75 16.75 16.75 17.75 15.5 17.75H3.5C2.25 17.75 1.25 16.75 1.25 15.5Z", fill: "dark" },
    ],
  },
  folderOpen: {
    width: 22,
    height: 17,
    parts: [
      { path: "M1.5 12.5V2.6C1.5 1.7 2.2 1 3.1 1H6.2C6.7 1 7.1 1.2 7.4 1.6L8.3 2.9H18.4C19.3 2.9 20 3.6 20 4.5V5.1H7.6L4.7 15.4C2.9 15.4 1.5 14.2 1.5 12.5Z", fill: "soft" },
      { path: "M7.6 5.1H20.4C21 5.1 21.4 5.7 21.2 6.2L18.6 14.6C18.4 15.1 18 15.4 17.5 15.4H5.4C4.9 15.4 4.5 14.9 4.7 14.4Z", fill: "dark" },
    ],
  },
  // A Space icon (shared/spaceIcons.ts): SF Symbols has no ringed planet, so we draw one (our own drawing), in the
  // proportions of the planet in the user's Arc (sphere about 12 pt, ring about 18 pt wide, falling 24° to the right). The sphere is two
  // pieces with a 0.9 pt gap on each side of the ring's front half, so the ring reads as passing in front of it; the
  // ring's back half is left out (hidden behind the sphere).
  planet: {
    width: 18,
    height: 18,
    parts: [
      { path: "M3.21 7.42A6 6 0 1 1 14.05 12.25A6.95 1.75 24 0 1 3.21 7.42Z", fill: "solid" },
      { path: "M10.49 14.81A6 6 0 0 1 3.68 11.78A10.25 5.05 24 0 0 10.49 14.81Z", fill: "solid" },
      { path: "M15.74 9.5A8.6 3.4 24 1 1 4.12 4.32", fill: "none" },
    ],
  },
} satisfies Record<string, OwnIcon>;

export type IconName = SymbolIconName | keyof typeof OWN_ICONS;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Stroke width of our own drawn icons: Arc's folder outlines measure about 1.5 pt. */
const OWN_ICON_STROKE_WIDTH = 1.5;

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
  const icon: OwnIcon = OWN_ICONS[name];
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", `0 0 ${icon.width} ${icon.height}`);
  svg.setAttribute("width", String(icon.width));
  svg.setAttribute("height", String(icon.height));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", className);
  for (const part of icon.parts) {
    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", part.path);
    path.setAttribute("class", `icon-part-${part.fill}`);
    svg.append(path);
    if (part.fill === "solid") {
      continue;
    }
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", String(OWN_ICON_STROKE_WIDTH));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
  }
  return svg;
}
