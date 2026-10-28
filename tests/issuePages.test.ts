/**
 * WHY this file exists:
 *   Jira and Linear live folders trust only the addresses of a list page's links. These made-up pages check which
 *   service a page lists, that each issue comes out once with a readable name, and when a list needs a sign-in first.
 */
import { describe, expect, it } from "vitest";
import { detectIssueKind, isIssueSignInPage, needsSignIn, pickIssueEntries } from "../src/main/issuePages";

const JIRA_LIST = "https://acme.atlassian.example/issues/?filter=10001";
const LINEAR_LIST = "https://linear.example/acme/my-issues/assigned";

describe("issue pages", () => {
  it("tell which service a page lists by its issue links", () => {
    const jiraLinks = [
      { href: "/browse/WEB-1", text: "WEB-1" },
      { href: "https://acme.atlassian.example/browse/WEB-2", text: "Fix the login page" },
      { href: "/jira/your-work", text: "Your work" },
    ];
    const linearLinks = [{ href: "/acme/issue/ENG-12/fix-the-sync", text: "Fix the sync" }];
    expect(detectIssueKind(jiraLinks, JIRA_LIST)).toBe("jira");
    expect(detectIssueKind(linearLinks, LINEAR_LIST)).toBe("linear");
    expect(detectIssueKind([{ href: "/about", text: "About" }], JIRA_LIST)).toBeNull();
  });

  it("ignore issue links to another site", () => {
    const links = [{ href: "https://other.atlassian.example/browse/WEB-1", text: "Elsewhere" }];
    expect(detectIssueKind(links, JIRA_LIST)).toBeNull();
    expect(pickIssueEntries(links, "jira", JIRA_LIST)).toEqual([]);
  });

  it("take each Jira issue once, in page order, named by its key and longest text", () => {
    const links = [
      { href: "/browse/WEB-2", text: "WEB-2" },
      { href: "/browse/WEB-2?focusedCommentId=5#comment", text: "Fix the &amp; sign in titles" },
      { href: "/browse/WEB-1", text: "WEB-1" },
      { href: "/browse/WEB-3", text: "WEB-3 Already named" },
      { href: "/browse/web-4", text: "Lowercase is not a key" },
    ];
    expect(pickIssueEntries(links, "jira", JIRA_LIST)).toEqual([
      { url: "https://acme.atlassian.example/browse/WEB-2", title: "WEB-2 Fix the & sign in titles" },
      { url: "https://acme.atlassian.example/browse/WEB-1", title: "WEB-1" },
      { url: "https://acme.atlassian.example/browse/WEB-3", title: "WEB-3 Already named" },
    ]);
  });

  it("take Linear issues with or without the title slug as one issue per address", () => {
    const links = [
      { href: "/acme/issue/ENG-12/fix-the-sync", text: "Fix the sync" },
      { href: "/acme/issue/ENG-13", text: "ENG-13" },
      { href: "/acme/project/sync-1234", text: "A project" },
    ];
    expect(pickIssueEntries(links, "linear", LINEAR_LIST)).toEqual([
      { url: "https://linear.example/acme/issue/ENG-12/fix-the-sync", title: "ENG-12 Fix the sync" },
      { url: "https://linear.example/acme/issue/ENG-13", title: "ENG-13" },
    ]);
  });

  it("know a sign-in page: another site, or a sign-in path of the same site", () => {
    expect(isIssueSignInPage("https://id.atlassian.example/login?continue=x", JIRA_LIST)).toBe(true);
    expect(isIssueSignInPage("https://linear.example/login", LINEAR_LIST)).toBe(true);
    expect(isIssueSignInPage("https://linear.example/acme/my-issues/assigned", LINEAR_LIST)).toBe(false);
    expect(isIssueSignInPage("https://linear.example/acme/issue/ENG-1/login-button", LINEAR_LIST)).toBe(false);
    expect(isIssueSignInPage("not a url", LINEAR_LIST)).toBe(false);
  });

  it("need a sign-in when the page tried to leave for another site or landed on a sign-in page", () => {
    expect(needsSignIn({ pageUrl: JIRA_LIST, leftFor: "https://id.atlassian.example/login" }, JIRA_LIST)).toBe(true);
    expect(needsSignIn({ pageUrl: "https://linear.example/login" }, LINEAR_LIST)).toBe(true);
    expect(needsSignIn({ pageUrl: JIRA_LIST, leftFor: null }, JIRA_LIST)).toBe(false);
  });
});
