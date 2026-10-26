/**
 * WHY this file exists:
 *   Tab-to-search picks a site from a few typed letters; these tests pin down which text picks which site, and the
 *   address a search opens.
 */
import { describe, expect, it } from "vitest";
import { buildSiteSearchUrl, findSiteSearch, SITE_SEARCHES } from "../src/shared/siteSearch";

describe("site search", () => {
  it("picks a site from the start of its name or host", () => {
    expect(findSiteSearch("yout")?.name).toBe("YouTube");
    expect(findSiteSearch("GitHub.c")?.name).toBe("GitHub");
    expect(findSiteSearch("  wiki ")?.name).toBe("Wikipedia");
  });

  it("lets a full short keyword win, and ignores single letters and searches", () => {
    expect(findSiteSearch("x")?.name).toBe("X");
    expect(findSiteSearch("g")).toBeNull();
    expect(findSiteSearch("best pizza")).toBeNull();
    expect(findSiteSearch("")).toBeNull();
  });

  it("prefers the earlier site when two match", () => {
    expect(findSiteSearch("go")?.name).toBe("Google");
    expect(findSiteSearch("st")?.name).toBe("Stack Overflow");
  });

  it("builds the search address with the query encoded", () => {
    const youtube = SITE_SEARCHES.find((site) => site.id === "youtube")!;
    expect(buildSiteSearchUrl(youtube, " lofi beats & rain ")).toBe("https://www.youtube.com/results?search_query=lofi%20beats%20%26%20rain");
  });

  it("only lists https search addresses with one query slot", () => {
    for (const site of SITE_SEARCHES) {
      expect(site.searchUrl.startsWith("https://")).toBe(true);
      expect(site.searchUrl.split("%s").length).toBe(2);
    }
  });
});
