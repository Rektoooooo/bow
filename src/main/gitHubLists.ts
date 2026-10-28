/**
 * WHY this file exists:
 *   A GitHub live folder shows one of your lists on github.com (your open pull requests, the ones waiting for your
 *   review, the issues assigned to you or opened by you, or your notifications), read the way Arc reads it: the list page itself, with the folder's
 *   profile, whose cookies are your GitHub sign-in. No token is stored and private repositories are included.
 *   GitHub's markup is not stable (Arc's own reader failed with "unexpected page structure"), so this file trusts
 *   only addresses: every link on the page whose path is /<owner>/<repo>/pull/<number> (or /issues/<number>) is an
 *   item, named by the longest text any link to it has (the title link, not the comment count).
 *
 * Data source:
 *   The links of a list page: from its HTML (findHtmlLinks) or from the rendered page (liveFolderRefresher.ts).
 *   Untrusted: only same-origin item addresses and plain text come out.
 *
 * Data flow:
 *   liveFolderRefresher.ts → getGitHubListUrl() → the page's links → pickGitHubEntries() → liveFolders.ts
 */
import type { GitHubLiveList } from "../shared/types";
import type { LiveFolderEntry } from "./liveFolders";
import { decodeEntities, toPlainText } from "./markupText";

/** One link on a page: its address (maybe relative) and its text (maybe markup). */
export interface PageLink {
  href: string;
  text: string;
}

/** Where GitHub lives. Tests point live folders at a local server instead (liveFolderRefresher.ts). */
export const GITHUB_ORIGIN = "https://github.com";

/** Every GitHub list a live folder can show, for checking a list name from a message or a file. */
export const GITHUB_LIVE_LISTS: GitHubLiveList[] = ["pullRequests", "reviewRequests", "assignedIssues", "createdIssues", "notifications"];

/** The page of each list, under the GitHub origin. */
const LIST_PATHS: Record<GitHubLiveList, string> = {
  pullRequests: "/pulls",
  reviewRequests: "/pulls/review-requested",
  assignedIssues: "/issues/assigned",
  createdIssues: "/issues/created",
  notifications: "/notifications",
};

/** The name a new folder of each list gets. */
export const GITHUB_LIST_TITLES: Record<GitHubLiveList, string> = {
  pullRequests: "Pull Requests",
  reviewRequests: "Review Requests",
  assignedIssues: "Assigned Issues",
  createdIssues: "Your Issues",
  notifications: "Notifications",
};

/** The path segments of the items each list holds (notifications are about pull requests and issues alike). */
const ITEM_SEGMENTS: Record<GitHubLiveList, string[]> = {
  pullRequests: ["pull"],
  reviewRequests: ["pull"],
  assignedIssues: ["issues"],
  createdIssues: ["issues"],
  notifications: ["pull", "issues"],
};

/** An item's path: owner (letters, digits, dashes), repository (also dots and underscores), kind, number. */
const ITEM_PATH_PATTERN = /^\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/(pull|issues)\/[0-9]+$/;

/** Where GitHub sends you when you are not signed in. */
const SIGN_IN_PATHS = ["/login", "/session", "/sessions"];

/** An `<a …>…</a>` element of a page's HTML. */
const ANCHOR_PATTERN = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;

/** The `href` of an anchor's attributes. */
const HREF_PATTERN = /\shref\s*=\s*("([^"]*)"|'([^']*)')/i;

/** Link text that is only a number ("3" comments, "#12"): never a title. */
const NUMBER_ONLY_PATTERN = /^#?[0-9]+$/;

/**
 * The list page's address.
 * Example: getGitHubListUrl("reviewRequests") → "https://github.com/pulls/review-requested"
 */
export function getGitHubListUrl(list: GitHubLiveList, origin: string = GITHUB_ORIGIN): string {
  return origin + LIST_PATHS[list];
}

/**
 * True when a page is GitHub's sign-in page: the list redirected there because the profile is not signed in.
 * Example: isGitHubSignInPage("https://github.com/login?return_to=%2Fpulls") → true
 */
export function isGitHubSignInPage(pageUrl: string, origin: string = GITHUB_ORIGIN): boolean {
  try {
    const url = new URL(pageUrl);
    const isGitHub = url.origin === new URL(origin).origin;
    const isSignInPath = SIGN_IN_PATHS.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`));
    return isGitHub && isSignInPath;
  } catch {
    return false;
  }
}

/**
 * Every link in a page's HTML, with its text as written.
 */
export function findHtmlLinks(html: string): PageLink[] {
  const links: PageLink[] = [];
  for (const match of html.matchAll(ANCHOR_PATTERN)) {
    const hrefMatch = HREF_PATTERN.exec(match[1] ?? "");
    if (hrefMatch === null) {
      continue;
    }
    const href = decodeEntities(hrefMatch[2] ?? hrefMatch[3] ?? "");
    links.push({ href: href, text: match[2] ?? "" });
  }
  return links;
}

/**
 * The items of a list page, in page order: same-origin links to pull requests (or issues), one entry per item,
 * named by the longest text of its links. An item none of whose links has text is named "owner/repo#number".
 */
export function pickGitHubEntries(links: PageLink[], list: GitHubLiveList, pageUrl: string): LiveFolderEntry[] {
  let pageOrigin: string;
  try {
    pageOrigin = new URL(pageUrl).origin;
  } catch {
    return [];
  }
  const wantedSegments = ITEM_SEGMENTS[list];
  const titlesByAddress = new Map<string, string>();
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link.href, pageUrl);
    } catch {
      continue;
    }
    if (url.origin !== pageOrigin || !ITEM_PATH_PATTERN.test(url.pathname)) {
      continue;
    }
    const segment = url.pathname.split("/")[3] ?? "";
    if (!wantedSegments.includes(segment)) {
      continue;
    }
    const address = pageOrigin + url.pathname;
    const text = toPlainText(link.text);
    const usableText = NUMBER_ONLY_PATTERN.test(text) ? "" : text;
    const knownTitle = titlesByAddress.get(address) ?? "";
    titlesByAddress.set(address, usableText.length > knownTitle.length ? usableText : knownTitle);
  }

  const entries: LiveFolderEntry[] = [];
  for (const [address, title] of titlesByAddress) {
    const pathParts = new URL(address).pathname.split("/");
    const fallbackTitle = `${pathParts[1]}/${pathParts[2]}#${pathParts[4]}`;
    entries.push({ url: address, title: title === "" ? fallbackTitle : title });
  }
  return entries;
}
