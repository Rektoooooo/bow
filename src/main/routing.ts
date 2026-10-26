/**
 * WHY this file exists:
 *   Arc's Air Traffic Control: rules that send links opened from other apps straight to a Space ("address contains
 *   github.com → Work"). Links that match no rule keep opening in a Little Window. These pure functions add, remove
 *   and match the rules.
 *
 * Data source:
 *   BrowserState.routingRules, and the address of a link that arrived from another app.
 *
 * Data flow:
 *   link from another app → littleWindow.ts handleExternalUrl() → findRoutedSpaceId() → a Space, or a Little Window
 *   Library › Settings → actions addRoutingRule / removeRoutingRule → these functions
 */
import type { BrowserState, RoutingMatchType, RoutingRule, SpaceId } from "../shared/types";
import { createId, findSpace } from "./tree";

/** Most rules kept. Our choice: plenty for real use, and a bound on what a broken message can add. */
export const ROUTING_RULES_LIMIT = 50;

/**
 * True when an address matches a rule. Comparisons ignore letter case; "is" also ignores a trailing slash.
 * Example: ruleMatches({ matchType: "contains", value: "GitHub.com", … }, "https://github.com/x") → true
 */
export function ruleMatches(rule: RoutingRule, url: string): boolean {
  const lowerUrl = url.toLowerCase();
  const lowerValue = rule.value.trim().toLowerCase();
  if (lowerValue === "") {
    return false;
  }
  if (rule.matchType === "contains") {
    return lowerUrl.includes(lowerValue);
  }
  const withoutTrailingSlash = (text: string): string => (text.endsWith("/") ? text.slice(0, -1) : text);
  return withoutTrailingSlash(lowerUrl) === withoutTrailingSlash(lowerValue);
}

/**
 * Returns the Space the first matching rule names, or null when no rule matches (or its Space was deleted).
 */
export function findRoutedSpaceId(state: BrowserState, url: string): SpaceId | null {
  for (const rule of state.routingRules ?? []) {
    if (ruleMatches(rule, url) && findSpace(state, rule.spaceId) !== undefined) {
      return rule.spaceId;
    }
  }
  return null;
}

/**
 * Adds a rule at the end. Returns the same state for an empty value, an unknown Space, or a full list.
 */
export function addRoutingRule(state: BrowserState, matchType: RoutingMatchType, value: string, spaceId: SpaceId, now: number): BrowserState {
  const rules = state.routingRules ?? [];
  const trimmedValue = value.trim();
  if (trimmedValue === "" || findSpace(state, spaceId) === undefined || rules.length >= ROUTING_RULES_LIMIT) {
    return state;
  }
  const rule: RoutingRule = { id: createId("route", now), matchType: matchType, value: trimmedValue, spaceId: spaceId };
  return { ...state, routingRules: [...rules, rule] };
}

/**
 * Removes a rule. Returns the same state when there is no such rule.
 */
export function removeRoutingRule(state: BrowserState, ruleId: string): BrowserState {
  const rules = state.routingRules ?? [];
  const remainingRules = rules.filter((rule) => rule.id !== ruleId);
  if (remainingRules.length === rules.length) {
    return state;
  }
  return { ...state, routingRules: remainingRules };
}
