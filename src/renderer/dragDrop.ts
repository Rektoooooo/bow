/**
 * WHY this file exists:
 *   Arc's sidebar is arranged by dragging: a tab dragged into Pinned is pinned, into the Favorites row becomes a
 *   Favorite, onto a folder goes inside it. This file wires HTML drag and drop on the sidebar rows and turns a drop
 *   into one "moveItem" action. Links dragged in from a page or another app open as a new tab.
 *
 * Data source:
 *   Drag events, and the drop information each row registers (its list, its position, and whether it is a folder).
 *
 * Data flow:
 *   dragstart on a row → dragover on another row (shows a line or highlight) → drop → dispatch moveItem / openTab
 */
import type { ItemId, ItemLocation } from "../shared/types";
import { dispatch } from "./dom.js";

/** Where a drop on an element lands. */
export interface DropTargetInfo {
  /** The list the element's item sits in. */
  location: ItemLocation;
  /** The element's position in that list. */
  index: number;
  /** For a folder row: the folder, so a drop on its middle goes inside it. */
  intoFolderId: ItemId | null;
  /** True for Favorites tiles, which sit side by side: left/right halves decide before/after. */
  isHorizontal?: boolean;
}

/** The type name under which a dragged sidebar item's id travels. */
const SIDEBAR_ITEM_TYPE = "application/x-sidebar-item";

/** Part of a folder row (top and bottom) that still means "before" / "after" instead of "inside". */
const FOLDER_EDGE_FRACTION = 0.25;

/** CSS classes that show where a drop will land. */
const DROP_CLASSES = ["drop-before", "drop-after", "drop-into"];

/** The item being dragged right now. dataTransfer cannot be read during dragover, so it is kept here. */
let draggedItemId: ItemId | null = null;

/** Listeners told when a drag starts and ends (sidebar.ts holds redraws during a drag). */
const dragStateListeners: ((isDragging: boolean) => void)[] = [];

/**
 * Registers a function to hear when a drag starts and ends.
 */
export function onDragStateChanged(listener: (isDragging: boolean) => void): void {
  dragStateListeners.push(listener);
}

function notifyDragState(isDragging: boolean): void {
  for (const listener of dragStateListeners) {
    listener(isDragging);
  }
}

/**
 * Lets an element be dragged as a sidebar item.
 */
export function makeDraggable(element: HTMLElement, itemId: ItemId): void {
  element.draggable = true;
  element.addEventListener("dragstart", (event) => {
    if (event.dataTransfer === null) {
      return;
    }
    event.dataTransfer.setData(SIDEBAR_ITEM_TYPE, itemId);
    event.dataTransfer.effectAllowed = "move";
    draggedItemId = itemId;
    element.classList.add("is-dragging");
    notifyDragState(true);
  });
  element.addEventListener("dragend", () => {
    draggedItemId = null;
    element.classList.remove("is-dragging");
    clearAllDropClasses();
    notifyDragState(false);
  });
}

/**
 * True when the drag carries a link from outside the sidebar (a page or another app).
 */
function carriesExternalLink(event: DragEvent): boolean {
  const types = event.dataTransfer === null ? [] : Array.from(event.dataTransfer.types);
  return draggedItemId === null && types.includes("text/uri-list");
}

/**
 * Opens a link dropped from outside as a new Today tab. Only the first link counts.
 */
function openDroppedLink(event: DragEvent): void {
  if (event.dataTransfer === null) {
    return;
  }
  const uriList = event.dataTransfer.getData("text/uri-list");
  const firstLink = uriList.split("\n").find((line) => line.trim() !== "" && !line.startsWith("#"));
  if (firstLink !== undefined) {
    dispatch({ type: "openTab", typedText: firstLink.trim() });
  }
}

/**
 * Decides which part of the element the pointer is over: before, after, or (folders only) inside.
 */
function findDropZone(event: DragEvent, element: HTMLElement, info: DropTargetInfo): "before" | "after" | "into" {
  const rectangle = element.getBoundingClientRect();
  if (info.isHorizontal === true) {
    const isLeftHalf = event.clientX < rectangle.left + rectangle.width / 2;
    return isLeftHalf ? "before" : "after";
  }

  const fraction = (event.clientY - rectangle.top) / rectangle.height;
  if (info.intoFolderId !== null) {
    if (fraction < FOLDER_EDGE_FRACTION) {
      return "before";
    }
    return fraction > 1 - FOLDER_EDGE_FRACTION ? "after" : "into";
  }
  return fraction < 0.5 ? "before" : "after";
}

function clearDropClasses(element: HTMLElement): void {
  element.classList.remove(...DROP_CLASSES);
}

function clearAllDropClasses(): void {
  for (const element of document.querySelectorAll<HTMLElement>(".drop-before, .drop-after, .drop-into")) {
    clearDropClasses(element);
  }
}

/**
 * Makes an element accept drops. Sidebar items move next to it (or into it, for a folder); links open as tabs.
 */
export function makeDropTarget(element: HTMLElement, info: DropTargetInfo): void {
  element.addEventListener("dragover", (event) => {
    const isOwnDrag = draggedItemId !== null && draggedItemId !== element.dataset.itemId;
    if (!isOwnDrag && !carriesExternalLink(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    clearAllDropClasses();
    element.classList.add(`drop-${findDropZone(event, element, info)}`);
  });
  element.addEventListener("dragleave", () => clearDropClasses(element));
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearAllDropClasses();
    if (carriesExternalLink(event)) {
      openDroppedLink(event);
      return;
    }
    if (draggedItemId === null || draggedItemId === element.dataset.itemId) {
      return;
    }

    const zone = findDropZone(event, element, info);
    if (zone === "into" && info.intoFolderId !== null) {
      dispatch({ type: "moveItem", itemId: draggedItemId, target: { kind: "folder", folderId: info.intoFolderId }, index: -1 });
      return;
    }
    const index = zone === "before" ? info.index : info.index + 1;
    dispatch({ type: "moveItem", itemId: draggedItemId, target: info.location, index: index });
  });
}

/**
 * Makes an empty area (an empty section, the space below a list) accept drops at the start or end of a list.
 */
export function makeListDropZone(element: HTMLElement, location: ItemLocation, position: "start" | "end"): void {
  element.addEventListener("dragover", (event) => {
    if (draggedItemId === null && !carriesExternalLink(event)) {
      return;
    }
    event.preventDefault();
    clearAllDropClasses();
    element.classList.add("drop-into");
  });
  element.addEventListener("dragleave", () => clearDropClasses(element));
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    clearAllDropClasses();
    if (carriesExternalLink(event)) {
      openDroppedLink(event);
      return;
    }
    if (draggedItemId === null) {
      return;
    }
    const index = position === "start" ? 0 : -1;
    dispatch({ type: "moveItem", itemId: draggedItemId, target: location, index: index });
  });
}
