/**
 * WHY this file exists:
 *   Live folders refresh themselves: shortly after the start, every LIVE_FOLDER_REFRESH_MS, right after one is made,
 *   on "Refresh Now", and when you visit GitHub while a GitHub folder waits for you to sign in. This file reads each
 *   folder's source with the folder's profile (feeds with a plain request; GitHub lists the way Arc reads them, as
 *   you, with your sign-in cookies) and hands the entries to liveFolders.ts. How the last refresh went is a runtime
 *   fact, shown as the folder's status line.
 *
 * Data source:
 *   Feeds: the feed address, fetched in the profile's session. GitHub: the `logged_in` cookie GitHub sets for the
 *   profile, then the list page: its HTML, or, when GitHub draws the list with scripts (its newer pages do), the
 *   page rendered in a hidden window (renderedLinks.ts).
 *
 * Data flow:
 *   timer / action / visit → refreshLiveFolder(folderId) → one refresh at a time → readSource()
 *   → applyChange(applyLiveFolderEntries) + setLiveFolderStatus() (browserCore.ts) → the sidebar's status line
 */
import { dialog } from "electron";
import type { Session } from "electron";
import { LIVE_FOLDER_FIRST_REFRESH_MS, LIVE_FOLDER_REFRESH_MS } from "../shared/settings";
import type { GitHubLiveList, ItemId } from "../shared/types";
import { applyChange, getLiveFolderStatuses, getState, getWindow, setLiveFolderStatus } from "./browserCore";
import { parseFeed, pickFeedLink } from "./feedParser";
import type { PageFeedLink } from "./feedParser";
import { findHtmlLinks, getGitHubListUrl, GITHUB_LIST_TITLES, GITHUB_ORIGIN, isGitHubSignInPage, pickGitHubEntries } from "./gitHubLists";
import { applyLiveFolderEntries, listLiveFolders } from "./liveFolders";
import type { LiveFolderEntry, LiveFolderTarget } from "./liveFolders";
import { getProfileSession } from "./profiles";
import { readRenderedLinks } from "./renderedLinks";
import { createFolder } from "./state";
import { openLinkInNewTab } from "./tabActions";
import { getFocusedContents } from "./tabViews";

/** What reading a source gave. */
type SourceResult = { state: "ok"; entries: LiveFolderEntry[] } | { state: "signedOut" } | { state: "failed" };

/**
 * Tests point GitHub folders at a local server: `--github-origin=http://127.0.0.1:4000`. Like --skip-welcome, only
 * whoever starts the app can pass it.
 */
const GITHUB_ORIGIN_FLAG = "--github-origin=";

/** The cookie GitHub sets on every visit: "yes" while you are signed in, "no" otherwise. */
const GITHUB_SIGNED_IN_COOKIE = "logged_in";

/** A source that does not answer within this long counts as failed. Our choice. */
const FETCH_TIMEOUT_MS = 20 * 1000;

/** At most this much of a feed or page is read. Our choice: feeds are well below a megabyte. */
const MAX_SOURCE_LENGTH = 5 * 1024 * 1024;

/** HTTP status of a page that does not exist; GitHub also answers it to signed-out visits of github.com/issues. */
const NOT_FOUND_STATUS = 404;

/** The isolated world "Feed from This Page" reads the page's feed links in (renderedLinks.ts uses 1034). */
const FEED_LINKS_WORLD_ID = 1035;

/** Runs in the page on screen: its type and its alternate links. */
const READ_FEED_LINKS_SCRIPT = `(() => ({
  contentType: document.contentType || "",
  links: Array.from(document.querySelectorAll('link[rel~="alternate"][href]')).slice(0, 50).map((link) => ({
    href: link.href, type: link.type || "", title: link.title || "",
  })),
}))()`;

/** Folders that filled once in this run: what arrives later gets the unread dot. */
const filledFolderIds = new Set<ItemId>();

/** Folders waiting for their refresh, in order; one refresh runs at a time. */
const waitingFolderIds: ItemId[] = [];
let isRefreshing = false;

/**
 * The GitHub origin: github.com, or the test server given on the command line.
 */
function getGitHubOrigin(): string {
  const flag = process.argv.find((argument) => argument.startsWith(GITHUB_ORIGIN_FLAG));
  if (flag === undefined) {
    return GITHUB_ORIGIN;
  }
  const value = flag.slice(GITHUB_ORIGIN_FLAG.length);
  if (!URL.canParse(value)) {
    return GITHUB_ORIGIN;
  }
  const url = new URL(value);
  return url.protocol === "http:" || url.protocol === "https:" ? url.origin : GITHUB_ORIGIN;
}

/**
 * Fetches a source's text with the profile's cookies. Returns null when it cannot be read.
 */
async function fetchText(url: string, profileSession: Session): Promise<{ status: number; text: string } | null> {
  try {
    const response = await profileSession.fetch(url, { credentials: "include", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const text = await response.text();
    return { status: response.status, text: text.slice(0, MAX_SOURCE_LENGTH) };
  } catch {
    return null;
  }
}

/**
 * Reads a feed's newest posts.
 */
async function readFeed(feedUrl: string, profileSession: Session): Promise<SourceResult> {
  const response = await fetchText(feedUrl, profileSession);
  if (response === null || response.status >= 400) {
    return { state: "failed" };
  }
  const feed = parseFeed(response.text, feedUrl);
  return feed === null ? { state: "failed" } : { state: "ok", entries: feed.entries };
}

/**
 * True while the profile is signed in to GitHub, by the cookie GitHub keeps for it.
 */
async function isSignedInToGitHub(profileSession: Session, origin: string): Promise<boolean> {
  const cookies = await profileSession.cookies.get({ url: origin, name: GITHUB_SIGNED_IN_COOKIE });
  return cookies.some((cookie) => cookie.value === "yes");
}

/**
 * Reads one of the signed-in user's GitHub lists: from the page's HTML when the items are in it, otherwise from the
 * page rendered in a hidden window. A sign-in that expired shows as the rendered page ending on GitHub's sign-in page.
 */
async function readGitHubList(list: GitHubLiveList, profileSession: Session): Promise<SourceResult> {
  const origin = getGitHubOrigin();
  if (!(await isSignedInToGitHub(profileSession, origin))) {
    return { state: "signedOut" };
  }
  const listUrl = getGitHubListUrl(list, origin);
  const response = await fetchText(listUrl, profileSession);
  if (response === null || response.status >= 400) {
    return { state: "failed" };
  }
  const htmlEntries = pickGitHubEntries(findHtmlLinks(response.text), list, listUrl);
  if (htmlEntries.length > 0) {
    return { state: "ok", entries: htmlEntries };
  }
  const page = await readRenderedLinks(listUrl, profileSession, (rendered) => pickGitHubEntries(rendered.links, list, rendered.pageUrl).length);
  if (page === null) {
    return { state: "failed" };
  }
  if (isGitHubSignInPage(page.pageUrl, origin)) {
    return { state: "signedOut" };
  }
  return { state: "ok", entries: pickGitHubEntries(page.links, list, page.pageUrl) };
}

/**
 * Reads a live folder's source with its profile's session.
 */
function readSource(target: LiveFolderTarget): Promise<SourceResult> {
  const profileSession = getProfileSession(target.profileId);
  if (target.source.kind === "feed") {
    return readFeed(target.source.url, profileSession);
  }
  return readGitHubList(target.source.list, profileSession);
}

/**
 * Refreshes one folder: reads its source, puts the entries in (new ones unread once the folder has filled before)
 * and records how it went. A folder deleted meanwhile is forgotten.
 */
async function refreshNow(folderId: ItemId): Promise<void> {
  const target = listLiveFolders(getState()).find((candidate) => candidate.folderId === folderId);
  if (target === undefined) {
    setLiveFolderStatus(folderId, null);
    return;
  }
  const result = await readSource(target).catch((): SourceResult => ({ state: "failed" }));
  const now = Date.now();
  if (result.state === "ok") {
    const folder = getState().items[folderId];
    const hasChildren = folder !== undefined && folder.kind === "folder" && folder.childIds.length > 0;
    const markNewAsUnread = filledFolderIds.has(folderId) || hasChildren;
    applyChange((state) => applyLiveFolderEntries(state, folderId, result.entries, now, markNewAsUnread));
    filledFolderIds.add(folderId);
  }
  setLiveFolderStatus(folderId, { state: result.state, checkedAt: now });
}

/**
 * Runs the waiting refreshes one after another.
 */
async function runWaitingRefreshes(): Promise<void> {
  isRefreshing = true;
  try {
    let folderId = waitingFolderIds.shift();
    while (folderId !== undefined) {
      await refreshNow(folderId);
      folderId = waitingFolderIds.shift();
    }
  } finally {
    isRefreshing = false;
  }
}

/**
 * Queues a folder's refresh (once) and shows it as loading.
 */
export function refreshLiveFolder(folderId: ItemId): void {
  if (waitingFolderIds.includes(folderId)) {
    return;
  }
  waitingFolderIds.push(folderId);
  const previous = getLiveFolderStatuses()[folderId];
  setLiveFolderStatus(folderId, { state: "loading", checkedAt: previous?.checkedAt ?? null });
  if (!isRefreshing) {
    runWaitingRefreshes().catch((error) => console.error("Live folder refresh failed:", error));
  }
}

/**
 * Refreshes every live folder, and forgets the statuses of folders that are gone.
 */
function refreshAllLiveFolders(): void {
  const targets = listLiveFolders(getState());
  const liveFolderIds = new Set(targets.map((target) => target.folderId));
  for (const folderId of Object.keys(getLiveFolderStatuses())) {
    if (!liveFolderIds.has(folderId)) {
      setLiveFolderStatus(folderId, null);
    }
  }
  for (const target of targets) {
    refreshLiveFolder(target.folderId);
  }
}

/**
 * Refreshes the live folders that have not been read in this run (a folder just made, or just imported).
 */
function refreshNewLiveFolders(): void {
  for (const target of listLiveFolders(getState())) {
    if (getLiveFolderStatuses()[target.folderId] === undefined) {
      refreshLiveFolder(target.folderId);
    }
  }
}

/**
 * Starts the refreshes: a first one shortly after the start, then every LIVE_FOLDER_REFRESH_MS.
 */
export function startLiveFolderRefreshing(): void {
  setTimeout(refreshAllLiveFolders, LIVE_FOLDER_FIRST_REFRESH_MS);
  setInterval(refreshAllLiveFolders, LIVE_FOLDER_REFRESH_MS);
}

/**
 * A page loaded somewhere: when it is on GitHub (not its sign-in page) and a GitHub folder waits for a sign-in, the
 * user may just have signed in, so those folders try again.
 */
export function noticeVisitedPage(url: string): void {
  const origin = getGitHubOrigin();
  const isOnGitHub = URL.canParse(url) && new URL(url).origin === origin;
  if (!isOnGitHub || isGitHubSignInPage(url, origin)) {
    return;
  }
  for (const [folderId, status] of Object.entries(getLiveFolderStatuses())) {
    if (status.state === "signedOut") {
      refreshLiveFolder(folderId);
    }
  }
}

/**
 * "New Live Folder › GitHub …": a folder for one of the user's GitHub lists, read right away.
 */
export function createGitHubLiveFolder(list: GitHubLiveList): void {
  const source = { kind: "github", list: list } as const;
  applyChange((state) => createFolder(state, GITHUB_LIST_TITLES[list], Date.now(), { source: source, hiddenUrls: [] }));
  refreshNewLiveFolders();
}

/**
 * Tells the user the page on screen has no feed.
 */
function showNoFeedMessage(): void {
  const window = getWindow();
  const options = {
    type: "info" as const,
    message: "This page has no feed",
    detail: "Open a page of a site that offers an RSS or Atom feed (most blogs and news sites do), or the feed itself, and try again.",
  };
  const shown = window === null ? dialog.showMessageBox(options) : dialog.showMessageBox(window, options);
  shown.catch(() => undefined);
}

/**
 * Checks what the feed-link script returned.
 */
function toFeedLinks(value: unknown): { contentType: string; links: PageFeedLink[] } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.contentType !== "string" || !Array.isArray(record.links)) {
    return null;
  }
  const links: PageFeedLink[] = [];
  for (const rawLink of record.links) {
    const link = rawLink as Record<string, unknown> | null;
    if (link !== null && typeof link.href === "string" && typeof link.type === "string" && typeof link.title === "string") {
      links.push({ href: link.href, type: link.type, title: link.title });
    }
  }
  return { contentType: record.contentType, links: links };
}

/**
 * "New Live Folder › Feed from This Page": finds the feed the page on screen offers (or the page itself, when it is
 * a feed) and makes a live folder of it, named as the site names its feed (or like the page).
 */
export async function createFeedLiveFolderFromPage(): Promise<void> {
  const contents = getFocusedContents();
  if (contents === null) {
    showNoFeedMessage();
    return;
  }
  const pageUrl = contents.getURL();
  const result: unknown = await contents.executeJavaScriptInIsolatedWorld(FEED_LINKS_WORLD_ID, [{ code: READ_FEED_LINKS_SCRIPT }]).catch(() => null);
  const pageLinks = toFeedLinks(result);
  const feed = pageLinks === null ? null : pickFeedLink(pageLinks.contentType, pageLinks.links, pageUrl);
  if (feed === null) {
    showNoFeedMessage();
    return;
  }
  const pageTitle = contents.getTitle().trim();
  const pageName = pageTitle === "" ? new URL(feed.url).hostname : pageTitle;
  const title = feed.title ?? pageName;
  const source = { kind: "feed", url: feed.url } as const;
  applyChange((state) => createFolder(state, title, Date.now(), { source: source, hiddenUrls: [] }));
  refreshNewLiveFolders();
}

/**
 * The status line's "Sign in to GitHub": opens the folder's list page in a new tab. GitHub shows its sign-in page
 * and comes back to the list afterwards; visiting GitHub then refreshes the folder (noticeVisitedPage).
 */
export function openLiveFolderSource(folderId: ItemId): void {
  const target = listLiveFolders(getState()).find((candidate) => candidate.folderId === folderId);
  if (target === undefined) {
    return;
  }
  const url = target.source.kind === "github" ? getGitHubListUrl(target.source.list, getGitHubOrigin()) : target.source.url;
  openLinkInNewTab(url, "foreground");
}
