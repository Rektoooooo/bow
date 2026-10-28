/**
 * WHY this file exists:
 *   Air Traffic Control decides where links from other apps open; these tests pin down its matching rules.
 */
import { describe, expect, it } from "vitest";
import { addRoutingRule, findRoutedSpaceId, removeRoutingRule, ROUTING_RULES_LIMIT } from "../src/main/routing";
import { findMatchingRule, ruleMatches } from "../src/shared/routingRules";
import { createInitialState } from "../src/main/state";
import { ONE_PM, PERSONAL_SPACE_ID, WORK_SPACE_ID } from "./builders";

describe("ruleMatches", () => {
  it("matches 'contains' anywhere and 'is' exactly, ignoring case and a trailing slash", () => {
    const contains = { id: "r1", matchType: "contains" as const, value: "GitHub.com", spaceId: WORK_SPACE_ID };
    const exact = { id: "r2", matchType: "is" as const, value: "https://mail.example/", spaceId: WORK_SPACE_ID };

    expect(ruleMatches(contains, "https://github.com/pulls", null)).toBe(true);
    expect(ruleMatches(contains, "https://gitlab.com/", null)).toBe(false);
    expect(ruleMatches(exact, "https://MAIL.example", null)).toBe(true);
    expect(ruleMatches(exact, "https://mail.example/inbox", null)).toBe(false);
  });
});

describe("routing rules", () => {
  it("routes by the first matching rule and ignores rules for deleted Spaces", () => {
    const withWork = addRoutingRule(createInitialState(), "contains", "github.com", WORK_SPACE_ID, ONE_PM);
    const withBoth = addRoutingRule(withWork, "contains", "github", PERSONAL_SPACE_ID, ONE_PM + 1);
    const withGone = addRoutingRule(withBoth, "contains", "x", "space-gone", ONE_PM + 2);

    expect(findRoutedSpaceId(withBoth, "https://github.com/me", null)).toBe(WORK_SPACE_ID);
    expect(findRoutedSpaceId(withBoth, "https://example.com", null)).toBeNull();
    expect(withGone).toBe(withBoth);
  });

  it("removes rules, refuses empty values and stops at the limit", () => {
    const state = addRoutingRule(createInitialState(), "is", "https://a.example", WORK_SPACE_ID, ONE_PM);
    const ruleId = state.routingRules?.[0]?.id ?? "";
    let full = createInitialState();
    for (let index = 0; index < ROUTING_RULES_LIMIT + 3; index++) {
      full = addRoutingRule(full, "contains", `site${index}`, WORK_SPACE_ID, ONE_PM + index);
    }

    expect(removeRoutingRule(state, ruleId).routingRules).toEqual([]);
    expect(addRoutingRule(state, "contains", "   ", WORK_SPACE_ID, ONE_PM)).toBe(state);
    expect(full.routingRules).toHaveLength(ROUTING_RULES_LIMIT);
  });
});

describe("rules by the app a link came from", () => {
  const chatApp = { bundleId: "com.example.chat", name: "Example Chat" };

  it("match every link from that app, and nothing when the sender is unknown", () => {
    const rule = { id: "r3", matchType: "app" as const, value: "com.example.chat", spaceId: WORK_SPACE_ID, appName: "Example Chat" };
    expect(ruleMatches(rule, "https://anything.example/", chatApp)).toBe(true);
    expect(ruleMatches(rule, "https://anything.example/", { bundleId: "com.example.mail", name: "Mail" })).toBe(false);
    expect(ruleMatches(rule, "https://anything.example/", null)).toBe(false);
  });

  it("route in list order: an address rule above an app rule wins", () => {
    const state = createInitialState(ONE_PM);
    const withAddress = addRoutingRule(state, "contains", "docs.example", PERSONAL_SPACE_ID, ONE_PM);
    const withApp = addRoutingRule(withAddress, "app", "com.example.chat", WORK_SPACE_ID, ONE_PM, "Example Chat");
    expect(withApp.routingRules?.[1]).toMatchObject({ matchType: "app", value: "com.example.chat", appName: "Example Chat" });
    expect(findRoutedSpaceId(withApp, "https://docs.example/a", chatApp)).toBe(PERSONAL_SPACE_ID);
    expect(findRoutedSpaceId(withApp, "https://news.example/", chatApp)).toBe(WORK_SPACE_ID);
    expect(findRoutedSpaceId(withApp, "https://news.example/", null)).toBeNull();
    const spaceIds = withApp.spaces.map((space) => space.id);
    expect(findMatchingRule(withApp.routingRules ?? [], spaceIds, "https://news.example/", chatApp)?.id).toBe(withApp.routingRules?.[1]?.id);
  });
});

