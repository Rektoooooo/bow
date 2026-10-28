/**
 * WHY this file exists:
 *   Sync between the user's own Macs without an account or a server: Bow keeps one file per Mac in a folder the user
 *   picks (iCloud Drive, Dropbox, a NAS) and reads the other Macs' files. This file is the pure part. The sidebar is
 *   cut into small units (a tab, a folder, a split view, a Space's name and look, a Space's Pinned order, the Space
 *   order, a profile's Favorites, a Boost, the Air Traffic Control rules, a Note, an Easel), each with a fingerprint
 *   and the time it last changed on the Mac that changed it. Merging goes unit by unit: the newer change wins, a
 *   deletion wins over older edits, and a unit changed on both Macs keeps this Mac's version when the two times are
 *   too close to tell (clocks differ). So renaming a tab on one Mac and pinning a page on the other keeps both.
 *   Today tabs, the Archive, windows, extensions and settings stay on each Mac; a live folder syncs its source and
 *   each Mac fills it.
 *
 * Data source:
 *   The BrowserState, the Notes and Easels of synced tabs, this Mac's sync meta (fingerprints, change times,
 *   deletions, what was merged from whom), and a peer's file, checked like a restored backup (backup.ts).
 *
 * Data flow:
 *   change here → collectUnits() → stampLocalChanges(meta) → buildSyncPayload() → this Mac's file
 *   a peer's file → parseSyncPayload() → mergePeer(state, meta, payload) → applyChange + Notes/Easels written
 *
 * Same rules as state.ts: never change what is passed in, return the same objects when nothing changed, `now` is a
 * parameter.
 */
import type { Boost, BrowserState, FolderItem, ItemId, ItemLocation, Profile, RoutingRule, SidebarItem, Space, SpaceTheme, SplitItem, TabItem } from "../shared/types";
import { getEaselId, isEaselId } from "../shared/easels";
import { createNoteUrl, getNoteId, isNoteId } from "../shared/notes";
import { checkBackupState } from "./backup";
import { MAX_EASEL_LENGTH } from "./easelsStore";
import { upgradeToCurrentVersion } from "./migrate";
import { MAX_NOTE_LENGTH } from "./notesStore";
import { deleteSpace } from "./spaces";
import { repairSelections } from "./state";
import { createId, deleteItems, findLocation, getIdsAt, insertIntoLocation } from "./tree";
import { repairOtherWindows } from "./windows";

/** What every sync file says it is. */
export const SYNC_FORMAT = "bow-sync";

/** The sync file format's version. A newer peer's file is not read until this Bow is updated. */
export const SYNC_FORMAT_VERSION = 1;

/** Two changes closer than this cannot be ordered across Macs whose clocks differ: this Mac's version stays. */
export const CLOCK_SKEW_GUARD_MS = 3000;

/** A deletion is remembered this long, so a Mac that was away for a while still learns of it. Our choice. */
export const TOMBSTONE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/** A Mac's id: letters, digits and dashes (it names that Mac's file). */
export const DEVICE_ID_PATTERN = /^[a-z0-9-]{8,64}$/;

/** A unit's fingerprint and when it last changed (on whichever Mac changed it). */
export interface UnitStamp {
  hash: string;
  updatedAt: number;
}

/** This Mac's sync bookkeeping (kept in its own file, never in the state, never in a backup). */
export interface SyncMeta {
  deviceId: string;
  stamps: Record<string, UnitStamp>;
  /** Units deleted, and when. Kept TOMBSTONE_LIFETIME_MS. */
  tombstones: Record<string, number>;
  /** For each peer, the time of its file last merged, and when this Mac merged it (for "changed on both"). */
  peers: Record<string, { writtenAt: number; mergedAt: number }>;
}

/** One Mac's sync file. */
export interface SyncPayload {
  format: typeof SYNC_FORMAT;
  formatVersion: number;
  deviceId: string;
  deviceName: string;
  writtenAt: number;
  /** The synced parts of the state: Spaces (without Today), their Pinned trees, Favorites, Boosts and rules. */
  state: BrowserState;
  stamps: Record<string, UnitStamp>;
  tombstones: Record<string, number>;
  notes: Record<string, string>;
  easels: Record<string, string>;
}

/** A unit as merging needs it: its fingerprint and its value. */
interface Unit {
  hash: string;
  value: unknown;
}

/** What merging a peer did. */
export interface MergeResult {
  state: BrowserState;
  meta: SyncMeta;
  /** Notes and Easels to write (by id), adopted from the peer or kept as a conflict copy. */
  notes: Record<string, string>;
  easels: Record<string, string>;
  /** Units changed on both Macs (this Mac's version stayed, or the other one's is kept as a copy). */
  conflicts: number;
}

// ---------- Fingerprints ----------

/** FNV-1a's 32-bit offset basis and prime. */
const HASH_OFFSET_BASIS = 0x811c9dc5;
const HASH_PRIME = 0x01000193;

/**
 * A short fingerprint of a value: the same value always gives the same text. Not for security, only for "changed?".
 */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  let hash = HASH_OFFSET_BASIS;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, HASH_PRIME) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(36)}`;
}

// ---------- Units ----------

/**
 * The part of a tab that syncs: its address (where it was pinned), names and home. Where it has browsed to since
 * stays on this Mac.
 */
function toSyncedTab(tab: TabItem): Pick<TabItem, "kind" | "id" | "url" | "title" | "customTitle" | "homeUrl"> {
  return { kind: "tab", id: tab.id, url: tab.homeUrl ?? tab.url, title: tab.title, customTitle: tab.customTitle, homeUrl: tab.homeUrl };
}

/**
 * The part of a folder that syncs. A live folder's children are filled by each Mac from its source, so they are left
 * out; whether a folder is open belongs to each window.
 */
function toSyncedFolder(folder: FolderItem): Omit<FolderItem, "isOpen"> {
  const synced: Omit<FolderItem, "isOpen"> = { kind: "folder", id: folder.id, title: folder.title, childIds: folder.live === undefined ? folder.childIds : [] };
  if (folder.live !== undefined) {
    synced.live = folder.live;
  }
  return synced;
}

/**
 * The part of an item that syncs.
 */
function toSyncedItem(item: SidebarItem): unknown {
  if (item.kind === "tab") {
    return toSyncedTab(item);
  }
  if (item.kind === "folder") {
    return toSyncedFolder(item);
  }
  const split: SplitItem = { kind: "split", id: item.id, childIds: item.childIds, orientation: item.orientation };
  return split;
}

/**
 * The ids of every synced item: everything reachable from the Spaces' Pinned lists and the Favorites, except the
 * children of live folders.
 */
export function collectSyncedItemIds(state: BrowserState): Set<ItemId> {
  const synced = new Set<ItemId>();
  const visit = (itemIds: ItemId[]): void => {
    for (const itemId of itemIds) {
      const item = state.items[itemId];
      if (item === undefined || synced.has(itemId)) {
        continue;
      }
      synced.add(itemId);
      const isLiveFolder = item.kind === "folder" && item.live !== undefined;
      if (item.kind !== "tab" && !isLiveFolder) {
        visit(item.childIds);
      }
    }
  };
  for (const space of state.spaces) {
    visit(space.pinnedIds);
  }
  for (const profile of state.profiles) {
    visit(profile.favoriteIds);
  }
  return synced;
}

/**
 * Adds a unit (its fingerprint is taken from its value).
 */
function addUnit(units: Map<string, Unit>, key: string, value: unknown): void {
  units.set(key, { hash: fingerprint(value), value: value });
}

/**
 * Every synced unit of a state, with the Notes and Easels its synced tabs use.
 */
export function collectUnits(state: BrowserState, notes: Record<string, string>, easels: Record<string, string>): Map<string, Unit> {
  const units = new Map<string, Unit>();
  const syncedItemIds = collectSyncedItemIds(state);
  for (const itemId of syncedItemIds) {
    const item = state.items[itemId] as SidebarItem;
    addUnit(units, `item:${itemId}`, toSyncedItem(item));
    const noteId = item.kind === "tab" ? getNoteId(item.url) : null;
    const easelId = item.kind === "tab" ? getEaselId(item.url) : null;
    if (noteId !== null && notes[noteId] !== undefined) {
      addUnit(units, `note:${noteId}`, notes[noteId]);
    }
    if (easelId !== null && easels[easelId] !== undefined) {
      addUnit(units, `easel:${easelId}`, easels[easelId]);
    }
  }
  for (const space of state.spaces) {
    addUnit(units, `space:${space.id}`, { name: space.name, icon: space.icon, theme: space.theme, profileId: space.profileId });
    addUnit(units, `pinned:${space.id}`, space.pinnedIds);
  }
  addUnit(units, "order", state.spaces.map((space) => space.id));
  for (const profile of state.profiles) {
    addUnit(units, `profile:${profile.id}`, { name: profile.name });
    addUnit(units, `favorites:${profile.id}`, profile.favoriteIds);
  }
  for (const boost of state.boosts ?? []) {
    addUnit(units, `boost:${boost.site}`, boost);
  }
  addUnit(units, "rules", state.routingRules ?? []);
  return units;
}

// ---------- This Mac's changes ----------

/**
 * Fresh bookkeeping for a Mac that has never synced.
 */
export function createSyncMeta(deviceId: string): SyncMeta {
  return { deviceId: deviceId, stamps: {}, tombstones: {}, peers: {} };
}

/**
 * Records what changed here: a unit whose fingerprint differs from the last one recorded changed now; a recorded
 * unit that is gone was deleted now. Deletions older than TOMBSTONE_LIFETIME_MS are forgotten. When the Mac joins a
 * folder that already has other Macs' files, `changedAt` is 0: everything here counts as older than theirs, so the
 * folder's setup wins where they differ (the Mac's own setup is kept in a "Before Sync" backup first).
 * Same meta when nothing changed.
 */
export function stampLocalChanges(meta: SyncMeta, units: Map<string, Unit>, now: number, changedAt: number = now): SyncMeta {
  let isChanged = false;
  const stamps = { ...meta.stamps };
  const tombstones = { ...meta.tombstones };
  for (const [key, unit] of units) {
    const stamp = stamps[key];
    if (stamp !== undefined && stamp.hash === unit.hash) {
      continue;
    }
    stamps[key] = { hash: unit.hash, updatedAt: changedAt };
    delete tombstones[key];
    isChanged = true;
  }
  for (const key of Object.keys(stamps)) {
    if (!units.has(key)) {
      delete stamps[key];
      tombstones[key] = now;
      isChanged = true;
    }
  }
  for (const [key, deletedAt] of Object.entries(tombstones)) {
    if (now - deletedAt > TOMBSTONE_LIFETIME_MS) {
      delete tombstones[key];
      isChanged = true;
    }
  }
  return isChanged ? { ...meta, stamps: stamps, tombstones: tombstones } : meta;
}

/**
 * This Mac's sync file: the synced parts of the state, the stamps, and the Notes and Easels its synced tabs use.
 */
export function buildSyncPayload(state: BrowserState, meta: SyncMeta, notes: Record<string, string>, easels: Record<string, string>, deviceName: string, now: number): SyncPayload {
  const syncedItemIds = collectSyncedItemIds(state);
  const items: Record<ItemId, SidebarItem> = {};
  const syncedNotes: Record<string, string> = {};
  const syncedEasels: Record<string, string> = {};
  for (const itemId of syncedItemIds) {
    const item = state.items[itemId] as SidebarItem;
    const isLiveFolder = item.kind === "folder" && item.live !== undefined;
    items[itemId] = isLiveFolder ? { ...item, childIds: [] } : item;
    const noteId = item.kind === "tab" ? getNoteId(item.url) : null;
    const easelId = item.kind === "tab" ? getEaselId(item.url) : null;
    if (noteId !== null && notes[noteId] !== undefined) {
      syncedNotes[noteId] = notes[noteId] as string;
    }
    if (easelId !== null && easels[easelId] !== undefined) {
      syncedEasels[easelId] = easels[easelId] as string;
    }
  }
  const spaces = state.spaces.map((space) => ({ ...space, todayIds: [] }));
  const payloadState: BrowserState = {
    ...state,
    items: items,
    spaces: spaces,
    selectedTabIdBySpace: {},
    otherWindows: [],
    archive: [],
    extensions: [],
    sitePermissions: [],
  };
  return {
    format: SYNC_FORMAT,
    formatVersion: SYNC_FORMAT_VERSION,
    deviceId: meta.deviceId,
    deviceName: deviceName,
    writtenAt: now,
    state: payloadState,
    stamps: meta.stamps,
    tombstones: meta.tombstones,
    notes: syncedNotes,
    easels: syncedEasels,
  };
}

// ---------- Reading a peer's file ----------

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A unit key: a known kind and an id (or one of the keys without an id). */
const UNIT_KEY_PATTERN = /^((item|space|pinned|profile|favorites|note|easel):[A-Za-z0-9._-]{1,200}|boost:[a-z0-9.-]{1,253}|order|rules)$/;

/**
 * The stamps of a peer's file: valid keys, numeric times, text fingerprints.
 */
function readStamps(raw: unknown): Record<string, UnitStamp> {
  const stamps: Record<string, UnitStamp> = {};
  for (const [key, value] of Object.entries(isRecord(raw) ? raw : {})) {
    const isStamp = isRecord(value) && typeof value.hash === "string" && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt);
    if (UNIT_KEY_PATTERN.test(key) && isStamp) {
      stamps[key] = { hash: (value.hash as string).slice(0, 64), updatedAt: value.updatedAt as number };
    }
  }
  return stamps;
}

/**
 * The deletions of a peer's file: valid keys and numeric times.
 */
function readTombstones(raw: unknown): Record<string, number> {
  const tombstones: Record<string, number> = {};
  for (const [key, value] of Object.entries(isRecord(raw) ? raw : {})) {
    if (UNIT_KEY_PATTERN.test(key) && typeof value === "number" && Number.isFinite(value)) {
      tombstones[key] = value;
    }
  }
  return tombstones;
}

/**
 * The Notes or Easels of a peer's file: valid ids, text within the limit.
 */
function readFiles(raw: unknown, isId: (value: unknown) => boolean, maxLength: number): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [fileId, content] of Object.entries(isRecord(raw) ? raw : {})) {
    if (isId(fileId) && typeof content === "string" && content.length <= maxLength) {
      files[fileId] = content;
    }
  }
  return files;
}

/**
 * Reads a peer's sync file. Null when it is not one, is from a newer Bow, or its sidebar can't be read. Its state is
 * checked like a restored backup (only safe addresses, real references, JavaScript Boosts off).
 */
export function parseSyncPayload(text: string): SyncPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const isPayload = parsed.format === SYNC_FORMAT && typeof parsed.formatVersion === "number" && parsed.formatVersion <= SYNC_FORMAT_VERSION;
  if (!isPayload || typeof parsed.deviceId !== "string" || !DEVICE_ID_PATTERN.test(parsed.deviceId) || typeof parsed.writtenAt !== "number") {
    return null;
  }
  const upgraded = upgradeToCurrentVersion(parsed.state);
  const state = upgraded === null ? null : checkBackupState(upgraded, { leftOut: 0, scriptsTurnedOff: 0 });
  if (state === null) {
    return null;
  }
  return {
    format: SYNC_FORMAT,
    formatVersion: parsed.formatVersion as number,
    deviceId: parsed.deviceId,
    deviceName: typeof parsed.deviceName === "string" ? parsed.deviceName.slice(0, 100) : "another Mac",
    writtenAt: parsed.writtenAt,
    state: state,
    stamps: readStamps(parsed.stamps),
    tombstones: readTombstones(parsed.tombstones),
    notes: readFiles(parsed.notes, isNoteId, MAX_NOTE_LENGTH),
    easels: readFiles(parsed.easels, isEaselId, MAX_EASEL_LENGTH),
  };
}

// ---------- Merging a peer ----------

/** What to do with each unit of a merge. */
interface MergePlan {
  adopt: string[];
  delete: string[];
  conflicts: number;
  stamps: Record<string, UnitStamp>;
  tombstones: Record<string, number>;
}

/**
 * Decides, unit by unit, whether the peer's version wins: a newer change (by more than CLOCK_SKEW_GUARD_MS) or a unit
 * this Mac does not have; a peer's deletion wins over an older change here; a deletion here wins over an older change
 * there. Adopted units take the peer's stamps, so they never count as changes made here (no ping-pong).
 */
function planMerge(meta: SyncMeta, payload: SyncPayload, remoteUnits: Map<string, Unit>): MergePlan {
  const plan: MergePlan = { adopt: [], delete: [], conflicts: 0, stamps: { ...meta.stamps }, tombstones: { ...meta.tombstones } };
  for (const [key, deletedAt] of Object.entries(payload.tombstones)) {
    const local = meta.stamps[key];
    const isNewerThanLocal = local === undefined || deletedAt > local.updatedAt;
    if (isNewerThanLocal && meta.tombstones[key] === undefined && payload.stamps[key] === undefined) {
      plan.delete.push(key);
      delete plan.stamps[key];
      plan.tombstones[key] = deletedAt;
    }
  }
  for (const [key, remoteStamp] of Object.entries(payload.stamps)) {
    const remoteUnit = remoteUnits.get(key);
    const local = meta.stamps[key];
    const localDeletedAt = meta.tombstones[key];
    if (remoteUnit === undefined || (localDeletedAt !== undefined && localDeletedAt >= remoteStamp.updatedAt)) {
      continue;
    }
    if (local !== undefined && local.hash === remoteUnit.hash) {
      continue;
    }
    const isNewer = local === undefined || remoteStamp.updatedAt > local.updatedAt + CLOCK_SKEW_GUARD_MS;
    if (!isNewer) {
      // Changed on both Macs within the clocks' uncertainty: this Mac's version stays, counted as a conflict.
      const isTooCloseToTell = local !== undefined && Math.abs(remoteStamp.updatedAt - local.updatedAt) <= CLOCK_SKEW_GUARD_MS;
      if (isTooCloseToTell) {
        plan.conflicts += 1;
      }
      continue;
    }
    plan.adopt.push(key);
    plan.stamps[key] = { hash: remoteUnit.hash, updatedAt: remoteStamp.updatedAt };
    delete plan.tombstones[key];
  }
  return plan;
}

/**
 * A synced item as it lands here: a tab keeps where it has browsed to on this Mac and how it was used; a folder keeps
 * whether it is open and, for a live folder, the children this Mac filled.
 */
function landItem(remote: SidebarItem, local: SidebarItem | undefined, now: number): SidebarItem | null {
  if (local !== undefined && local.kind !== remote.kind) {
    return null;
  }
  if (remote.kind === "tab") {
    const localTab = local as TabItem | undefined;
    // A tab new here opens where it was pinned; one already here stays where it has browsed to.
    const url = localTab === undefined ? (remote.homeUrl ?? remote.url) : localTab.url;
    const base: TabItem = localTab ?? { ...remote, lastActiveAt: now, isMuted: false };
    return { ...base, url: url, title: remote.title, customTitle: remote.customTitle, homeUrl: remote.homeUrl };
  }
  if (remote.kind === "folder") {
    const localFolder = local as FolderItem | undefined;
    const childIds = remote.live === undefined ? remote.childIds : (localFolder?.childIds ?? []);
    const folder: FolderItem = { kind: "folder", id: remote.id, title: remote.title, childIds: childIds, isOpen: localFolder?.isOpen ?? true };
    if (remote.live !== undefined) {
      folder.live = remote.live;
    }
    return folder;
  }
  return { kind: "split", id: remote.id, childIds: remote.childIds, orientation: remote.orientation };
}

/**
 * A Space's synced fields from the peer, on this Mac's Space (or a new Space without Today tabs).
 */
function landSpace(remote: Space, local: Space | undefined): Space {
  const fields = { name: remote.name, icon: remote.icon, theme: remote.theme as SpaceTheme, profileId: remote.profileId };
  if (local !== undefined) {
    return { ...local, ...fields };
  }
  return { id: remote.id, ...fields, pinnedIds: [], todayIds: [], isPinnedOpen: true };
}

/**
 * The Spaces in the peer's order: those it lists first, in its order, then this Mac's others where they were.
 */
function orderSpaces(spaces: Space[], order: string[]): Space[] {
  const byId = new Map(spaces.map((space) => [space.id, space]));
  const ordered = order.map((spaceId) => byId.get(spaceId)).filter((space): space is Space => space !== undefined);
  const rest = spaces.filter((space) => !order.includes(space.id));
  return [...ordered, ...rest];
}

/**
 * Every list (Favorites, Pinned, Today, folder and split children) keeps each item once, in the first list that
 * reaches it, and only items that exist; items no list reaches any more are deleted.
 */
function tidyLists(state: BrowserState): BrowserState {
  const seen = new Set<ItemId>();
  const items = { ...state.items };
  const keep = (itemIds: ItemId[]): ItemId[] => {
    const kept: ItemId[] = [];
    for (const itemId of itemIds) {
      const item = items[itemId];
      if (item === undefined || seen.has(itemId)) {
        continue;
      }
      seen.add(itemId);
      if (item.kind !== "tab") {
        items[itemId] = { ...item, childIds: keep(item.childIds) };
      }
      kept.push(itemId);
    }
    return kept;
  };
  const profiles = state.profiles.map((profile) => ({ ...profile, favoriteIds: keep(profile.favoriteIds) }));
  const spaces = state.spaces.map((space) => ({ ...space, pinnedIds: keep(space.pinnedIds), todayIds: keep(space.todayIds) }));
  const unreached = Object.keys(items).filter((itemId) => !seen.has(itemId));
  return deleteItems({ ...state, items: items, profiles: profiles, spaces: spaces }, unreached);
}

/**
 * Where a note's tab sits (for placing a conflict copy next to it), or null.
 */
function findNoteTab(state: BrowserState, noteId: string): { tabId: ItemId; location: ItemLocation } | null {
  const noteUrl = createNoteUrl(noteId);
  for (const item of Object.values(state.items)) {
    const location = item.kind === "tab" && item.url === noteUrl ? findLocation(state, item.id) : null;
    if (location !== null) {
      return { tabId: item.id, location: location };
    }
  }
  return null;
}

/**
 * Applies the peer's units that won to the state.
 */
function applyAdoptedUnits(state: BrowserState, payload: SyncPayload, keys: string[], now: number): BrowserState {
  const items = { ...state.items };
  for (const key of keys.filter((candidate) => candidate.startsWith("item:"))) {
    const itemId = key.slice("item:".length);
    const remote = payload.state.items[itemId];
    const landed = remote === undefined ? null : landItem(remote, items[itemId], now);
    if (landed !== null) {
      items[itemId] = landed;
    }
  }
  let spaces = [...state.spaces];
  let profiles = state.profiles.map((profile) => ({ ...profile }));
  for (const key of keys) {
    const separatorIndex = key.indexOf(":");
    const kind = key.slice(0, separatorIndex);
    const id = key.slice(separatorIndex + 1);
    const remoteSpace = payload.state.spaces.find((space) => space.id === id);
    if (kind === "space" && remoteSpace !== undefined) {
      const index = spaces.findIndex((space) => space.id === id);
      const landed = landSpace(remoteSpace, spaces[index]);
      spaces = index === -1 ? [...spaces, landed] : spaces.map((space) => (space.id === id ? landed : space));
    }
    if (kind === "pinned" && remoteSpace !== undefined) {
      spaces = spaces.map((space) => (space.id === id ? { ...space, pinnedIds: remoteSpace.pinnedIds } : space));
    }
    const remoteProfile = payload.state.profiles.find((profile) => profile.id === id);
    if ((kind === "profile" || kind === "favorites") && remoteProfile !== undefined) {
      profiles = landProfile(profiles, remoteProfile, kind === "favorites");
    }
  }
  if (keys.includes("order")) {
    spaces = orderSpaces(spaces, payload.state.spaces.map((space) => space.id));
  }
  const boosts = landBoosts(state.boosts ?? [], payload.state.boosts ?? [], keys);
  const routingRules: RoutingRule[] = keys.includes("rules") ? (payload.state.routingRules ?? []) : (state.routingRules ?? []);
  return { ...state, items: items, spaces: spaces, profiles: profiles, boosts: boosts, routingRules: routingRules };
}

/**
 * A profile from the peer: its name, or its Favorites list. A profile this Mac lacks is added.
 */
function landProfile(profiles: Profile[], remote: Profile, isFavorites: boolean): Profile[] {
  const local = profiles.find((profile) => profile.id === remote.id);
  if (local === undefined) {
    return [...profiles, { id: remote.id, name: remote.name, favoriteIds: isFavorites ? remote.favoriteIds : [] }];
  }
  const landed = isFavorites ? { ...local, favoriteIds: remote.favoriteIds } : { ...local, name: remote.name };
  return profiles.map((profile) => (profile.id === remote.id ? landed : profile));
}

/**
 * The Boosts after the peer's winning ones replace or join this Mac's (JavaScript arrives switched off: backup.ts).
 */
function landBoosts(local: Boost[], remote: Boost[], keys: string[]): Boost[] {
  const adoptedSites = new Set(keys.filter((key) => key.startsWith("boost:")).map((key) => key.slice("boost:".length)));
  const kept = local.filter((boost) => !adoptedSites.has(boost.site));
  const adopted = remote.filter((boost) => adoptedSites.has(boost.site));
  return [...kept, ...adopted];
}

/**
 * Applies the peer's deletions: items and Boosts go; a Space goes the way deleting it here goes (its tabs to the
 * Archive), unless it is the last one.
 */
function applyDeletions(state: BrowserState, keys: string[], now: number): BrowserState {
  let changed = state;
  const itemIds = keys.filter((key) => key.startsWith("item:")).map((key) => key.slice("item:".length));
  const deletedSites = new Set(keys.filter((key) => key.startsWith("boost:")).map((key) => key.slice("boost:".length)));
  if (deletedSites.size > 0) {
    changed = { ...changed, boosts: (changed.boosts ?? []).filter((boost) => !deletedSites.has(boost.site)) };
  }
  for (const key of keys.filter((candidate) => candidate.startsWith("space:"))) {
    changed = deleteSpace(changed, key.slice("space:".length), now);
  }
  return deleteItems(changed, itemIds);
}

/**
 * Merges a peer's file into this Mac's state. Returns the same state and meta objects when the peer brings nothing
 * new (its file was read before, or every unit already matches).
 */
export function mergePeer(state: BrowserState, meta: SyncMeta, payload: SyncPayload, localNotes: Record<string, string>, now: number): MergeResult {
  const unchanged: MergeResult = { state: state, meta: meta, notes: {}, easels: {}, conflicts: 0 };
  const lastMerged = meta.peers[payload.deviceId];
  if (payload.deviceId === meta.deviceId || (lastMerged !== undefined && payload.writtenAt <= lastMerged.writtenAt)) {
    return unchanged;
  }
  const remoteUnits = collectUnits(payload.state, payload.notes, payload.easels);
  const plan = planMerge(meta, payload, remoteUnits);
  const peers = { ...meta.peers, [payload.deviceId]: { writtenAt: payload.writtenAt, mergedAt: now } };
  if (plan.adopt.length === 0 && plan.delete.length === 0) {
    // Same stamps and deletions: this Mac's file has nothing new to say, so the peer is not answered (no ping-pong).
    return { ...unchanged, meta: { ...meta, peers: peers }, conflicts: plan.conflicts };
  }
  const mergedMeta: SyncMeta = { ...meta, stamps: plan.stamps, tombstones: plan.tombstones, peers: peers };

  const adopted = applyAdoptedUnits(state, payload, plan.adopt, now);
  const afterDeletions = applyDeletions(adopted, plan.delete, now);
  const notes: Record<string, string> = {};
  const easels: Record<string, string> = {};
  let merged = afterDeletions;
  let conflicts = plan.conflicts;
  for (const key of plan.adopt) {
    const fileId = key.slice(key.indexOf(":") + 1);
    if (key.startsWith("easel:")) {
      easels[fileId] = payload.easels[fileId] as string;
    }
    if (!key.startsWith("note:")) {
      continue;
    }
    notes[fileId] = payload.notes[fileId] as string;
    // Changed here too since the last merge with this Mac: this Mac's text is kept as a copy next to the note.
    const localStamp = meta.stamps[key];
    const wasChangedHere = localStamp !== undefined && lastMerged !== undefined && localStamp.updatedAt > lastMerged.mergedAt;
    const localText = localNotes[fileId];
    if (!wasChangedHere || localText === undefined) {
      continue;
    }
    const copy = keepConflictCopy(merged, fileId, payload.deviceName, now);
    if (copy !== null) {
      merged = copy.state;
      notes[copy.noteId] = localText;
      conflicts += 1;
    }
  }
  const tidied = repairOtherWindows(repairSelections(tidyLists(merged)));
  return { state: tidied, meta: mergedMeta, notes: notes, easels: easels, conflicts: conflicts };
}

/**
 * Puts a copy of a note right after its tab, named "… (before <peer>'s change)", so no text is lost when both Macs
 * changed it. Null when the note has no tab in a list.
 */
function keepConflictCopy(state: BrowserState, noteId: string, peerName: string, now: number): { state: BrowserState; noteId: string } | null {
  const placed = findNoteTab(state, noteId);
  if (placed === null) {
    return null;
  }
  const original = state.items[placed.tabId] as TabItem;
  const copyNoteId = createId("note", now);
  const copyTab: TabItem = { ...original, id: createId("tab", now), url: createNoteUrl(copyNoteId), homeUrl: original.homeUrl === null ? null : createNoteUrl(copyNoteId), customTitle: `${original.customTitle ?? original.title} (before ${peerName}'s change)` };
  const withTab: BrowserState = { ...state, items: { ...state.items, [copyTab.id]: copyTab } };
  const index = getIdsAt(withTab, placed.location).indexOf(placed.tabId) + 1;
  return { state: insertIntoLocation(withTab, placed.location, copyTab.id, index), noteId: copyNoteId };
}
