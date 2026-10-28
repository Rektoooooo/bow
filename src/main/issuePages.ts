/**
 * WHY this file exists:
 *   A live folder of your Jira or Linear issues, through your own sign-in: open the list you care about (a Jira
 *   filter, Linear's My Issues) and choose New Live Folder › Issues from This Page. Bow then reads that page now and
 *   then in a hidden window of the same profile and keeps the folder's tabs in step. No token is stored; like the
 *   GitHub lists (gitHubLists.ts), only addresses are trusted: a link whose path is a Jira issue (/browse/ABC-123) or
 *   a Linear issue (/<workspace>/issue/ABC-123) is an item, named by the longest text of its links.
 *
 * Data source:
 *   The links of the rendered page (renderedLinks.ts), untrusted: only same-origin issue addresses and plain text
 *   come out.
 *
 * Data flow:
 *   New Live Folder › Issues from This Page → the tab's links → detectIssueKind() → a "page" live folder
 *   liveFolderRefresher.ts → readRenderedLinks(page) → pickIssueEntries() → liveFolders.ts
 *
 * Rules: pure.
 */
import type { IssuePageKind } from "../shared/types";
import type { PageLink } from "./gitHubLists";
import type { LiveFolderEntry } from "./liveFolders";
import { toPlainText } from "./markupText";

/** An issue's path, by service: Jira's /browse/KEY-123, Linear's /<workspace>/issue/KEY-123 (and a slug after it). */
const ISSUE_PATH_PATTERNS: Record<IssuePageKind, RegExp> = {
  jira: /^\/browse\/([A-Z][A-Z0-9_]+-[0-9]+)\/?$/,
  linear: /^\/([A-Za-z0-9_-]+)\/issue\/([A-Z0-9]+-[0-9]+)(\/[A-Za-z0-9_-]*)?\/?$/,
};

/** The name each service's folders get when the page has no title. */
export const ISSUE_PAGE_TITLES: Record<IssuePageKind, string> = {
  jira: "Jira Issues",
  linear: "Linear Issues",
};

/**
 * First path segments that mean "sign in first" (Linear's /login, Jira Server's /login.jsp, most sites'). Only the
 * first segment counts: a Jira project keyed AUTH lives at /projects/AUTH/….
 */
const SIGN_IN_PATH_WORDS = ["login", "login.jsp", "signin", "sign-in", "sign_in", "auth"];

/** Link text that is only a number or the issue key itself: never a better title than a sentence. */
const KEY_ONLY_PATTERN = /^[A-Z][A-Z0-9_]*-[0-9]+$/;

/**
 * An issue link's address without anything after the issue (query, hash), and its key; null when it is not one.
 */
function readIssueLink(href: string, pageUrl: string, kind: IssuePageKind): { address: string; key: string } | null {
  let url: URL;
  let page: URL;
  try {
    url = new URL(href, pageUrl);
    page = new URL(pageUrl);
  } catch {
    return null;
  }
  const match = ISSUE_PATH_PATTERNS[kind].exec(url.pathname);
  if (url.origin !== page.origin || match === null) {
    return null;
  }
  const key = kind === "jira" ? (match[1] as string) : (match[2] as string);
  return { address: url.origin + url.pathname, key: key };
}

/**
 * Which service's issues a page lists: the one with more issue links. Null when it lists none.
 * Example: a page with links to /browse/WEB-1 and /browse/WEB-2 → "jira"
 */
export function detectIssueKind(links: PageLink[], pageUrl: string): IssuePageKind | null {
  const counts: Record<IssuePageKind, number> = { jira: 0, linear: 0 };
  for (const link of links) {
    for (const kind of ["jira", "linear"] as const) {
      if (readIssueLink(link.href, pageUrl, kind) !== null) {
        counts[kind] += 1;
      }
    }
  }
  if (counts.jira === 0 && counts.linear === 0) {
    return null;
  }
  return counts.jira >= counts.linear ? "jira" : "linear";
}

/**
 * The issues a page lists, in page order, one entry per issue, named by the longest text of its links (the key,
 * "WEB-12", when no link has more).
 */
export function pickIssueEntries(links: PageLink[], kind: IssuePageKind, pageUrl: string): LiveFolderEntry[] {
  const titlesByAddress = new Map<string, { key: string; title: string }>();
  for (const link of links) {
    const issue = readIssueLink(link.href, pageUrl, kind);
    if (issue === null) {
      continue;
    }
    const text = toPlainText(link.text);
    const usableText = KEY_ONLY_PATTERN.test(text) ? "" : text;
    const known = titlesByAddress.get(issue.address);
    const knownTitle = known?.title ?? "";
    titlesByAddress.set(issue.address, { key: issue.key, title: usableText.length > knownTitle.length ? usableText : knownTitle });
  }
  const entries: LiveFolderEntry[] = [];
  for (const [address, named] of titlesByAddress) {
    entries.push({ url: address, title: nameIssue(named.key, named.title) });
  }
  return entries;
}

/**
 * An issue's tab name: "WEB-12 Fix the login page" (its text already starting with the key keeps it as it is).
 */
function nameIssue(key: string, title: string): string {
  if (title === "") {
    return key;
  }
  return title.startsWith(key) ? title : `${key} ${title}`;
}

/**
 * Whether reading the list ended at a request to sign in first: the page tried to go to another site (Atlassian's
 * sign-in lives elsewhere; the hidden window keeps it from leaving) or landed on a sign-in path of its own site.
 */
export function needsSignIn(page: { pageUrl: string; leftFor?: string | null }, listUrl: string): boolean {
  const triedToLeave = page.leftFor !== undefined && page.leftFor !== null;
  return triedToLeave || isIssueSignInPage(page.pageUrl, listUrl);
}

/**
 * Whether a page is a sign-in page for a list: on another site, or a sign-in path on the same site. The list's own
 * page never is, whatever its path says.
 * Example: ("https://id.atlassian.com/login?…", "https://acme.atlassian.net/issues/?filter=1") → true
 */
export function isIssueSignInPage(renderedUrl: string, listUrl: string): boolean {
  let rendered: URL;
  let list: URL;
  try {
    rendered = new URL(renderedUrl);
    list = new URL(listUrl);
  } catch {
    return false;
  }
  if (rendered.host !== list.host) {
    return true;
  }
  if (rendered.pathname === list.pathname) {
    return false;
  }
  const firstSegment = rendered.pathname.split("/")[1] ?? "";
  return SIGN_IN_PATH_WORDS.includes(firstSegment.toLowerCase());
}
