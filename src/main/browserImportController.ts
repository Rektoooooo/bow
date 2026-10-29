/**
 * WHY this file exists:
 *   File › Import From Browser and the onboarding bring bookmarks and history from Chrome, Dia, Brave, Edge, Vivaldi,
 *   Opera, Chromium, Firefox or Safari, like Arc's own importer; from the Chromium browsers also their saved
 *   passwords (macOS asks once to let Bow read them). The readers (chromiumImport.ts, firefoxImport.ts,
 *   safariImport.ts) and the state change (bookmarkImport.ts) are separate; this file finds what can be imported and
 *   runs one import in two steps: prepare (read the files once and count, changing nothing) and apply (bring the
 *   chosen parts over). The onboarding shows the counts first; the menu brings both and shows a summary.
 *
 * Data source:
 *   The browsers' profile folders under ~/Library/Application Support (Firefox's listed in its profiles.ini), and
 *   ~/Library/Safari (macOS only lets us read Safari's files with Full Disk Access).
 *
 * Data flow:
 *   menu / Library → listImportSources() → importFromBrowser(sourceId) → prepareBrowserImport() → applyBrowserImport()
 *   → summary dialog
 *   onboardingWindow.ts → prepareBrowserImport() → counts on its card → applyBrowserImport(chosen parts)
 *   applyBrowserImport: addImportedBookmarks() → applyChange() → importChromiumPasswords() → importHistoryEntries()
 */
import { dialog, shell } from "electron";
import type { BrowserWindow } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { applyChange, getState, getWindow } from "./browserCore";
import { addImportedBookmarks, addProfilesAsSpaces, countBookmarks } from "./bookmarkImport";
import type { ImportedBookmarkNode, ProfileSpacesResult } from "./bookmarkImport";
import { findChromiumProfiles, readChromiumBookmarks, readChromiumHistory } from "./chromiumImport";
import { countChromiumLogins } from "./chromiumPasswords";
import { importChromiumPasswords } from "./chromiumPasswordsImport";
import type { ChromiumPasswordsOutcome, PasswordImportTarget } from "./chromiumPasswordsImport";
import { findFirefoxProfiles, readFirefoxProfile } from "./firefoxImport";
import type { HistoryEntry } from "./history";
import { countNewHistoryUrls, importHistoryEntries } from "./historyStore";
import { getImportHomeFolder } from "./importHome";
import { readSafariBookmarks, readSafariHistory } from "./safariImport";
import { THEME_PRESETS } from "./themePresets";
import { getActiveSpace } from "./tree";
import { IMPORT_PART_ORDER, formatCount, profileNounFor } from "../shared/onboarding";
import type { ImportFound, ImportPart } from "../shared/onboarding";
import type { ProfileId, SpaceId, SpaceTheme } from "../shared/types";

/** Something the user can import from, as the menus and the onboarding list it. */
export interface ImportSource {
  /** "safari", "chromium:<browser>:<profile folder>" or "firefox:<profile folder>". */
  id: string;
  /** "Google Chrome", or with the profile's name when the browser has several: "Google Chrome (Work)". */
  label: string;
  /** The browser it belongs to: "safari", "firefox", or a Chromium browser's id (chromiumImport.ts). */
  browserId: string;
  /** The browser's own name: "Google Chrome", "Dia", "Firefox". */
  browserName: string;
  /** The profile's name, or null for a browser without profiles to tell apart. */
  profileName: string | null;
}

/** Everything a browser import needs, read once; nothing has changed yet. */
export interface PreparedBrowserImport {
  browserName: string;
  bookmarks: ImportedBookmarkNode[];
  history: HistoryEntry[];
  /** Where the saved logins are and which Keychain item opens them; null when there are none to read. Never a secret. */
  loginSource: { profileFolder: string; keychainService: string } | null;
  found: ImportFound;
}

/** What a prepare found: the import, Safari waiting for Full Disk Access, or a source that is not on this Mac. */
export type BrowserPreparation = { prepared: PreparedBrowserImport } | { needsFullDiskAccess: true } | { isMissing: true };

/** What applying an import brought over. */
export interface BrowserImportResult {
  bookmarks: number;
  historyPages: number;
  /** How bringing the passwords went; null when they were not chosen or there are none. */
  passwords: ChromiumPasswordsOutcome | null;
}

/** One profile of a browser, read, to bring over as a Space of its own. */
export interface PreparedProfile {
  name: string;
  prepared: PreparedBrowserImport;
}

/** What bringing several profiles over did. */
export interface ProfileImportsResult {
  spaces: number;
  /** Profiles that came over as folders: no room for more Spaces. */
  foldersInstead: string[];
  historyPages: number;
  /** How bringing the passwords went; null when they were not chosen or there are none. */
  passwords: ChromiumPasswordsOutcome | null;
}

const SAFARI_SOURCE_ID = "safari";
const CHROMIUM_SOURCE_PREFIX = "chromium:";
const FIREFOX_SOURCE_PREFIX = "firefox:";

/** Where macOS keeps Safari's files. */
const SAFARI_FOLDER = path.join("Library", "Safari");

/** System Settings › Privacy & Security › Full Disk Access. */
const FULL_DISK_ACCESS_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

/**
 * The browsers and profiles on this Mac that have bookmarks or history to import.
 */
export function listImportSources(): ImportSource[] {
  const homeFolder = getImportHomeFolder();
  const chromiumProfiles = findChromiumProfiles(homeFolder);
  const sources: ImportSource[] = [];
  for (const profile of chromiumProfiles) {
    const sameBrowser = chromiumProfiles.filter((candidate) => candidate.browserId === profile.browserId);
    const profileName = sameBrowser.length > 1 || profile.displayName !== profile.folderName ? profile.displayName : null;
    sources.push({
      id: `${CHROMIUM_SOURCE_PREFIX}${profile.browserId}:${profile.folderName}`,
      label: profileName === null ? profile.browserName : `${profile.browserName} (${profileName})`,
      browserId: profile.browserId,
      browserName: profile.browserName,
      profileName: profileName,
    });
  }
  // One Firefox profile is just "Firefox"; several are told apart by their names.
  const firefoxProfiles = findFirefoxProfiles(homeFolder);
  for (const profile of firefoxProfiles) {
    const profileName = firefoxProfiles.length === 1 ? null : profile.displayName;
    const label = profileName === null ? "Firefox" : `Firefox (${profileName})`;
    sources.push({ id: `${FIREFOX_SOURCE_PREFIX}${profile.folderName}`, label: label, browserId: "firefox", browserName: "Firefox", profileName: profileName });
  }
  if (fs.existsSync(path.join(homeFolder, SAFARI_FOLDER))) {
    sources.push({ id: SAFARI_SOURCE_ID, label: "Safari", browserId: "safari", browserName: "Safari", profileName: null });
  }
  return sources;
}

/**
 * The counts of a browser import: its bookmarks, its saved logins and the sites not in our history yet.
 */
function countBrowserImport(bookmarks: ImportedBookmarkNode[], history: HistoryEntry[], passwordCount: number): ImportFound {
  const counts: Partial<Record<ImportPart, number>> = { bookmarks: countBookmarks(bookmarks), passwords: passwordCount, history: countNewHistoryUrls(history) };
  const parts = IMPORT_PART_ORDER.filter((part) => (counts[part] ?? 0) > 0);
  return { parts: parts, counts: counts, tabs: 0 };
}

/**
 * A prepared import of what was read. Safari and Firefox keep their passwords behind their own lock (the user brings
 * them as a file), so only a Chromium profile passes `loginSource` and the count of its logins.
 */
function toPreparation(
  browserName: string,
  bookmarks: ImportedBookmarkNode[],
  history: HistoryEntry[],
  loginSource: PreparedBrowserImport["loginSource"] = null,
  passwordCount = 0,
): BrowserPreparation {
  const found = countBrowserImport(bookmarks, history, passwordCount);
  return { prepared: { browserName: browserName, bookmarks: bookmarks, history: history, loginSource: loginSource, found: found } };
}

/**
 * Reads Safari's bookmarks (with the Reading List as a folder of its own) and history.
 */
async function prepareSafari(): Promise<BrowserPreparation> {
  const homeFolder = getImportHomeFolder();
  const bookmarks = await readSafariBookmarks(homeFolder);
  if (!bookmarks.ok && bookmarks.reason === "needsFullDiskAccess") {
    return { needsFullDiskAccess: true };
  }
  const tree: ImportedBookmarkNode[] = [];
  if (bookmarks.ok) {
    tree.push(...bookmarks.value.bookmarks);
    if (bookmarks.value.readingList.length > 0) {
      tree.push({ kind: "folder", title: "Reading List", children: bookmarks.value.readingList });
    }
  }
  const history = await readSafariHistory(homeFolder);
  return toPreparation("Safari", tree, history.ok ? history.value : []);
}

/**
 * Reads what one source from listImportSources() has, and counts it. Changes nothing.
 */
export async function prepareBrowserImport(sourceId: string): Promise<BrowserPreparation> {
  const homeFolder = getImportHomeFolder();
  if (sourceId === SAFARI_SOURCE_ID) {
    return prepareSafari();
  }
  if (sourceId.startsWith(FIREFOX_SOURCE_PREFIX)) {
    const firefoxProfile = findFirefoxProfiles(homeFolder).find((candidate) => `${FIREFOX_SOURCE_PREFIX}${candidate.folderName}` === sourceId);
    if (firefoxProfile === undefined) {
      return { isMissing: true };
    }
    const profileData = await readFirefoxProfile(firefoxProfile);
    return toPreparation("Firefox", profileData.bookmarks, profileData.history);
  }
  const profile = findChromiumProfiles(homeFolder).find((candidate) => `${CHROMIUM_SOURCE_PREFIX}${candidate.browserId}:${candidate.folderName}` === sourceId);
  if (profile === undefined) {
    return { isMissing: true };
  }
  const passwordCount = profile.hasLogins ? await countChromiumLogins(profile.profileFolder) : 0;
  const loginSource = passwordCount > 0 ? { profileFolder: profile.profileFolder, keychainService: profile.keychainService } : null;
  return toPreparation(profile.browserName, readChromiumBookmarks(profile), await readChromiumHistory(profile), loginSource, passwordCount);
}

/**
 * The Bow profile of a Space, and the profile of the active Space when the Space is gone.
 */
function findProfileOfSpace(spaceId: SpaceId): ProfileId {
  const state = getState();
  const space = state.spaces.find((candidate) => candidate.id === spaceId);
  return space?.profileId ?? getActiveSpace(state).profileId;
}

/**
 * Brings the chosen parts of a prepared import over: the bookmarks as one folder in the active Space, the saved
 * passwords into the active Space's profile (macOS asks to let Bow read them), then the history. `onPartDone` hears as
 * each lands (the onboarding ticks its checklist); the passwords are not reported when macOS did not allow them: the
 * result says so.
 */
export async function applyBrowserImport(prepared: PreparedBrowserImport, parts: ImportPart[], onPartDone: (part: ImportPart) => void): Promise<BrowserImportResult> {
  const result: BrowserImportResult = { bookmarks: 0, historyPages: 0, passwords: null };
  const bookmarkCount = countBookmarks(prepared.bookmarks);
  if (parts.includes("bookmarks") && bookmarkCount > 0) {
    const folderTitle = `${prepared.browserName} Bookmarks`;
    applyChange((state) => addImportedBookmarks(state, getActiveSpace(state).id, folderTitle, prepared.bookmarks, Date.now()));
    result.bookmarks = bookmarkCount;
    onPartDone("bookmarks");
  }
  if (parts.includes("passwords") && prepared.loginSource !== null) {
    const target: PasswordImportTarget = { profileFolder: prepared.loginSource.profileFolder, bowProfileId: getActiveSpace(getState()).profileId };
    result.passwords = await importChromiumPasswords([target], prepared.loginSource.keychainService, Date.now());
    if (result.passwords.kind === "imported") {
      onPartDone("passwords");
    }
  }
  if (parts.includes("history")) {
    result.historyPages = importHistoryEntries(prepared.history);
    onPartDone("history");
  }
  return result;
}

/**
 * Explains that macOS keeps Safari's files private, and offers to open the right settings pane. `window`: the window
 * the question is attached to.
 */
async function explainFullDiskAccess(window: BrowserWindow): Promise<void> {
  const answer = await dialog.showMessageBox(window, {
    type: "info",
    message: "Safari's bookmarks need your permission",
    detail:
      "macOS keeps Safari's files private. Turn on Bow in System Settings › Privacy & Security › Full Disk Access, then import again.",
    buttons: ["Open System Settings", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
  if (answer.response === 0) {
    await openFullDiskAccessSettings();
  }
}

/**
 * Opens System Settings at Full Disk Access (the onboarding's button, and the menu's question above).
 */
export async function openFullDiskAccessSettings(): Promise<void> {
  await shell.openExternal(FULL_DISK_ACCESS_SETTINGS_URL);
}

/** The two buttons of the question before a menu import that has passwords. The first is the default. */
const PASSWORDS_QUESTION_BUTTONS = ["Import Passwords Too", "Skip Passwords"];
const IMPORT_PASSWORDS_INDEX = 0;
const SKIP_PASSWORDS_INDEX = 1;

/**
 * Asks, in a sheet on the window, whether to bring the saved passwords too (the menu imports everything else without
 * asking; macOS will show its own question about the Keychain next). True: bring them. `browserName`: whose
 * passwords they are.
 */
export async function askToImportPasswords(window: BrowserWindow, browserName: string): Promise<boolean> {
  const answer = await dialog.showMessageBox(window, {
    type: "question",
    message: "Import passwords too?",
    detail: `macOS will ask to let Bow read ${browserName}'s saved passwords.`,
    buttons: PASSWORDS_QUESTION_BUTTONS,
    defaultId: IMPORT_PASSWORDS_INDEX,
    cancelId: SKIP_PASSWORDS_INDEX,
  });
  return answer.response === IMPORT_PASSWORDS_INDEX;
}

/**
 * The summary line about passwords after a menu import; null when they were not part of it.
 */
export function describePasswordsResult(outcome: ChromiumPasswordsOutcome | null): string | null {
  if (outcome === null) {
    return null;
  }
  if (outcome.kind === "denied") {
    return "Passwords: not imported, macOS did not let Bow read them.";
  }
  if (outcome.kind === "missing") {
    return "Passwords: not imported, the browser's key was not found in the Keychain.";
  }
  if (outcome.kind === "vaultUnavailable") {
    return "Passwords: not imported, Bow's password vault could not be opened.";
  }
  const alreadyCount = outcome.alreadySavedCount + outcome.keptDifferentCount;
  const alreadyNote = alreadyCount > 0 ? `, already in Bow: ${alreadyCount}` : "";
  return `Passwords: ${outcome.addedCount}${alreadyNote}.`;
}

/**
 * Tells the user what arrived.
 */
async function showSummary(window: BrowserWindow, browserName: string, result: BrowserImportResult): Promise<void> {
  const spaceName = getActiveSpace(getState()).name;
  const addedPasswords = result.passwords?.kind === "imported" ? result.passwords.addedCount : 0;
  const nothingNew = result.bookmarks === 0 && result.historyPages === 0 && addedPasswords === 0;
  const lines = [`Bookmarks: ${result.bookmarks}, in the folder "${browserName} Bookmarks" in ${spaceName}.`];
  const passwordsLine = describePasswordsResult(result.passwords);
  if (passwordsLine !== null) {
    lines.push(passwordsLine);
  }
  lines.push(`History: ${result.historyPages} pages.`);
  await dialog.showMessageBox(window, {
    type: "info",
    message: nothingNew ? `Nothing to import from ${browserName}` : `Imported from ${browserName}`,
    detail: nothingNew ? "No bookmarks, no passwords, and no pages that are not in your history already." : lines.join("\n"),
  });
}

/**
 * File › Import From Browser: brings one source's bookmarks, history and (after asking) passwords over and says what
 * arrived.
 */
export async function importFromBrowser(sourceId: string): Promise<void> {
  const window = getWindow();
  if (window === null) {
    return;
  }
  const preparation = await prepareBrowserImport(sourceId);
  if ("needsFullDiskAccess" in preparation) {
    await explainFullDiskAccess(window);
    return;
  }
  if ("isMissing" in preparation) {
    return;
  }
  const prepared = preparation.prepared;
  const hasPasswords = (prepared.found.counts.passwords ?? 0) > 0;
  const bringsPasswords = hasPasswords && (await askToImportPasswords(window, prepared.browserName));
  const parts = IMPORT_PART_ORDER.filter((part) => part !== "passwords" || bringsPasswords);
  const result = await applyBrowserImport(prepared, parts, () => undefined);
  await showSummary(window, prepared.browserName, result);
}

/**
 * The colors the imported profiles' Spaces take in turn: the light presets (themePresets.ts), so each Space is told
 * apart at a glance.
 */
function listProfileSpaceThemes(): SpaceTheme[] {
  const lightPresets = THEME_PRESETS.filter((preset) => preset.appearance !== "dark");
  return lightPresets.map((preset) => ({ colors: preset.colors, appearance: preset.appearance, grain: 0 }));
}

/**
 * The Bow profile each imported profile's logins go to: the profile of the Space it became. A profile that found no
 * room for a Space came over as a folder in the last new Space (or the active one), so its logins follow it there.
 */
function findProfileIdsOfImportedProfiles(profileCount: number, spaceIds: SpaceId[]): ProfileId[] {
  const lastSpaceId = spaceIds.at(-1);
  const profileIds: ProfileId[] = [];
  for (let index = 0; index < profileCount; index++) {
    const spaceId = spaceIds[index] ?? lastSpaceId;
    profileIds.push(spaceId === undefined ? getActiveSpace(getState()).profileId : findProfileOfSpace(spaceId));
  }
  return profileIds;
}

/**
 * Brings the saved passwords of several imported profiles in, with one request to macOS, each into the Bow profile its
 * Space got.
 */
async function importProfilePasswords(profiles: PreparedProfile[], spaceIds: SpaceId[]): Promise<ChromiumPasswordsOutcome | null> {
  const profileIds = findProfileIdsOfImportedProfiles(profiles.length, spaceIds);
  const targets: PasswordImportTarget[] = [];
  let keychainService: string | null = null;
  for (const [index, profile] of profiles.entries()) {
    const loginSource = profile.prepared.loginSource;
    const bowProfileId = profileIds[index];
    if (loginSource !== null && bowProfileId !== undefined) {
      keychainService = loginSource.keychainService;
      targets.push({ profileFolder: loginSource.profileFolder, bowProfileId: bowProfileId });
    }
  }
  if (keychainService === null) {
    return null;
  }
  return importChromiumPasswords(targets, keychainService, Date.now());
}

/**
 * Brings several profiles of one browser over at once (Dia's spaces): each becomes a Space of its own with its own Bow
 * profile and its bookmarks pinned (bookmarkImport.ts addProfilesAsSpaces), all their history comes in, and (when
 * `withPasswords`) their saved passwords, each into its Space's profile.
 */
export async function applyProfileImports(profiles: PreparedProfile[], withPasswords: boolean): Promise<ProfileImportsResult> {
  let historyPages = 0;
  for (const profile of profiles) {
    historyPages = historyPages + importHistoryEntries(profile.prepared.history);
  }
  const importedProfiles = profiles.map((profile) => ({ name: profile.name, tree: profile.prepared.bookmarks }));
  // A list, because the callback below fills it and TypeScript cannot see assignments to a plain variable there.
  const results: ProfileSpacesResult[] = [];
  applyChange((state) => {
    const result = addProfilesAsSpaces(state, importedProfiles, listProfileSpaceThemes(), Date.now());
    results.push(result);
    return result.state;
  });
  const result = results[0];
  const passwords = withPasswords ? await importProfilePasswords(profiles, result?.spaceIds ?? []) : null;
  return { spaces: result?.spaceIds.length ?? 0, foldersInstead: result?.foldersInstead ?? [], historyPages: historyPages, passwords: passwords };
}

/**
 * File › Import From Browser › "Dia, all 4 spaces…": reads every profile of a browser and brings them over at once,
 * each as its own Space (asking first about the passwords), then says what arrived.
 */
export async function importAllProfiles(browserId: string): Promise<void> {
  const window = getWindow();
  if (window === null) {
    return;
  }
  const sources = listImportSources().filter((source) => source.browserId === browserId);
  const profiles: PreparedProfile[] = [];
  for (const source of sources) {
    const preparation = await prepareBrowserImport(source.id);
    if ("prepared" in preparation) {
      profiles.push({ name: source.profileName ?? source.browserName, prepared: preparation.prepared });
    }
  }
  const browserName = sources[0]?.browserName ?? browserId;
  const noun = profileNounFor(browserId);
  const hasPasswords = profiles.some((profile) => profile.prepared.loginSource !== null);
  const bringsPasswords = hasPasswords && (await askToImportPasswords(window, browserName));
  const result = await applyProfileImports(profiles, bringsPasswords);
  const names = profiles.map((profile) => profile.name).join(", ");
  const folderLine = result.foldersInstead.length > 0 ? `\nNo room for more Spaces: ${result.foldersInstead.join(", ")} came over as folders.` : "";
  const passwordsLine = describePasswordsResult(result.passwords);
  const passwordsText = passwordsLine === null ? "" : `\n${passwordsLine}`;
  await dialog.showMessageBox(window, {
    type: "info",
    message: `Imported ${formatCount(profiles.length, noun)} from ${browserName}`,
    detail: `Each is a Space of its own, with its own sign-ins: ${names}.${folderLine}${passwordsText}\nHistory: ${result.historyPages} pages.`,
  });
}
