/**
 * WHY this file exists:
 *   "Feed from This Page" falls back to feeds some sites have at a known address without naming them in the page.
 *   These addresses check which pages have one and that nothing else gets one.
 */
import { describe, expect, it } from "vitest";
import { FEED_PRESETS, findKnownFeed } from "../src/main/feedPresets";

describe("known feeds", () => {
  it("give a subreddit's page its feed, whatever Reddit host or sub-page it is on", () => {
    const typescript = { url: "https://www.reddit.com/r/typescript/.rss", title: "r/typescript" };
    expect(findKnownFeed("https://www.reddit.com/r/typescript/")).toEqual(typescript);
    expect(findKnownFeed("https://old.reddit.com/r/typescript/top/?t=week")).toEqual(typescript);
    expect(findKnownFeed("https://reddit.com/r/typescript")).toEqual(typescript);
  });

  it("give Hacker News its front page feed", () => {
    expect(findKnownFeed("https://news.ycombinator.com/news?p=2")).toEqual(FEED_PRESETS.hackerNews);
  });

  it("give other pages none", () => {
    expect(findKnownFeed("https://www.reddit.com/")).toBeNull();
    expect(findKnownFeed("https://www.reddit.com/user/someone")).toBeNull();
    expect(findKnownFeed("https://reddit.example/r/typescript/")).toBeNull();
    expect(findKnownFeed("not a url")).toBeNull();
  });
});
