// End-to-end check of live folders against a local server that plays a blog with a feed and a made-up "GitHub"
// (--github-origin points GitHub folders at it), so every source is local (only the sidebar's GitHub icon is fetched):
//   - "Feed from This Page" finds the page's feed and fills the folder; a refresh adds new posts (unread) and drops
//     gone ones; a removed post stays removed until "Show Removed Items"; nothing can be dragged in; a page without
//     a feed says so.
//   - GitHub folders: signed out (no `logged_in=yes` cookie) they ask to sign in; the status line opens the list
//     page, GitHub's redirect lands on its sign-in page; visiting the site once signed in fills the folder. A list
//     in the HTML is read from it; a list drawn by scripts is read from a hidden window, which is closed afterwards.
//     An empty list says so. Notifications and the issues you opened are lists too. Deleting a live folder does not
//     fill the Archive.
//   - Issues from This Page: a Jira-like filter (drawn by scripts, behind a sign-in cookie) and a Linear-like list
//     become folders of their issues; signed out, the folder asks to sign in, and visiting the site again refills it;
//     a page without issues says so.
//   - Hacker News and a subreddit: answered by a test-only https handler in the profile's session, so nothing reaches
//     the real sites. An unknown ready-made feed is refused.
// usage: npm run build && node e2e/check-live-folders.mjs      (uses a throwaway --user-data-dir)
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-live-folders");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// ---------- The local server: a blog with a feed, and a made-up GitHub ----------

/** The blog's posts, newest first; the test changes them between refreshes. */
let posts = [
  { id: 1, title: "First post" },
  { id: 2, title: "Second post" },
  { id: 3, title: "Third post" },
];

function rssFeed() {
  const items = posts.map((post) => `<item><title>${post.title}</title><link>/posts/${post.id}</link><guid>post-${post.id}</guid></item>`).join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Example Blog</title><link>/blog</link>${items}</channel></rss>`;
}

const page = (title, body = "") => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
const isSignedIn = (request) => /(^|;\s*)logged_in=yes/.test(request.headers.cookie ?? "");

/** Server-drawn pull requests: a title link, a comment-count link and a repository link per row. */
const PULLS_HTML = page(
  "Pull requests",
  `<div><a href="/octo-org/sample-app">octo-org/sample-app</a> <a href="/octo-org/sample-app/pull/1">Add live folders</a> <a href="/octo-org/sample-app/pull/1#comments">2</a></div>
   <div><a href="/octo-org/sample-app/pull/2">Fix the toolbar tint</a></div>`,
);

/** A list drawn by a script after the page loaded, like GitHub's newer pages: no item links in the HTML. */
const REVIEW_REQUESTS_HTML = page(
  "Review requests",
  `<div id="list">Loading…</div><script>setTimeout(() => {
     document.getElementById("list").innerHTML = '<a href="/octo-org/docs/pull/7">Review the docs</a>';
   }, 400);</script>`,
);

/** GitHub's notifications: pull requests and issues, among links to its settings. Their addresses are in no other
 * folder (a live folder skips addresses open elsewhere). */
const NOTIFICATIONS_HTML = page(
  "Notifications",
  `<a href="/octo-org/sample-app/pull/3">Bump the version</a> <a href="/octo-org/sample-app/issues/5">Crash on start</a> <a href="/settings/notifications">Settings</a>`,
);

/** The issues of a made-up Jira filter; the test adds one while the user is signed out. */
let jiraIssues = [
  { key: "WEB-1", title: "Fix the login page" },
  { key: "WEB-2", title: "Speed up search" },
];
const hasJiraSession = (request) => /(^|;\s*)jira_session=yes/.test(request.headers.cookie ?? "");

/** A Jira-like filter drawn by a script: each issue has a key link and a title link to the same address. */
function jiraFilterHtml() {
  const rows = jiraIssues.map((issue) => `<div><a href="/browse/${issue.key}">${issue.key}</a> <a href="/browse/${issue.key}">${issue.title}</a></div>`).join("");
  return page("Team filter", `<div id="issues">Loading…</div><script>setTimeout(() => { document.getElementById("issues").innerHTML = ${JSON.stringify(rows)}; }, 400);</script>`);
}

/** A Linear-like list: an issue (with its title slug) and a project. */
const LINEAR_HTML = page("My issues", `<a href="/acme/issue/ENG-7/fix-the-sync">Fix the sync</a> <a href="/acme/project/sync-1">A project</a>`);

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const send = (status, type, body, headers = {}) => {
    response.writeHead(status, { "content-type": type, ...headers });
    response.end(body);
  };
  const githubList = {
    "/pulls": PULLS_HTML,
    "/pulls/review-requested": REVIEW_REQUESTS_HTML,
    "/issues/assigned": page("Assigned issues", "<p>Nothing assigned</p>"),
    "/issues/created": page("Your issues", `<a href="/octo-org/sample-app/issues/6">Dark mode flickers</a>`),
    "/notifications": NOTIFICATIONS_HTML,
  };
  if (url.pathname in githubList) {
    if (!isSignedIn(request)) {
      send(302, "text/html", "", { location: `/login?return_to=${encodeURIComponent(url.pathname)}` });
      return;
    }
    send(200, "text/html", githubList[url.pathname]);
    return;
  }
  if (url.pathname === "/blog") {
    send(200, "text/html", page("Example Blog Home", "<h1>Blog</h1>").replace("</head>", '<link rel="alternate" type="application/rss+xml" title="Example Blog" href="/feed.xml"></head>'));
    return;
  }
  if (url.pathname === "/feed.xml") {
    send(200, "application/rss+xml", rssFeed());
    return;
  }
  if (url.pathname === "/jira/filter") {
    if (!hasJiraSession(request)) {
      send(302, "text/html", "", { location: `/login?next=${encodeURIComponent(url.pathname)}` });
      return;
    }
    send(200, "text/html", jiraFilterHtml());
    return;
  }
  if (url.pathname === "/jira-sign-in") {
    send(200, "text/html", page("Jira", "<p>Signed in to Jira</p>"), { "set-cookie": "jira_session=yes; Path=/" });
    return;
  }
  if (url.pathname === "/jira-sign-out") {
    send(200, "text/html", page("Jira", "<p>Signed out of Jira</p>"), { "set-cookie": "jira_session=; Path=/; Max-Age=0" });
    return;
  }
  if (url.pathname === "/acme/my-issues") {
    send(200, "text/html", LINEAR_HTML);
    return;
  }
  if (url.pathname === "/sign-in") {
    send(200, "text/html", page("Signed in", "<p>Welcome back</p>"), { "set-cookie": "logged_in=yes; Path=/" });
    return;
  }
  send(200, "text/html", page(url.pathname, `<p>${url.pathname}</p>`));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// ---------- The app ----------

const now = Date.now();
const tab = (id, url, title) => ({ kind: "tab", id, url, title, customTitle: null, faviconUrl: null, homeUrl: null, lastActiveAt: now, isMuted: false });
fs.writeFileSync(
  path.join(userDataDir, "browser-state.json"),
  JSON.stringify({
    version: 2,
    items: { "tab-blog": tab("tab-blog", `${origin}/blog`, "Example Blog Home"), "tab-plain": tab("tab-plain", `${origin}/plain`, "Plain") },
    profiles: [{ id: "profile-default", name: "Default", favoriteIds: [] }],
    spaces: [{ id: "space-a", name: "Main", icon: "✦", theme: { colors: ["#000000"], appearance: "dark", grain: 0 }, profileId: "profile-default", pinnedIds: [], todayIds: ["tab-blog", "tab-plain"], isPinnedOpen: true }],
    activeSpaceId: "space-a",
    selectedTabIdBySpace: { "space-a": "tab-blog" },
    archive: [],
    settings: { archiveAfterMs: 43200000, isSidebarVisible: true },
  }),
);

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", `--github-origin=${origin}`, appDir],
  timeout: 30000,
});
const mainLog = [];
app.process().stderr.on("data", (data) => mainLog.push(data.toString()));
let sidebar;
while (!sidebar) {
  sidebar = app.windows().find((candidate) => candidate.url().endsWith("/renderer/index.html"));
  if (!sidebar) await new Promise((resolve) => setTimeout(resolve, 150));
}
await sidebar.emulateMedia({ reducedMotion: "reduce" });
await sidebar.waitForSelector(".space-title");

const dispatch = (action) => sidebar.evaluate((value) => window.browserApi.dispatch(value), action);
const getState = () => sidebar.evaluate(() => window.browserApi.getState());
const liveFolders = (state) => Object.values(state.items).filter((item) => item.kind === "folder" && item.live);
const childTitles = (state, folder) => folder.childIds.map((childId) => state.items[childId].title);

/** Polls until a condition on the state holds; returns the last state either way. */
async function waitForState(condition, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let state = await getState();
  while (!condition(state) && Date.now() < deadline) {
    await sidebar.waitForTimeout(200);
    state = await getState();
  }
  return state;
}

/** The texts of a folder's rows (its own row first), as the sidebar shows them. */
const folderRowTexts = (folderId) =>
  sidebar.evaluate((id) => {
    const rows = Array.from(document.querySelectorAll(`[data-key$=":${id}"], [data-key^="live-status:${id}"]`));
    return rows.map((row) => row.textContent.trim());
  }, folderId);

/** The text of a live folder's status line, or null. */
const statusLine = (folderId) =>
  sidebar.evaluate((id) => document.querySelector(`[data-row="live-status"][data-item-id="${id}"]`)?.textContent.trim() ?? null, folderId);

async function waitForStatusLine(folderId, expected, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let text = await statusLine(folderId);
  while (text !== expected && Date.now() < deadline) {
    await sidebar.waitForTimeout(200);
    text = await statusLine(folderId);
  }
  return text;
}

// Let the blog page load, so "Feed from This Page" can read its links.
await sidebar.waitForTimeout(1500);

// ---------- A feed ----------

await dispatch({ type: "createFeedLiveFolder" });
let state = await waitForState((current) => liveFolders(current).some((folder) => folder.childIds.length === 3));
const feedFolder = liveFolders(state)[0];
check("Feed from This Page makes a live folder named like the site's feed", feedFolder?.title === "Example Blog" && feedFolder.live.source.url === `${origin}/feed.xml`, JSON.stringify(feedFolder?.live));
check("and fills it with the feed's posts, in order", JSON.stringify(childTitles(state, feedFolder)) === JSON.stringify(["First post", "Second post", "Third post"]), childTitles(state, feedFolder).join(", "));
const firstFillDots = await sidebar.evaluate((id) => document.querySelectorAll(`[data-key*="folder:${id}"] .unread-dot`).length, feedFolder.id);
const feedRows = await sidebar.locator(".row-title", { hasText: "Second post" }).count();
check("the posts show as rows, none marked new on the first fill", feedRows === 1 && firstFillDots === 0 && !state.items[feedFolder.childIds[0]].isUnread);

posts = [{ id: 4, title: "Fourth post" }, posts[0], posts[1]];
await dispatch({ type: "refreshLiveFolder", folderId: feedFolder.id });
state = await waitForState((current) => childTitles(current, current.items[feedFolder.id])[0] === "Fourth post");
const refreshedTitles = childTitles(state, state.items[feedFolder.id]);
check("a refresh adds the new post on top and drops the one that left the feed", JSON.stringify(refreshedTitles) === JSON.stringify(["Fourth post", "First post", "Second post"]), refreshedTitles.join(", "));
const fourthTab = state.items[state.items[feedFolder.id].childIds[0]];
await sidebar.waitForTimeout(300);
const badge = await sidebar.evaluate(() => document.querySelector(".folder-row.is-live .live-unread-count")?.textContent ?? null);
check("the new post is unread, and the folder counts it", fourthTab.isUnread === true && badge === "1", `badge ${badge}`);

const firstPostTabId = state.items[feedFolder.id].childIds[1];
await dispatch({ type: "deleteItem", itemId: firstPostTabId });
await dispatch({ type: "refreshLiveFolder", folderId: feedFolder.id });
await sidebar.waitForTimeout(1500);
state = await getState();
check(
  "a removed post stays removed after a refresh",
  !childTitles(state, state.items[feedFolder.id]).includes("First post") && state.items[feedFolder.id].live.hiddenUrls.includes(`${origin}/posts/1`),
  childTitles(state, state.items[feedFolder.id]).join(", "),
);
await dispatch({ type: "showHiddenLiveFolderItems", folderId: feedFolder.id });
state = await waitForState((current) => childTitles(current, current.items[feedFolder.id]).includes("First post"));
check("Show Removed Items brings it back", childTitles(state, state.items[feedFolder.id]).includes("First post") && state.items[feedFolder.id].live.hiddenUrls.length === 0);

const beforeDrag = await getState();
await dispatch({ type: "moveItem", itemId: "tab-plain", target: { kind: "folder", folderId: feedFolder.id }, index: 0 });
const afterDrag = await getState();
check("a tab dragged onto a live folder stays where it was", afterDrag.spaces[0].todayIds.includes("tab-plain") && !afterDrag.items[feedFolder.id].childIds.includes("tab-plain") && beforeDrag.items[feedFolder.id].childIds.length === afterDrag.items[feedFolder.id].childIds.length);
const dropInto = await sidebar.evaluate((id) => {
  const folderRow = document.querySelector(`.folder-row[data-key$=":${id}"]`);
  const childRows = Array.from(document.querySelectorAll(`[data-key*="folder:${id}:"]`));
  return { found: folderRow !== null && childRows.length > 0, into: folderRow?.dataset.intoFolderId ?? null, childDrops: childRows.filter((row) => row.dataset.drop !== undefined).length };
}, feedFolder.id);
check("and the sidebar offers neither the folder nor its rows as a drop target", dropInto.found && dropInto.into === null && dropInto.childDrops === 0, JSON.stringify(dropInto));

// A page without a feed: the message box is replaced by a recorder, so the check can read it.
await app.evaluate(({ dialog }) => {
  globalThis.shownMessages = [];
  dialog.showMessageBox = async (...parts) => {
    globalThis.shownMessages.push(parts.at(-1).message);
    return { response: 0, checkboxChecked: false };
  };
});
await dispatch({ type: "selectTab", tabId: "tab-plain" });
await sidebar.waitForTimeout(1500);
const foldersBefore = liveFolders(await getState()).length;
await dispatch({ type: "createFeedLiveFolder" });
await sidebar.waitForTimeout(800);
const messages = await app.evaluate(() => globalThis.shownMessages);
check("Feed from This Page on a page without a feed says so and makes nothing", messages.includes("This page has no feed") && liveFolders(await getState()).length === foldersBefore, messages.join(" | "));

// ---------- GitHub ----------

const windowsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
await dispatch({ type: "createGitHubLiveFolder", list: "pullRequests" });
state = await getState();
const pullsFolder = liveFolders(state).find((folder) => folder.live.source.kind === "github");
check("a GitHub folder is named after its list", pullsFolder?.title === "Pull Requests" && pullsFolder.live.source.list === "pullRequests");
const signInText = await waitForStatusLine(pullsFolder.id, "Sign in to GitHub");
check("signed out, it asks to sign in", signInText === "Sign in to GitHub", String(signInText));

await sidebar.click(`[data-row="live-status"][data-item-id="${pullsFolder.id}"]`);
state = await waitForState((current) => {
  const selected = current.items[current.selectedTabIdBySpace[current.activeSpaceId]];
  return selected !== undefined && selected.url.includes("/login");
});
const signInTab = state.items[state.selectedTabIdBySpace[state.activeSpaceId]];
check("the status line opens the list, which GitHub sends to its sign-in page", signInTab?.url.startsWith(`${origin}/login`), signInTab?.url);

await dispatch({ type: "openTab", typedText: `${origin}/sign-in` });
state = await waitForState((current) => (current.items[pullsFolder.id]?.childIds.length ?? 0) === 2);
check(
  "visiting the site signed in fills the folder from the list's HTML, titled by the title links",
  JSON.stringify(childTitles(state, state.items[pullsFolder.id])) === JSON.stringify(["Add live folders", "Fix the toolbar tint"]),
  childTitles(state, state.items[pullsFolder.id]).join(", "),
);
check("each item opens the pull request itself", state.items[state.items[pullsFolder.id].childIds[0]].homeUrl === `${origin}/octo-org/sample-app/pull/1`);

await dispatch({ type: "createGitHubLiveFolder", list: "reviewRequests" });
state = await waitForState((current) => liveFolders(current).some((folder) => folder.live.source.list === "reviewRequests" && folder.childIds.length === 1), 20000);
const reviewFolder = liveFolders(state).find((folder) => folder.live.source.list === "reviewRequests");
check("a list drawn by scripts is read from the rendered page", JSON.stringify(childTitles(state, reviewFolder)) === JSON.stringify(["Review the docs"]), childTitles(state, reviewFolder).join(", "));
await sidebar.waitForTimeout(300);
const windowsAfter = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
check("and the hidden window is gone afterwards", windowsAfter === windowsBefore, `${windowsBefore} → ${windowsAfter}`);

await dispatch({ type: "createGitHubLiveFolder", list: "assignedIssues" });
state = await getState();
const issuesFolder = liveFolders(state).find((folder) => folder.live.source.list === "assignedIssues");
const emptyText = await waitForStatusLine(issuesFolder.id, "No issues assigned to you", 30000);
check("an empty list says so", emptyText === "No issues assigned to you", String(emptyText));

await dispatch({ type: "createGitHubLiveFolder", list: "notifications" });
state = await waitForState((current) => liveFolders(current).some((folder) => folder.live.source.list === "notifications" && folder.childIds.length === 2), 20000);
const notificationsFolder = liveFolders(state).find((folder) => folder.live.source.list === "notifications");
check(
  "a notifications folder takes the pull requests and issues, not the settings link",
  notificationsFolder?.title === "Notifications" && JSON.stringify(childTitles(state, notificationsFolder)) === JSON.stringify(["Bump the version", "Crash on start"]),
  `${notificationsFolder?.title}: ${notificationsFolder ? childTitles(state, notificationsFolder).join(", ") : "none"}`,
);
await dispatch({ type: "createGitHubLiveFolder", list: "createdIssues" });
state = await waitForState((current) => liveFolders(current).some((folder) => folder.live.source.list === "createdIssues" && folder.childIds.length === 1), 20000);
const createdFolder = liveFolders(state).find((folder) => folder.live.source.list === "createdIssues");
check("an issues-you-opened folder takes your issues", createdFolder !== undefined && JSON.stringify(childTitles(state, createdFolder)) === JSON.stringify(["Dark mode flickers"]), createdFolder ? childTitles(state, createdFolder).join(", ") : "none");

// ---------- Issues from This Page ----------

const issueFolders = (current) => liveFolders(current).filter((folder) => folder.live.source.kind === "issues");
await dispatch({ type: "openTab", typedText: `${origin}/jira-sign-in` });
await sidebar.waitForTimeout(800);
await dispatch({ type: "openTab", typedText: `${origin}/jira/filter` });
await sidebar.waitForTimeout(1500);
await dispatch({ type: "createIssuesLiveFolder" });
state = await waitForState((current) => issueFolders(current).some((folder) => folder.childIds.length === 2), 20000);
const jiraFolder = issueFolders(state)[0];
check(
  "Issues from This Page on a Jira filter makes a folder of its issues, named by key and title",
  jiraFolder?.title === "Team filter" && jiraFolder.live.source.issueKind === "jira" && jiraFolder.live.source.url === `${origin}/jira/filter` &&
    JSON.stringify(childTitles(state, jiraFolder)) === JSON.stringify(["WEB-1 Fix the login page", "WEB-2 Speed up search"]),
  jiraFolder ? `${jiraFolder.title} ${JSON.stringify(jiraFolder.live.source)}: ${childTitles(state, jiraFolder).join(", ")}` : "none",
);
check("each issue opens the issue itself", jiraFolder !== undefined && state.items[jiraFolder.childIds[0]].homeUrl === `${origin}/browse/WEB-1`);

await dispatch({ type: "openTab", typedText: `${origin}/jira-sign-out` });
await sidebar.waitForTimeout(800);
jiraIssues = [{ key: "WEB-3", title: "Write the docs" }, ...jiraIssues];
await dispatch({ type: "refreshLiveFolder", folderId: jiraFolder.id });
const jiraSignInText = await waitForStatusLine(jiraFolder.id, "Sign in to see these issues", 20000);
check("signed out, the issues folder asks to sign in and keeps its issues", jiraSignInText === "Sign in to see these issues" && (await getState()).items[jiraFolder.id].childIds.length === 2, String(jiraSignInText));
// Another address than the first visit: opening an address already open switches to its tab, loading nothing.
await dispatch({ type: "openTab", typedText: `${origin}/jira-sign-in?visit=2` });
state = await waitForState((current) => (current.items[jiraFolder.id]?.childIds.length ?? 0) === 3, 20000);
check("visiting the site signed in refills it", childTitles(state, state.items[jiraFolder.id])[0] === "WEB-3 Write the docs", childTitles(state, state.items[jiraFolder.id]).join(", "));

await dispatch({ type: "openTab", typedText: `${origin}/acme/my-issues` });
await sidebar.waitForTimeout(1500);
await dispatch({ type: "createIssuesLiveFolder" });
state = await waitForState((current) => issueFolders(current).some((folder) => folder.live.source.issueKind === "linear" && folder.childIds.length === 1), 20000);
const linearFolder = issueFolders(state).find((folder) => folder.live.source.issueKind === "linear");
check("Issues from This Page on a Linear list takes its issues, not its projects", linearFolder !== undefined && JSON.stringify(childTitles(state, linearFolder)) === JSON.stringify(["ENG-7 Fix the sync"]), linearFolder ? childTitles(state, linearFolder).join(", ") : "none");

await dispatch({ type: "selectTab", tabId: "tab-plain" });
await sidebar.waitForTimeout(800);
const issueFoldersBefore = issueFolders(await getState()).length;
await dispatch({ type: "createIssuesLiveFolder" });
await sidebar.waitForTimeout(800);
const issueMessages = await app.evaluate(() => globalThis.shownMessages);
check("Issues from This Page on a page without issues says so and makes nothing", issueMessages.includes("This page lists no issues") && issueFolders(await getState()).length === issueFoldersBefore, issueMessages.join(" | "));

// ---------- Ready-made feeds: Hacker News and a subreddit, answered locally ----------

await app.evaluate(({ session, net }) => {
  const fakeFeed = (title) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><item><title>${title} story</title><link>https://example.com/${encodeURIComponent(title)}</link></item></channel></rss>`;
  session.fromPartition("persist:profile-default").protocol.handle("https", (request) => {
    const url = new URL(request.url);
    if (url.hostname === "news.ycombinator.com") {
      return new Response(fakeFeed("Hacker News"), { headers: { "content-type": "application/rss+xml" } });
    }
    if (url.hostname === "www.reddit.com" && url.pathname.endsWith("/.rss")) {
      return new Response(fakeFeed("Reddit"), { headers: { "content-type": "application/rss+xml" } });
    }
    if (url.hostname === "www.reddit.com") {
      return new Response("<!doctype html><title>A subreddit</title><p>No feed link here</p>", { headers: { "content-type": "text/html" } });
    }
    return net.fetch(request, { bypassCustomProtocolHandlers: true });
  });
});
await dispatch({ type: "createPresetFeedLiveFolder", preset: "hackerNews" });
state = await waitForState((current) => liveFolders(current).some((folder) => folder.title === "Hacker News" && folder.childIds.length === 1), 20000);
const hackerNewsFolder = liveFolders(state).find((folder) => folder.title === "Hacker News");
check("New Live Folder › Hacker News reads its front page feed", hackerNewsFolder?.live.source.url === "https://news.ycombinator.com/rss" && childTitles(state, hackerNewsFolder)[0] === "Hacker News story", JSON.stringify(hackerNewsFolder?.live.source));

await dispatch({ type: "openTab", typedText: "https://www.reddit.com/r/bowtesting/top/" });
await sidebar.waitForTimeout(1500);
await dispatch({ type: "createFeedLiveFolder" });
state = await waitForState((current) => liveFolders(current).some((folder) => folder.title === "r/bowtesting" && folder.childIds.length === 1), 20000);
const subredditFolder = liveFolders(state).find((folder) => folder.title === "r/bowtesting");
check("Feed from This Page on a subreddit uses its feed, though the page names none", subredditFolder?.live.source.url === "https://www.reddit.com/r/bowtesting/.rss", JSON.stringify(subredditFolder?.live.source));

const foldersBeforeUnknown = liveFolders(await getState()).length;
await dispatch({ type: "createPresetFeedLiveFolder", preset: "notAPreset" });
await sidebar.waitForTimeout(500);
check("an unknown ready-made feed is refused", liveFolders(await getState()).length === foldersBeforeUnknown);
await app.evaluate(({ session }) => session.fromPartition("persist:profile-default").protocol.unhandle("https"));

await sidebar.screenshot({ path: path.join(outDir, "live-folders-sidebar.png") });
const archiveBefore = (await getState()).archive.length;
await dispatch({ type: "deleteItem", itemId: pullsFolder.id });
state = await getState();
check("deleting a live folder removes its tabs without filling the Archive", state.items[pullsFolder.id] === undefined && state.archive.length === archiveBefore);

// The state reaches its file within half a second of a change (STATE_SAVE_DELAY_MS).
await new Promise((resolve) => setTimeout(resolve, 1000));
const savedState = JSON.parse(fs.readFileSync(path.join(userDataDir, "browser-state.json"), "utf8"));
const savedFeedFolder = savedState.items[feedFolder.id];
check("the source is saved with the folder; refresh results are not", savedFeedFolder?.live?.source?.kind === "feed" && savedFeedFolder.live.lastFetch === undefined && savedState.liveFolders === undefined);

const errors = mainLog.join("").split("\n").filter((line) => /live folder/i.test(line));
check("no live folder errors in the main process", errors.length === 0, errors.join(" | "));

await app.close();
server.close();
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} live folder checks passed.`);
process.exit(failed === 0 ? 0 : 1);
