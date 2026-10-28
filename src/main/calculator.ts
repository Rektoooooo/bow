/**
 * WHY this file exists:
 *   The Command Bar answers sums as you type ("12*7", "(3+4)^2", "sqrt(2)"), like Spotlight; Return copies the
 *   answer. What is typed is untrusted text, so a small parser of our own reads it: numbers, + − × ÷ ^ %, brackets and
 *   a few functions. Nothing typed is ever run as code.
 *
 * Data source:
 *   The typed query.
 *
 * Data flow:
 *   commandBar.ts rankCommandBarResults → calculate(query) → an "answer" line → Return → overlayController copies it
 *
 * Rules: pure. A query is only worked out when it is a sum, not a plain number, and not something that merely looks
 * like one: digits and dashes with no spaces are a date or a phone number ("2026-10-28", "555-1234").
 */

/** A worked-out sum: the number to copy and the line's text. */
export interface CalculatorAnswer {
  /** The answer as plain text, what Return copies: "84", "0.3", "-1.5". */
  text: string;
}

/** Significant digits an answer keeps, so 0.1 + 0.2 reads 0.3. Our choice (a pocket calculator shows about as many). */
const SIGNIFICANT_DIGITS = 12;

/** Longest query worked out. Our choice: longer text is a search, and the parser stays fast on every keystroke. */
const MAX_QUERY_LENGTH = 200;

/** Deepest bracket nesting read, so a crafted query cannot exhaust the stack. Our choice. */
const MAX_DEPTH = 32;

/** A date or a phone number: digits and dashes, no spaces. */
const DATE_OR_PHONE_PATTERN = /^[0-9]+(-[0-9]+)+$/;

/** The functions a sum may use, by name. */
const FUNCTIONS: Record<string, (value: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
};

/** Named numbers. */
const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
};

/** One piece of the query: a number, a name (function or constant), or an operator or bracket. */
type Token = { kind: "number"; value: number } | { kind: "name"; name: string } | { kind: "symbol"; symbol: string };

/** Symbols typed in place of the plain ones. */
const SYMBOL_ALIASES: Record<string, string> = { "×": "*", "÷": "/", "−": "-", "·": "*" };

const NUMBER_PATTERN = /^(\d+(\.\d+)?|\.\d+)/;
const NAME_PATTERN = /^[a-zπ]+/i;
const SYMBOLS = ["+", "-", "*", "/", "^", "%", "(", ")"];

/**
 * Cuts the query into tokens; null when it has anything else (letters that are not a known name, commas, colons).
 */
function readTokens(query: string): Token[] | null {
  const tokens: Token[] = [];
  let rest = query;
  while (rest.length > 0) {
    const first = rest[0] as string;
    if (first === " ") {
      rest = rest.slice(1);
      continue;
    }
    const numberMatch = NUMBER_PATTERN.exec(rest);
    if (numberMatch !== null) {
      tokens.push({ kind: "number", value: Number(numberMatch[0]) });
      rest = rest.slice(numberMatch[0].length);
      continue;
    }
    const nameMatch = NAME_PATTERN.exec(rest);
    if (nameMatch !== null) {
      const name = nameMatch[0].toLowerCase();
      if (!(name in FUNCTIONS) && !(name in CONSTANTS)) {
        return null;
      }
      tokens.push({ kind: "name", name: name });
      rest = rest.slice(nameMatch[0].length);
      continue;
    }
    const symbol = SYMBOL_ALIASES[first] ?? first;
    if (!SYMBOLS.includes(symbol)) {
      return null;
    }
    tokens.push({ kind: "symbol", symbol: symbol });
    rest = rest.slice(1);
  }
  return tokens;
}

/**
 * Reads tokens by the usual rules: brackets first, then ^ (right to left), a leading minus, × ÷, then + −.
 * Throws on anything that is not a whole sum; calculate() turns that into "no answer".
 */
class SumReader {
  private position = 0;
  private depth = 0;
  /** Whether the sum does more than state a number (an operator or a function). */
  hasOperation = false;

  constructor(private readonly tokens: Token[]) {}

  readAll(): number {
    const value = this.readSum();
    if (this.position !== this.tokens.length) {
      throw new Error("Unexpected text after the sum");
    }
    return value;
  }

  private peekSymbol(): string | null {
    const token = this.tokens[this.position];
    return token !== undefined && token.kind === "symbol" ? token.symbol : null;
  }

  private readSum(): number {
    let value = this.readProduct();
    let symbol = this.peekSymbol();
    while (symbol === "+" || symbol === "-") {
      this.position += 1;
      this.hasOperation = true;
      const right = this.readProduct();
      value = symbol === "+" ? value + right : value - right;
      symbol = this.peekSymbol();
    }
    return value;
  }

  private readProduct(): number {
    let value = this.readSigned();
    let symbol = this.peekSymbol();
    while (symbol === "*" || symbol === "/") {
      this.position += 1;
      this.hasOperation = true;
      const right = this.readSigned();
      value = symbol === "*" ? value * right : value / right;
      symbol = this.peekSymbol();
    }
    return value;
  }

  /** A leading minus binds looser than ^, so -2^2 is -4, as in mathematics. */
  private readSigned(): number {
    const symbol = this.peekSymbol();
    if (symbol === "-" || symbol === "+") {
      this.position += 1;
      const value = this.readSigned();
      return symbol === "-" ? -value : value;
    }
    return this.readPower();
  }

  private readPower(): number {
    const base = this.readPercent();
    if (this.peekSymbol() !== "^") {
      return base;
    }
    this.position += 1;
    this.hasOperation = true;
    const exponent = this.readSigned();
    return Math.pow(base, exponent);
  }

  private readPercent(): number {
    const value = this.readValue();
    if (this.peekSymbol() !== "%") {
      return value;
    }
    this.position += 1;
    this.hasOperation = true;
    return value / 100;
  }

  private readValue(): number {
    const token = this.tokens[this.position];
    if (token === undefined) {
      throw new Error("The sum ends too early");
    }
    this.position += 1;
    if (token.kind === "number") {
      return token.value;
    }
    if (token.kind === "symbol" && token.symbol === "(") {
      return this.readBracket();
    }
    if (token.kind === "name" && token.name in CONSTANTS) {
      return CONSTANTS[token.name] as number;
    }
    if (token.kind === "name" && this.peekSymbol() === "(") {
      this.position += 1;
      this.hasOperation = true;
      const apply = FUNCTIONS[token.name] as (value: number) => number;
      return apply(this.readBracket());
    }
    throw new Error("Not a number");
  }

  /** What is inside a bracket whose "(" was just read, and its ")". */
  private readBracket(): number {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) {
      throw new Error("Too deep");
    }
    const value = this.readSum();
    if (this.peekSymbol() !== ")") {
      throw new Error("A bracket is not closed");
    }
    this.position += 1;
    this.depth -= 1;
    return value;
  }
}

/**
 * A number as an answer shows it: at most SIGNIFICANT_DIGITS digits, no trailing zeros.
 * Example: 0.30000000000000004 → "0.3"
 */
export function formatAnswerNumber(value: number): string {
  const rounded = Number(value.toPrecision(SIGNIFICANT_DIGITS));
  // -0 reads as 0.
  return rounded === 0 ? "0" : String(rounded);
}

/**
 * The answer to a typed sum, or null when the query is not one.
 * Example: "12 × 7" → { text: "84" }; "42", "2026-10-28", "github" → null
 */
export function calculate(query: string): CalculatorAnswer | null {
  const trimmed = query.trim();
  if (trimmed === "" || trimmed.length > MAX_QUERY_LENGTH || DATE_OR_PHONE_PATTERN.test(trimmed)) {
    return null;
  }
  // "= 12*7" is how some people ask.
  const sum = trimmed.startsWith("=") ? trimmed.slice(1) : trimmed;
  const tokens = readTokens(sum);
  if (tokens === null || tokens.length === 0) {
    return null;
  }
  const reader = new SumReader(tokens);
  let value: number;
  try {
    value = reader.readAll();
  } catch {
    return null;
  }
  if (!reader.hasOperation || !Number.isFinite(value)) {
    return null;
  }
  return { text: formatAnswerNumber(value) };
}
