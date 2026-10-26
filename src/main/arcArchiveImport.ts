/**
 * WHY this file exists:
 *   Arc keeps the tabs that left the sidebar in an archive, and people search it to get a page back. Importing it
 *   next to the sidebar means those pages are not lost when someone switches browsers.
 *
 * Data source:
 *   The parsed content of Arc's StorableArchiveItems.json, passed in as `arcArchiveFile` (unknown shape, never
 *   trusted), and the BrowserState whose archive it is added to. The format is described in
 *   docs/research/arc-data-model.md. Nothing is read from disk or the clock here.
 *
 * Data flow:
 *   main process reads and parses the file → importArcArchive() → { new state, report } → arcImportController.ts
 *   attaches icons, saves the state and shows the report
 *
 * Rules: never change the state that was passed in; never throw. When the file cannot be understood, the same
 * state object comes back together with a report whose `error` says why.
 */
import { ARCHIVE_LIMIT } from "../shared/settings";
import type { ArchivedTab, ArchiveReason, BrowserState, TabItem } from "../shared/types";

/** Arc stores times as seconds since 2001-01-01; Unix time starts in 1970. Source: docs/research/arc-data-model.md. */
const APPLE_EPOCH_OFFSET_SECONDS = 978307200;
const MILLISECONDS_PER_SECOND = 1000;

/** Same prefixes as arcImport.ts, so ids stay recognizable and a second import finds the first one's tabs. */
const ITEM_ID_PREFIX = "arc-";
const SPACE_ID_PREFIX = "arc-space-";

/** Only these addresses can be opened by our tabs. */
const WEB_URL_PATTERN = /^https?:\/\//i;

type JsonObject = Record<string, unknown>;

export interface ArcArchiveImportReport {
  archivedImported: number;
  /** Entries that were not added: not a web address, already imported, or not readable. */
  archivedSkipped: number;
  error: string | null;
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

function appleSecondsToUnixMilliseconds(appleSeconds: number): number {
  return (appleSeconds + APPLE_EPOCH_OFFSET_SECONDS) * MILLISECONDS_PER_SECOND;
}

/**
 * Maps Arc's reason for archiving to ours. "clearButton" and "clearTabGroup" both mean the user cleared tabs;
 * anything we do not know counts as a manual archive.
 */
function convertReason(arcReason: string | null): ArchiveReason {
  if (arcReason === "auto") {
    return "auto";
  }
  if (arcReason === "clearButton" || arcReason === "clearTabGroup") {
    return "clear-button";
  }
  return "manual";
}

/**
 * Returns our id for the Space an item left, or null when Arc does not say or the Space is not in the state.
 * Source shape: {"space": {"_0": arcSpaceId}} | {"littleArc": {}} | {"unknown": {}}
 */
function findFromSpaceId(arcItem: JsonObject, state: BrowserState): string | null {
  const spaceSource = readObject(readObject(arcItem, "source"), "space");
  const arcSpaceId = readString(spaceSource, "_0");
  if (arcSpaceId === null) {
    return null;
  }
  const spaceId = SPACE_ID_PREFIX + arcSpaceId;
  const spaceExists = state.spaces.some((space) => space.id === spaceId);
  return spaceExists ? spaceId : null;
}

/**
 * Reads one archived item into our archived tab. Returns null when it has no http(s) address or no archive time.
 */
function readArchivedTab(arcItemId: string, arcItem: JsonObject, state: BrowserState): ArchivedTab | null {
  const sidebarItem = readObject(arcItem, "sidebarItem");
  const tabData = readObject(readObject(sidebarItem, "data"), "tab");
  const savedUrl = readString(tabData, "savedURL");
  const archivedAtSeconds = readNumber(arcItem, "archivedAt");
  if (savedUrl === null || !WEB_URL_PATTERN.test(savedUrl) || archivedAtSeconds === null) {
    return null;
  }

  const archivedAt = appleSecondsToUnixMilliseconds(archivedAtSeconds);
  const savedTitle = readString(tabData, "savedTitle");
  const hasSavedTitle = savedTitle !== null && savedTitle.trim().length > 0;
  const userTitle = readString(sidebarItem, "title");
  const hasUserTitle = userTitle !== null && userTitle.trim().length > 0;
  const lastActiveSeconds = readNumber(tabData, "timeLastActiveAt");

  const tab: TabItem = {
    kind: "tab",
    id: ITEM_ID_PREFIX + arcItemId,
    url: savedUrl,
    title: hasSavedTitle ? savedTitle : savedUrl,
    customTitle: hasUserTitle ? userTitle : null,
    faviconUrl: null,
    homeUrl: null,
    lastActiveAt: lastActiveSeconds === null ? archivedAt : appleSecondsToUnixMilliseconds(lastActiveSeconds),
    isMuted: readString(tabData, "savedMuteStatus") === "mute",
  };
  return {
    tab: tab,
    fromSpaceId: findFromSpaceId(arcItem, state),
    archivedAt: archivedAt,
    reason: convertReason(readString(arcItem, "reason")),
  };
}

/**
 * Adds the tabs of Arc's archive file to the archive of the state. Safe to run twice: tabs already there are skipped.
 * The archive stays newest first and keeps at most ARCHIVE_LIMIT entries.
 * `now` is part of the importers' shared signature (arcImport.ts takes it too); every time here comes from the file.
 */
export function importArcArchive(
  arcArchiveFile: unknown,
  state: BrowserState,
  _now: number,
): { state: BrowserState; report: ArcArchiveImportReport } {
  const report: ArcArchiveImportReport = { archivedImported: 0, archivedSkipped: 0, error: null };
  const flatItems = isJsonObject(arcArchiveFile) ? arcArchiveFile["items"] : null;
  if (!Array.isArray(flatItems)) {
    report.error = "The archive file has no list of items.";
    return { state: state, report: report };
  }

  const knownTabIds = new Set<string>(state.archive.map((archivedTab) => archivedTab.tab.id));
  for (const itemId of Object.keys(state.items)) {
    knownTabIds.add(itemId);
  }

  const importedTabs: ArchivedTab[] = [];
  // Arc's list is flat: [id, item, id, item, …]. A missing last item (odd length) is ignored.
  for (let index = 0; index + 1 < flatItems.length; index += 2) {
    const arcItemId: unknown = flatItems[index];
    const arcItem: unknown = flatItems[index + 1];
    const isReadable = typeof arcItemId === "string" && isJsonObject(arcItem);
    const archivedTab = isReadable ? readArchivedTab(arcItemId, arcItem, state) : null;
    if (archivedTab === null || knownTabIds.has(archivedTab.tab.id)) {
      report.archivedSkipped += 1;
      continue;
    }
    knownTabIds.add(archivedTab.tab.id);
    importedTabs.push(archivedTab);
    report.archivedImported += 1;
  }

  if (importedTabs.length === 0) {
    return { state: state, report: report };
  }
  const mergedArchive = [...state.archive, ...importedTabs];
  mergedArchive.sort((first, second) => second.archivedAt - first.archivedAt);
  return { state: { ...state, archive: mergedArchive.slice(0, ARCHIVE_LIMIT) }, report: report };
}
