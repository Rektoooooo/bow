/**
 * WHY this file exists:
 *   HTTPS-Only Mode upgrades plain-http pages and offers http back only when the secure version is missing. These
 *   tests pin down which addresses are upgraded, how, and which failures count as "no https".
 */
import { describe, expect, it } from "vitest";
import { isNoHttpsFailure, toHttpsUrl } from "../src/main/httpsOnly";
import { isLocalHost } from "../src/shared/localNames";

describe("HTTPS-Only Mode", () => {
  it("upgrades plain-http pages, keeping the path, query and a named port", () => {
    expect(toHttpsUrl("http://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
    expect(toHttpsUrl("http://example.com:8080/")).toBe("https://example.com:8080/");
    expect(toHttpsUrl("http://example.com:80/")).toBe("https://example.com/");
  });

  it("leaves secure pages, other schemes, local names and IP addresses alone", () => {
    for (const url of ["https://example.com/", "ftp://example.com/", "http://localhost:3000/", "http://app.localhost/", "http://printer.local/", "http://site.test/", "http://192.168.1.10/", "http://127.0.0.1:8000/", "http://[::1]:8000/", "not a url"]) {
      expect(toHttpsUrl(url), url).toBeNull();
    }
    expect(isLocalHost("example.com")).toBe(false);
  });

  it("counts refused, reset, timed-out, TLS and certificate failures as no https, but not a cancel or an unknown name", () => {
    for (const code of [-7, -100, -101, -102, -107, -200, -202, -299]) {
      expect(isNoHttpsFailure(code), String(code)).toBe(true);
    }
    for (const code of [-3, -105, -300, -2, 0]) {
      expect(isNoHttpsFailure(code), String(code)).toBe(false);
    }
  });
});
