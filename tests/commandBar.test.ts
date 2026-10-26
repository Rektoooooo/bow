/**
 * WHY this file exists:
 *   The Command Bar decides where ⌘T takes you; these tests pin down its ranking rules and the history it reads.
 */
import { describe, expect, it } from "vitest";
import { rankCommandBarResults, scoreAddressMatch, scoreTextMatch } from "../src/main/commandBar";
import type { CommandBarInput } from "../src/main/commandBar";
import { HISTORY_LIMIT, recordVisit, searchHistory, updateHistoryTitle } from "../src/main/history";
import { addToFavorites, createInitialState, updateTabPage } from "../src/main/state";
import { HOUR_MS } from "../src/shared/settings";
import type { BrowserState, ItemId } from "../src/shared/types";
import { ONE_PM, openTabs } from "./builders";

/** Builds a ranking input with sensible empty defaults. */
function makeInput(query: string, state: BrowserState, changes: Partial<CommandBarInput> = {}): CommandBarInput {
  return { query: query, state: state, history: [], suggestions: [], actions: [], currentUrl: null, recentTabIds: [], ...changes };
}

describe("match scores", () => {
  it("prefers exact, then prefix, then word start, then anywhere", () => {
    expect(scoreTextMatch("GitHub", "github")).toBe(100);
    expect(scoreTextMatch("GitHub Pull Requests", "git")).toBe(80);
    expect(scoreTextMatch("GitHub Pull Requests", "pull")).toBe(60);
    expect(scoreTextMatch("GitHub Pull Requests", "ull")).toBe(40);
    expect(scoreTextMatch("GitHub Pull Requests", "requests git")).toBe(30);
    expect(scoreTextMatch("GitHub", "")).toBe(0);
  });

  it("matches addresses by host first", () => {
    expect(scoreAddressMatch("https://www.github.com/x", "github.com")).toBe(100);
    expect(scoreAddressMatch("https://github.com/x", "git")).toBe(90);
    expect(scoreAddressMatch("https://example.com/github", "github")).toBe(40);
  });
});

describe("rankCommandBarResults", () => {
  it("switches to an open tab instead of opening its address again", () => {
    const { state } = openTabs(["https://github.com/"]);

    const results = rankCommandBarResults(makeInput("github.com", state), ONE_PM);

    expect(results[0]?.kind).toBe("tab");
    expect(results.filter((result) => result.url?.includes("github.com"))).toHaveLength(1);
  });

  it("puts what you typed first when nothing matches strongly", () => {
    const { state } = openTabs(["https://news.example/"]);

    const results = rankCommandBarResults(makeInput("best pizza", state, { suggestions: ["best pizza near me"] }), ONE_PM);

    expect(results[0]).toMatchObject({ kind: "search", title: "best pizza" });
    expect(results.some((result) => result.title === "best pizza near me")).toBe(true);
  });

  it("ranks the page you are on below other matches, and Favorites above plain tabs", () => {
    const { state: withTabs, tabIds } = openTabs(["https://docs.example/a", "https://docs.example/b"]);
    const titled = updateTabPage(updateTabPage(withTabs, tabIds[0] as ItemId, "https://docs.example/a", "Docs A"), tabIds[1] as ItemId, "https://docs.example/b", "Docs B");
    const withFavorite = addToFavorites(titled, tabIds[1] as ItemId);

    const results = rankCommandBarResults(makeInput("docs", withFavorite, { currentUrl: "https://docs.example/a" }), ONE_PM);

    const tabResults = results.filter((result) => result.kind === "tab");
    expect(tabResults.map((result) => result.tabId)).toEqual([tabIds[1], tabIds[0]]);
  });

  it("finds history and actions", () => {
    const history = recordVisit([], "https://weather.example/prague", "Prague weather", ONE_PM);
    const actions = [{ id: "toggle-sidebar", title: "Toggle Sidebar", keywords: ["hide sidebar"] }];

    const historyResults = rankCommandBarResults(makeInput("weather", createInitialState(), { history: history }), ONE_PM + HOUR_MS);
    const actionResults = rankCommandBarResults(makeInput("hide", createInitialState(), { actions: actions }), ONE_PM);

    expect(historyResults[0]).toMatchObject({ kind: "history", url: "https://weather.example/prague" });
    expect(actionResults[0]).toMatchObject({ kind: "action", actionId: "toggle-sidebar" });
  });

  it("lists recently used tabs for an empty query", () => {
    const { state, tabIds } = openTabs(["https://a.example/", "https://b.example/", "https://c.example/"]);

    const results = rankCommandBarResults(makeInput("", state, { currentUrl: "https://c.example/" }), ONE_PM);

    expect(results.map((result) => result.tabId)).toEqual([tabIds[1], tabIds[0]]);
  });
});

describe("history", () => {
  it("moves a revisited page to the front and counts visits", () => {
    const first = recordVisit([], "https://a.example/", "A", ONE_PM);
    const second = recordVisit(first, "https://b.example/", "B", ONE_PM + 1);
    const third = recordVisit(second, "https://a.example/", "", ONE_PM + 2);

    expect(third.map((entry) => entry.url)).toEqual(["https://a.example/", "https://b.example/"]);
    expect(third[0]).toMatchObject({ visitCount: 2, title: "A", lastVisitAt: ONE_PM + 2 });
  });

  it("ignores non-web pages, keeps the limit, updates titles and searches every word", () => {
    let entries = recordVisit([], "about:blank", "", ONE_PM);
    expect(entries).toEqual([]);
    for (let index = 0; index < HISTORY_LIMIT + 5; index++) {
      entries = recordVisit(entries, `https://site${index}.example/`, `Site ${index}`, ONE_PM + index);
    }
    expect(entries).toHaveLength(HISTORY_LIMIT);

    const retitled = updateHistoryTitle(entries, "https://site4000.example/", "Weather in Prague");
    expect(searchHistory(retitled, "prague weather", 5).map((entry) => entry.url)).toEqual(["https://site4000.example/"]);
    expect(updateHistoryTitle(retitled, "https://site4000.example/", "Weather in Prague")).toBe(retitled);
  });
});
