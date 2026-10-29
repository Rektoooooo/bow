/**
 * WHY this file exists:
 *   The sentences that tell the user how a passwords import went, and where each browser keeps its export, are shown
 *   in three places and must stay accurate (counts, singular and plural) and free of dashes (the onboarding forbids
 *   them in its text).
 *
 * Data source:
 *   Hand-made outcomes; no real data.
 *
 * Data flow:
 *   outcome → describeImportOutcome / isImportedFileTrashable; browser id → describePasswordExport → checks
 */
import { describe, expect, it } from "vitest";
import { SUPPORTED_BROWSERS } from "../src/shared/onboarding";
import { describeImportOutcome, describePasswordExport, isImportedFileTrashable } from "../src/shared/passwords";
import type { PasswordImportOutcome } from "../src/shared/passwords";

const DASH_PATTERN = /[-–—]/;

function imported(addedCount: number, alreadySavedCount: number, keptDifferentCount: number, skippedCount: number): PasswordImportOutcome {
  return { kind: "imported", addedCount, alreadySavedCount, keptDifferentCount, skippedCount };
}

describe("describeImportOutcome", () => {
  it("counts what was imported, in singular and plural", () => {
    expect(describeImportOutcome(imported(120, 0, 0, 0))).toBe("Imported 120 passwords.");
    expect(describeImportOutcome(imported(1, 5, 0, 0))).toBe("Imported 1 password.");
  });

  it("says when everything was already in Bow", () => {
    expect(describeImportOutcome(imported(0, 12, 0, 0))).toBe("No new passwords: all 12 were already in Bow.");
    expect(describeImportOutcome(imported(0, 0, 0, 0))).toBe("No new passwords.");
  });

  it("adds the logins that stayed as they were and the rows that were skipped", () => {
    expect(describeImportOutcome(imported(2, 0, 3, 2))).toBe(
      "Imported 2 passwords. 3 were already in Bow with another password and stayed as they were. 2 rows had no web address or password.",
    );
    expect(describeImportOutcome(imported(1, 0, 1, 1))).toBe(
      "Imported 1 password. 1 was already in Bow with another password and stayed as it was. 1 row had no web address or password.",
    );
  });

  it("explains a file that cannot be imported, and stays silent when cancelled", () => {
    expect(describeImportOutcome({ kind: "unrecognized" })).toBe("This file doesn't look like a passwords export. Choose the CSV file your browser saved.");
    expect(describeImportOutcome({ kind: "tooLarge" })).toBe("This file is too large to be a passwords export.");
    expect(describeImportOutcome({ kind: "vaultUnavailable" })).toBe("Bow can't open its saved passwords right now.");
    expect(describeImportOutcome({ kind: "cancelled" })).toBe("");
  });

  it("never uses a dash", () => {
    const outcomes: PasswordImportOutcome[] = [imported(2, 0, 3, 2), imported(0, 12, 1, 1), { kind: "unrecognized" }, { kind: "tooLarge" }, { kind: "vaultUnavailable" }];
    for (const outcome of outcomes) {
      expect(describeImportOutcome(outcome)).not.toMatch(DASH_PATTERN);
    }
  });
});

describe("isImportedFileTrashable", () => {
  it("offers the Trash when the file held logins, not otherwise", () => {
    expect(isImportedFileTrashable(imported(1, 0, 0, 0))).toBe(true);
    expect(isImportedFileTrashable(imported(0, 2, 0, 0))).toBe(true);
    expect(isImportedFileTrashable(imported(0, 0, 0, 3))).toBe(false);
    expect(isImportedFileTrashable({ kind: "unrecognized" })).toBe(false);
  });
});

describe("describePasswordExport", () => {
  it("names the browser for the Chromium family", () => {
    expect(describePasswordExport("chrome")).toBe("In Chrome, open Settings, find Passwords and choose Export passwords. Then choose the file it saved.");
    expect(describePasswordExport("dia")).toContain("In Dia,");
    expect(describePasswordExport("edge")).toContain("In Edge,");
  });

  it("has its own steps for Safari and Firefox", () => {
    expect(describePasswordExport("safari")).toBe("Open the Passwords app (on macOS 14, Safari), choose File, then Export All Passwords. Then choose the file it saved.");
    expect(describePasswordExport("firefox")).toBe("In Firefox, open Passwords, click the three dots and choose Export Passwords. Then choose the file it saved.");
  });

  it("has steps for every browser the onboarding lists, without a dash", () => {
    for (const browser of SUPPORTED_BROWSERS) {
      const steps = describePasswordExport(browser.id);
      expect(steps).not.toMatch(DASH_PATTERN);
      expect(steps.length).toBeGreaterThan(20);
    }
  });
});
