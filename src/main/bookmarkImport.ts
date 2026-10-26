/**
 * WHY this file exists:
 *   Bookmarks from other browsers (Chrome, Brave, Edge, Vivaldi, Safari) arrive as a tree of folders and
 *   bookmarks. This turns such a tree into one closed folder in a Space's Pinned section, so nothing the user
 *   imports ends up scattered between their own pinned tabs.
 *
 * Data source:
 *   An ImportedBookmarkNode tree made by chromiumImport.ts or safariImport.ts, and the BrowserState to add to.
 *   Nothing is read from disk or the clock here: the caller passes `now`.
 *
 * Data flow:
 *   chromiumImport / safariImport parse a file → tree → addImportedBookmarks() → new state → main saves it
 *
 * Rules: never change the state that was passed in; return the same object when nothing would change (empty
 * tree, unknown Space). Folders without any bookmark inside are left out.
 */
import type { BrowserState, FolderItem, ItemId, SidebarItem, TabItem } from "../shared/types";
import { createId } from "./tree";

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
