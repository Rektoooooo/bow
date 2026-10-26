/**
 * WHY this file exists:
 *   Arc's Boosts can swap a site's font. Ours offers the fonts every Mac has (our choice of a short, varied list);
 *   the Boost editor shows them and boosts.ts writes the chosen one into the site's CSS.
 *
 * Data source:
 *   macOS's bundled fonts and the system font families CSS can name (ui-serif, ui-rounded, ui-monospace).
 *
 * Data flow:
 *   Boost editor › Font → action setBoostStyle(fontId) → boosts.ts buildBoostCss() → font-family on the site's text
 */

/** One font a Boost can use. */
export interface BoostFont {
  id: string;
  label: string;
  /** The CSS font-family list, best match first. */
  stack: string;
}

/** The fonts offered, in the order the editor shows them. */
export const BOOST_FONTS: BoostFont[] = [
  { id: "system", label: "System", stack: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif" },
  { id: "rounded", label: "Rounded", stack: "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif" },
  { id: "serif", label: "New York", stack: "ui-serif, 'New York', Georgia, serif" },
  { id: "mono", label: "Mono", stack: "ui-monospace, 'SF Mono', Menlo, monospace" },
  { id: "avenir", label: "Avenir Next", stack: "'Avenir Next', Avenir, sans-serif" },
  { id: "helvetica", label: "Helvetica", stack: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { id: "georgia", label: "Georgia", stack: "Georgia, serif" },
  { id: "baskerville", label: "Baskerville", stack: "Baskerville, 'Baskerville Old Face', serif" },
  { id: "futura", label: "Futura", stack: "Futura, 'Trebuchet MS', sans-serif" },
  { id: "gill", label: "Gill Sans", stack: "'Gill Sans', 'Gill Sans MT', sans-serif" },
];

/**
 * The font with this id, or undefined (also for "", meaning the site's own font).
 */
export function findBoostFont(fontId: string | undefined): BoostFont | undefined {
  return BOOST_FONTS.find((font) => font.id === fontId);
}
