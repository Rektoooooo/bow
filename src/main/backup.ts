/**
 * WHY this file exists:
 *   Arc never let people take their Spaces and pinned tabs with them, and now they are stuck. Bow writes everything
 *   that makes your setup yours to one open file (documented in docs/backup-format.md) and can bring it back: in
 *   place of the current setup, or as extra Spaces next to it. This file is the pure part: building a backup,
 *   reading one back, and turning it into a state. A backup is untrusted (it may come from anywhere), so everything
 *   in it is checked field by field before it can reach the state: only web, note and easel addresses survive,
 *   references must point at real items, and JavaScript Boosts arrive switched off.
 *
 * Data source:
 *   The BrowserState and the Notes and Easels that backupController.ts reads from disk; a backup file's text.
 *
 * Data flow:
 *   Export → createBackup(state, notes, easels, now, appVersion) → JSON file
 *   Restore → parseBackup(text) → checkedState + report → replaceFromBackup() or addSpacesFromBackup() → applyChange
 *
 * Same rules as state.ts: never change what is passed in; `now` is a parameter.
 */
import { ARCHIVE_LIMIT, BEFORE_RESTORE_SNAPSHOTS_KEPT, DEFAULT_ARCHIVE_AFTER_MS, DEFAULT_PROFILE_ID, FAVORITES_LIMIT, GLOBAL_SHORTCUT_CHOICES, READER_TEXT_SIZES, SNAPSHOTS_DAILY_KEPT, SNAPSHOTS_HOURLY_KEPT, SPLIT_PANES_LIMIT } from "../shared/settings";
import { isSearchEngineId, SEARCH_ENGINE_IDS } from "../shared/searchEngines";
import { isValidSearchKeyword } from "../shared/searchKeywords";
import { createNoteUrl, getNoteId, isNoteId } from "../shared/notes";
import { createEaselUrl, getEaselId, isEaselId } from "../shared/easels";
import type {
  ArchivedTab,
  Boost,
  BrowserSettings,
  BrowserState,
  FolderItem,
  GitHubLiveList,
  InstalledExtension,
  IssuePageKind,
  ItemId,
  LiveFolderData,
  Profile,
  ProfileId,
  RoutingRule,
  SidebarItem,
  SitePermission,
  SearchKeyword,
  Space,
  SpaceId,
  SpaceTheme,
  SplitItem,
  SplitOrientation,
  TabItem,
} from "../shared/types";
import { upgradeToCurrentVersion } from "./migrate";
import { GITHUB_LIVE_LISTS } from "./gitHubLists";
import { checkCommandChains } from "./commandChains";
import { checkSpaceTemplates } from "./spaceTemplates";
import { BUNDLE_ID_PATTERN } from "./linkSourceApps";
import { MAX_NOTE_LENGTH } from "./notesStore";
import { MAX_EASEL_LENGTH } from "./easelsStore";
import { repairSelections } from "./state";
import { createId } from "./tree";
import { repairOtherWindows } from "./windows";

/** What every backup file says it is. */
export const BACKUP_FORMAT = "bow-backup";

/** The file format's version. Raise it when the file's shape changes; older files must keep restoring. */
export const BACKUP_FORMAT_VERSION = 1;

/** A backup file: the state (in its own saved version), and the text of the Notes and Easels its tabs use. */
export interface BowBackup {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  /** When it was made, as an ISO date (readable in the file). */
  createdAt: string;
  /** The Bow version that made it. */
  appVersion: string;
  state: BrowserState;
  /** Note HTML by note id. */
  notes: Record<string, string>;
  /** Easel board JSON by easel id. */
  easels: Record<string, string>;
}

/** What a backup holds, for the question before restoring, and what had to be left out of it. */
export interface BackupReport {
  createdAt: string;
  appVersion: string;
  spaces: number;
  pinnedTabs: number;
  todayTabs: number;
  favorites: number;
  folders: number;
  notes: number;
  easels: number;
  boosts: number;
  /** Items, archive entries, rules or permissions that were malformed or pointed nowhere, and were left out. */
  leftOut: number;
  /** JavaScript Boosts switched off: their code stays, and runs again only when the user turns it back on. */
  scriptsTurnedOff: number;
  /** Extensions the backup lists: their files are not in it, so they must be installed again on another Mac. */
  extensionNames: string[];
}

/** A backup that passed every check. */
export interface CheckedBackup {
  state: BrowserState;
  notes: Record<string, string>;
  easels: Record<string, string>;
  report: BackupReport;
}

export type BackupParseResult = { isValid: true; backup: CheckedBackup } | { isValid: false; error: string };

/** Longest title, name or URL kept from a backup. Our choice: far more than real ones; bounds a crafted file. */
const MAX_TEXT_LENGTH = 4000;

/** Longest Boost CSS or JavaScript kept, like boosts.ts accepts. */
const MAX_BOOST_CODE_LENGTH = 20000;

/** Theme colors a Space may have (Arc's gradient editor allows three). */
const MAX_THEME_COLORS = 3;

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** A site key such as "github.com", as ipc.ts accepts it. */
const SITE_PATTERN = /^[a-z0-9.-]{1,253}$/;

/** The page addresses a tab may have besides web pages: an empty page. */
const BLANK_PAGE_URL = "about:blank";

/** Image addresses a favicon may have. */
const FAVICON_URL_PATTERN = /^(https?:\/\/|data:image\/)/;

/** Longest favicon address kept: Arc's cached icons arrive as data: URLs of a few kilobytes. Our choice. */
const MAX_FAVICON_URL_LENGTH = 100_000;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A string cut to MAX_TEXT_LENGTH, or the fallback when it is not a string.
 */
function readText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.slice(0, MAX_TEXT_LENGTH) : fallback;
}

/**
 * True for an address a restored tab may open: a web page, a note or easel of ours, or an empty page. Anything else
 * (javascript:, file:, chrome:, a made-up scheme) is left out.
 */
export function isRestorableUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH) {
    return false;
  }
  if (value === BLANK_PAGE_URL || getNoteId(value) !== null || getEaselId(value) !== null) {
    return true;
  }
  if (!URL.canParse(value)) {
    return false;
  }
  const protocol = new URL(value).protocol;
  return protocol === "https:" || protocol === "http:";
}

// ---------- Creating a backup ----------

/**
 * The note and easel ids the state's tabs use (in the sidebar and in the archive).
 */
export function collectNoteAndEaselIds(state: BrowserState): { noteIds: string[]; easelIds: string[] } {
  const urls: string[] = [];
  for (const item of Object.values(state.items)) {
    if (item.kind === "tab") {
      urls.push(item.url);
    }
  }
  for (const entry of state.archive) {
    urls.push(entry.tab.url);
  }
  const noteIds = new Set<string>();
  const easelIds = new Set<string>();
  for (const url of urls) {
    const noteId = getNoteId(url);
    const easelId = getEaselId(url);
    if (noteId !== null) {
      noteIds.add(noteId);
    }
    if (easelId !== null) {
      easelIds.add(easelId);
    }
  }
  return { noteIds: Array.from(noteIds), easelIds: Array.from(easelIds) };
}

/**
 * Builds a backup. Things that only mean something on this Mac are not written: the other windows' places and
 * choices, and the folders extensions were installed into (their names stay, so a restore can say what to install).
 */
export function createBackup(state: BrowserState, notes: Record<string, string>, easels: Record<string, string>, now: number, appVersion: string): BowBackup {
  const extensions: InstalledExtension[] = (state.extensions ?? []).map((extension) => ({ ...extension, path: "" }));
  const portableState: BrowserState = { ...state, otherWindows: [], extensions: extensions };
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date(now).toISOString(),
    appVersion: appVersion,
    state: portableState,
    notes: notes,
    easels: easels,
  };
}

// ---------- Checking a backup ----------

/** Counts what the checks left out while they run. */
export interface CheckCounter {
  leftOut: number;
  scriptsTurnedOff: number;
}

/**
 * A tab from a backup, or null when it is malformed or opens an address a tab may not have.
 */
function checkTab(raw: unknown, expectedId: string | null): TabItem | null {
  if (!isRecord(raw) || raw.kind !== "tab" || typeof raw.id !== "string" || !isRestorableUrl(raw.url)) {
    return null;
  }
  if (expectedId !== null && raw.id !== expectedId) {
    return null;
  }
  const homeUrl = isRestorableUrl(raw.homeUrl) ? raw.homeUrl : null;
  const faviconUrl = typeof raw.faviconUrl === "string" && FAVICON_URL_PATTERN.test(raw.faviconUrl) ? raw.faviconUrl.slice(0, MAX_FAVICON_URL_LENGTH) : null;
  const tab: TabItem = {
    kind: "tab",
    id: raw.id.slice(0, MAX_TEXT_LENGTH),
    url: raw.url,
    title: readText(raw.title, ""),
    customTitle: typeof raw.customTitle === "string" ? raw.customTitle.slice(0, MAX_TEXT_LENGTH) : null,
    faviconUrl: faviconUrl,
    homeUrl: homeUrl,
    lastActiveAt: isFiniteNumber(raw.lastActiveAt) ? raw.lastActiveAt : 0,
    isMuted: raw.isMuted === true,
  };
  if (typeof raw.isUnread === "boolean") {
    tab.isUnread = raw.isUnread;
  }
  if (raw.isNeverArchived === true) {
    tab.isNeverArchived = true;
  }
  return tab;
}

/**
 * A live folder's source and hidden list, or undefined when malformed (the folder then stays a plain folder).
 */
export function checkLiveFolder(raw: unknown): LiveFolderData | undefined {
  if (!isRecord(raw) || !isRecord(raw.source) || !Array.isArray(raw.hiddenUrls)) {
    return undefined;
  }
  const hiddenUrls = raw.hiddenUrls.filter((url): url is string => typeof url === "string").map((url) => url.slice(0, MAX_TEXT_LENGTH));
  const source = raw.source;
  const isGitHubList = GITHUB_LIVE_LISTS.includes(source.list as GitHubLiveList);
  if (source.kind === "github" && isGitHubList) {
    return { source: { kind: "github", list: source.list as GitHubLiveList }, hiddenUrls: hiddenUrls };
  }
  const isWebAddress = typeof source.url === "string" && isRestorableUrl(source.url) && /^https?:/.test(source.url);
  if (source.kind === "feed" && isWebAddress) {
    return { source: { kind: "feed", url: source.url as string }, hiddenUrls: hiddenUrls };
  }
  const isIssueKind = source.issueKind === "jira" || source.issueKind === "linear";
  if (source.kind === "issues" && isWebAddress && isIssueKind) {
    return { source: { kind: "issues", url: source.url as string, issueKind: source.issueKind as IssuePageKind }, hiddenUrls: hiddenUrls };
  }
  return undefined;
}

/**
 * The ids in a child list, without anything that is not a string.
 */
function readIdList(value: unknown): ItemId[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/**
 * One sidebar item, or null when malformed.
 */
function checkItem(key: string, raw: unknown): SidebarItem | null {
  if (!isRecord(raw) || raw.id !== key) {
    return null;
  }
  if (raw.kind === "tab") {
    return checkTab(raw, key);
  }
  if (raw.kind === "folder") {
    const folder: FolderItem = { kind: "folder", id: key, title: readText(raw.title, "Folder"), childIds: readIdList(raw.childIds), isOpen: raw.isOpen !== false };
    const live = checkLiveFolder(raw.live);
    if (live !== undefined) {
      folder.live = live;
    }
    return folder;
  }
  if (raw.kind === "split") {
    const isKnownLayout = raw.orientation === "vertical" || raw.orientation === "grid";
    const orientation: SplitOrientation = isKnownLayout ? (raw.orientation as SplitOrientation) : "horizontal";
    const split: SplitItem = { kind: "split", id: key, childIds: readIdList(raw.childIds), orientation: orientation };
    // Pane sizes: a few numbers; whether they fit is decided where they are used (shared/splitLayout.ts).
    const isSizeList = Array.isArray(raw.sizes) && raw.sizes.length <= SPLIT_PANES_LIMIT && raw.sizes.every((size) => isFiniteNumber(size));
    if (isSizeList) {
      split.sizes = raw.sizes as number[];
    }
    return split;
  }
  return null;
}

/**
 * A Space theme, or Bow's neutral one when malformed.
 */
export function checkTheme(raw: unknown): SpaceTheme {
  const neutral: SpaceTheme = { colors: ["#000000"], appearance: "auto", grain: 0 };
  if (!isRecord(raw) || !Array.isArray(raw.colors)) {
    return neutral;
  }
  const colors = raw.colors.filter((color): color is string => typeof color === "string" && HEX_COLOR_PATTERN.test(color)).slice(0, MAX_THEME_COLORS);
  if (colors.length === 0) {
    return neutral;
  }
  const appearance = raw.appearance === "light" || raw.appearance === "dark" ? raw.appearance : "auto";
  const grain = isFiniteNumber(raw.grain) ? Math.min(Math.max(raw.grain, 0), 1) : 0;
  const theme: SpaceTheme = { colors: colors, appearance: appearance, grain: grain };
  if (isFiniteNumber(raw.intensity)) {
    theme.intensity = Math.min(Math.max(raw.intensity, 0), 1);
  }
  return theme;
}

/** The items being walked (folders and splits get their cleaned child lists) and the ids reached so far. */
interface SidebarWalk {
  items: Record<ItemId, SidebarItem>;
  visited: Set<ItemId>;
}

/**
 * Walks one list of the sidebar and keeps each item only in the first list that reaches it: an item listed twice, a
 * folder inside itself, or a child that is missing all fall out. Favorites and split panes hold only tabs; Today holds
 * no folders; a split view left with one pane becomes that tab.
 */
function keepList(walk: SidebarWalk, ids: ItemId[], allowsFolders: boolean, tabsOnly: boolean): ItemId[] {
  const kept: ItemId[] = [];
  for (const itemId of ids) {
    const item = walk.items[itemId];
    if (item === undefined || walk.visited.has(itemId)) {
      continue;
    }
    if ((item.kind === "folder" && !allowsFolders) || (item.kind !== "tab" && tabsOnly)) {
      continue;
    }
    walk.visited.add(itemId);
    if (item.kind === "folder") {
      walk.items[itemId] = { ...item, childIds: keepList(walk, item.childIds, true, false) };
    }
    if (item.kind === "split") {
      const panes = keepList(walk, item.childIds, false, true).slice(0, SPLIT_PANES_LIMIT);
      if (panes.length < 2) {
        kept.push(...panes);
        continue;
      }
      walk.items[itemId] = { ...item, childIds: panes };
    }
    kept.push(itemId);
  }
  return kept;
}

/**
 * The profiles of a backup, with at least the default one.
 */
function checkProfiles(raw: unknown): Profile[] {
  const profiles: Profile[] = [];
  const seenIds = new Set<string>();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!isRecord(entry) || typeof entry.id !== "string" || seenIds.has(entry.id)) {
      continue;
    }
    seenIds.add(entry.id);
    profiles.push({ id: entry.id.slice(0, MAX_TEXT_LENGTH), name: readText(entry.name, "Profile"), favoriteIds: readIdList(entry.favoriteIds) });
  }
  if (profiles.length === 0) {
    profiles.push({ id: DEFAULT_PROFILE_ID, name: "Default", favoriteIds: [] });
  }
  return profiles;
}

/**
 * The Spaces of a backup (before their lists are walked).
 */
function checkSpaces(raw: unknown, profileIds: Set<ProfileId>, fallbackProfileId: ProfileId): Space[] {
  const spaces: Space[] = [];
  const seenIds = new Set<string>();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!isRecord(entry) || typeof entry.id !== "string" || seenIds.has(entry.id)) {
      continue;
    }
    seenIds.add(entry.id);
    const profileId = typeof entry.profileId === "string" && profileIds.has(entry.profileId) ? entry.profileId : fallbackProfileId;
    const space: Space = {
      id: entry.id.slice(0, MAX_TEXT_LENGTH),
      name: readText(entry.name, "Space"),
      icon: readText(entry.icon, "✦").slice(0, 64),
      theme: checkTheme(entry.theme),
      profileId: profileId,
      pinnedIds: readIdList(entry.pinnedIds),
      todayIds: readIdList(entry.todayIds),
      isPinnedOpen: entry.isPinnedOpen !== false,
    };
    // Its own archive timing: Never, or a positive time (anything else means the setting).
    const isTiming = isFiniteNumber(entry.archiveAfterMs) && entry.archiveAfterMs > 0;
    if (entry.archiveAfterMs === null || isTiming) {
      space.archiveAfterMs = entry.archiveAfterMs as number | null;
    }
    if (isSearchEngineId(entry.searchEngine)) {
      space.searchEngine = entry.searchEngine;
    }
    const isWebPage = isRestorableUrl(entry.newTabUrl) && /^https?:/i.test(entry.newTabUrl);
    if (isWebPage) {
      space.newTabUrl = entry.newTabUrl as string;
    }
    spaces.push(space);
  }
  return spaces;
}

/**
 * The archive of a backup: well-formed entries with restorable tabs, newest first, at most ARCHIVE_LIMIT.
 */
function checkArchive(raw: unknown, counter: CheckCounter): ArchivedTab[] {
  const archive: ArchivedTab[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const tab = isRecord(entry) ? checkTab(entry.tab, null) : null;
    const isReason = isRecord(entry) && (entry.reason === "auto" || entry.reason === "manual" || entry.reason === "clear-button");
    if (!isRecord(entry) || tab === null || !isReason || !isFiniteNumber(entry.archivedAt)) {
      counter.leftOut += 1;
      continue;
    }
    const fromSpaceId = typeof entry.fromSpaceId === "string" ? entry.fromSpaceId : null;
    archive.push({ tab: tab, fromSpaceId: fromSpaceId, archivedAt: entry.archivedAt, reason: entry.reason as ArchivedTab["reason"] });
  }
  return archive.slice(0, ARCHIVE_LIMIT);
}

/**
 * The Boosts of a backup. JavaScript Boosts arrive switched off: code from a file runs only once the user says so.
 */
export function checkBoosts(raw: unknown, counter: CheckCounter): Boost[] {
  const boosts: Boost[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const isWellFormed = isRecord(entry) && typeof entry.id === "string" && typeof entry.site === "string" && SITE_PATTERN.test(entry.site) && typeof entry.css === "string";
    if (!isWellFormed || (entry.css as string).length > MAX_BOOST_CODE_LENGTH) {
      counter.leftOut += 1;
      continue;
    }
    const boost: Boost = {
      id: (entry.id as string).slice(0, MAX_TEXT_LENGTH),
      site: entry.site as string,
      css: entry.css as string,
      zappedSelectors: readIdList(entry.zappedSelectors).map((selector) => selector.slice(0, MAX_TEXT_LENGTH)),
      isEnabled: entry.isEnabled !== false,
    };
    if (isFiniteNumber(entry.hueShift)) {
      boost.hueShift = entry.hueShift;
    }
    if (typeof entry.isInverted === "boolean") {
      boost.isInverted = entry.isInverted;
    }
    if (typeof entry.fontId === "string") {
      boost.fontId = entry.fontId.slice(0, 64);
    }
    if (typeof entry.javascript === "string" && entry.javascript.length <= MAX_BOOST_CODE_LENGTH) {
      boost.javascript = entry.javascript;
      boost.isJavaScriptOn = false;
      if (entry.isJavaScriptOn === true) {
        counter.scriptsTurnedOff += 1;
      }
    }
    boosts.push(boost);
  }
  return boosts;
}

/**
 * The Air Traffic Control rules of a backup whose Space exists.
 */
function checkRoutingRules(raw: unknown, spaceIds: Set<SpaceId>, counter: CheckCounter): RoutingRule[] {
  const rules: RoutingRule[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const isAddressRule = isRecord(entry) && (entry.matchType === "contains" || entry.matchType === "is");
    // An app rule keeps a bundle id, and the app's name for the Library.
    const isAppRule = isRecord(entry) && entry.matchType === "app" && typeof entry.value === "string" && BUNDLE_ID_PATTERN.test(entry.value);
    const isWellFormed = isRecord(entry) && (isAddressRule || isAppRule) && typeof entry.id === "string" && typeof entry.value === "string" && typeof entry.spaceId === "string";
    if (!isWellFormed || !spaceIds.has(entry.spaceId as string)) {
      counter.leftOut += 1;
      continue;
    }
    const rule: RoutingRule = { id: (entry.id as string).slice(0, MAX_TEXT_LENGTH), matchType: entry.matchType as RoutingRule["matchType"], value: (entry.value as string).slice(0, MAX_TEXT_LENGTH), spaceId: entry.spaceId as string };
    if (isAppRule && typeof entry.appName === "string") {
      rule.appName = entry.appName.slice(0, MAX_TEXT_LENGTH);
    }
    rules.push(rule);
  }
  return rules;
}

/**
 * The sites' permission answers of a backup whose profile exists.
 */
function checkSitePermissions(raw: unknown, profileIds: Set<ProfileId>, counter: CheckCounter): SitePermission[] {
  const kinds = ["camera", "microphone", "notifications", "location", "clipboard"];
  const permissions: SitePermission[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const isWellFormed = isRecord(entry) && typeof entry.profileId === "string" && typeof entry.origin === "string" && kinds.includes(entry.kind as string);
    if (!isWellFormed || !profileIds.has(entry.profileId as string) || typeof entry.isAllowed !== "boolean") {
      counter.leftOut += 1;
      continue;
    }
    permissions.push({ profileId: entry.profileId as string, origin: (entry.origin as string).slice(0, MAX_TEXT_LENGTH), kind: entry.kind as SitePermission["kind"], isAllowed: entry.isAllowed });
  }
  return permissions;
}

/**
 * The settings of a backup: each known setting of the right type; anything else is left as Bow's default.
 */
function checkSettings(raw: unknown): BrowserSettings {
  const source = isRecord(raw) ? raw : {};
  // Null is a real choice ("never archive"); anything that is not a number or null falls back to the default.
  let archiveAfterMs: number | null = DEFAULT_ARCHIVE_AFTER_MS;
  if (isFiniteNumber(source.archiveAfterMs) || source.archiveAfterMs === null) {
    archiveAfterMs = source.archiveAfterMs;
  }
  const settings: BrowserSettings = { archiveAfterMs: archiveAfterMs, isSidebarVisible: source.isSidebarVisible !== false };
  if (source.isToolbarVisible === false) {
    settings.isToolbarVisible = false;
  }
  if (GLOBAL_SHORTCUT_CHOICES.some((choice) => choice.accelerator === source.globalShortcut)) {
    settings.globalShortcut = source.globalShortcut as string;
  }
  if (source.globalShortcutOpens === "commandBar" || source.globalShortcutOpens === "littleWindow") {
    settings.globalShortcutOpens = source.globalShortcutOpens;
  }
  if (READER_TEXT_SIZES.some((size) => size === source.readerTextSize)) {
    settings.readerTextSize = source.readerTextSize as number;
  }
  if (isFiniteNumber(source.sidebarWidth)) {
    settings.sidebarWidth = source.sidebarWidth;
  }
  if (typeof source.searchEngine === "string" && (SEARCH_ENGINE_IDS as readonly string[]).includes(source.searchEngine)) {
    settings.searchEngine = source.searchEngine as BrowserSettings["searchEngine"];
  }
  const flags = ["isAdBlockOn", "isHttpsOnly", "areTitlesTidy", "showsFullUrls", "hasSeenWelcome", "areSnapshotsOn", "areFavoritesKeptAwake", "asksWhereToSave"] as const;
  for (const flag of flags) {
    if (typeof source[flag] === "boolean") {
      settings[flag] = source[flag] as boolean;
    }
  }
  if (typeof source.appIcon === "string") {
    settings.appIcon = source.appIcon.slice(0, 64);
  }
  if (isFiniteNumber(source.tabSleepAfterMs) || source.tabSleepAfterMs === null) {
    settings.tabSleepAfterMs = source.tabSleepAfterMs as number | null;
  }
  return settings;
}

/**
 * The extensions a backup lists, by name (their files are not in a backup).
 */
function readExtensionNames(raw: unknown): string[] {
  const names: string[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (isRecord(entry) && typeof entry.name === "string") {
      names.push(entry.name.slice(0, 200));
    }
  }
  return names;
}

/**
 * A state from a backup, checked field by field. Returns null when nothing usable is left (no Space).
 */
export function checkBackupState(raw: BrowserState, counter: CheckCounter): BrowserState | null {
  const candidateItems: Record<ItemId, SidebarItem> = {};
  for (const [key, value] of Object.entries(isRecord(raw.items) ? raw.items : {})) {
    const item = checkItem(key, value);
    if (item === null) {
      counter.leftOut += 1;
      continue;
    }
    candidateItems[key] = item;
  }
  const profiles = checkProfiles(raw.profiles);
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const fallbackProfileId = profiles[0]?.id ?? DEFAULT_PROFILE_ID;
  const spaces = checkSpaces(raw.spaces, profileIds, fallbackProfileId);
  if (spaces.length === 0) {
    return null;
  }

  const walk: SidebarWalk = { items: candidateItems, visited: new Set() };
  const walkedProfiles = profiles.map((profile) => ({ ...profile, favoriteIds: keepList(walk, profile.favoriteIds, false, true) }));
  const walkedSpaces = spaces.map((space) => ({
    ...space,
    pinnedIds: keepList(walk, space.pinnedIds, true, false),
    todayIds: keepList(walk, space.todayIds, false, false),
  }));
  const items: Record<ItemId, SidebarItem> = {};
  for (const itemId of walk.visited) {
    const item = walk.items[itemId];
    if (item !== undefined) {
      items[itemId] = item;
    }
  }
  counter.leftOut += Object.keys(candidateItems).length - Object.keys(items).length;

  const spaceIds = new Set(walkedSpaces.map((space) => space.id));
  const firstSpaceId = walkedSpaces[0]?.id as SpaceId;
  const activeSpaceId = typeof raw.activeSpaceId === "string" && spaceIds.has(raw.activeSpaceId) ? raw.activeSpaceId : firstSpaceId;
  const selectedTabIdBySpace: Record<SpaceId, ItemId | null> = {};
  const rawSelections = isRecord(raw.selectedTabIdBySpace) ? raw.selectedTabIdBySpace : {};
  for (const space of walkedSpaces) {
    const selected = rawSelections[space.id];
    selectedTabIdBySpace[space.id] = typeof selected === "string" && items[selected]?.kind === "tab" ? selected : null;
  }

  const checked: BrowserState = {
    version: raw.version,
    items: items,
    profiles: walkedProfiles,
    spaces: walkedSpaces,
    activeSpaceId: activeSpaceId,
    selectedTabIdBySpace: selectedTabIdBySpace,
    focusedWindowId: typeof raw.focusedWindowId === "string" ? raw.focusedWindowId : "window-1",
    otherWindows: [],
    archive: checkArchive(raw.archive, counter),
    settings: checkSettings(raw.settings),
    routingRules: checkRoutingRules(raw.routingRules, spaceIds, counter),
    boosts: checkBoosts(raw.boosts, counter),
    extensions: [],
    sitePermissions: checkSitePermissions(raw.sitePermissions, profileIds, counter),
  };
  if (isRecord(raw.developerModeSites)) {
    const sites: Record<string, boolean> = {};
    for (const [site, isOn] of Object.entries(raw.developerModeSites)) {
      if (SITE_PATTERN.test(site) && typeof isOn === "boolean") {
        sites[site] = isOn;
      }
    }
    checked.developerModeSites = sites;
  }
  if (Array.isArray(raw.adBlockOffSites)) {
    checked.adBlockOffSites = raw.adBlockOffSites.filter((site): site is string => typeof site === "string" && SITE_PATTERN.test(site));
  }
  if (Array.isArray(raw.keepAwakeSites)) {
    checked.keepAwakeSites = raw.keepAwakeSites.filter((site): site is string => typeof site === "string" && SITE_PATTERN.test(site));
  }
  if (isRecord(raw.siteZooms)) {
    checked.siteZooms = checkSiteZooms(raw.siteZooms);
  }
  if (Array.isArray(raw.searchKeywords)) {
    checked.searchKeywords = checkSearchKeywords(raw.searchKeywords, counter);
  }
  if (Array.isArray(raw.commandChains)) {
    const checkedChains = checkCommandChains(raw.commandChains);
    counter.leftOut += checkedChains.leftOut;
    checked.commandChains = checkedChains.chains;
  }
  if (Array.isArray(raw.spaceTemplates)) {
    const checkedTemplates = checkSpaceTemplates(raw.spaceTemplates);
    counter.leftOut += checkedTemplates.leftOut;
    checked.spaceTemplates = checkedTemplates.templates;
  }
  return repairSelections(checked);
}

/**
 * Search keywords: whole entries that pass the same check as adding one (a web address with %s), each keyword once.
 */
function checkSearchKeywords(raw: unknown[], counter: CheckCounter): SearchKeyword[] {
  const keywords: SearchKeyword[] = [];
  for (const entry of raw) {
    const isEntry = isRecord(entry) && typeof entry.keyword === "string" && typeof entry.name === "string" && typeof entry.url === "string";
    const candidate = isEntry ? { keyword: entry.keyword as string, name: entry.name as string, url: entry.url as string } : null;
    const isUsable = candidate !== null && isValidSearchKeyword(candidate) && !keywords.some((kept) => kept.keyword === candidate.keyword);
    if (!isUsable) {
      counter.leftOut += 1;
      continue;
    }
    keywords.push(candidate);
  }
  return keywords;
}

/** The zoom range Bow's zoom steps cover (pageCommands.ts): 25% to 500%. */
const MIN_SITE_ZOOM = 0.25;
const MAX_SITE_ZOOM = 5;

/**
 * Remembered zooms: hosts as Bow writes them, factors within the zoom steps' range.
 */
function checkSiteZooms(raw: Record<string, unknown>): Record<string, number> {
  const zooms: Record<string, number> = {};
  for (const [host, factor] of Object.entries(raw)) {
    const isFactor = isFiniteNumber(factor) && factor >= MIN_SITE_ZOOM && factor <= MAX_SITE_ZOOM;
    if (SITE_PATTERN.test(host) && isFactor) {
      zooms[host] = factor;
    }
  }
  return zooms;
}

/**
 * Counts what a checked state holds, for the question before restoring.
 */
function countState(state: BrowserState): { pinnedTabs: number; todayTabs: number; favorites: number; folders: number } {
  let folders = 0;
  for (const item of Object.values(state.items)) {
    if (item.kind === "folder") {
      folders += 1;
    }
  }
  const favorites = state.profiles.reduce((total, profile) => total + profile.favoriteIds.length, 0);
  let pinnedTabs = 0;
  let todayTabs = 0;
  const countTabs = (itemIds: ItemId[]): number => {
    let count = 0;
    for (const itemId of itemIds) {
      const item = state.items[itemId];
      if (item === undefined) {
        continue;
      }
      count += item.kind === "tab" ? 1 : countTabs(item.childIds);
    }
    return count;
  };
  for (const space of state.spaces) {
    pinnedTabs += countTabs(space.pinnedIds);
    todayTabs += countTabs(space.todayIds);
  }
  return { pinnedTabs: pinnedTabs, todayTabs: todayTabs, favorites: favorites, folders: folders };
}

/**
 * The notes or easels of a backup that the checked state uses, each a string within its limit.
 */
function keepUsedFiles(raw: unknown, usedIds: string[], isId: (value: unknown) => boolean, maxLength: number): Record<string, string> {
  const files: Record<string, string> = {};
  const source = isRecord(raw) ? raw : {};
  for (const fileId of usedIds) {
    const content = source[fileId];
    if (isId(fileId) && typeof content === "string" && content.length <= maxLength) {
      files[fileId] = content;
    }
  }
  return files;
}

/**
 * Reads a backup file's text. It must be a Bow backup of a format this Bow knows, holding a state file of any version
 * Bow can upgrade; everything in it is checked (checkBackupState).
 */
export function parseBackup(text: string): BackupParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { isValid: false, error: "This file is not a Bow backup (it is not readable JSON)." };
  }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT || !isFiniteNumber(parsed.formatVersion)) {
    return { isValid: false, error: "This file is not a Bow backup." };
  }
  if (parsed.formatVersion > BACKUP_FORMAT_VERSION) {
    return { isValid: false, error: "This backup was made by a newer Bow. Update Bow, then restore it." };
  }
  const upgraded = upgradeToCurrentVersion(parsed.state);
  if (upgraded === null) {
    return { isValid: false, error: "This backup's sidebar could not be read." };
  }
  const counter: CheckCounter = { leftOut: 0, scriptsTurnedOff: 0 };
  const state = checkBackupState(upgraded, counter);
  if (state === null) {
    return { isValid: false, error: "This backup has no Spaces to restore." };
  }
  const used = collectNoteAndEaselIds(state);
  const notes = keepUsedFiles(parsed.notes, used.noteIds, isNoteId, MAX_NOTE_LENGTH);
  const easels = keepUsedFiles(parsed.easels, used.easelIds, isEaselId, MAX_EASEL_LENGTH);
  const counts = countState(state);
  const report: BackupReport = {
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt.slice(0, 64) : "",
    appVersion: typeof parsed.appVersion === "string" ? parsed.appVersion.slice(0, 32) : "",
    spaces: state.spaces.length,
    pinnedTabs: counts.pinnedTabs,
    todayTabs: counts.todayTabs,
    favorites: counts.favorites,
    folders: counts.folders,
    notes: Object.keys(notes).length,
    easels: Object.keys(easels).length,
    boosts: (state.boosts ?? []).length,
    leftOut: counter.leftOut,
    scriptsTurnedOff: counter.scriptsTurnedOff,
    extensionNames: readExtensionNames(isRecord(upgraded) ? upgraded.extensions : []),
  };
  return { isValid: true, backup: { state: state, notes: notes, easels: easels, report: report } };
}

// ---------- Restoring ----------

/**
 * The backup's setup in place of the current one. What belongs to this Mac stays: the open windows (they fall back to
 * a Space that exists), the sidebar new windows get, and the installed extensions.
 */
export function replaceFromBackup(current: BrowserState, restored: BrowserState): BrowserState {
  const replaced: BrowserState = {
    ...restored,
    version: current.version,
    focusedWindowId: current.focusedWindowId,
    otherWindows: current.otherWindows,
    extensions: current.extensions ?? [],
  };
  if (current.newWindowSidebar !== undefined) {
    replaced.newWindowSidebar = current.newWindowSidebar;
  }
  // This Mac's download folder stays (a backup never carries one: backup.ts leaves it out on reading).
  if (current.settings.downloadFolder !== undefined) {
    replaced.settings = { ...replaced.settings, downloadFolder: current.settings.downloadFolder };
  }
  return repairOtherWindows(repairSelections(replaced));
}

/** What adding a backup's Spaces did: the new state, and the new ids its notes and easels must be written under. */
export interface AddedFromBackup {
  state: BrowserState;
  noteIds: Record<string, string>;
  easelIds: Record<string, string>;
}

/**
 * Copies an item and everything inside it under new ids. Notes and easels get new ids too, so they never overwrite
 * one already here.
 */
function copyItemTree(restored: BrowserState, itemId: ItemId, now: number, target: Record<ItemId, SidebarItem>, files: { noteIds: Record<string, string>; easelIds: Record<string, string> }): ItemId | null {
  const item = restored.items[itemId];
  if (item === undefined) {
    return null;
  }
  if (item.kind !== "tab") {
    const childIds = item.childIds.map((childId) => copyItemTree(restored, childId, now, target, files)).filter((childId): childId is ItemId => childId !== null);
    const copy = { ...item, id: createId(item.kind, now), childIds: childIds };
    target[copy.id] = copy;
    return copy.id;
  }
  const copy: TabItem = { ...item, id: createId("tab", now), url: renameFileUrl(item.url, now, files), homeUrl: item.homeUrl === null ? null : renameFileUrl(item.homeUrl, now, files) };
  target[copy.id] = copy;
  return copy.id;
}

/**
 * A note or easel address under its new id (the same new id for every tab that shows it); other addresses unchanged.
 */
function renameFileUrl(url: string, now: number, files: { noteIds: Record<string, string>; easelIds: Record<string, string> }): string {
  const noteId = getNoteId(url);
  if (noteId !== null) {
    const newNoteId = files.noteIds[noteId] ?? createId("note", now);
    files.noteIds[noteId] = newNoteId;
    return createNoteUrl(newNoteId);
  }
  const easelId = getEaselId(url);
  if (easelId !== null) {
    const newEaselId = files.easelIds[easelId] ?? createId("easel", now);
    files.easelIds[easelId] = newEaselId;
    return createEaselUrl(newEaselId);
  }
  return url;
}

/**
 * Adds a backup's Spaces next to the current ones, with all their tabs, folders and split views under new ids. A
 * profile the backup's Spaces use is added when this Mac has none of that id. The backup's Favorites join their
 * profile up to its limit (the same address is not added twice), its Boosts join for sites without one, and its
 * Air Traffic Control rules join pointing at the new Spaces. The archive and settings stay as they are.
 */
export function addSpacesFromBackup(current: BrowserState, restored: BrowserState, now: number): AddedFromBackup {
  const files = { noteIds: {} as Record<string, string>, easelIds: {} as Record<string, string> };
  const items: Record<ItemId, SidebarItem> = { ...current.items };
  const profiles = current.profiles.map((profile) => ({ ...profile, favoriteIds: [...profile.favoriteIds] }));
  for (const restoredProfile of restored.profiles) {
    if (!profiles.some((profile) => profile.id === restoredProfile.id)) {
      profiles.push({ id: restoredProfile.id, name: restoredProfile.name, favoriteIds: [] });
    }
  }

  const spaceIdMap = new Map<SpaceId, SpaceId>();
  const addedSpaces: Space[] = restored.spaces.map((space) => {
    const newSpaceId = createId("space", now);
    spaceIdMap.set(space.id, newSpaceId);
    const pinnedIds = space.pinnedIds.map((itemId) => copyItemTree(restored, itemId, now, items, files)).filter((itemId): itemId is ItemId => itemId !== null);
    const todayIds = space.todayIds.map((itemId) => copyItemTree(restored, itemId, now, items, files)).filter((itemId): itemId is ItemId => itemId !== null);
    return { ...space, id: newSpaceId, pinnedIds: pinnedIds, todayIds: todayIds };
  });

  for (const restoredProfile of restored.profiles) {
    const profile = profiles.find((candidate) => candidate.id === restoredProfile.id);
    if (profile === undefined) {
      continue;
    }
    const presentAddresses = new Set(profile.favoriteIds.map((favoriteId) => readAddress(items[favoriteId])));
    for (const favoriteId of restoredProfile.favoriteIds) {
      const address = readAddress(restored.items[favoriteId]);
      if (profile.favoriteIds.length >= FAVORITES_LIMIT || address === null || presentAddresses.has(address)) {
        continue;
      }
      const copyId = copyItemTree(restored, favoriteId, now, items, files);
      if (copyId !== null) {
        profile.favoriteIds.push(copyId);
        presentAddresses.add(address);
      }
    }
  }

  const presentBoostSites = new Set((current.boosts ?? []).map((boost) => boost.site));
  const addedBoosts = (restored.boosts ?? []).filter((boost) => !presentBoostSites.has(boost.site));
  const presentRules = new Set((current.routingRules ?? []).map((rule) => `${rule.matchType}:${rule.value}`));
  const addedRules: RoutingRule[] = [];
  for (const rule of restored.routingRules ?? []) {
    const spaceId = spaceIdMap.get(rule.spaceId);
    if (spaceId !== undefined && !presentRules.has(`${rule.matchType}:${rule.value}`)) {
      addedRules.push({ ...rule, id: createId("rule", now), spaceId: spaceId });
    }
  }

  const selectedTabIdBySpace: Record<SpaceId, ItemId | null> = { ...current.selectedTabIdBySpace };
  for (const space of addedSpaces) {
    selectedTabIdBySpace[space.id] = null;
  }
  const state: BrowserState = {
    ...current,
    items: items,
    profiles: profiles,
    spaces: [...current.spaces, ...addedSpaces],
    selectedTabIdBySpace: selectedTabIdBySpace,
    boosts: [...(current.boosts ?? []), ...addedBoosts],
    routingRules: [...(current.routingRules ?? []), ...addedRules],
  };
  return { state: state, noteIds: files.noteIds, easelIds: files.easelIds };
}

/**
 * The address a tab stands for (its pinned home, or where it is), or null for anything else.
 */
function readAddress(item: SidebarItem | undefined): string | null {
  if (item === undefined || item.kind !== "tab") {
    return null;
  }
  return item.homeUrl ?? item.url;
}

// ---------- Automatic snapshots ----------

/** One of Bow's own backup files: what it is for, and when it was taken. */
export interface SnapshotFile {
  name: string;
  kind: "snapshot" | "beforeRestore";
  takenAt: number;
}

/** A day number (UTC) for keeping one snapshot per day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The snapshot files to delete so the folder keeps what is useful: the newest SNAPSHOTS_HOURLY_KEPT automatic ones,
 * then the newest of each day for SNAPSHOTS_DAILY_KEPT more days, and the newest BEFORE_RESTORE_SNAPSHOTS_KEPT copies
 * from before a restore.
 * Example: 20 hourly snapshots from today → the 8 oldest are deleted (one of today's is already kept as the newest)
 */
export function chooseSnapshotsToDelete(files: SnapshotFile[]): string[] {
  const newestFirst = [...files].sort((first, second) => second.takenAt - first.takenAt);
  const automatic = newestFirst.filter((file) => file.kind === "snapshot");
  const beforeRestore = newestFirst.filter((file) => file.kind === "beforeRestore");
  const kept = new Set(automatic.slice(0, SNAPSHOTS_HOURLY_KEPT).map((file) => file.name));
  const keptDays = new Set(automatic.slice(0, SNAPSHOTS_HOURLY_KEPT).map((file) => Math.floor(file.takenAt / DAY_MS)));
  let dailyKept = 0;
  for (const file of automatic.slice(SNAPSHOTS_HOURLY_KEPT)) {
    const day = Math.floor(file.takenAt / DAY_MS);
    if (keptDays.has(day) || dailyKept >= SNAPSHOTS_DAILY_KEPT) {
      continue;
    }
    keptDays.add(day);
    kept.add(file.name);
    dailyKept += 1;
  }
  for (const file of beforeRestore.slice(0, BEFORE_RESTORE_SNAPSHOTS_KEPT)) {
    kept.add(file.name);
  }
  return newestFirst.filter((file) => !kept.has(file.name)).map((file) => file.name);
}
