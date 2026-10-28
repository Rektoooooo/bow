/**
 * WHY this file exists:
 *   GitHub live folders read github.com's list pages by their links only. These made-up pages check that only the
 *   right items come out, named by their title link, whatever else the page links to.
 */
import { describe, expect, it } from "vitest";
import { findHtmlLinks, getGitHubListUrl, isGitHubSignInPage, pickGitHubEntries } from "../src/main/gitHubLists";

const LIST_URL = "https://github.com/pulls";

describe("GitHub lists", () => {
  it("know each list's page", () => {
    expect(getGitHubListUrl("pullRequests")).toBe("https://github.com/pulls");
    expect(getGitHubListUrl("reviewRequests")).toBe("https://github.com/pulls/review-requested");
    expect(getGitHubListUrl("assignedIssues", "http://127.0.0.1:4000")).toBe("http://127.0.0.1:4000/issues/assigned");
    expect(getGitHubListUrl("createdIssues")).toBe("https://github.com/issues/created");
    expect(getGitHubListUrl("notifications")).toBe("https://github.com/notifications");
  });

  it("recognize the sign-in page GitHub redirects to", () => {
    expect(isGitHubSignInPage("https://github.com/login?return_to=%2Fpulls")).toBe(true);
    expect(isGitHubSignInPage("https://github.com/sessions/two-factor")).toBe(true);
    expect(isGitHubSignInPage("https://github.com/pulls")).toBe(false);
    expect(isGitHubSignInPage("https://elsewhere.example/login")).toBe(false);
    expect(isGitHubSignInPage("not a url")).toBe(false);
  });

  it("take each pull request once, named by its longest link text, in page order", () => {
    const html = `
      <div class="row">
        <a href="/octo-org/sample-app" class="muted">octo-org/sample-app</a>
        <a href="/octo-org/sample-app/pull/12" class="title">Add the &amp; sign to titles</a>
        <a href="/octo-org/sample-app/pull/12#issuecomment-1"><span>3</span></a>
      </div>
      <div class="row">
        <a href='https://github.com/example-user/tools.js/pull/7'>
          <span>Fix</span> <em>flaky</em> test
        </a>
      </div>
      <div class="row"><a href="/octo-org/sample-app/pull/13?w=1">#13</a></div>
      <a href="/octo-org/sample-app/issues/4">An issue, not a pull request</a>
      <a href="https://gitlab.example/octo-org/sample-app/pull/99">Elsewhere</a>
      <a href="/octo-org/sample-app/pull/12/files">Files</a>
      <a>No address</a>`;
    const entries = pickGitHubEntries(findHtmlLinks(html), "pullRequests", LIST_URL);
    expect(entries).toEqual([
      { url: "https://github.com/octo-org/sample-app/pull/12", title: "Add the & sign to titles" },
      { url: "https://github.com/example-user/tools.js/pull/7", title: "Fix flaky test" },
      { url: "https://github.com/octo-org/sample-app/pull/13", title: "octo-org/sample-app#13" },
    ]);
  });

  it("take issues for the assigned-issues list", () => {
    const links = [
      { href: "https://github.com/octo-org/sample-app/issues/4", text: "Crash on start" },
      { href: "https://github.com/octo-org/sample-app/pull/12", text: "A pull request" },
    ];
    expect(pickGitHubEntries(links, "assignedIssues", "https://github.com/issues/assigned")).toEqual([
      { url: "https://github.com/octo-org/sample-app/issues/4", title: "Crash on start" },
    ]);
  });

  it("take pull requests and issues for notifications, but not the notification settings", () => {
    const links = [
      { href: "https://github.com/octo-org/sample-app/pull/12", text: "Add the & sign to titles" },
      { href: "https://github.com/octo-org/sample-app/issues/4", text: "Crash on start" },
      { href: "https://github.com/settings/notifications", text: "Settings" },
      { href: "https://github.com/octo-org/sample-app", text: "octo-org/sample-app" },
    ];
    expect(pickGitHubEntries(links, "notifications", "https://github.com/notifications")).toEqual([
      { url: "https://github.com/octo-org/sample-app/pull/12", title: "Add the & sign to titles" },
      { url: "https://github.com/octo-org/sample-app/issues/4", title: "Crash on start" },
    ]);
    expect(pickGitHubEntries(links, "createdIssues", "https://github.com/issues/created")).toEqual([
      { url: "https://github.com/octo-org/sample-app/issues/4", title: "Crash on start" },
    ]);
  });
});
