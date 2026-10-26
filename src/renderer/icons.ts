/**
 * WHY this file exists:
 *   The sidebar and toolbar need small line icons (back, reload, folder, archive, …). They are drawn here as our own
 *   16×16 SVG paths, so nothing is copied from Arc or loaded from the network.
 *
 * Data source:
 *   None. Hand-written SVG path data.
 *
 * Data flow:
 *   sidebar.ts / toolbar.ts → createIcon("folder") → an <svg> element placed in a button or row
 */

/** The path data of each icon, drawn on a 16×16 grid with a 1.5 px rounded stroke. */
const ICON_PATHS = {
  back: "M10 3.5 5.5 8l4.5 4.5",
  forward: "M6 3.5 10.5 8 6 12.5",
  reload: "M12.5 8a4.5 4.5 0 1 1-1.3-3.2M12.5 3v2.4h-2.4",
  stop: "M4.5 4.5l7 7M11.5 4.5l-7 7",
  sidebar: "M2.5 3.5h11v9h-11zM6.5 3.5v9",
  link: "M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.6.6M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.6-.6",
  lock: "M4.5 7.5h7v5h-7zM6 7.5V6a2 2 0 0 1 4 0v1.5",
  sliders: "M3 5h10M3 11h10M6 3.5v3M10 9.5v3",
  split: "M2.5 3.5h11v9h-11zM8 3.5v9",
  plus: "M8 3.5v9M3.5 8h9",
  archive: "M2.5 3.5h11v3h-11zM3.5 6.5v6h9v-6M6.5 9h3",
  folder: "M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z",
  folderOpen: "M2.5 12.5V4.5h4L8 6h4.5v1.5M2.5 12.5l1.8-5h9.2l-1.8 5z",
  chevronRight: "M6.5 4 10.5 8l-4 4",
  chevronDown: "M4 6.5 8 10.5l4-4",
  close: "M5 5l6 6M11 5l-6 6",
  speaker: "M3 6.5h2.5L8.5 4v8L5.5 9.5H3zM10.5 6a2.8 2.8 0 0 1 0 4M12 4.5a5 5 0 0 1 0 7",
  speakerMuted: "M3 6.5h2.5L8.5 4v8L5.5 9.5H3zM10.5 6.5l3 3M13.5 6.5l-3 3",
  globe: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM2.5 8h11M8 2.5c1.6 1.6 2.3 3.4 2.3 5.5S9.6 11.9 8 13.5M8 2.5C6.4 4.1 5.7 5.9 5.7 8s.7 3.9 2.3 5.5",
  search: "M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 10l3.5 3.5",
  reset: "M5.5 4 3 6.5 5.5 9M3 6.5h6a3.5 3.5 0 0 1 0 7H7",
  more: "M4 8h.01M8 8h.01M12 8h.01",
  download: "M8 3v7M5 7.5 8 10.5l3-3M3.5 12.5h9",
  camera: "M2.5 5.5h2.5l1-1.5h4l1 1.5h2.5v7h-11zM8 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  copy: "M5.5 5.5h7v7h-7zM3.5 10.5v-7h7",
  code: "M6 5 3 8l3 3M10 5l3 3-3 3",
  zoomIn: "M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 10l3.5 3.5M5.5 7h3M7 5.5v3",
  zoomOut: "M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 10l3.5 3.5M5.5 7h3",
  trash: "M3.5 4.5h9M6.5 4.5V3h3v1.5M4.5 4.5l.7 8h5.6l.7-8",
  expand: "M9.5 3.5h3v3M6.5 12.5h-3v-3M12.5 3.5 9 7M3.5 12.5 7 9",
} as const;

export type IconName = keyof typeof ICON_PATHS;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Icon edge length in CSS pixels. */
const ICON_SIZE_PX = 16;

/**
 * Builds an <svg> element for an icon. It inherits the text color (stroke="currentColor") and is hidden from
 * screen readers, because the button around it carries the label.
 */
export function createIcon(name: IconName, className: string = "icon"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", `0 0 ${ICON_SIZE_PX} ${ICON_SIZE_PX}`);
  svg.setAttribute("width", String(ICON_SIZE_PX));
  svg.setAttribute("height", String(ICON_SIZE_PX));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", className);

  const path = document.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute("d", ICON_PATHS[name]);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}
