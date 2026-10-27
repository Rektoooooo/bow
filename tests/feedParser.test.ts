/**
 * WHY this file exists:
 *   Real feeds differ in many small ways (CDATA, escaped HTML, relative links, Atom's link tags, guids). These made-up
 *   feeds hold one of each, so a feed live folder reads the right address and title.
 */
import { describe, expect, it } from "vitest";
import { parseFeed, pickFeedLink } from "../src/main/feedParser";

const FEED_URL = "https://news.example/feed.xml";

describe("parseFeed", () => {
  it("reads RSS 2.0: channel title, CDATA and escaped titles, relative links, permalink guids", () => {
    const rss = `<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <title>Example &amp; News</title>
        <link>https://news.example/</link>
        <item><title><![CDATA[Tom & Jerry <em>return</em>]]></title><link>https://news.example/1</link></item>
        <item><title>It&amp;rsquo;s &lt;b&gt;here&lt;/b&gt;</title><link> /2 </link></item>
        <item><title>Guid only</title><guid isPermaLink="true">https://news.example/3</guid></item>
        <item><title>Not a link</title><guid isPermaLink="false">post-4</guid></item>
        <item><link>https://news.example/5</link></item>
      </channel></rss>`;
    expect(parseFeed(rss, FEED_URL)).toEqual({
      title: "Example & News",
      entries: [
        { url: "https://news.example/1", title: "Tom & Jerry return" },
        { url: "https://news.example/2", title: "It’s here" },
        { url: "https://news.example/3", title: "Guid only" },
        { url: "https://news.example/5", title: "https://news.example/5" },
      ],
    });
  });

  it("reads Atom: the alternate link (or one without rel), never self or enclosure links", () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
        <title type="text">Example Atom</title>
        <link rel="self" href="https://news.example/atom"/>
        <entry>
          <title type="html">&lt;i&gt;First&lt;/i&gt;</title>
          <link rel="enclosure" href="https://news.example/a.mp3"/>
          <link rel="alternate" type="text/html" href="https://news.example/first"/>
        </entry>
        <entry><title>Second</title><link href='/second?x=1&amp;y=2'/></entry>
      </feed>`;
    expect(parseFeed(atom, FEED_URL)).toEqual({
      title: "Example Atom",
      entries: [
        { url: "https://news.example/first", title: "First" },
        { url: "https://news.example/second?x=1&y=2", title: "Second" },
      ],
    });
  });

  it("reads RDF (RSS 1.0) and prefers FeedBurner's original address", () => {
    const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
        <channel rdf:about="https://news.example/"><title>Old Style</title></channel>
        <item rdf:about="https://news.example/r1"><title>R1</title><link>https://news.example/r1</link></item>
        <item rdf:about="https://feeds.example/x"><title>R2</title><link>https://feeds.example/x</link>
          <feedburner:origLink>https://news.example/r2</feedburner:origLink></item>
      </rdf:RDF>`;
    expect(parseFeed(rdf, FEED_URL)?.entries).toEqual([
      { url: "https://news.example/r1", title: "R1" },
      { url: "https://news.example/r2", title: "R2" },
    ]);
  });

  it("reads JSON Feed, naming untitled posts by their text", () => {
    const json = JSON.stringify({
      version: "https://jsonfeed.org/version/1.1",
      title: "Example JSON",
      items: [
        { id: "1", url: "https://news.example/j1", title: "J1" },
        { id: "2", external_url: "https://elsewhere.example/j2", content_text: "A short note" },
        { id: "3", url: "javascript:alert(1)", title: "Never" },
      ],
    });
    expect(parseFeed(json, FEED_URL)).toEqual({
      title: "Example JSON",
      entries: [
        { url: "https://news.example/j1", title: "J1" },
        { url: "https://elsewhere.example/j2", title: "A short note" },
      ],
    });
  });

  it("skips posts that are not web addresses and returns null for pages that are not feeds", () => {
    const rss = `<rss><channel><title>T</title><item><title>X</title><link>javascript:alert(1)</link></item></channel></rss>`;
    expect(parseFeed(rss, FEED_URL)?.entries).toEqual([]);
    expect(parseFeed("<!doctype html><html><body>Not found</body></html>", FEED_URL)).toBeNull();
    expect(parseFeed("{\"error\":true}", FEED_URL)).toBeNull();
  });
});

describe("pickFeedLink", () => {
  it("takes the page itself when it is a feed", () => {
    expect(pickFeedLink("application/xml", [], "https://news.example/feed.xml")).toEqual({ url: "https://news.example/feed.xml", title: null });
  });

  it("takes the first alternate link of a feed type, made absolute", () => {
    const links = [
      { href: "/fr/", type: "text/html", title: "Français" },
      { href: "/atom.xml", type: "application/atom+xml", title: " Example Blog " },
      { href: "/rss.xml", type: "application/rss+xml", title: "" },
    ];
    expect(pickFeedLink("text/html", links, "https://news.example/posts/1")).toEqual({ url: "https://news.example/atom.xml", title: "Example Blog" });
  });

  it("finds nothing on a page without a feed", () => {
    expect(pickFeedLink("text/html", [{ href: "/fr/", type: "text/html", title: "" }], "https://news.example/")).toBeNull();
  });
});
