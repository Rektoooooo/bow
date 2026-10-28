/**
 * WHY this file exists:
 *   Arc blocks ads and trackers itself. Ours uses our own filter engine (adBlockEngine.ts) with the public EasyList
 *   and EasyPrivacy lists, downloaded from easylist.to at runtime (nothing is bundled) and refreshed when they are
 *   older than the lists' own "Expires: 4 days". Requests are checked in every profile's session; pages get the
 *   lists' element-hiding CSS. It is off until the user turns it on (Library › Settings) and can be turned off per
 *   site (Control Center).
 *
 * Data source:
 *   BrowserState.settings.isAdBlockOn and BrowserState.adBlockOffSites; the list files in <userData>/adblock.
 *
 * Data flow:
 *   profile session created → onBeforeRequest → shouldBlockRequest() → cancel (counted per page, and in the privacy
 *   report: privacyReportStore.ts)
 *   page "dom-ready" → applyCosmeticFilters() → insertCSS(getCosmeticCss())
 *   setting turned on → ensureFilterLists() → download / read → parseFilterList()
 */
import { net } from "electron";
import type { Session, WebContents } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BrowserState } from "../shared/types";
import { DAY_MS } from "../shared/settings";
import { getSiteKey } from "../shared/siteKey";
import { getCosmeticCss, parseFilterList, shouldBlockRequest } from "./adBlockEngine";
import type { FilterSet } from "./adBlockEngine";
import { noteBlockedRequest } from "./privacyReportStore";
import { decideMainFrameRequest } from "./httpsOnlyController";

/** The lists we use. Both are public and free to download; we fetch them, we do not ship them. */
const FILTER_LISTS = [
  { name: "EasyList", url: "https://easylist.to/easylist/easylist.txt", fileName: "easylist.txt" },
  { name: "EasyPrivacy", url: "https://easylist.to/easylist/easyprivacy.txt", fileName: "easyprivacy.txt" },
];

/** Lists older than this are downloaded again. Source: the lists' own "! Expires: 4 days" header. */
const LIST_MAX_AGE_MS = 4 * DAY_MS;

const LISTS_FOLDER_NAME = "adblock";

/** Where the blocker stands, for the Library's label. */
export type AdBlockStatus = "off" | "loading" | "ready" | "failed";

let listsFolder: string | null = null;
let filterSet: FilterSet | null = null;
let status: AdBlockStatus = "off";
let loading: Promise<void> | null = null;
let readState: () => BrowserState = () => {
  throw new Error("adBlock.ts used before initializeAdBlocking()");
};
let notifyChanged: () => void = () => undefined;

/** Requests blocked on each page since it last navigated, by WebContents id. */
const blockedCounts = new Map<number, number>();

/** CSS we inserted into each page, so it can be taken out again. */
const insertedCssKeys = new Map<number, string>();

/**
 * True when blocking applies to a page: turned on, and not turned off for its site.
 */
export function isAdBlockActiveFor(state: BrowserState, pageUrl: string): boolean {
  if (state.settings.isAdBlockOn !== true) {
    return false;
  }
  const site = getSiteKey(pageUrl);
  return site === null || !(state.adBlockOffSites ?? []).includes(site);
}

/**
 * Turns Electron's request into the engine's question and answers it.
 */
function handleRequest(details: Electron.OnBeforeRequestListenerDetails, callback: (response: Electron.CallbackResponse) => void): void {
  const contents = details.webContents;
  if (details.resourceType === "mainFrame" && contents !== undefined) {
    blockedCounts.delete(contents.id);
    // HTTPS-Only Mode shares this handler (a session has one): a page asked for over http goes to https.
    const httpsUrl = decideMainFrameRequest(contents.id, details.url);
    if (httpsUrl !== null) {
      callback({ redirectURL: httpsUrl });
      return;
    }
  }
  const isWebRequest = details.url.startsWith("http:") || details.url.startsWith("https:") || details.url.startsWith("ws");
  if (filterSet === null || contents === undefined || !isWebRequest || details.resourceType === "mainFrame") {
    callback({});
    return;
  }
  const pageUrl = contents.getURL();
  if (!isAdBlockActiveFor(readState(), pageUrl)) {
    callback({});
    return;
  }
  const decision = shouldBlockRequest(filterSet, { url: details.url, pageUrl: pageUrl, resourceType: details.resourceType });
  if (!decision.isBlocked) {
    callback({});
    return;
  }
  blockedCounts.set(contents.id, (blockedCounts.get(contents.id) ?? 0) + 1);
  // The privacy report counts it, except in private windows (their sessions are not persistent).
  if (contents.session.isPersistent()) {
    noteBlockedRequest(pageUrl, details.url);
  }
  callback({ cancel: true });
}

/**
 * Starts checking a profile's requests (blocking happens only once lists are loaded and the setting is on).
 */
export function installAdBlocker(profileSession: Session): void {
  profileSession.webRequest.onBeforeRequest(handleRequest);
}

/**
 * Reads a list from disk when it is fresh enough, otherwise downloads it (keeping the old copy if that fails).
 */
async function readOrDownloadList(list: (typeof FILTER_LISTS)[number], now: number): Promise<string> {
  const folder = listsFolder as string;
  const filePath = path.join(folder, list.fileName);
  const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  const isFresh = stats !== null && now - stats.mtimeMs < LIST_MAX_AGE_MS;
  if (isFresh) {
    return fs.readFileSync(filePath, "utf8");
  }
  try {
    const response = await net.fetch(list.url);
    if (!response.ok) {
      throw new Error(`${list.name}: HTTP ${response.status}`);
    }
    const text = await response.text();
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(filePath, text);
    return text;
  } catch (error) {
    if (stats !== null) {
      console.warn(`Could not refresh ${list.name}; using the copy from before:`, error);
      return fs.readFileSync(filePath, "utf8");
    }
    throw error;
  }
}

/**
 * Loads the lists (once; later calls share the same load).
 */
export function ensureFilterLists(): Promise<void> {
  if (filterSet !== null) {
    return Promise.resolve();
  }
  if (loading !== null) {
    return loading;
  }
  status = "loading";
  notifyChanged();
  loading = Promise.all(FILTER_LISTS.map((list) => readOrDownloadList(list, Date.now())))
    .then((texts) => {
      filterSet = parseFilterList(texts.join("\n"));
      status = "ready";
    })
    .catch((error) => {
      console.warn("The ad-blocking lists could not be loaded:", error);
      status = "failed";
    })
    .finally(() => {
      loading = null;
      notifyChanged();
    });
  return loading;
}

/**
 * Hides the lists' ad elements in a page, or takes our CSS out when blocking does not apply (any more).
 */
export async function applyCosmeticFilters(contents: WebContents): Promise<void> {
  const previousKey = insertedCssKeys.get(contents.id);
  insertedCssKeys.delete(contents.id);
  if (previousKey !== undefined) {
    // After a navigation the old CSS is already gone and removing it fails; that is fine.
    await contents.removeInsertedCSS(previousKey).catch(() => undefined);
  }
  const pageUrl = contents.getURL();
  if (filterSet === null || contents.isDestroyed() || !isAdBlockActiveFor(readState(), pageUrl)) {
    return;
  }
  const css = getCosmeticCss(filterSet, pageUrl);
  if (css === "") {
    return;
  }
  insertedCssKeys.set(contents.id, await contents.insertCSS(css));
}

/**
 * How many requests were blocked on a page since it last navigated.
 */
export function getBlockedCount(contents: WebContents): number {
  return blockedCounts.get(contents.id) ?? 0;
}

/**
 * The Library's label: on or off, loading, how many filters.
 */
export function describeAdBlock(state: BrowserState): { isOn: boolean; status: AdBlockStatus; filterCount: number } {
  const isOn = state.settings.isAdBlockOn === true;
  return { isOn: isOn, status: isOn ? status : "off", filterCount: filterSet?.loadedCount ?? 0 };
}

/**
 * Sets up the blocker: where the lists live, how to read the state, who to tell about changes. Loads the lists
 * right away when blocking is on.
 */
export function initializeAdBlocking(userDataFolder: string, getState: () => BrowserState, onChanged: () => void): void {
  listsFolder = path.join(userDataFolder, LISTS_FOLDER_NAME);
  readState = getState;
  notifyChanged = onChanged;
  if (getState().settings.isAdBlockOn === true) {
    ensureFilterLists().catch(() => undefined);
  }
}
