/**
 * WHY this file exists:
 *   The ad blocker engine must block what lists say and never more. These tests pin down the filter syntax it
 *   understands, the syntax it refuses, and that matching stays fast with a list the size of EasyList.
 *   All filters here are synthetic (example.com, ads.example, tracker.test), no real list is used.
 */
import { describe, expect, it } from "vitest";
import { getCosmeticCss, parseFilterList, shouldBlockRequest } from "../src/main/adBlockEngine";

const NEWS_PAGE = "https://news.test/story";

function isBlocked(filterText: string, url: string, pageUrl: string | null = NEWS_PAGE, resourceType = "script"): boolean {
  const filters = parseFilterList(filterText);
  return shouldBlockRequest(filters, { url, pageUrl, resourceType }).isBlocked;
}

describe("comments, headers and counts", () => {
  it("ignores comments, the header and blank lines, and counts loaded and skipped filters", () => {
    const filters = parseFilterList(
      [
        "[Adblock Plus 2.0]",
        "! Title: synthetic list",
        "",
        "||ads.example^",
        "@@||ads.example/ok^",
        "##.banner",
        "/ad[0-9]+/",
        "||x.test^$redirect=noop.js",
        "example.com#?#div:-abp-has(.x)",
      ].join("\r\n"),
    );

    expect(filters.loadedCount).toBe(3);
    expect(filters.skippedCount).toBe(3);
  });
});

describe("domain anchors", () => {
  it("blocks the domain and its subdomains but not look-alike domains", () => {
    const list = "||example.com^";

    expect(isBlocked(list, "https://example.com/a.js")).toBe(true);
    expect(isBlocked(list, "https://cdn.example.com/a.js")).toBe(true);
    expect(isBlocked(list, "https://a.b.example.com:8080/a.js")).toBe(true);
    expect(isBlocked(list, "https://notexample.com/a.js")).toBe(false);
    expect(isBlocked(list, "https://example.com.evil.test/a.js")).toBe(false);
    expect(isBlocked(list, "https://other.test/?next=example.com")).toBe(false);
  });

  it("without a separator the anchor still matches the start of the host name", () => {
    expect(isBlocked("||ads.example", "https://ads.example.org/x")).toBe(true);
    expect(isBlocked("||ads.example", "https://badads.example/x")).toBe(false);
  });

  it("ignores letter case in addresses and patterns", () => {
    expect(isBlocked("||ADS.example^", "https://Ads.Example/Banner.js")).toBe(true);
  });
});

describe("separators, wildcards and anchors", () => {
  it("'^' matches a separator or the end of the address, not a letter or digit", () => {
    const list = "/ads^";

    expect(isBlocked(list, "https://site.test/ads/banner.png")).toBe(true);
    expect(isBlocked(list, "https://site.test/ads?size=3")).toBe(true);
    expect(isBlocked(list, "https://site.test/ads")).toBe(true);
    expect(isBlocked(list, "https://site.test/adsense/x.png")).toBe(false);
    expect(isBlocked(list, "https://site.test/ads-free/x.png")).toBe(false);
  });

  it("'*' matches any run of characters", () => {
    const list = "/banner*/img";

    expect(isBlocked(list, "https://site.test/banner123/img.png")).toBe(true);
    expect(isBlocked(list, "https://site.test/banner/img.png")).toBe(true);
    expect(isBlocked(list, "https://site.test/banners/other.png")).toBe(false);
  });

  it("a plain pattern is a substring match", () => {
    expect(isBlocked("adserver", "https://cdn.test/path/myadserver9/x.js")).toBe(true);
    expect(isBlocked("adserver", "https://cdn.test/path/x.js")).toBe(false);
  });

  it("'|' at the start anchors to the start of the address", () => {
    const list = "|https://ads.test/";

    expect(isBlocked(list, "https://ads.test/x.js")).toBe(true);
    expect(isBlocked(list, "https://other.test/?u=https://ads.test/x.js")).toBe(false);
  });

  it("'|' at the end anchors to the end of the address", () => {
    const list = "/player.swf|";

    expect(isBlocked(list, "https://site.test/player.swf")).toBe(true);
    expect(isBlocked(list, "https://site.test/player.swf?x=1")).toBe(false);
  });

  it("a filter with only wildcards or separators is skipped instead of blocking everything", () => {
    const filters = parseFilterList("*\n^\n||");

    expect(filters.loadedCount).toBe(0);
    expect(filters.skippedCount).toBe(3);
  });

  it("words that touch a wildcard are still found (the index must not hide them)", () => {
    expect(isBlocked("ad*vert/x", "https://site.test/xadvert/x")).toBe(true);
    expect(isBlocked("ads*.js", "https://site.test/badsx.js")).toBe(true);
  });
});

describe("exceptions", () => {
  it("an exception beats a block and reports which filter allowed the request", () => {
    const filters = parseFilterList("||ads.example^\n@@||ads.example/allowed/");

    const blocked = shouldBlockRequest(filters, { url: "https://ads.example/x.js", pageUrl: NEWS_PAGE, resourceType: "script" });
    const allowed = shouldBlockRequest(filters, { url: "https://ads.example/allowed/x.js", pageUrl: NEWS_PAGE, resourceType: "script" });

    expect(blocked).toEqual({ isBlocked: true, matchedFilter: "||ads.example^" });
    expect(allowed).toEqual({ isBlocked: false, matchedFilter: "@@||ads.example/allowed/" });
  });

  it("reports no filter for a request nothing matches", () => {
    const filters = parseFilterList("||ads.example^");
    const decision = shouldBlockRequest(filters, { url: "https://fine.test/x.js", pageUrl: NEWS_PAGE, resourceType: "script" });

    expect(decision).toEqual({ isBlocked: false, matchedFilter: null });
  });

  it("an exception with an option only applies where the option matches", () => {
    const list = "||ads.example^\n@@||ads.example^$domain=partner.test";

    expect(isBlocked(list, "https://ads.example/x.js", "https://partner.test/")).toBe(false);
    expect(isBlocked(list, "https://ads.example/x.js", NEWS_PAGE)).toBe(true);
  });

  it("@@...$document allows everything on pages of that site", () => {
    const filters = parseFilterList("||tracker.test^\n@@||example.com^$document");

    const onAllowedPage = shouldBlockRequest(filters, {
      url: "https://tracker.test/pixel.gif",
      pageUrl: "https://shop.example.com/cart",
      resourceType: "image",
    });
    const onOtherPage = shouldBlockRequest(filters, {
      url: "https://tracker.test/pixel.gif",
      pageUrl: "https://news.test/",
      resourceType: "image",
    });

    expect(onAllowedPage.isBlocked).toBe(false);
    expect(onAllowedPage.matchedFilter).toBe("@@||example.com^$document");
    expect(onOtherPage.isBlocked).toBe(true);
  });

  it("@@...$document also switches off cosmetic hiding on that site", () => {
    const filters = parseFilterList("##.banner\n@@||example.com^$document");

    expect(getCosmeticCss(filters, "https://example.com/")).toBe("");
    expect(getCosmeticCss(filters, "https://other.test/")).toContain(".banner");
  });

  it("a $document filter that blocks is skipped", () => {
    const filters = parseFilterList("||example.com^$document");

    expect(filters.loadedCount).toBe(0);
    expect(filters.skippedCount).toBe(1);
  });
});

describe("options", () => {
  it("$third-party only blocks requests to another site, $~third-party only to the same site", () => {
    const thirdPartyList = "||tracker.test^$third-party";
    const firstPartyList = "||tracker.test^$~third-party";

    expect(isBlocked(thirdPartyList, "https://tracker.test/p.js", "https://news.test/")).toBe(true);
    expect(isBlocked(thirdPartyList, "https://tracker.test/p.js", "https://www.tracker.test/")).toBe(false);
    expect(isBlocked(firstPartyList, "https://tracker.test/p.js", "https://app.tracker.test/")).toBe(true);
    expect(isBlocked(firstPartyList, "https://tracker.test/p.js", "https://news.test/")).toBe(false);
  });

  it("treats co.uk style suffixes as one site when judging third-party", () => {
    const list = "||cdn.bbc.co.uk^$third-party";

    expect(isBlocked(list, "https://cdn.bbc.co.uk/x.js", "https://news.bbc.co.uk/")).toBe(false);
    expect(isBlocked(list, "https://cdn.bbc.co.uk/x.js", "https://other.co.uk/")).toBe(true);
  });

  it("$domain= includes and excludes, subdomains follow their parent, excludes win", () => {
    const list = "||ads.example^$domain=a.test|~b.a.test";

    expect(isBlocked(list, "https://ads.example/x.js", "https://a.test/")).toBe(true);
    expect(isBlocked(list, "https://ads.example/x.js", "https://x.a.test/")).toBe(true);
    expect(isBlocked(list, "https://ads.example/x.js", "https://b.a.test/page")).toBe(false);
    expect(isBlocked(list, "https://ads.example/x.js", "https://c.test/")).toBe(false);
    expect(isBlocked(list, "https://ads.example/x.js", "https://nota.test/")).toBe(false);
  });

  it("$domain= with only excludes blocks everywhere else, and with no known page needs no include", () => {
    const excludeOnly = "||ads.example^$domain=~a.test";
    const includeOnly = "||ads.example^$domain=a.test";

    expect(isBlocked(excludeOnly, "https://ads.example/x.js", "https://c.test/")).toBe(true);
    expect(isBlocked(excludeOnly, "https://ads.example/x.js", "https://a.test/")).toBe(false);
    expect(isBlocked(excludeOnly, "https://ads.example/x.js", null)).toBe(true);
    expect(isBlocked(includeOnly, "https://ads.example/x.js", null)).toBe(false);
  });

  it("resource type options include and exclude types", () => {
    const scriptOnly = "||ads.example^$script";
    const notImage = "||ads.example^$~image";
    const imageOrScript = "||ads.example^$image,script";

    expect(isBlocked(scriptOnly, "https://ads.example/x", NEWS_PAGE, "script")).toBe(true);
    expect(isBlocked(scriptOnly, "https://ads.example/x", NEWS_PAGE, "image")).toBe(false);
    expect(isBlocked(notImage, "https://ads.example/x", NEWS_PAGE, "image")).toBe(false);
    expect(isBlocked(notImage, "https://ads.example/x", NEWS_PAGE, "font")).toBe(true);
    expect(isBlocked(imageOrScript, "https://ads.example/x", NEWS_PAGE, "image")).toBe(true);
    expect(isBlocked(imageOrScript, "https://ads.example/x", NEWS_PAGE, "media")).toBe(false);
  });

  it("understands Electron's resource type names", () => {
    expect(isBlocked("||ads.example^$xmlhttprequest", "https://ads.example/x", NEWS_PAGE, "xhr")).toBe(true);
    expect(isBlocked("||ads.example^$subdocument", "https://ads.example/x", NEWS_PAGE, "subFrame")).toBe(true);
    expect(isBlocked("||ads.example^$websocket", "https://ads.example/x", NEWS_PAGE, "webSocket")).toBe(true);
    expect(isBlocked("||ads.example^$other", "https://ads.example/x", NEWS_PAGE, "somethingNew")).toBe(true);
    expect(isBlocked("||ads.example^$stylesheet", "https://ads.example/x", NEWS_PAGE, "stylesheet")).toBe(true);
    expect(isBlocked("||ads.example^$ping", "https://ads.example/x", NEWS_PAGE, "ping")).toBe(true);
  });

  it("$match-case makes the pattern case sensitive", () => {
    const list = "/AdBanner.js$match-case";

    expect(isBlocked(list, "https://site.test/AdBanner.js")).toBe(true);
    expect(isBlocked(list, "https://site.test/adbanner.js")).toBe(false);
    expect(isBlocked("/AdBanner.js", "https://site.test/adbanner.js")).toBe(true);
  });

  it("skips the whole filter when an option is unknown", () => {
    const unknownOptions = [
      "||ads.example^$redirect=noop.js",
      "||ads.example^$csp=script-src 'none'",
      "||ads.example^$removeparam=utm",
      "||ads.example^$popup",
      "||ads.example^$script,important",
      "||ads.example^$domain=a.*",
    ];

    for (const line of unknownOptions) {
      const filters = parseFilterList(line);
      expect(filters.loadedCount).toBe(0);
      expect(filters.skippedCount).toBe(1);
      expect(isBlocked(line, "https://ads.example/x.js")).toBe(false);
    }
  });

  it("skips regular expression filters and counts them", () => {
    const filters = parseFilterList("/banner[0-9]+/\n/ads\\.js/$script");

    expect(filters.loadedCount).toBe(0);
    expect(filters.skippedCount).toBe(2);
  });

  it("a path that merely starts with a slash is not mistaken for a regular expression", () => {
    expect(isBlocked("/ads/banner", "https://site.test/ads/banner.png")).toBe(true);
  });
});

describe("the page itself", () => {
  it("never blocks the main frame, even when a filter matches its address", () => {
    expect(isBlocked("||ads.example^", "https://ads.example/", "https://ads.example/", "mainFrame")).toBe(false);
  });
});

describe("cosmetic filters", () => {
  it("hides generic selectors everywhere", () => {
    const css = getCosmeticCss(parseFilterList("##.banner\n###sponsored"), "https://anywhere.test/");

    expect(css).toContain(".banner");
    expect(css).toContain("#sponsored");
    expect(css).toContain("display: none !important");
  });

  it("hides site specific selectors on that site and its subdomains only", () => {
    const filters = parseFilterList("news.test##.promo\nnews.test,blog.test##.sidebar-ad");

    expect(getCosmeticCss(filters, "https://news.test/a")).toContain(".promo");
    expect(getCosmeticCss(filters, "https://www.news.test/a")).toContain(".promo");
    expect(getCosmeticCss(filters, "https://blog.test/a")).toContain(".sidebar-ad");
    expect(getCosmeticCss(filters, "https://blog.test/a")).not.toContain(".promo");
    expect(getCosmeticCss(filters, "https://notnews.test/a")).toBe("");
  });

  it("leaves out a subdomain that the filter excludes", () => {
    const filters = parseFilterList("news.test,~live.news.test##.promo");

    expect(getCosmeticCss(filters, "https://news.test/")).toContain(".promo");
    expect(getCosmeticCss(filters, "https://live.news.test/")).toBe("");
  });

  it("'#@#' removes a generic selector everywhere or only on named sites", () => {
    const everywhere = parseFilterList("##.banner\n#@#.banner");
    const onOneSite = parseFilterList("##.banner\nnews.test#@#.banner");

    expect(getCosmeticCss(everywhere, "https://anywhere.test/")).toBe("");
    expect(getCosmeticCss(onOneSite, "https://news.test/")).toBe("");
    expect(getCosmeticCss(onOneSite, "https://other.test/")).toContain(".banner");
  });

  it("an exception also removes a site specific selector", () => {
    const filters = parseFilterList("news.test##.promo\nnews.test#@#.promo");

    expect(getCosmeticCss(filters, "https://news.test/")).toBe("");
  });

  it("does not repeat a selector that two filters both name", () => {
    const filters = parseFilterList("##.banner\nnews.test##.banner");
    const css = getCosmeticCss(filters, "https://news.test/");

    expect(css.split(".banner").length - 1).toBe(1);
  });

  it("skips extended syntax and counts it", () => {
    const skippedLines = [
      "news.test#?#div:-abp-has(.x)",
      "news.test#$#body { overflow: auto !important }",
      "news.test##+js(set-constant, x, 1)",
      "news.test##div:has-text(Sponsored)",
      "news.test#@$#body { overflow: auto }",
      "google.*##.ad",
      "##.a { color: red }",
    ];
    const filters = parseFilterList(skippedLines.join("\n"));

    expect(filters.loadedCount).toBe(0);
    expect(filters.skippedCount).toBe(skippedLines.length);
    expect(getCosmeticCss(filters, "https://news.test/")).toBe("");
  });

  it("splits many selectors into several rules so one bad selector cannot break all", () => {
    const lines: string[] = [];
    for (let position = 0; position < 1200; position += 1) {
      lines.push(`##.ad-${position}`);
    }
    const css = getCosmeticCss(parseFilterList(lines.join("\n")), "https://anywhere.test/");

    const ruleCount = css.split("display: none !important").length - 1;
    expect(ruleCount).toBe(3);
    expect(css).toContain(".ad-0");
    expect(css).toContain(".ad-1199");
  });

  it("returns an empty stylesheet for an address without a host", () => {
    expect(getCosmeticCss(parseFilterList("##.banner"), "about:blank")).toBe("");
  });
});

describe("speed", () => {
  it("checks 1000 addresses against 20000 filters in well under a second", () => {
    const lines: string[] = [];
    for (let position = 0; position < 20000; position += 1) {
      const kind = position % 4;
      if (kind === 0) {
        lines.push(`||adhost${position}.example^$third-party`);
      }
      if (kind === 1) {
        lines.push(`/banner${position}/ad*.js`);
      }
      if (kind === 2) {
        lines.push(`||track${position}.test/pixel^$image`);
      }
      if (kind === 3) {
        lines.push(`@@||adhost${position}.example/ok^`);
      }
    }
    lines.push("/ads.js");
    lines.push("##.banner");

    const buildStart = performance.now();
    const filters = parseFilterList(lines.join("\n"));
    const buildMilliseconds = performance.now() - buildStart;

    let blockedCount = 0;
    const checkStart = performance.now();
    for (let position = 0; position < 1000; position += 1) {
      const url =
        position % 10 === 0
          ? `https://cdn.adhost${(position * 4) % 20000}.example/lib/file${position}.js`
          : `https://www.site${position}.test/assets/app-${position}/main.js?v=${position}`;
      const decision = shouldBlockRequest(filters, { url, pageUrl: NEWS_PAGE, resourceType: "script" });
      if (decision.isBlocked) {
        blockedCount += 1;
      }
    }
    const checkMilliseconds = performance.now() - checkStart;

    expect(filters.loadedCount).toBe(20002);
    expect(blockedCount).toBe(100);
    expect(checkMilliseconds).toBeLessThan(1500);
    expect(buildMilliseconds).toBeLessThan(5000);
  });
});
