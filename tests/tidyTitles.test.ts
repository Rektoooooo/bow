/**
 * WHY this file exists:
 *   Tidy titles shorten pinned tabs' names with general rules; these tests pin down what they keep and what they
 *   drop, and that they leave titles alone when unsure.
 */
import { describe, expect, it } from "vitest";
import { tidyTitle } from "../src/shared/tidyTitles";

describe("tidy titles", () => {
  it("drop counts and the parts that only name the site", () => {
    expect(tidyTitle("(3) Inbox - Mail", "https://mail.example.com/")).toBe("Inbox");
    expect(tidyTitle("sidebar-browser · GitHub", "https://github.com/someone/sidebar-browser")).toBe("sidebar-browser");
    expect(tidyTitle("Web browser - Wikipedia", "https://en.wikipedia.org/wiki/Web_browser")).toBe("Web browser");
    expect(tidyTitle("Settings | Project | Example Cloud", "https://cloud.example.com/")).toBe("Settings");
  });

  it("keep a title that is only the site's name, and short site words do not eat real words", () => {
    expect(tidyTitle("Hacker News", "https://news.ycombinator.com/")).toBe("Hacker News");
    expect(tidyTitle("Garden tips - Blog", "https://en.example.org/")).toBe("Garden tips");
  });

  it("leave titles without separators or with odd addresses alone", () => {
    expect(tidyTitle("Dashboard", "https://app.example.com/")).toBe("Dashboard");
    expect(tidyTitle("Untitled", "about:blank")).toBe("Untitled");
    expect(tidyTitle("", "https://example.com/")).toBe("");
  });
});
