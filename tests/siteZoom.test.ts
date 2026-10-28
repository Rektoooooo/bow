// Zoom remembered per host: ⌘+ on a site stays the next time it opens.
import { describe, expect, it } from "vitest";
import { getZoomHost, readSiteZoom, setSiteZoom } from "../src/main/siteZoom";
import { createInitialState } from "../src/main/state";

describe("site zoom", () => {
  const state = createInitialState();

  it("remembers a zoom per host, for every page of that host only", () => {
    const zoomed = setSiteZoom(state, "https://docs.example.com/a", 1.25);
    expect(readSiteZoom(zoomed, "https://docs.example.com/b?x=1")).toBe(1.25);
    expect(readSiteZoom(zoomed, "https://mail.example.com/")).toBe(1);
  });

  it("forgets it at 100%, and changes nothing when the zoom is already that", () => {
    const zoomed = setSiteZoom(state, "https://docs.example.com/", 0.9);
    expect(setSiteZoom(zoomed, "https://docs.example.com/", 0.9)).toBe(zoomed);
    expect(setSiteZoom(zoomed, "https://docs.example.com/", 1).siteZooms).toEqual({});
    expect(setSiteZoom(state, "https://docs.example.com/", 1)).toBe(state);
  });

  it("only web pages have a zoom host", () => {
    expect(getZoomHost("HTTPS://Docs.Example.com/")).toBe("docs.example.com");
    expect(getZoomHost("sidebar-note:note-1")).toBeNull();
    expect(getZoomHost("not a url")).toBeNull();
    expect(setSiteZoom(state, "about:blank", 2)).toBe(state);
  });
});
