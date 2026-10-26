/**
 * WHY this file exists:
 *   Arc's Command Bar finishes an address while you type: "git" becomes "github.com" with "hub.com" selected, so
 *   Return goes there and typing on replaces the suggestion. This pure function picks that completion from the
 *   ranked results.
 *
 * Data source:
 *   The typed text and the addresses of the Command Bar's results, best first.
 *
 * Data flow:
 *   overlay.ts (results arrive while typing) → findInlineCompletion(typed, addresses) → input shows the completion
 */

/** One address the completion may come from, with the line it belongs to. */
export interface CompletionCandidate {
  lineId: string;
  url: string;
}

/** The address to show and the line to highlight with it. */
export interface InlineCompletion {
  lineId: string;
  /** The full text the input shows: what was typed, then the completion. */
  text: string;
}

/** Below this many typed characters nothing is completed (one letter finishes too eagerly). Our choice. */
const MIN_TYPED_LENGTH = 2;

/**
 * How an address reads without its scheme and "www.", and without a lone trailing "/".
 * Example: "https://www.github.com/" → "github.com"; "https://en.wikipedia.org/wiki/X" → "en.wikipedia.org/wiki/X"
 */
export function toCompletionText(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  const host = parsed.host.startsWith("www.") ? parsed.host.slice("www.".length) : parsed.host;
  const rest = `${parsed.pathname}${parsed.search}`;
  return rest === "/" ? host : `${host}${rest}`;
}

/**
 * Finds the completion for what was typed: the first candidate whose address starts with it. The site alone is
 * preferred when the typed text is still inside the site's name ("wik" → "wikipedia.org", not a long page address).
 * Null for searches (text with spaces), very short text, or no match.
 */
export function findInlineCompletion(typedText: string, candidates: CompletionCandidate[]): InlineCompletion | null {
  if (typedText.length < MIN_TYPED_LENGTH || /\s/.test(typedText)) {
    return null;
  }
  const typedLower = typedText.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  for (const candidate of candidates) {
    const fullText = toCompletionText(candidate.url);
    if (fullText === null) {
      continue;
    }
    const host = fullText.split("/")[0] ?? fullText;
    const isTypingTheHost = !typedLower.includes("/");
    const completionText = isTypingTheHost ? host : fullText;
    if (completionText.toLowerCase().startsWith(typedLower) && completionText.length > typedLower.length) {
      return { lineId: candidate.lineId, text: `${typedText}${completionText.slice(typedLower.length)}` };
    }
  }
  return null;
}
