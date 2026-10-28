/**
 * WHY this file exists:
 *   The onboarding's pictures, drawn by us: a small Bow window (its frame in a Space's colors, the sidebar, the page
 *   card) and five short looping demos built on it for the essentials tour (Command Bar, Spaces, Split View, Peek,
 *   Today tidying itself into the Archive). Plain elements moved with the Web Animations API, so they stay sharp at
 *   any size, follow the chosen look and need no video, Lottie or image files (Arc's onboarding clips are not ours).
 *
 * Data source:
 *   The active Space's theme (shared/themePalette.ts paints the frame like the real sidebar).
 *
 * Data flow:
 *   onboarding.ts → createMiniWindow() / createTourDemos() → paint(theme) on every update → play() / stop() as the
 *   tour moves between items
 */
import type { SpaceTheme } from "../shared/types";
import { computeFramePalette } from "../shared/themePalette.js";
import { createElement } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";
import type { IconName } from "../renderer/icons.js";

/** One loop of every tour demo, in milliseconds. Our choice: long enough to read, short enough to stay lively. */
export const TOUR_DEMO_CYCLE_MS = 5200;

/** The easing of every move in the demos (the onboarding's out curve, onboarding.css --ease-out). */
const DEMO_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** How many rows the small sidebar shows, and which one is selected. Our choice. */
const MINI_ROW_COUNT = 5;
const MINI_SELECTED_ROW = 1;

/** The second Space in the Spaces demo: Mint, one of our presets (main/themePresets.ts). */
const SECOND_SPACE_THEME: SpaceTheme = { colors: ["#cdeadb", "#c2e3e8"], appearance: "auto", grain: 0 };

/** The letters typed into the Command Bar demo. */
const TYPED_TEXT = "weather";

/**
 * How far the Spaces demo's dot moves: one dot and one gap, and the gap is as wide as a dot (onboarding.css
 * .demo-space-dots), so twice the dot's own width.
 */
const SPACE_DOT_STEP = "translateX(200%)";

/** Where the Archive demo's row falls to: down to the Archive icon at the sidebar's foot, in row heights. */
const ARCHIVE_DROP = "translate(-8%, 300%) scale(0.4)";

/** A small Bow window and the parts the demos move. */
export interface MiniWindow {
  element: HTMLElement;
  sidebar: HTMLElement;
  rows: HTMLElement[];
  card: HTMLElement;
  page: HTMLElement;
  /** Paints the frame in a theme, with light or dark rows like the real sidebar. */
  paint(theme: SpaceTheme, isSystemDark: boolean): void;
}

/** One demo of the essentials tour. */
export interface TourDemo {
  element: HTMLElement;
  paint(theme: SpaceTheme, isSystemDark: boolean): void;
  /** Starts its loop (or, with reduced motion, shows its key moment still). */
  play(): void;
  stop(): void;
}

/**
 * True when macOS asks for less motion: demos then hold still on their key moment.
 */
export function prefersLessMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Sets an element's frame gradient and grain from a theme, the way the sidebar paints its frame.
 */
function paintFrame(element: HTMLElement, theme: SpaceTheme, isSystemDark: boolean): void {
  const palette = computeFramePalette(theme, isSystemDark, true);
  element.style.setProperty("--mini-1", palette.colors[0]);
  element.style.setProperty("--mini-2", palette.colors[1]);
  element.style.setProperty("--mini-3", palette.colors[2]);
  element.classList.toggle("is-dark", palette.isDark);
}

/**
 * The sidebar of a small window: window buttons, four Favorites, the Space's name and its rows.
 */
function createMiniSidebar(rowCount: number, selectedRow: number): { sidebar: HTMLElement; rows: HTMLElement[] } {
  const sidebar = createElement("div", "mini-sidebar");
  const lights = createElement("div", "mini-lights");
  lights.append(createElement("span", "mini-light"), createElement("span", "mini-light"), createElement("span", "mini-light"));
  const favorites = createElement("div", "mini-favorites");
  for (let index = 0; index < 4; index++) {
    favorites.append(createElement("span", `mini-favorite mini-favorite-${index + 1}`));
  }
  const rows: HTMLElement[] = [];
  const rowList = createElement("div", "mini-rows");
  for (let index = 0; index < rowCount; index++) {
    const row = createElement("span", index === selectedRow ? "mini-row is-selected" : "mini-row");
    row.append(createElement("span", "mini-row-icon"), createElement("span", `mini-row-text mini-row-text-${(index % 5) + 1}`));
    rows.push(row);
    rowList.append(row);
  }
  sidebar.append(lights, favorites, createElement("span", "mini-space-title"), rowList);
  return { sidebar: sidebar, rows: rows };
}

/**
 * A page in the card: a picture block, lines of text and a row of three cards, like a site's front page.
 */
function createMiniPage(): HTMLElement {
  const page = createElement("div", "mini-page");
  page.append(createElement("span", "mini-page-hero"));
  for (let index = 0; index < 4; index++) {
    page.append(createElement("span", `mini-page-line mini-page-line-${index + 1}`));
  }
  const tiles = createElement("div", "mini-page-tiles");
  tiles.append(createElement("span", "mini-page-tile"), createElement("span", "mini-page-tile"), createElement("span", "mini-page-tile"));
  page.append(tiles);
  return page;
}

/**
 * Builds a small Bow window: the frame (a Space's gradient and grain), the sidebar and the page card.
 */
export function createMiniWindow(rowCount: number = MINI_ROW_COUNT, selectedRow: number = MINI_SELECTED_ROW): MiniWindow {
  const element = createElement("div", "mini-window");
  element.setAttribute("aria-hidden", "true");
  const { sidebar, rows } = createMiniSidebar(rowCount, selectedRow);
  const card = createElement("div", "mini-card");
  const page = createMiniPage();
  card.append(createElement("span", "mini-toolbar"), page);
  element.append(createElement("span", "mini-grain"), sidebar, card);
  return {
    element: element,
    sidebar: sidebar,
    rows: rows,
    card: card,
    page: page,
    paint: (theme, isSystemDark) => paintFrame(element, theme, isSystemDark),
  };
}

/**
 * A keyframe list where each step names its moment in the loop (0…1), the Web Animations way.
 */
type TimedFrames = Keyframe[];

/**
 * Starts one looping animation of a demo, the same length as every demo's loop.
 */
function loop(element: Element, frames: TimedFrames): Animation {
  return element.animate(frames, { duration: TOUR_DEMO_CYCLE_MS, iterations: Infinity, easing: "linear" });
}

/**
 * The part every demo shares: its animations start together, stop together, and hold a still moment with reduced
 * motion.
 */
function createDemo(miniWindow: MiniWindow, extraPaint: (theme: SpaceTheme, isSystemDark: boolean) => void, startLoops: () => Animation[], stillMoment: number): TourDemo {
  let running: Animation[] = [];
  const stop = (): void => {
    for (const animation of running) {
      animation.cancel();
    }
    running = [];
  };
  const play = (): void => {
    stop();
    running = startLoops();
    // With less motion, the demo shows its key moment and holds it there.
    if (prefersLessMotion()) {
      for (const animation of running) {
        animation.currentTime = stillMoment * TOUR_DEMO_CYCLE_MS;
        animation.pause();
      }
    }
  };
  const paint = (theme: SpaceTheme, isSystemDark: boolean): void => {
    miniWindow.paint(theme, isSystemDark);
    extraPaint(theme, isSystemDark);
  };
  return { element: miniWindow.element, paint: paint, play: play, stop: stop };
}

/**
 * Command Bar: the bar drops in, the letters arrive one by one, results appear and the highlight moves down.
 */
function createCommandBarDemo(): TourDemo {
  const miniWindow = createMiniWindow();
  const bar = createElement("div", "demo-command-bar");
  const field = createElement("div", "demo-command-field");
  const typed = createElement("span", "demo-command-text", TYPED_TEXT);
  field.append(createIcon("search", "icon demo-command-search"), typed);
  const results = createElement("div", "demo-command-results");
  const resultRows = [0, 1, 2].map((index) => createElement("span", `demo-command-result demo-command-result-${index + 1}`));
  const highlight = createElement("span", "demo-command-highlight");
  results.append(highlight, ...resultRows);
  bar.append(field, results);
  miniWindow.element.append(bar);
  const startLoops = (): Animation[] => [
    loop(bar, [
      { opacity: 0, transform: "translate(-50%, -6px) scale(0.96)", offset: 0, easing: DEMO_EASING },
      { opacity: 1, transform: "translate(-50%, 0) scale(1)", offset: 0.1 },
      { opacity: 1, transform: "translate(-50%, 0) scale(1)", offset: 0.82, easing: DEMO_EASING },
      { opacity: 0, transform: "translate(-50%, -4px) scale(0.98)", offset: 0.9 },
      { opacity: 0, transform: "translate(-50%, -6px) scale(0.96)", offset: 1 },
    ]),
    loop(typed, [
      { clipPath: "inset(0 100% 0 0)", offset: 0, easing: `steps(${TYPED_TEXT.length})` },
      { clipPath: "inset(0 100% 0 0)", offset: 0.12, easing: `steps(${TYPED_TEXT.length})` },
      { clipPath: "inset(0 0% 0 0)", offset: 0.36 },
      { clipPath: "inset(0 0% 0 0)", offset: 1 },
    ]),
    ...resultRows.map((row, index) =>
      loop(row, [
        { opacity: 0, transform: "translateY(4px)", offset: 0 },
        { opacity: 0, transform: "translateY(4px)", offset: 0.38 + index * 0.04, easing: DEMO_EASING },
        { opacity: 1, transform: "translateY(0)", offset: 0.46 + index * 0.04 },
        { opacity: 1, transform: "translateY(0)", offset: 1 },
      ]),
    ),
    loop(highlight, [
      { opacity: 0, transform: "translateY(0)", offset: 0 },
      { opacity: 0, transform: "translateY(0)", offset: 0.44, easing: DEMO_EASING },
      { opacity: 1, transform: "translateY(0)", offset: 0.5 },
      { opacity: 1, transform: "translateY(0)", offset: 0.62, easing: DEMO_EASING },
      { opacity: 1, transform: "translateY(100%)", offset: 0.68 },
      { opacity: 1, transform: "translateY(100%)", offset: 1 },
    ]),
  ];
  return createDemo(miniWindow, () => undefined, startLoops, 0.7);
}

/**
 * Spaces: the sidebar slides over to a second Space in other colors, then back.
 */
function createSpacesDemo(): TourDemo {
  const miniWindow = createMiniWindow();
  // The second Space's frame lies over the first one and fades in as its sidebar slides in.
  const secondFrame = createElement("span", "demo-space-frame");
  const secondSidebar = createMiniSidebar(3, 0).sidebar;
  secondSidebar.classList.add("demo-space-sidebar");
  const dots = createElement("div", "demo-space-dots");
  const activeDot = createElement("span", "demo-space-dot is-active");
  dots.append(activeDot, createElement("span", "demo-space-dot"), createElement("span", "demo-space-dot"));
  miniWindow.element.insertBefore(secondFrame, miniWindow.sidebar);
  miniWindow.element.append(secondSidebar, dots);
  const startLoops = (): Animation[] => [
    loop(miniWindow.sidebar, [
      { transform: "translateX(0)", opacity: 1, offset: 0 },
      { transform: "translateX(0)", opacity: 1, offset: 0.3, easing: DEMO_EASING },
      { transform: "translateX(-60%)", opacity: 0, offset: 0.46 },
      { transform: "translateX(-60%)", opacity: 0, offset: 0.78, easing: DEMO_EASING },
      { transform: "translateX(0)", opacity: 1, offset: 0.94 },
      { transform: "translateX(0)", opacity: 1, offset: 1 },
    ]),
    loop(secondSidebar, [
      { transform: "translateX(60%)", opacity: 0, offset: 0 },
      { transform: "translateX(60%)", opacity: 0, offset: 0.3, easing: DEMO_EASING },
      { transform: "translateX(0)", opacity: 1, offset: 0.46 },
      { transform: "translateX(0)", opacity: 1, offset: 0.78, easing: DEMO_EASING },
      { transform: "translateX(60%)", opacity: 0, offset: 0.94 },
      { transform: "translateX(60%)", opacity: 0, offset: 1 },
    ]),
    loop(secondFrame, [
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: 0.3, easing: DEMO_EASING },
      { opacity: 1, offset: 0.46 },
      { opacity: 1, offset: 0.78, easing: DEMO_EASING },
      { opacity: 0, offset: 0.94 },
      { opacity: 0, offset: 1 },
    ]),
    loop(activeDot, [
      { transform: "translateX(0)", offset: 0 },
      { transform: "translateX(0)", offset: 0.3, easing: DEMO_EASING },
      { transform: SPACE_DOT_STEP, offset: 0.46 },
      { transform: SPACE_DOT_STEP, offset: 0.78, easing: DEMO_EASING },
      { transform: "translateX(0)", offset: 0.94 },
      { transform: "translateX(0)", offset: 1 },
    ]),
  ];
  const paintSecondSpace = (_theme: SpaceTheme, isSystemDark: boolean): void => paintFrame(secondFrame, SECOND_SPACE_THEME, isSystemDark);
  return createDemo(miniWindow, paintSecondSpace, startLoops, 0.6);
}

/**
 * Split View: a second page slides in over the right half of the card, so the two pages sit side by side.
 */
function createSplitDemo(): TourDemo {
  const miniWindow = createMiniWindow();
  const secondPane = createElement("div", "demo-split-pane");
  secondPane.append(createElement("span", "mini-toolbar"), createMiniPage());
  miniWindow.card.append(secondPane);
  const startLoops = (): Animation[] => [
    loop(secondPane, [
      { transform: "translateX(104%)", offset: 0 },
      { transform: "translateX(104%)", offset: 0.24, easing: DEMO_EASING },
      { transform: "translateX(0)", offset: 0.42 },
      { transform: "translateX(0)", offset: 0.8, easing: DEMO_EASING },
      { transform: "translateX(104%)", offset: 0.95 },
      { transform: "translateX(104%)", offset: 1 },
    ]),
  ];
  return createDemo(miniWindow, () => undefined, startLoops, 0.6);
}

/**
 * Peek: a link lights up and a card grows out of it over the dimmed page, then shrinks back into it.
 */
function createPeekDemo(): TourDemo {
  const miniWindow = createMiniWindow();
  const link = createElement("span", "demo-peek-link");
  miniWindow.page.append(link);
  const dim = createElement("span", "demo-peek-dim");
  const peek = createElement("div", "demo-peek-card");
  peek.append(createElement("span", "mini-toolbar"), createMiniPage());
  miniWindow.card.append(dim, peek);
  const startLoops = (): Animation[] => [
    loop(link, [
      { opacity: 0.55, offset: 0 },
      { opacity: 0.55, offset: 0.12, easing: DEMO_EASING },
      { opacity: 1, offset: 0.18 },
      { opacity: 1, offset: 0.9 },
      { opacity: 0.55, offset: 1 },
    ]),
    loop(dim, [
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: 0.2, easing: DEMO_EASING },
      { opacity: 1, offset: 0.3 },
      { opacity: 1, offset: 0.78, easing: DEMO_EASING },
      { opacity: 0, offset: 0.88 },
      { opacity: 0, offset: 1 },
    ]),
    loop(peek, [
      { opacity: 0, transform: "scale(0.18)", offset: 0 },
      { opacity: 0, transform: "scale(0.18)", offset: 0.2, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
      { opacity: 1, transform: "scale(1)", offset: 0.34 },
      { opacity: 1, transform: "scale(1)", offset: 0.76, easing: "cubic-bezier(0.32, 0, 0.67, 0)" },
      { opacity: 0, transform: "scale(0.18)", offset: 0.88 },
      { opacity: 0, transform: "scale(0.18)", offset: 1 },
    ]),
  ];
  return createDemo(miniWindow, () => undefined, startLoops, 0.55);
}

/**
 * Today tidies itself: a tab nobody used for 12 hours gets a clock, slides into the Archive, and the Archive nods.
 */
function createArchiveDemo(): TourDemo {
  const miniWindow = createMiniWindow(4, 0);
  const leavingRow = miniWindow.rows[3] as HTMLElement;
  const clock = createElement("span", "demo-archive-badge", "12h");
  leavingRow.append(clock);
  const archive = createElement("span", "demo-archive-icon");
  archive.append(createIcon("archive", "icon"));
  miniWindow.sidebar.append(archive);
  const startLoops = (): Animation[] => [
    loop(clock, [
      { opacity: 0, transform: "scale(0.6)", offset: 0 },
      { opacity: 0, transform: "scale(0.6)", offset: 0.14, easing: DEMO_EASING },
      { opacity: 1, transform: "scale(1)", offset: 0.22 },
      { opacity: 1, transform: "scale(1)", offset: 1 },
    ]),
    loop(leavingRow, [
      { opacity: 1, transform: "translate(0, 0) scale(1)", offset: 0 },
      { opacity: 1, transform: "translate(0, 0) scale(1)", offset: 0.36, easing: "cubic-bezier(0.32, 0, 0.67, 0)" },
      { opacity: 0, transform: ARCHIVE_DROP, offset: 0.56 },
      { opacity: 0, transform: ARCHIVE_DROP, offset: 0.86, easing: DEMO_EASING },
      { opacity: 1, transform: "translate(0, 0) scale(1)", offset: 0.97 },
      { opacity: 1, transform: "translate(0, 0) scale(1)", offset: 1 },
    ]),
    loop(archive, [
      { transform: "scale(1)", offset: 0 },
      { transform: "scale(1)", offset: 0.55, easing: DEMO_EASING },
      { transform: "scale(1.22)", offset: 0.6 },
      { transform: "scale(1)", offset: 0.68 },
      { transform: "scale(1)", offset: 1 },
    ]),
  ];
  return createDemo(miniWindow, () => undefined, startLoops, 0.25);
}

/** The tour's items, in order: each a name, its keys, a sentence and its demo. */
export interface TourItem {
  title: string;
  keys: string;
  text: string;
  icon: IconName;
  demo: TourDemo;
}

/**
 * The essentials tour: what makes Bow fast, one demo each.
 */
export function createTourItems(): TourItem[] {
  return [
    { title: "Command Bar", keys: "⌘T", text: "Search, open a site or jump to any tab from one place.", icon: "search", demo: createCommandBarDemo() },
    { title: "Spaces", keys: "⌃1 – ⌃9", text: "A sidebar for each part of your life. Swipe between them.", icon: "spaces", demo: createSpacesDemo() },
    { title: "Split View", keys: "⌃⇧=", text: "Two pages side by side, in one tab.", icon: "split", demo: createSplitDemo() },
    { title: "Peek", keys: "⇧ Click", text: "A link opens over the page, so you never lose your place.", icon: "expand", demo: createPeekDemo() },
    { title: "Today tidies itself", keys: "⌘⇧L", text: "Tabs you leave alone for 12 hours move to the Archive. Pin what you keep.", icon: "archive", demo: createArchiveDemo() },
  ];
}
