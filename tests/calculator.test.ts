/**
 * WHY this file exists:
 *   The Command Bar works out what you type when it is a sum or a unit conversion. These tests pin down the rules of
 *   arithmetic it follows, the answers it gives, and the many queries that must not be taken for a sum.
 */
import { describe, expect, it } from "vitest";
import { calculate, formatAnswerNumber } from "../src/main/calculator";
import { convertUnits } from "../src/main/unitConversion";

const answerOf = (query: string): string | null => calculate(query)?.text ?? null;

describe("calculator", () => {
  it("follows the usual order: brackets, powers, a leading minus, × ÷, then + −", () => {
    expect(answerOf("12*7")).toBe("84");
    expect(answerOf("2 + 3 * 4")).toBe("14");
    expect(answerOf("(2 + 3) * 4")).toBe("20");
    expect(answerOf("2^3^2")).toBe("512");
    expect(answerOf("-2^2")).toBe("-4");
    expect(answerOf("10 / 4")).toBe("2.5");
    expect(answerOf("7 − 10")).toBe("-3");
    expect(answerOf("6 × 7 ÷ 2")).toBe("21");
  });

  it("knows percentages, functions and pi", () => {
    expect(answerOf("50%")).toBe("0.5");
    expect(answerOf("sqrt(16) + abs(-2)")).toBe("6");
    expect(answerOf("log(1000)")).toBe("3");
    expect(answerOf("2 * pi")).toBe("6.28318530718");
    expect(answerOf("= 1+1")).toBe("2");
  });

  it("reads like a pocket calculator: no float noise, no minus zero", () => {
    expect(answerOf("0.1 + 0.2")).toBe("0.3");
    expect(formatAnswerNumber(-0)).toBe("0");
    expect(answerOf("1/3")).toBe("0.333333333333");
  });

  it("gives no answer for what is not a sum", () => {
    for (const query of ["", "42", "-5", "(5)", "pi", "github", "log", "2026-10-28", "555-1234", "192.168.1.1", "localhost:3000", "1e5", "2pi", "1,5 + 2", "(1 + 2", "1 +", "1/0", "sqrt(-1)", "constructor(1) + 1", "valueOf + 1", "__proto__ * 2"]) {
      expect(calculate(query), query).toBeNull();
    }
  });

  it("refuses very deep brackets and very long text", () => {
    expect(calculate(`${"(".repeat(40)}1+1${")".repeat(40)}`)).toBeNull();
    expect(calculate(`1+${"1+".repeat(150)}1`)).toBeNull();
  });
});

describe("unit conversion", () => {
  it("converts lengths, weights, volumes, times, data sizes and speeds", () => {
    expect(convertUnits("5 km in mi")).toEqual({ text: "3.10686", title: "3.10686 mi", description: "5 km in mi" });
    expect(convertUnits("12 in to cm")?.title).toBe("30.48 cm");
    expect(convertUnits("6 feet in m")?.title).toBe("1.8288 m");
    expect(convertUnits("2 lbs to kg")?.title).toBe("0.907185 kg");
    expect(convertUnits("2 cups in ml")?.title).toBe("473.176 ml");
    expect(convertUnits("1 fl oz to ml")?.title).toBe("29.5735 ml");
    expect(convertUnits("90 minutes in hours")?.title).toBe("1.5 h");
    expect(convertUnits("1 GiB in MB")?.title).toBe("1073.74 MB");
    expect(convertUnits("100 km/h to mph")?.title).toBe("62.1371 mph");
  });

  it("converts temperatures through their offsets", () => {
    expect(convertUnits("350 f to c")?.title).toBe("176.667 °C");
    expect(convertUnits("-40 °C in °F")?.title).toBe("-40 °F");
    expect(convertUnits("0 kelvin to celsius")?.title).toBe("-273.15 °C");
  });

  it("gives no answer for units of different kinds, unknown units or other text", () => {
    for (const query of ["5 km in kg", "5 parsecs in km", "3 tons in kg", "km in mi", "how to cook rice", "5 km", "5 constructor in constructor", "1 tostring to valueof", "2 __proto__ in km"]) {
      expect(convertUnits(query), query).toBeNull();
    }
  });
});
