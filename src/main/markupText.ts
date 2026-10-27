/**
 * WHY this file exists:
 *   Live folders read titles out of feeds (XML) and GitHub's list pages (HTML) in the main process, which has no
 *   DOM. These two functions turn a piece of markup into the plain text a sidebar row shows.
 *
 * Data source:
 *   Text from a feed or page that liveFolderRefresher.ts fetched. Untrusted: it only ever becomes plain text here.
 *
 * Data flow:
 *   feedParser.ts / gitHubLists.ts → toPlainText(markup) → a tab title
 */

/**
 * The named entities feeds and pages use in titles. XML itself has the first five; the rest are HTML's, common in
 * feeds that carry HTML titles. Our pick; any other named entity stays as written.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
};

/** One entity: `&#169;`, `&#xA9;` or `&copy;`. */
const ENTITY_PATTERN = /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi;

/** A CDATA section, whose text is taken as written. */
const CDATA_PATTERN = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/;

/** Any tag, to remove from text that carried HTML. */
const TAG_PATTERN = /<[^>]*>/g;

/** The longest title a row gets. Our choice: longer text is never a title. */
const MAX_TEXT_LENGTH = 300;

/** The largest code point there is (Unicode's last plane). */
const MAX_CODE_POINT = 0x10ffff;

/**
 * Replaces character references with their characters. Unknown names stay as written.
 * Example: decodeEntities("Tom &amp; Jerry &#8212; &hellip;") → "Tom & Jerry — …"
 */
export function decodeEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, (whole: string, name: string) => {
    if (name.startsWith("#")) {
      const isHex = name[1] === "x" || name[1] === "X";
      const codePoint = isHex ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      const isValid = Number.isFinite(codePoint) && codePoint > 0 && codePoint <= MAX_CODE_POINT;
      return isValid ? String.fromCodePoint(codePoint) : whole;
    }
    const character = NAMED_ENTITIES[name.toLowerCase()];
    return character ?? whole;
  });
}

/**
 * The plain text of a title written in XML or HTML: CDATA unwrapped, tags removed, entities decoded (twice when not
 * CDATA, because feeds often escape HTML that has entities of its own: `&amp;rsquo;`), spaces collapsed.
 * Example: toPlainText("&lt;b&gt;Hello&lt;/b&gt; &amp;amp; bye") → "Hello & bye"
 */
export function toPlainText(markup: string): string {
  const cdataMatch = CDATA_PATTERN.exec(markup);
  let text: string;
  if (cdataMatch !== null) {
    const cdataText = cdataMatch[1] ?? "";
    text = decodeEntities(cdataText.replace(TAG_PATTERN, " "));
  } else {
    const onceDecoded = decodeEntities(markup);
    text = decodeEntities(onceDecoded.replace(TAG_PATTERN, " "));
  }
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, MAX_TEXT_LENGTH);
}
