// End-to-end check of live folders against a local server that plays a blog with a feed and a made-up "GitHub"
// (--github-origin points GitHub folders at it), so every source is local (only the sidebar's GitHub icon is fetched):
//   - "Feed from This Page" finds the page's feed and fills the folder; a refresh adds new posts (unread) and drops
//     gone ones; a removed post stays removed until "Show Removed Items"; nothing can be dragged in; a page without
//     a feed says so.
//   - GitHub folders: signed out (no `logged_in=yes` cookie) they ask to sign in; the status line opens the list
//     page, GitHub's redirect lands on its sign-in page; visiting the site once signed in fills the folder. A list
//     in the HTML is read from it; a list drawn by scripts is read from a hidden window, which is closed afterwards.
//     An empty list says so. Deleting a live folder does not fill the Archive.
// usage: npm run build && node e2e/check-live-folders.mjs      (uses a throwaway --user-data-dir)
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

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const send = (status, type, body, headers = {}) => {
    response.writeHead(status, { "content-type": type, ...headers });
    response.end(body);
  };
  const githubList = { "/pulls": PULLS_HTML, "/pulls/review-requested": REVIEW_REQUESTS_HTML, "/issues/assigned": page("Assigned issues", "<p>Nothing assigned</p>") };
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

await sidebar.screenshot({ path: path.join(outDir, "live-folders-sidebar.png") });
const archiveBefore = (await getState()).archive.length;
await dispatch({ type: "deleteItem", itemId: pullsFolder.id });
state = await getState();
check("deleting a live folder removes its tabs without filling the Archive", state.items[pullsFolder.id] === undefined && state.archive.length === archiveBefore);

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
