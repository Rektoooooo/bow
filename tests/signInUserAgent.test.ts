/**
 * WHY this file exists:
 *   Google's sign-in only works when it sees Electron's own user agent (signInUserAgent.ts). These tests pin down
 *   which requests get it: the sign-in pages and what they load, never other sites, never look-alike hosts.
 *
 * Data source:
 *   Addresses written by hand below.
 *
 * Data flow:
 *   address, page navigation or not, page address → usesElectronUserAgent() → true / false
 */
import { describe, expect, it } from "vitest";
import { isGoogleSignInAddress, usesElectronUserAgent } from "../src/main/signInUserAgent";

const SIGN_IN_PAGE = "https://accounts.google.com/v3/signin/identifier?flowName=WebLiteSignIn";

describe("isGoogleSignInAddress", () => {
  it("accepts https pages on accounts.google.com only", () => {
    expect(isGoogleSignInAddress(SIGN_IN_PAGE)).toBe(true);
    expect(isGoogleSignInAddress("https://accounts.google.com/o/oauth2/v2/auth?client_id=x")).toBe(true);
    expect(isGoogleSignInAddress("http://accounts.google.com/")).toBe(false);
    expect(isGoogleSignInAddress("https://mail.google.com/")).toBe(false);
    expect(isGoogleSignInAddress("https://accounts.google.com.example.org/")).toBe(false);
    expect(isGoogleSignInAddress("https://example.org/?next=https://accounts.google.com/")).toBe(false);
    expect(isGoogleSignInAddress("")).toBe(false);
    expect(isGoogleSignInAddress("not an address")).toBe(false);
  });
});

describe("usesElectronUserAgent", () => {
  it("covers a navigation to the sign-in host, from anywhere", () => {
    expect(usesElectronUserAgent(SIGN_IN_PAGE, true, "https://mail.google.com/")).toBe(true);
    expect(usesElectronUserAgent(SIGN_IN_PAGE, true, "")).toBe(true);
  });

  it("covers everything a sign-in page loads, also from other hosts", () => {
    expect(usesElectronUserAgent("https://ssl.gstatic.com/accounts/script.js", false, SIGN_IN_PAGE)).toBe(true);
    expect(usesElectronUserAgent("https://play.google.com/log", false, SIGN_IN_PAGE)).toBe(true);
  });

  it("returns to Chrome when the page leaves the sign-in host", () => {
    expect(usesElectronUserAgent("https://mail.google.com/mail/", true, SIGN_IN_PAGE)).toBe(false);
  });

  it("leaves every other site alone", () => {
    expect(usesElectronUserAgent("https://www.youtube.com/", true, "https://www.google.com/")).toBe(false);
    expect(usesElectronUserAgent("https://example.org/app.js", false, "https://example.org/")).toBe(false);
    expect(usesElectronUserAgent("https://example.org/app.js", false, "")).toBe(false);
  });
});
