/**
 * WHY this file exists:
 *   Arc draws its interface with Apple's SF Symbols, the system's own icons. So do we: for each icon our interface
 *   uses, this table names the SF Symbol macOS draws for it. Nothing is copied: the main process asks macOS to
 *   render the symbols when the app starts (symbols.ts in src/main), and the pages show them as masks tinted with
 *   the text color.
 *
 * Data source:
 *   SF Symbols names (Apple's SF Symbols app lists them). Picked to match what Arc shows in the same places
 *   (measured from the user's Arc screenshots: toolbar `slider.horizontal.2.square` and `square.split.2x1`,
 *   Library `archivebox.fill`, …).
 *
 * Data flow:
 *   SYMBOL_NAMES → main renders each to a template image → pages call getSymbols() → icons.ts installSymbols()
 */

/** Our icon name → SF Symbol name. */
export const SYMBOL_NAMES = {
  back: "arrow.left",
  forward: "arrow.right",
  reload: "arrow.clockwise",
  stop: "xmark",
  sidebar: "sidebar.left",
  link: "link",
  lock: "lock.fill",
  sliders: "slider.horizontal.2.square",
  split: "square.split.2x1",
  plus: "plus",
  archive: "archivebox.fill",
  folder: "folder",
  chevronRight: "chevron.right",
  chevronDown: "chevron.down",
  close: "xmark",
  speaker: "speaker.wave.2.fill",
  speakerMuted: "speaker.slash.fill",
  globe: "globe",
  search: "magnifyingglass",
  reset: "arrow.uturn.backward",
  more: "ellipsis",
  download: "arrow.down.circle",
  camera: "camera",
  copy: "doc.on.doc",
  code: "chevron.left.forwardslash.chevron.right",
  zoomIn: "plus.magnifyingglass",
  zoomOut: "minus.magnifyingglass",
  trash: "trash",
  expand: "arrow.up.left.and.arrow.down.right",
  play: "play.fill",
  pause: "pause.fill",
  puzzle: "puzzlepiece.extension",
  share: "square.and.arrow.up",
  boost: "paintbrush.pointed",
  capture: "text.viewfinder",
  info: "info.circle",
  gear: "gearshape",
  pin: "pin",
  shield: "shield.lefthalf.filled",
  bell: "bell",
  location: "location",
  microphone: "mic",
  video: "video",
  clipboard: "doc.on.clipboard",
  pictureInPicture: "pip",
  note: "note.text",
  clock: "clock.arrow.circlepath",
  checkmark: "checkmark",
  hammer: "hammer",
  easel: "scribble.variable",
  terminal: "apple.terminal",
  network: "network",
  scope: "scope",
  person: "person.crop.circle",
  warning: "exclamationmark.triangle",
  feed: "dot.radiowaves.up.forward",
} as const;

/** An icon drawn from an SF Symbol. */
export type SymbolIconName = keyof typeof SYMBOL_NAMES;

/** One rendered symbol, as the pages receive it. */
export interface SymbolImage {
  /** A PNG data: URL: black glyph on transparent (the pages tint it). */
  url: string;
  /** The symbol's natural size in CSS pixels. */
  width: number;
  height: number;
}
