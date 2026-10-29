/**
 * WHY this file exists:
 *   The first-start onboarding's rules that need no screen: which scenes it has and how keys move between them, the
 *   browsers it imports from and how it says what one holds, and the three colors of its background wash; and the
 *   messages between its window's page and main. Kept pure, so they are tested on their own; the page (onboarding/onboarding.ts) and main
 *   (onboardingWindow.ts) share them.
 *
 * Data source:
 *   None. Values in, values out.
 *
 * Data flow:
 *   onboardingWindow.ts buildWelcomeData() → "onboarding:data" → onboarding/onboarding.ts → these helpers → the scenes
 *   the page → onboardingApi (preload/onboardingPreload.ts) → ONBOARDING_CHANNELS → onboardingWindow.ts
 */
import type { SymbolImage } from "./symbols";
import type { SpaceTheme, ThemeAppearance } from "./types";

/** The scenes, in order (overlay/onboarding.ts draws one per id). */
export const ONBOARDING_SCENES = ["hello", "import", "look", "essentials", "defaults", "ready"] as const;

export type OnboardingScene = (typeof ONBOARDING_SCENES)[number];

/** The parts an import can bring: Arc's Spaces (with their tabs), Favorites, archive and extensions; any browser's
 * bookmarks and history. The onboarding lets the user leave some out. */
export type ImportPart = "spaces" | "favorites" | "archive" | "bookmarks" | "extensions" | "history";

/** The order parts are listed and brought in (history last: it is the biggest). */
export const IMPORT_PART_ORDER: ImportPart[] = ["spaces", "favorites", "archive", "bookmarks", "extensions", "history"];

/** What a source holds, counted before anything is imported (main reads it once). */
export interface ImportFound {
  /** The parts it has something for, in IMPORT_PART_ORDER. */
  parts: ImportPart[];
  /** How many of each: Spaces count Spaces (their tabs are `tabs`), history counts sites. */
  counts: Partial<Record<ImportPart, number>>;
  tabs: number;
}

/**
 * One source's import in the onboarding: being read, read (what it holds), waiting for Full Disk Access (Safari),
 * bringing the chosen parts over (those done so far), done, or failed.
 */
export interface WelcomeImport {
  phase: "reading" | "found" | "needsAccess" | "importing" | "done" | "failed";
  found: ImportFound | null;
  /** The parts chosen to come over (all it found, until the user leaves some out). */
  parts: ImportPart[];
  /** Those already brought over while it imports. */
  doneParts: ImportPart[];
}

/** A browser the onboarding lists: every one Bow imports from, found on this Mac or not. */
export interface WelcomeBrowser {
  /** One of SUPPORTED_BROWSERS' ids. */
  id: string;
  name: string;
  /** The installed app's own icon (a data: URL drawn by macOS), or null (not installed, or not drawn). */
  iconUrl: string | null;
  /** Its profiles that have something to import (several for a browser with profiles); none: not on this Mac. */
  sources: { id: string; profileName: string | null }[];
}

/** The sidebar preview beside the import: what the active Space and its profile hold now. */
export interface WelcomeSidebar {
  spaceName: string;
  favorites: { title: string; iconUrl: string | null }[];
  pinned: { title: string; iconUrl: string | null; isFolder: boolean }[];
}

/** A theme preset as the onboarding offers it (main/themePresets.ts). */
export interface WelcomePreset {
  label: string;
  colors: string[];
  appearance: ThemeAppearance;
}

/** Everything the onboarding shows that can change while it is open. Sent whole on every update. */
export interface WelcomeData {
  /** The active Space (an Arc import can replace the one the onboarding started with) and its theme. */
  spaceId: string;
  theme: SpaceTheme;
  isSystemDark: boolean;
  /** Every browser Bow imports from, those on this Mac first. */
  browsers: WelcomeBrowser[];
  /** Imports read or started from the onboarding, by source id. */
  imports: Record<string, WelcomeImport>;
  sidebar: WelcomeSidebar;
  presets: WelcomePreset[];
  /** A build from source cannot register as the default browser (macOS needs the packaged app). */
  isPackaged: boolean;
  isDefaultBrowser: boolean;
  isAdBlockOn: boolean;
  /**
   * The "shortcut from any app" the onboarding offers (the one already set, or ⌥⌘Space: ⌥Space is Raycast's and
   * Alfred's), how macOS writes it, and whether it is on, off or taken by another app.
   */
  globalShortcut: { accelerator: string; label: string; status: "off" | "on" | "taken" };
}

/** The import source id the onboarding uses for Arc. */
export const ARC_IMPORT_SOURCE_ID = "arc";

/** Bow's own colors (shared/appIconDrawing.ts), the wash's colors until a look is picked. */
export const BOW_WASH_COLORS: [string, string, string] = ["#ff8a7a", "#b56cff", "#4f7cff"];

/**
 * The scene after a step of `delta` (+1 next, −1 back), kept inside the scenes.
 * Example: (0, -1, 6) → 0; (5, 1, 6) → 5
 */
export function stepScene(currentIndex: number, delta: number, sceneCount: number): number {
  const wanted = currentIndex + delta;
  return Math.min(Math.max(wanted, 0), sceneCount - 1);
}

/**
 * A count with its noun, thousands grouped: (1, "tab") → "1 tab"; (2341, "page") → "2,341 pages".
 */
export function formatCount(count: number, noun: string): string {
  const grouped = count.toLocaleString("en-US");
  return count === 1 ? `${grouped} ${noun}` : `${grouped} ${noun}s`;
}

/**
 * The wash's three colors for a theme's colors: one, two or three colors become three (a one-color theme repeats its
 * color; the wash's grain and blob shapes keep it from looking flat). No colors: Bow's own.
 * Example: ["#cfe0f4"] → ["#cfe0f4", "#cfe0f4", "#cfe0f4"]; ["#a", "#b"] → ["#a", "#b", "#a"]
 */
export function pickWashColors(colors: string[]): [string, string, string] {
  const first = colors[0];
  if (first === undefined) {
    return BOW_WASH_COLORS;
  }
  const second = colors[1] ?? first;
  const third = colors[2] ?? first;
  return [first, second, third];
}

/**
 * The wash's lights must glow on the scene's background: Space colors are pale pastels or deep darks, which would
 * vanish on a light or a dark scene. Each keeps its hue but gets at least this much color, and a lightness in this
 * band (HSL, 0…1). Greys (almost no color) stay grey. Our choice, tuned by eye on the onboarding's screenshots.
 */
const WASH_MIN_SATURATION = 0.6;
const WASH_GREY_SATURATION = 0.06;
const WASH_LIGHTNESS_ON_LIGHT: [number, number] = [0.66, 0.76];
const WASH_LIGHTNESS_ON_DARK: [number, number] = [0.45, 0.58];

/**
 * Reads "#rrggbb" into hue (0…360), saturation and lightness (0…1). Not a color: null.
 */
function hexToHsl(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return null;
  }
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;
  const highest = Math.max(red, green, blue);
  const lowest = Math.min(red, green, blue);
  const lightness = (highest + lowest) / 2;
  const range = highest - lowest;
  if (range === 0) {
    return [0, 0, lightness];
  }
  const saturation = range / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (highest === red) {
    hue = ((green - blue) / range + 6) % 6;
  } else if (highest === green) {
    hue = (blue - red) / range + 2;
  } else {
    hue = (red - green) / range + 4;
  }
  return [hue * 60, saturation, lightness];
}

/**
 * Writes hue (0…360), saturation and lightness (0…1) as "#rrggbb".
 */
function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const second = chroma * (1 - Math.abs((section % 2) - 1));
  const sections: [number, number, number][] = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ];
  const [red, green, blue] = sections[Math.floor(section) % 6] ?? [0, 0, 0];
  const offset = lightness - chroma / 2;
  const toByte = (channel: number): string => Math.round((channel + offset) * 255).toString(16).padStart(2, "0");
  return `#${toByte(red)}${toByte(green)}${toByte(blue)}`;
}

/**
 * One wash color that shows on the scene: the same hue, enough color, a lightness that glows on light or dark.
 * Examples: ("#cfe0f4", light) → a clear sky blue; ("#1f2b47", dark) → a lit navy; ("#3a3a3c", dark) → a grey
 */
export function vividWashColor(color: string, isDark: boolean): string {
  const hsl = hexToHsl(color);
  if (hsl === null) {
    return color;
  }
  const [hue, saturation, lightness] = hsl;
  const band = isDark ? WASH_LIGHTNESS_ON_DARK : WASH_LIGHTNESS_ON_LIGHT;
  const keptLightness = Math.min(Math.max(lightness, band[0]), band[1]);
  const keptSaturation = saturation < WASH_GREY_SATURATION ? saturation : Math.max(saturation, WASH_MIN_SATURATION);
  return hslToHex(hue, keptSaturation, keptLightness);
}

/** Every browser Bow imports from, in the order the onboarding lists them (those on this Mac come first). */
export const SUPPORTED_BROWSERS: { id: string; name: string }[] = [
  { id: "arc", name: "Arc" },
  { id: "chrome", name: "Chrome" },
  { id: "safari", name: "Safari" },
  { id: "firefox", name: "Firefox" },
  { id: "brave", name: "Brave" },
  { id: "edge", name: "Edge" },
  { id: "vivaldi", name: "Vivaldi" },
  { id: "chromium", name: "Chromium" },
];

/**
 * The browsers as the onboarding lists them: those with something to import first, each group in
 * SUPPORTED_BROWSERS' order.
 */
export function orderBrowsers(browsers: WelcomeBrowser[]): WelcomeBrowser[] {
  const found = browsers.filter((browser) => browser.sources.length > 0);
  const missing = browsers.filter((browser) => browser.sources.length === 0);
  return [...found, ...missing];
}

/** A piece of a sentence, drawn bold (a number and its noun) or plain. */
export interface SentencePart {
  text: string;
  isBold: boolean;
}

/**
 * What a source holds, as one sentence with the numbers in bold: "Found 3 Spaces with 25 tabs, 6 Favorites and 4,812
 * sites from your history." Nothing: "Nothing new to bring over."
 */
export function describeFound(found: ImportFound): SentencePart[] {
  const counts = found.counts;
  const phrases: SentencePart[][] = [];
  if ((counts.spaces ?? 0) > 0) {
    phrases.push([{ text: formatCount(counts.spaces ?? 0, "Space"), isBold: true }, { text: " with ", isBold: false }, { text: formatCount(found.tabs, "tab"), isBold: true }]);
  }
  if ((counts.favorites ?? 0) > 0) {
    phrases.push([{ text: formatCount(counts.favorites ?? 0, "Favorite"), isBold: true }]);
  }
  if ((counts.archive ?? 0) > 0) {
    phrases.push([{ text: formatCount(counts.archive ?? 0, "archived tab"), isBold: true }]);
  }
  if ((counts.bookmarks ?? 0) > 0) {
    phrases.push([{ text: formatCount(counts.bookmarks ?? 0, "bookmark"), isBold: true }]);
  }
  if ((counts.extensions ?? 0) > 0) {
    phrases.push([{ text: formatCount(counts.extensions ?? 0, "extension"), isBold: true }]);
  }
  if ((counts.history ?? 0) > 0) {
    phrases.push([{ text: formatCount(counts.history ?? 0, "site"), isBold: true }, { text: " from your history", isBold: false }]);
  }
  if (phrases.length === 0) {
    return [{ text: "Nothing new to bring over.", isBold: false }];
  }
  const sentence: SentencePart[] = [{ text: "Found ", isBold: false }];
  phrases.forEach((phrase, index) => {
    const isLast = index === phrases.length - 1;
    const separator = isLast ? " and " : ", ";
    if (index > 0) {
      sentence.push({ text: separator, isBold: false });
    }
    sentence.push(...phrase);
  });
  sentence.push({ text: ".", isBold: false });
  return sentence;
}

/** Each part's row in "Choose what comes over": its name and how its count reads. */
export const IMPORT_PART_LABELS: Record<ImportPart, { title: string; noun: string }> = {
  spaces: { title: "Spaces and pinned tabs", noun: "Space" },
  favorites: { title: "Favorites", noun: "site" },
  archive: { title: "Archived tabs", noun: "tab" },
  bookmarks: { title: "Bookmarks", noun: "bookmark" },
  extensions: { title: "Extensions", noun: "extension" },
  history: { title: "History", noun: "site" },
};

/**
 * The line under a part's name in the checklist: "3 Spaces, 25 tabs", "6 sites", "214 bookmarks".
 */
export function describePartCount(part: ImportPart, found: ImportFound): string {
  const count = found.counts[part] ?? 0;
  const counted = formatCount(count, IMPORT_PART_LABELS[part].noun);
  if (part === "spaces") {
    return `${counted}, ${formatCount(found.tabs, "tab")}`;
  }
  return counted;
}

/** The functions the onboarding's page may call (preload/onboardingPreload.ts provides them as window.onboardingApi). */
export interface OnboardingApi {
  /** What the onboarding shows now; later changes come through onData. */
  getData(): Promise<WelcomeData | null>;
  /** Something it shows changed (a theme, an import, a switch, the system's appearance): update in place. */
  onData(listener: (data: WelcomeData) => void): void;
  /** The onboarding is done (its outro has played): its window closes and the browser shows. */
  close(): Promise<void>;
  /** The SF Symbols the icons use, rendered by macOS (the same as every page of ours). */
  getSymbols(): Promise<Record<string, SymbolImage>>;
  /** Reads what a source (a browser profile, or Arc) holds and counts it; nothing is imported yet. */
  readSource(sourceId: string): Promise<void>;
  /** Brings the chosen parts of a source that was read over. */
  bringOver(sourceId: string, parts: ImportPart[]): Promise<void>;
  /** Opens System Settings at Full Disk Access (Safari's files need it). */
  openFullDiskAccess(): Promise<void>;
}

/** Channel names between the onboarding's page and main (onboardingWindow.ts checks every sender is that page). */
export const ONBOARDING_CHANNELS = {
  getData: "onboarding:get-data",
  data: "onboarding:data",
  close: "onboarding:close",
  readSource: "onboarding:read-source",
  bringOver: "onboarding:bring-over",
  openFullDiskAccess: "onboarding:open-full-disk-access",
} as const;
