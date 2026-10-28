/**
 * WHY this file exists:
 *   Arc's Air Traffic Control: rules that send links opened from other apps straight to a Space ("address contains
 *   github.com → Work", "comes from Slack → Work"). Links that match no rule keep opening in a Little Window. These
 *   pure functions add and remove the rules and find a link's Space (the matching is shared/routingRules.ts).
 *
 * Data source:
 *   BrowserState.routingRules, and the address of a link that arrived from another app.
 *
 * Data flow:
 *   link from another app (and its sender) → littleWindow.ts handleExternalUrl() → findRoutedSpaceId() → a Space, or a
 *   Little Window
 *   Library › Settings → actions addRoutingRule / removeRoutingRule → these functions
 */
import { findMatchingRule } from "../shared/routingRules";
import type { LinkSourceApp } from "../shared/routingRules";
import type { BrowserState, RoutingMatchType, RoutingRule, SpaceId } from "../shared/types";
import { createId, findSpace } from "./tree";

/** Most rules kept. Our choice: plenty for real use, and a bound on what a broken message can add. */
export const ROUTING_RULES_LIMIT = 50;

/**
 * Returns the Space the first matching rule names, or null when no rule matches (or its Space was deleted).
 * `sourceApp` is the app the link came from, when known (linkSourceApps.ts).
 */
export function findRoutedSpaceId(state: BrowserState, url: string, sourceApp: LinkSourceApp | null): SpaceId | null {
  const spaceIds = state.spaces.map((space) => space.id);
  const rule = findMatchingRule(state.routingRules ?? [], spaceIds, url, sourceApp);
  return rule === null ? null : rule.spaceId;
}

/**
 * Adds a rule at the end. Returns the same state for an empty value, an unknown Space, or a full list.
 */
export function addRoutingRule(state: BrowserState, matchType: RoutingMatchType, value: string, spaceId: SpaceId, now: number, appName?: string): BrowserState {
  const rules = state.routingRules ?? [];
  const trimmedValue = value.trim();
  if (trimmedValue === "" || findSpace(state, spaceId) === undefined || rules.length >= ROUTING_RULES_LIMIT) {
    return state;
  }
  const rule: RoutingRule = { id: createId("route", now), matchType: matchType, value: trimmedValue, spaceId: spaceId };
  if (matchType === "app" && appName !== undefined) {
    rule.appName = appName.trim();
  }
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
