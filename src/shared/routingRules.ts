/**
 * WHY this file exists:
 *   Air Traffic Control's matching, shared by main (where a link from another app goes) and the Library's "Test a
 *   link" field (where it would go), so both always agree. A rule matches the link's address ("contains" or "is"),
 *   or the app the link came from ("app", by its bundle id: "com.tinyspeck.slackmacgap").
 *
 * Data source:
 *   BrowserState.routingRules, the link, and the app that sent it (main/linkSourceApps.ts), when known.
 *
 * Data flow:
 *   main/littleWindow.ts handleExternalUrl → main/routing.ts findRoutedSpaceId → findMatchingRule
 *   overlay/library.ts "Test a link" → findMatchingRule → "Opens in ✦ Work"
 *
 * Rules: pure. The first rule that matches wins, in the order the Library lists them.
 */
import type { RoutingRule, SpaceId } from "./types";

/** An app on this Mac that sent a link: its bundle id (what a rule keeps) and its name (what the Library shows). */
export interface LinkSourceApp {
  bundleId: string;
  name: string;
}

/**
 * True when a link matches a rule. Comparisons ignore letter case; "is" also ignores a trailing slash; "app" needs
 * the sending app to be known.
 * Example: ruleMatches({ matchType: "contains", value: "GitHub.com", … }, "https://github.com/x", null) → true
 */
export function ruleMatches(rule: RoutingRule, url: string, sourceApp: LinkSourceApp | null): boolean {
  const lowerValue = rule.value.trim().toLowerCase();
  if (lowerValue === "") {
    return false;
  }
  if (rule.matchType === "app") {
    return sourceApp !== null && sourceApp.bundleId.toLowerCase() === lowerValue;
  }
  const lowerUrl = url.toLowerCase();
  if (rule.matchType === "contains") {
    return lowerUrl.includes(lowerValue);
  }
  const withoutTrailingSlash = (text: string): string => (text.endsWith("/") ? text.slice(0, -1) : text);
  return withoutTrailingSlash(lowerUrl) === withoutTrailingSlash(lowerValue);
}

/**
 * The first rule that matches a link and names a Space that still exists, or null.
 */
export function findMatchingRule(rules: RoutingRule[], spaceIds: SpaceId[], url: string, sourceApp: LinkSourceApp | null): RoutingRule | null {
  for (const rule of rules) {
    if (ruleMatches(rule, url, sourceApp) && spaceIds.includes(rule.spaceId)) {
      return rule;
    }
  }
  return null;
}
