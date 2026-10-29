/**
 * WHY this file exists:
 *   Bookmarks from other browsers (Chrome, Dia, Brave, Edge, Vivaldi, Opera, Safari) arrive as a tree of folders and
 *   bookmarks. This turns such a tree into one closed folder in a Space's Pinned section, so nothing the user
 *   imports ends up scattered between their own pinned tabs. A browser with several profiles (Dia's spaces are
 *   profiles) comes over as one new Space per profile instead, each with its own Bow profile, its bookmarks as the
 *   Space's Pinned items.
 *
 * Data source:
 *   An ImportedBookmarkNode tree made by chromiumImport.ts or safariImport.ts, and the BrowserState to add to.
 *   Nothing is read from disk or the clock here: the caller passes `now`.
 *
 * Data flow:
 *   chromiumImport / safariImport parse a file → tree → addImportedBookmarks() → new state → main saves it
 *   several profiles → addProfilesAsSpaces() → new Spaces and profiles → main saves it
 *
 * Rules: never change the state that was passed in; return the same object when nothing would change (empty
 * tree, unknown Space). Folders without any bookmark inside are left out.
 */
import type { BrowserState, FolderItem, ItemId, SidebarItem, SpaceId, SpaceTheme, TabItem } from "../shared/types";
import { SPACES_LIMIT, STARTER_SPACE_IDS, createProfile, createSpace, removeEmptySpaces, setSpaceProfile, switchSpace } from "./spaces";
import { createId, getActiveSpace } from "./tree";

/** One bookmark from another browser. The address is always http(s): the parsers drop everything else. */
export interface ImportedBookmark {
  kind: "bookmark";
  title: string;
  url: string;
}

/** A bookmark folder from another browser, with its children in the source browser's order. */
export interface ImportedBookmarkFolder {
  kind: "folder";
  title: string;
  children: ImportedBookmarkNode[];
}

export type ImportedBookmarkNode = ImportedBookmark | ImportedBookmarkFolder;

/** Name of a nested folder whose source folder had no name. */
const FALLBACK_FOLDER_TITLE = "Folder";

/** Prefixes for new ids, as in the rest of the state code. */
const TAB_ID_PREFIX = "tab";
const FOLDER_ID_PREFIX = "folder";

/** Counts the bookmarks in a tree, at any depth. */
export function countBookmarks(nodes: ImportedBookmarkNode[]): number {
  let bookmarkCount = 0;
  for (const node of nodes) {
    bookmarkCount += node.kind === "bookmark" ? 1 : countBookmarks(node.children);
  }
  return bookmarkCount;
}

/**
 * Adds the nodes as items to `items` and returns their ids in order. Pinned tabs keep their address as home
 * address ("Reset tab" goes back to it), like the Arc importer does.
 */
function addNodes(items: Record<ItemId, SidebarItem>, nodes: ImportedBookmarkNode[], now: number): ItemId[] {
  const ids: ItemId[] = [];
  for (const node of nodes) {
    if (node.kind === "bookmark") {
      const hasTitle = node.title.trim().length > 0;
      const tab: TabItem = {
        kind: "tab",
        id: createId(TAB_ID_PREFIX, now),
        url: node.url,
        title: hasTitle ? node.title : node.url,
        customTitle: null,
        faviconUrl: null,
        homeUrl: node.url,
        lastActiveAt: now,
        isMuted: false,
      };
      items[tab.id] = tab;
      ids.push(tab.id);
      continue;
    }
    if (countBookmarks(node.children) === 0) {
      continue;
    }
    const hasTitle = node.title.trim().length > 0;
    const folder: FolderItem = {
      kind: "folder",
      id: createId(FOLDER_ID_PREFIX, now),
      title: hasTitle ? node.title : FALLBACK_FOLDER_TITLE,
      childIds: addNodes(items, node.children, now),
      isOpen: false,
    };
    items[folder.id] = folder;
    ids.push(folder.id);
  }
  return ids;
}

/**
 * Adds the tree as one closed folder named `folderTitle` at the end of the Space's Pinned list.
 * Returns the same state when the tree has no bookmarks or the Space does not exist.
 */
export function addImportedBookmarks(
  state: BrowserState,
  spaceId: string,
  folderTitle: string,
  tree: ImportedBookmarkNode[],
  now: number,
): BrowserState {
  const targetSpace = state.spaces.find((space) => space.id === spaceId);
  if (targetSpace === undefined || countBookmarks(tree) === 0) {
    return state;
  }

  const items: Record<ItemId, SidebarItem> = { ...state.items };
  const wrapperFolder: FolderItem = {
    kind: "folder",
    id: createId(FOLDER_ID_PREFIX, now),
    title: folderTitle,
    childIds: addNodes(items, tree, now),
    isOpen: false,
  };
  items[wrapperFolder.id] = wrapperFolder;

  const spaces = state.spaces.map((space) =>
    space.id === spaceId ? { ...space, pinnedIds: [...space.pinnedIds, wrapperFolder.id] } : space,
  );
  return { ...state, items: items, spaces: spaces };
}

/** One profile of another browser to bring over as a Space: its name and its bookmark tree. */
export interface ImportedProfile {
  name: string;
  tree: ImportedBookmarkNode[];
}

/** What addProfilesAsSpaces() did. */
export interface ProfileSpacesResult {
  state: BrowserState;
  /** The new Spaces, in the profiles' order. */
  spaceIds: SpaceId[];
  /** Profiles that found no room for a Space of their own (SPACES_LIMIT): their bookmarks went into a folder. */
  foldersInstead: string[];
}

/**
 * Appends the nodes to a Space's Pinned list. The first top folder opens out into the list (a browser's bookmarks
 * bar is its first folder: its links and folders become the Space's own); the other top folders stay folders.
 */
function addToPinned(state: BrowserState, spaceId: SpaceId, tree: ImportedBookmarkNode[], now: number): BrowserState {
  const firstNode = tree[0];
  const openedTree = firstNode !== undefined && firstNode.kind === "folder" ? [...firstNode.children, ...tree.slice(1)] : tree;
  const items: Record<ItemId, SidebarItem> = { ...state.items };
  const newIds = addNodes(items, openedTree, now);
  if (newIds.length === 0) {
    return state;
  }
  const spaces = state.spaces.map((space) => (space.id === spaceId ? { ...space, pinnedIds: [...space.pinnedIds, ...newIds] } : space));
  return { ...state, items: items, spaces: spaces };
}

/**
 * Brings each profile over as a new Space named after it, with a Bow profile of its own (its own cookies and
 * sign-ins, as the other browser kept them apart) and its bookmarks as the Space's Pinned items. Spaces take the
 * `themes` in turn. A profile that finds no room (SPACES_LIMIT) comes over as a folder named after it, in the last
 * new Space (or the active one). The empty starter Spaces go, and the first new Space opens. No profiles: the same
 * state.
 * Example: four Dia spaces → four new Spaces "Personal", "Work", "School", "Side project", four new profiles
 */
export function addProfilesAsSpaces(state: BrowserState, profiles: ImportedProfile[], themes: SpaceTheme[], now: number): ProfileSpacesResult {
  if (profiles.length === 0) {
    return { state: state, spaceIds: [], foldersInstead: [] };
  }
  let current = state;
  const spaceIds: SpaceId[] = [];
  const foldersInstead: string[] = [];
  profiles.forEach((profile, index) => {
    if (current.spaces.length >= SPACES_LIMIT) {
      const lastNewSpaceId = spaceIds.at(-1) ?? getActiveSpace(current).id;
      current = addImportedBookmarks(current, lastNewSpaceId, profile.name, profile.tree, now);
      foldersInstead.push(profile.name);
      return;
    }
    const withProfile = createProfile(current, profile.name, now);
    const theme = themes[index % Math.max(themes.length, 1)] ?? getActiveSpace(current).theme;
    // createSpace() opens the new Space, so the active Space is the new one.
    const withSpace = createSpace(withProfile.state, { name: profile.name, icon: "", theme: theme }, now);
    const newSpaceId = getActiveSpace(withSpace).id;
    const withOwnProfile = setSpaceProfile(withSpace, newSpaceId, withProfile.profileId);
    current = addToPinned(withOwnProfile, newSpaceId, profile.tree, now);
    spaceIds.push(newSpaceId);
  });
  const firstSpaceId = spaceIds[0];
  if (firstSpaceId === undefined) {
    return { state: current, spaceIds: spaceIds, foldersInstead: foldersInstead };
  }
  const withoutStarters = removeEmptySpaces(current, STARTER_SPACE_IDS);
  return { state: switchSpace(withoutStarters, firstSpaceId, now), spaceIds: spaceIds, foldersInstead: foldersInstead };
}
