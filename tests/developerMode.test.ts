/**
 * WHY this file exists:
 *   Developer Mode is a per-site switch that is on by default only for local development servers; these tests pin
 *   down which pages it reaches and that the switch is remembered per site.
 */
import { describe, expect, it } from "vitest";
import { isDeveloperModeOn, isLocalDevelopmentUrl, setDeveloperMode } from "../src/shared/developerMode";
import { createInitialState } from "../src/main/state";

describe("Developer Mode", () => {
  it("is on for local development servers and off elsewhere until the user switches it", () => {
    const state = createInitialState();

    expect(isLocalDevelopmentUrl("http://localhost:3000/")).toBe(true);
    expect(isLocalDevelopmentUrl("http://shop.test/")).toBe(true);
    expect(isLocalDevelopmentUrl("http://127.0.0.1:8080/x")).toBe(true);
    expect(isDeveloperModeOn(state, "http://localhost:5173/")).toBe(true);
    expect(isDeveloperModeOn(state, "https://example.com/")).toBe(false);
    expect(isDeveloperModeOn(state, "about:blank")).toBe(false);
  });

  it("is switched per site, for every page of that site", () => {
    const state = setDeveloperMode(createInitialState(), "example.com", true);

    expect(isDeveloperModeOn(state, "https://www.example.com/docs")).toBe(true);
    expect(isDeveloperModeOn(state, "https://example.org/")).toBe(false);
  });

  it("can be turned off for a local server, and leaves the state alone when nothing changes", () => {
    const off = setDeveloperMode(createInitialState(), "localhost", false);

    expect(isDeveloperModeOn(off, "http://localhost:3000/")).toBe(false);
    expect(setDeveloperMode(off, "localhost", false)).toBe(off);
  });

  it("ignores a broken saved choice", () => {
    const state = { ...createInitialState(), developerModeSites: { "example.com": "yes" as unknown as boolean } };

    expect(isDeveloperModeOn(state, "https://example.com/")).toBe(false);
  });
});
