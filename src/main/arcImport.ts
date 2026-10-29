/**
 * WHY this file exists:
 *   People switching to this browser should not have to rebuild their sidebar by hand. This turns the sidebar
 *   file of Arc (the browser whose workflow we follow) into our own Spaces, Favorites, Pinned and Today items and
 *   themes, and adds them to the state the user already has.
 *
 * Data source:
 *   The parsed content of Arc's StorableSidebar.json, passed in as `arcFile` (unknown shape, never trusted), and
 *   the BrowserState to add to. The file format is described in docs/research/arc-data-model.md. Nothing is read
 *   from disk or the clock here: the caller reads the file and passes `now`.
 *
 * Data flow:
 *   main process reads and parses the file → importArcSidebar() → { new state, report } → main saves the state
 *   and shows the report to the user
 *
 * Rules: never change the state that was passed in; never throw. When the file cannot be understood, the same
 * state object comes back together with a report whose `error` says why.
 */
import { CARD_GAP_PX, DEFAULT_PROFILE_ID, FAVORITES_LIMIT, SPLIT_PANES_LIMIT } from "../shared/settings";
import type {
  BrowserState,
  FolderItem,
  ItemId,
  Profile,
  ProfileId,
  SidebarItem,
  Space,
  SpaceId,
  SpaceTheme,
  SplitItem,
  SplitOrientation,
  TabItem,
  ThemeAppearance,
} from "../shared/types";
import { arcProfileFolderToProfileId } from "./arcExtensionsImport";
import { DEFAULT_SPACE_ICON, SPACES_LIMIT } from "./spaces";

/** Arc stores times as seconds since 2001-01-01; Unix time starts in 1970. Source: docs/research/arc-data-model.md. */
const APPLE_EPOCH_OFFSET_SECONDS = 978307200;
const MILLISECONDS_PER_SECOND = 1000;

/** Prefixes that keep imported ids apart from ids this browser creates itself, and make a re-import recognizable. */
const SPACE_ID_PREFIX = "arc-space-";
const ITEM_ID_PREFIX = "arc-";

const FALLBACK_SPACE_NAME = "Imported Space";
const FALLBACK_FOLDER_TITLE = "Folder";

/** Only these addresses can be opened by our tabs. */
const WEB_URL_PATTERN = /^https?:\/\//i;

/**
 * Arc's built-in Space icon names and what we show for them: our own icon of the same kind (shared/spaceIcons.ts,
 * monochrome like Arc's), or an emoji where we have none. Names come from the binary's icon list.
 */
const ARC_ICON_TO_SPACE_ICON: Record<string, string> = {
  planet: "icon:planet",
  star: "icon:star",
  heart: "icon:heart",
  leaf: "icon:leaf",
  moon: "icon:moon",
  bookmark: "icon:bookmark",
  flag: "icon:flag",
  bulb: "icon:bulb",
  folder: "icon:folder",
  skull: "💀",
  rss: "📡",
};

/**
 * The theme of a Space whose Arc theme is missing or unreadable: Arc's neutral look (its saved palette for an uncolored
 * Space is grey: #313131 dark, #e5e5e5 light), which themePalette.ts draws from black.
 */
const DEFAULT_THEME_COLOR = "#000000";

/** A theme is one to three key colors (docs/research/arc-data-model.md, "Space theme"). */
const THEME_COLORS_LIMIT = 3;

/** Color channels are 0…1 in Arc and 0…255 in CSS hex. */
const MAX_CHANNEL_VALUE = 255;
const HEX_RADIX = 16;
const HEX_DIGITS_PER_CHANNEL = 2;

type JsonObject = Record<string, unknown>;

/** What happened during one import. All counts are about this run only. */
export interface ArcImportReport {
  spacesImported: number;
  /** Spaces skipped because an earlier import already created them. */
  spacesAlreadyImported: number;
  /** Spaces skipped because the Space limit was reached. */
  spacesDropped: number;
  tabsImported: number;
  foldersImported: number;
  splitViewsImported: number;
  favoritesImported: number;
  /** Favorites skipped because their Space already had the most Favorites allowed. */
  favoritesDropped: number;
  /** Folders (counted in foldersImported too) that Arc fills from GitHub. They become our GitHub live folders. */
  liveFolders: number;
  /** Items left out, by Arc's name for their kind, for example "easel" or "tabWithoutUrl". */
  skippedByKind: Record<string, number>;
  /** Why nothing was imported, or null when the file was understood. */
  error: string | null;
}

/** Where an imported item will sit, which decides whether folders and home addresses are allowed. */
type Placement = "pinned" | "today";

/** Everything the import changes while it runs. Copies of the caller's state, so the caller's state stays intact. */
interface ImportContext {
  arcItems: Map<string, JsonObject>;
  items: Record<ItemId, SidebarItem>;
  profiles: Profile[];
  spaces: Space[];
  /** The Spaces this run created from Arc's, in Arc's order: the first one with a profile gets that profile's Favorites. */
  importedSpaceIds: SpaceId[];
  /** The Space that was active before the import: it takes Favorites no imported Space can. */
  activeSpaceId: SpaceId;
  selectedTabIdBySpace: Record<string, ItemId | null>;
  /** Arc item ids already looked at, so a loop in Arc's data cannot make us run forever. */
  visitedArcItemIds: Set<string>;
  report: ArcImportReport;
  now: number;
}

function createEmptyReport(): ArcImportReport {
  return {
    spacesImported: 0,
    spacesAlreadyImported: 0,
    spacesDropped: 0,
    tabsImported: 0,
    foldersImported: 0,
    splitViewsImported: 0,
    favoritesImported: 0,
    favoritesDropped: 0,
    liveFolders: 0,
    skippedByKind: {},
    error: null,
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns parent[key] when it is an object, otherwise null. */
function readObject(parent: unknown, key: string): JsonObject | null {
  if (!isJsonObject(parent)) {
    return null;
  }
  const child = parent[key];
  return isJsonObject(child) ? child : null;
}

function readString(parent: unknown, key: string): string | null {
  if (!isJsonObject(parent)) {
    return null;
  }
  const child = parent[key];
  return typeof child === "string" ? child : null;
}

function readNumber(parent: unknown, key: string): number | null {
  if (!isJsonObject(parent)) {
    return null;
  }
  const child = parent[key];
  return typeof child === "number" && Number.isFinite(child) ? child : null;
}

function readArray(parent: unknown, key: string): unknown[] | null {
  if (!isJsonObject(parent)) {
    return null;
  }
  const child = parent[key];
  return Array.isArray(child) ? child : null;
}

/**
 * Reads one of Arc's flat dictionaries [key, value, key, value, …] as a list of pairs.
 * Example: ["a", 1, "b", 2] → [{key: "a", value: 1}, {key: "b", value: 2}]
 * A missing last value (odd length) is ignored.
 */
function readPairs(flatArray: unknown): Array<{ key: unknown; value: unknown }> {
  if (!Array.isArray(flatArray)) {
    return [];
  }
  const pairs: Array<{ key: unknown; value: unknown }> = [];
  for (let index = 0; index + 1 < flatArray.length; index += 2) {
    pairs.push({ key: flatArray[index], value: flatArray[index + 1] });
  }
  return pairs;
}

/** Arc enums are one-key objects: {"tab": {...}} → "tab". Returns null for anything else. */
function readEnumCaseName(enumObject: unknown): string | null {
  if (!isJsonObject(enumObject)) {
    return null;
  }
  const caseNames = Object.keys(enumObject);
  return caseNames.length === 1 ? caseNames[0] : null;
}

function countSkipped(report: ArcImportReport, kindName: string): void {
  const previousCount = report.skippedByKind[kindName] ?? 0;
  report.skippedByKind[kindName] = previousCount + 1;
}

function appleSecondsToUnixMilliseconds(appleSeconds: number): number {
  return (appleSeconds + APPLE_EPOCH_OFFSET_SECONDS) * MILLISECONDS_PER_SECOND;
}

function clampBetween(value: number, lowest: number, highest: number): number {
  return Math.min(highest, Math.max(lowest, value));
}

/**
 * Converts Arc's color {red, green, blue, alpha} (channels 0…1, sometimes slightly outside) to "#rrggbb".
 * Alpha is ignored: our themes are opaque. Returns null when a channel is missing.
 */
function colorToHex(arcColor: unknown): string | null {
  const channelNames = ["red", "green", "blue"];
  let hex = "#";
  for (const channelName of channelNames) {
    const channelValue = readNumber(arcColor, channelName);
    if (channelValue === null) {
      return null;
    }
    const clampedValue = clampBetween(channelValue, 0, 1);
    const channelByte = Math.round(clampedValue * MAX_CHANNEL_VALUE);
    const channelHex = channelByte.toString(HEX_RADIX);
    hex += channelHex.padStart(HEX_DIGITS_PER_CHANNEL, "0");
  }
  return hex;
}

/** Reads the key colors of a theme: one color for a flat theme, up to three for a gradient. */
function readThemeColors(themeBackground: JsonObject): string[] {
  const style = readObject(themeBackground, "style");
  const colorChoice = readObject(readObject(style, "color"), "_0");
  const singleColor = readObject(readObject(colorChoice, "blendedSingleColor"), "_0");
  const gradient = readObject(readObject(colorChoice, "blendedGradient"), "_0");

  if (singleColor !== null) {
    const singleHex = colorToHex(singleColor["color"]);
    return singleHex === null ? [] : [singleHex];
  }

  const baseColors = readArray(gradient, "baseColors") ?? [];
  const colors: string[] = [];
  for (const baseColor of baseColors) {
    const hex = colorToHex(baseColor);
    if (hex !== null && colors.length < THEME_COLORS_LIMIT) {
      colors.push(hex);
    }
  }
  return colors;
}

/**
 * Reads the grain strength (Arc's noiseFactor).
 */
function readThemeGrain(themeBackground: JsonObject): number {
  return readThemeModifier(themeBackground, "noiseFactor") ?? 0;
}

/**
 * Reads one of the theme's modifiers (noiseFactor = grain, intensityFactor = intensity), clamped to 0…1, or null.
 * Arc's description puts `modifiers` next to the color choice, inside it, or on the background itself depending on
 * the theme kind, so all of those places are tried in that order.
 */
function readThemeModifier(themeBackground: JsonObject, modifierName: string): number | null {
  const style = readObject(themeBackground, "style");
  const colorChoice = readObject(readObject(style, "color"), "_0");
  const singleColor = readObject(readObject(colorChoice, "blendedSingleColor"), "_0");
  const gradient = readObject(readObject(colorChoice, "blendedGradient"), "_0");
  const modifierHolders = [style, singleColor, gradient, themeBackground];

  for (const modifierHolder of modifierHolders) {
    const value = readNumber(readObject(modifierHolder, "modifiers"), modifierName);
    if (value !== null) {
      return clampBetween(value, 0, 1);
    }
  }
  return null;
}

function readThemeAppearance(themeBackground: JsonObject): ThemeAppearance {
  const appearance = readString(themeBackground, "contentOverBackgroundAppearance");
  if (appearance === "light" || appearance === "dark") {
    return appearance;
  }
  return "auto";
}

function createDefaultTheme(): SpaceTheme {
  return { colors: [DEFAULT_THEME_COLOR], appearance: "auto", grain: 0 };
}

/** Turns a Space's customInfo.windowTheme into our theme. Falls back to the default when nothing is readable. */
function readArcTheme(customInfo: unknown): SpaceTheme {
  const windowTheme = readObject(customInfo, "windowTheme");
  const background = readObject(windowTheme, "background");
  const themeBackground = readObject(background, "single");
  const themeBackgroundPayload = readObject(themeBackground, "_0");
  if (themeBackgroundPayload === null) {
    return createDefaultTheme();
  }

  const colors = readThemeColors(themeBackgroundPayload);
  if (colors.length === 0) {
    return createDefaultTheme();
  }
  return {
    colors: colors,
    appearance: readThemeAppearance(themeBackgroundPayload),
    grain: readThemeGrain(themeBackgroundPayload),
    intensity: readThemeModifier(themeBackgroundPayload, "intensityFactor") ?? 1,
  };
}

/** Picks the Space icon: the user's own emoji, a mapped built-in icon, or our default. */
function readArcIcon(customInfo: unknown): string {
  const iconType = readObject(customInfo, "iconType");
  const ownEmoji = readString(iconType, "emoji");
  if (ownEmoji !== null && ownEmoji.length > 0) {
    return ownEmoji;
  }
  const iconName = readString(iconType, "icon");
  if (iconName === null) {
    return DEFAULT_SPACE_ICON;
  }
  return ARC_ICON_TO_SPACE_ICON[iconName] ?? DEFAULT_SPACE_ICON;
}

/**
 * Finds (or creates) the profile for an Arc profile key and returns its id.
 * {"default": true} → our default profile. {"custom": {"_0": {"directoryBasename": "Profile 1"}}} → "arc-profile-profile-1".
 * Returns null when the key is not understood.
 */
function resolveProfileId(context: ImportContext, arcProfileKey: unknown): ProfileId | null {
  if (!isJsonObject(arcProfileKey)) {
    return null;
  }
  if (arcProfileKey["default"] === true) {
    return DEFAULT_PROFILE_ID;
  }

  const customPayload = readObject(readObject(arcProfileKey, "custom"), "_0");
  const directoryBasename = readString(customPayload, "directoryBasename");
  if (directoryBasename === null || directoryBasename.length === 0) {
    return null;
  }

  const profileId = arcProfileFolderToProfileId(directoryBasename);
  const profileExists = context.profiles.some((profile) => profile.id === profileId);
  if (!profileExists) {
    context.profiles.push({ id: profileId, name: directoryBasename });
  }
  return profileId;
}

/**
 * Reads one Arc tab item into our tab. Returns null (and counts it) when the tab has no http(s) address.
 * Pinned and Favorite tabs keep their saved address as home address; Today tabs have none.
 */
function readArcTab(context: ImportContext, arcItemId: string, arcItem: JsonObject, keepsHomeUrl: boolean): TabItem | null {
  const tabData = readObject(readObject(arcItem, "data"), "tab");
  const savedUrl = readString(tabData, "savedURL");
  if (savedUrl === null || !WEB_URL_PATTERN.test(savedUrl)) {
    countSkipped(context.report, "tabWithoutUrl");
    return null;
  }

  const savedTitle = readString(tabData, "savedTitle");
  const hasSavedTitle = savedTitle !== null && savedTitle.trim().length > 0;
  const userTitle = readString(arcItem, "title");
  const hasUserTitle = userTitle !== null && userTitle.trim().length > 0;
  const lastActiveSeconds = readNumber(tabData, "timeLastActiveAt");

  return {
    kind: "tab",
    id: ITEM_ID_PREFIX + arcItemId,
    url: savedUrl,
    title: hasSavedTitle ? savedTitle : savedUrl,
    customTitle: hasUserTitle ? userTitle : null,
    faviconUrl: null,
    homeUrl: keepsHomeUrl ? savedUrl : null,
    lastActiveAt: lastActiveSeconds === null ? context.now : appleSecondsToUnixMilliseconds(lastActiveSeconds),
    isMuted: readString(tabData, "savedMuteStatus") === "mute",
  };
}

/**
 * Decides whether this Arc item should be imported now. False when it was already looked at in this run (a loop
 * or an item listed twice) or when an earlier import already created it (re-import must change nothing).
 */
function claimArcItem(context: ImportContext, arcItemId: string): boolean {
  if (context.visitedArcItemIds.has(arcItemId)) {
    return false;
  }
  context.visitedArcItemIds.add(arcItemId);
  const alreadyImported = (ITEM_ID_PREFIX + arcItemId) in context.items;
  return !alreadyImported;
}

/** Looks up an item that a children list names. Returns null when the id is not a string or the item is missing. */
function lookupArcItem(context: ImportContext, arcItemId: unknown): JsonObject | null {
  if (typeof arcItemId !== "string") {
    return null;
  }
  return context.arcItems.get(arcItemId) ?? null;
}

/** Imports a split view. Fewer than two usable tabs → the tabs sit directly in the parent list instead. */
function importSplitView(context: ImportContext, arcItemId: string, arcItem: JsonObject, placement: Placement): ItemId[] {
  const childArcIds = readArray(arcItem, "childrenIds") ?? [];
  const tabs: TabItem[] = [];
  for (const childArcId of childArcIds) {
    const childItem = lookupArcItem(context, childArcId);
    if (childItem === null || typeof childArcId !== "string" || !claimArcItem(context, childArcId)) {
      continue;
    }
    const childKind = readEnumCaseName(childItem["data"]) ?? "unknown";
    if (childKind !== "tab") {
      countSkipped(context.report, childKind);
      continue;
    }
    const tab = readArcTab(context, childArcId, childItem, placement === "pinned");
    if (tab !== null) {
      tabs.push(tab);
    }
  }

  for (const tab of tabs) {
    context.items[tab.id] = tab;
  }
  context.report.tabsImported += tabs.length;

  const tabIds = tabs.map((tab) => tab.id);
  if (tabs.length < 2) {
    return tabIds;
  }

  const splitData = readObject(readObject(arcItem, "data"), "splitView");
  const orientation: SplitOrientation = readString(splitData, "layoutOrientation") === "vertical" ? "vertical" : "horizontal";
  const paneIds = tabIds.slice(0, SPLIT_PANES_LIMIT);
  const overflowIds = tabIds.slice(SPLIT_PANES_LIMIT);
  const splitItem: SplitItem = { kind: "split", id: ITEM_ID_PREFIX + arcItemId, childIds: paneIds, orientation: orientation };
  context.items[splitItem.id] = splitItem;
  context.report.splitViewsImported += 1;
  return [splitItem.id, ...overflowIds];
}

/**
 * Imports a folder. In Pinned it becomes a folder with its children inside; Today cannot hold folders, so there
 * only the tabs inside it (in order) are returned.
 */
function importFolder(context: ImportContext, arcItemId: string, arcItem: JsonObject, placement: Placement): ItemId[] {
  const childIds = importItemList(context, readArray(arcItem, "childrenIds"), placement);
  if (placement === "today") {
    return childIds;
  }

  const listData = readObject(readObject(arcItem, "data"), "list");
  const liveFolderData = isJsonObject(listData) ? listData["automaticLiveFolderData"] : undefined;
  const dataSource = isJsonObject(liveFolderData) ? liveFolderData["dataSource"] : undefined;
  // Arc's GitHub source ({"github": {}}) is your pull requests, read with your GitHub sign-in, like ours.
  const isGitHubLiveFolder = isJsonObject(dataSource) && isJsonObject(dataSource["github"]);
  if (isGitHubLiveFolder) {
    context.report.liveFolders += 1;
  }

  const userTitle = readString(arcItem, "title");
  const hasUserTitle = userTitle !== null && userTitle.trim().length > 0;
  const folder: FolderItem = {
    kind: "folder",
    id: ITEM_ID_PREFIX + arcItemId,
    title: hasUserTitle ? userTitle : FALLBACK_FOLDER_TITLE,
    childIds: childIds,
    isOpen: true,
  };
  if (isGitHubLiveFolder) {
    folder.live = { source: { kind: "github", list: "pullRequests" }, hiddenUrls: [] };
  }
  context.items[folder.id] = folder;
  context.report.foldersImported += 1;
  return [folder.id];
}

/** Imports one Arc item and everything inside it. Returns the ids that belong in the parent's list, in order. */
function importItem(context: ImportContext, arcItemId: unknown, placement: Placement): ItemId[] {
  const arcItem = lookupArcItem(context, arcItemId);
  if (arcItem === null || typeof arcItemId !== "string" || !claimArcItem(context, arcItemId)) {
    return [];
  }

  const kind = readEnumCaseName(arcItem["data"]) ?? "unknown";
  if (kind === "list") {
    return importFolder(context, arcItemId, arcItem, placement);
  }
  if (kind === "splitView") {
    return importSplitView(context, arcItemId, arcItem, placement);
  }
  if (kind !== "tab") {
    countSkipped(context.report, kind);
    return [];
  }

  const tab = readArcTab(context, arcItemId, arcItem, placement === "pinned");
  if (tab === null) {
    return [];
  }
  context.items[tab.id] = tab;
  context.report.tabsImported += 1;
  return [tab.id];
}

/** Imports a list of Arc child ids (a container's or folder's `childrenIds`). */
function importItemList(context: ImportContext, childArcIds: unknown[] | null, placement: Placement): ItemId[] {
  const importedIds: ItemId[] = [];
  for (const childArcId of childArcIds ?? []) {
    const idsFromChild = importItem(context, childArcId, placement);
    importedIds.push(...idsFromChild);
  }
  return importedIds;
}

/** Returns the children of the container that a Space's `containerIDs` names under "pinned" or "unpinned". */
function readSpaceContainerChildren(context: ImportContext, arcSpace: JsonObject, containerRole: string): unknown[] | null {
  const containerPairs = readPairs(arcSpace["containerIDs"]);
  const matchingPair = containerPairs.find((pair) => pair.key === containerRole);
  const container = lookupArcItem(context, matchingPair?.value);
  return readArray(container, "childrenIds");
}

function importSpace(context: ImportContext, arcSpaceKey: unknown, arcSpace: unknown): void {
  if (typeof arcSpaceKey !== "string" || !isJsonObject(arcSpace)) {
    return;
  }
  const newSpaceId = SPACE_ID_PREFIX + arcSpaceKey;
  const alreadyImported = context.spaces.some((space) => space.id === newSpaceId);
  if (alreadyImported) {
    context.report.spacesAlreadyImported += 1;
    return;
  }
  if (context.spaces.length >= SPACES_LIMIT) {
    context.report.spacesDropped += 1;
    return;
  }

  const customInfo = arcSpace["customInfo"];
  const title = readString(arcSpace, "title");
  const trimmedTitle = title === null ? "" : title.trim();
  const profileId = resolveProfileId(context, arcSpace["profile"]) ?? DEFAULT_PROFILE_ID;
  const pinnedIds = importItemList(context, readSpaceContainerChildren(context, arcSpace, "pinned"), "pinned");
  const todayIds = importItemList(context, readSpaceContainerChildren(context, arcSpace, "unpinned"), "today");

  context.spaces.push({
    id: newSpaceId,
    name: trimmedTitle.length > 0 ? trimmedTitle : FALLBACK_SPACE_NAME,
    icon: readArcIcon(customInfo),
    theme: readArcTheme(customInfo),
    profileId: profileId,
    favoriteIds: [],
    pinnedIds: pinnedIds,
    todayIds: todayIds,
    isPinnedOpen: true,
  });
  context.importedSpaceIds.push(newSpaceId);
  context.selectedTabIdBySpace[newSpaceId] = null;
  context.report.spacesImported += 1;
}

/**
 * The Space that takes an Arc profile's Favorites (Arc keeps them per profile, we per Space): the first Space this run
 * imported with that profile, else the Space that was active before the import (an import without Spaces, or a
 * profile none of the imported Spaces uses).
 */
function findFavoritesSpace(context: ImportContext, profileId: ProfileId): Space | undefined {
  const importedSpaces = context.spaces.filter((space) => context.importedSpaceIds.includes(space.id));
  const spaceWithProfile = importedSpaces.find((space) => space.profileId === profileId);
  return spaceWithProfile ?? context.spaces.find((space) => space.id === context.activeSpaceId);
}

/** Adds one Favorites container's tabs to a Space, up to FAVORITES_LIMIT in total. */
function importFavoritesContainer(context: ImportContext, space: Space, containerChildIds: unknown[]): void {
  for (const childArcId of containerChildIds) {
    const childItem = lookupArcItem(context, childArcId);
    if (childItem === null || typeof childArcId !== "string" || !claimArcItem(context, childArcId)) {
      continue;
    }
    const kind = readEnumCaseName(childItem["data"]) ?? "unknown";
    if (kind !== "tab") {
      countSkipped(context.report, kind);
      continue;
    }
    const tab = readArcTab(context, childArcId, childItem, true);
    if (tab === null) {
      continue;
    }
    if (space.favoriteIds.length >= FAVORITES_LIMIT) {
      context.report.favoritesDropped += 1;
      continue;
    }
    context.items[tab.id] = tab;
    space.favoriteIds.push(tab.id);
    context.report.favoritesImported += 1;
  }
}

function importFavorites(context: ImportContext, topAppsContainerIds: unknown): void {
  for (const pair of readPairs(topAppsContainerIds)) {
    const profileId = resolveProfileId(context, pair.key);
    const space = profileId === null ? undefined : findFavoritesSpace(context, profileId);
    const container = lookupArcItem(context, pair.value);
    if (space === undefined || container === null) {
      countSkipped(context.report, "favoritesWithoutProfile");
      continue;
    }
    importFavoritesContainer(context, space, readArray(container, "childrenIds") ?? []);
  }
}

/** Finds the object that holds the live data: the container with spaces, items and topAppsContainerIDs. */
function findLiveContainer(arcFile: unknown): JsonObject | null {
  const sidebar = readObject(arcFile, "sidebar");
  const containers = readArray(sidebar, "containers");
  if (containers === null) {
    return null;
  }
  for (const container of containers) {
    const hasLiveKeys =
      isJsonObject(container) &&
      Array.isArray(container["spaces"]) &&
      Array.isArray(container["items"]) &&
      Array.isArray(container["topAppsContainerIDs"]);
    if (hasLiveKeys) {
      return container;
    }
  }
  return null;
}

function createArcItemMap(rawItems: unknown): Map<string, JsonObject> {
  const arcItems = new Map<string, JsonObject>();
  for (const pair of readPairs(rawItems)) {
    if (typeof pair.key === "string" && isJsonObject(pair.value)) {
      arcItems.set(pair.key, pair.value);
    }
  }
  return arcItems;
}

/**
 * Our sidebar width for the width the user gave Arc's, from the parsed StorableWindows.json (null when the file has
 * none): the preference new windows get, else the first window's. Arc's width reaches the page card (the user's Arc:
 * 254 pt with the card at 254), ours stops at the sidebar's content, the card gap before the card. Clamping is
 * setSidebarWidth()'s.
 * Example: { sidebarViewPreferences: { sidebarWidth: 254 } } → 247
 */
export function readArcSidebarWidth(windowsFile: unknown): number | null {
  const preferredWidth = readNumber(readObject(windowsFile, "sidebarViewPreferences"), "sidebarWidth");
  const firstWindow = readArray(windowsFile, "windows")?.[0];
  const firstWindowWidth = readNumber(firstWindow, "sidebarWidth");
  const arcWidth = preferredWidth ?? firstWindowWidth;
  if (arcWidth === null) {
    return null;
  }
  return Math.round(arcWidth - CARD_GAP_PX);
}

/** Which parts of Arc's sidebar an import brings: the Spaces (with their Pinned and Today tabs and themes), the Favorites. */
export interface ArcSidebarParts {
  spaces: boolean;
  favorites: boolean;
}

const ALL_SIDEBAR_PARTS: ArcSidebarParts = { spaces: true, favorites: true };

/**
 * Adds the Spaces, Favorites, Pinned and Today items and themes found in Arc's sidebar file to the state (the parts
 * asked for: the onboarding can leave the Spaces or the Favorites out). Safe to run twice: Spaces and items that exist
 * from an earlier import are skipped.
 * Example: importArcSidebar(parsedJson, state, Date.now()).report.spacesImported → 2
 */
export function importArcSidebar(arcFile: unknown, state: BrowserState, now: number, parts: ArcSidebarParts = ALL_SIDEBAR_PARTS): { state: BrowserState; report: ArcImportReport } {
  const report = createEmptyReport();
  const liveContainer = findLiveContainer(arcFile);
  if (liveContainer === null) {
    report.error = "This is not an Arc sidebar file: no container with spaces, items and Favorites was found.";
    return { state: state, report: report };
  }

  try {
    const context: ImportContext = {
      arcItems: createArcItemMap(liveContainer["items"]),
      items: { ...state.items },
      profiles: [...state.profiles],
      // Copies, because a Space's Favorites list grows while the import runs.
      spaces: state.spaces.map((space) => ({ ...space, favoriteIds: [...space.favoriteIds] })),
      importedSpaceIds: [],
      activeSpaceId: state.activeSpaceId,
      selectedTabIdBySpace: { ...state.selectedTabIdBySpace },
      visitedArcItemIds: new Set<string>(),
      report: report,
      now: now,
    };

    if (parts.spaces) {
      for (const pair of readPairs(liveContainer["spaces"])) {
        importSpace(context, pair.key, pair.value);
      }
    }
    if (parts.favorites) {
      importFavorites(context, liveContainer["topAppsContainerIDs"]);
    }

    const importedState: BrowserState = {
      ...state,
      items: context.items,
      profiles: context.profiles,
      spaces: context.spaces,
      selectedTabIdBySpace: context.selectedTabIdBySpace,
    };
    return { state: importedState, report: report };
  } catch (caughtError) {
    // Arc's file is outside our control; whatever surprise it holds must not crash the app or half-change the state.
    const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
    const failedReport = createEmptyReport();
    failedReport.error = `The Arc sidebar file could not be read: ${message}`;
    return { state: state, report: failedReport };
  }
}
