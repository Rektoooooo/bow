/**
 * WHY this file exists:
 *   The Command Bar converts units as you type ("5 km in mi", "350 f to c", "2 cups in ml"), like Spotlight; Return
 *   copies the answer. Lengths, weights, volumes, temperatures, times, data sizes and speeds. Currencies are left out
 *   on purpose: their rates change by the minute and would need a server.
 *
 * Data source:
 *   The typed query and the unit table below (exact definitions: an inch is 2.54 cm, a pound 0.45359237 kg, a US
 *   gallon 231 cubic inches).
 *
 * Data flow:
 *   commandBar.ts rankCommandBarResults → convertUnits(query) → an "answer" line → Return → overlayController copies it
 *
 * Rules: pure. Both units must be of the same kind ("5 km in kg" is no answer).
 */
import { formatAnswerNumber } from "./calculator";

/** A converted amount: what Return copies and how the line reads. */
export interface ConversionAnswer {
  /** The converted number as plain text: "3.10686". */
  text: string;
  /** The answer with its unit: "3.10686 mi". */
  title: string;
  /** What was converted: "5 km in mi". */
  description: string;
}

/** What a unit measures; only units of the same kind convert. */
type UnitKind = "length" | "mass" | "volume" | "temperature" | "time" | "data" | "speed";

/** A unit: its kind, how many base units one of it is (m, kg, l, s, byte, m/s), and the name an answer shows. */
interface Unit {
  kind: UnitKind;
  factor: number;
  symbol: string;
}

/** Significant digits a conversion keeps. Our choice: enough for a recipe or a run, without noise. */
const CONVERSION_DIGITS = 6;

/** Longest query read as a conversion. Our choice. */
const MAX_QUERY_LENGTH = 80;

/** "<amount> <unit> to|in|into|as|= <unit>"; the amount may be negative or have decimals. */
const CONVERSION_PATTERN = /^(-?\d+(?:\.\d+)?|-?\.\d+)\s*(.+?)\s+(?:to|in|into|as|=|->)\s+(.+)$/i;

/** Each unit by every name it may be typed with (lower case, spaces removed). */
const UNITS: Record<string, Unit> = {};

/**
 * Adds a unit under its names.
 */
function addUnit(kind: UnitKind, factor: number, symbol: string, names: string[]): void {
  for (const name of [symbol.toLowerCase(), ...names]) {
    UNITS[name] = { kind: kind, factor: factor, symbol: symbol };
  }
}

const INCH_M = 0.0254;
const MILE_M = INCH_M * 63360;
const NAUTICAL_MILE_M = 1852;
const POUND_KG = 0.45359237;
const US_GALLON_L = 3.785411784;
const US_CUP_L = US_GALLON_L / 16;

addUnit("length", 0.001, "mm", ["millimeter", "millimeters", "millimetre", "millimetres"]);
addUnit("length", 0.01, "cm", ["centimeter", "centimeters", "centimetre", "centimetres"]);
addUnit("length", 1, "m", ["meter", "meters", "metre", "metres"]);
addUnit("length", 1000, "km", ["kilometer", "kilometers", "kilometre", "kilometres"]);
addUnit("length", INCH_M, "in", ["inch", "inches", "\""]);
addUnit("length", INCH_M * 12, "ft", ["foot", "feet", "'"]);
addUnit("length", INCH_M * 36, "yd", ["yard", "yards"]);
addUnit("length", MILE_M, "mi", ["mile", "miles"]);
addUnit("length", NAUTICAL_MILE_M, "nmi", ["nauticalmile", "nauticalmiles"]);

addUnit("mass", 0.000001, "mg", ["milligram", "milligrams"]);
addUnit("mass", 0.001, "g", ["gram", "grams"]);
addUnit("mass", 1, "kg", ["kilogram", "kilograms", "kilo", "kilos"]);
// "ton" is left out: a US ton is 907 kg, a metric one 1000 kg.
addUnit("mass", 1000, "t", ["tonne", "tonnes"]);
addUnit("mass", POUND_KG / 16, "oz", ["ounce", "ounces"]);
addUnit("mass", POUND_KG, "lb", ["lbs", "pound", "pounds"]);
addUnit("mass", POUND_KG * 14, "st", ["stone", "stones"]);

addUnit("volume", 0.001, "ml", ["milliliter", "milliliters", "millilitre", "millilitres"]);
addUnit("volume", 0.01, "cl", ["centiliter", "centiliters", "centilitre", "centilitres"]);
addUnit("volume", 0.1, "dl", ["deciliter", "deciliters", "decilitre", "decilitres"]);
addUnit("volume", 1, "l", ["liter", "liters", "litre", "litres"]);
addUnit("volume", US_CUP_L / 48, "tsp", ["teaspoon", "teaspoons"]);
addUnit("volume", US_CUP_L / 16, "tbsp", ["tablespoon", "tablespoons"]);
addUnit("volume", US_CUP_L / 8, "fl oz", ["floz", "fluidounce", "fluidounces"]);
addUnit("volume", US_CUP_L, "cup", ["cups"]);
addUnit("volume", US_CUP_L * 2, "pt", ["pint", "pints"]);
addUnit("volume", US_CUP_L * 4, "qt", ["quart", "quarts"]);
addUnit("volume", US_GALLON_L, "gal", ["gallon", "gallons"]);

// Temperatures are not a plain factor; convertTemperature() handles them. The factor is unused.
addUnit("temperature", 1, "°C", ["c", "celsius", "degc"]);
addUnit("temperature", 1, "°F", ["f", "fahrenheit", "degf"]);
addUnit("temperature", 1, "K", ["kelvin", "kelvins"]);

addUnit("time", 0.001, "ms", ["millisecond", "milliseconds"]);
addUnit("time", 1, "s", ["sec", "secs", "second", "seconds"]);
addUnit("time", 60, "min", ["mins", "minute", "minutes"]);
addUnit("time", 3600, "h", ["hr", "hrs", "hour", "hours"]);
addUnit("time", 86400, "days", ["d", "day"]);
addUnit("time", 604800, "weeks", ["wk", "week"]);

addUnit("data", 1, "bytes", ["b", "byte"]);
addUnit("data", 1e3, "KB", ["kilobyte", "kilobytes"]);
addUnit("data", 1e6, "MB", ["megabyte", "megabytes"]);
addUnit("data", 1e9, "GB", ["gigabyte", "gigabytes"]);
addUnit("data", 1e12, "TB", ["terabyte", "terabytes"]);
addUnit("data", 1024, "KiB", ["kibibyte", "kibibytes"]);
addUnit("data", 1024 ** 2, "MiB", ["mebibyte", "mebibytes"]);
addUnit("data", 1024 ** 3, "GiB", ["gibibyte", "gibibytes"]);
addUnit("data", 1024 ** 4, "TiB", ["tebibyte", "tebibytes"]);

addUnit("speed", 1, "m/s", ["mps"]);
addUnit("speed", 1 / 3.6, "km/h", ["kmh", "kph"]);
addUnit("speed", MILE_M / 3600, "mph", ["mi/h"]);
addUnit("speed", NAUTICAL_MILE_M / 3600, "kn", ["knot", "knots"]);

/**
 * The unit a typed name means, or undefined.
 * Example: "Fl Oz" → fluid ounce; "°f" → Fahrenheit
 */
function findUnit(typed: string): Unit | undefined {
  const compact = typed.toLowerCase().replace(/\s+/g, "");
  const withoutDegree = compact.startsWith("°") ? compact.slice(1) : compact;
  // Own names only: "constructor" or "toString" must not find what every object inherits.
  if (Object.hasOwn(UNITS, compact)) {
    return UNITS[compact];
  }
  return Object.hasOwn(UNITS, withoutDegree) ? UNITS[withoutDegree] : undefined;
}

/**
 * A temperature in another scale, through kelvin.
 */
function convertTemperature(amount: number, from: Unit, to: Unit): number {
  const kelvinBySymbol: Record<string, (value: number) => number> = {
    "°C": (value) => value + 273.15,
    "°F": (value) => ((value - 32) * 5) / 9 + 273.15,
    K: (value) => value,
  };
  const fromKelvinBySymbol: Record<string, (value: number) => number> = {
    "°C": (kelvin) => kelvin - 273.15,
    "°F": (kelvin) => ((kelvin - 273.15) * 9) / 5 + 32,
    K: (kelvin) => kelvin,
  };
  const toKelvin = kelvinBySymbol[from.symbol] as (value: number) => number;
  const fromKelvin = fromKelvinBySymbol[to.symbol] as (value: number) => number;
  return fromKelvin(toKelvin(amount));
}

/**
 * The answer to a typed conversion, or null when the query is not one.
 * Example: "5 km in mi" → { text: "3.10686", title: "3.10686 mi", description: "5 km in mi" }
 */
export function convertUnits(query: string): ConversionAnswer | null {
  const trimmed = query.trim();
  const match = trimmed.length > MAX_QUERY_LENGTH ? null : CONVERSION_PATTERN.exec(trimmed);
  if (match === null) {
    return null;
  }
  const amount = Number(match[1]);
  const from = findUnit(match[2] as string);
  const to = findUnit(match[3] as string);
  if (from === undefined || to === undefined || from.kind !== to.kind || !Number.isFinite(amount)) {
    return null;
  }
  const converted = from.kind === "temperature" ? convertTemperature(amount, from, to) : (amount * from.factor) / to.factor;
  const text = formatAnswerNumber(Number(converted.toPrecision(CONVERSION_DIGITS)));
  return { text: text, title: `${text} ${to.symbol}`, description: `${formatAnswerNumber(amount)} ${from.symbol} in ${to.symbol}` };
}
