/**
 * WHY this file exists:
 *   Arc's sidebar is arranged by dragging: a tab dragged into Pinned is pinned, into the Favorites row becomes a
 *   Favorite, onto a folder goes inside it, onto a Space button moves it to that Space. This file turns HTML drag and
 *   drop on the sidebar into one "moveItem" action. Links dragged in from a page or another app open as a new tab.
 *
 * Data source:
 *   Drag events, and the drop information each element carries as data attributes (set with markDropTarget() and
 *   markListDropZone()). Nothing is captured when an element is built: the sidebar keeps its elements across
 *   redraws (morph.ts), so a position read when the drop happens is always the current one.
 *
 * Data flow:
 *   dragstart on [draggable][data-item-id] → dragover on a [data-drop] element (line or highlight) → drop
 *   → dispatch moveItem / moveItemToSpace / openTab
 */
import type { ItemId, ItemLocation } from "../shared/types";
import { dispatch } from "./dom.js";

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
 * Writes a list location as text for a data attribute. Example: { kind: "today", spaceId: "s1" } → "today:s1"
 */
export function encodeLocation(location: ItemLocation): string {
  if (location.kind === "favorites") {
    return `favorites:${location.profileId}`;
  }
  if (location.kind === "folder") {
    return `folder:${location.folderId}`;
  }
  if (location.kind === "split") {
    return `split:${location.splitId}`;
  }
  return `${location.kind}:${location.spaceId}`;
}

/**
 * Reads a list location back from encodeLocation()'s text, or null when it is not one.
 */
export function decodeLocation(text: string | undefined): ItemLocation | null {
  if (text === undefined) {
    return null;
  }
  const separatorIndex = text.indexOf(":");
  const kind = text.slice(0, separatorIndex);
  const id = text.slice(separatorIndex + 1);
  if (separatorIndex === -1 || id === "") {
    return null;
  }
  if (kind === "favorites") {
    return { kind: "favorites", profileId: id };
  }
  if (kind === "folder") {
    return { kind: "folder", folderId: id };
  }
  if (kind === "split") {
    return { kind: "split", splitId: id };
  }
  if (kind === "pinned" || kind === "today") {
    return { kind: kind, spaceId: id };
  }
  return null;
}

/**
 * Lets an element be dragged as a sidebar item.
 */
export function markDraggable(element: HTMLElement, itemId: ItemId): void {
  element.draggable = true;
  element.dataset.itemId = itemId;
}

/**
 * Makes an element a drop target next to (or, for a folder, into) its item: its list, its position in it, and
 * whether its items sit side by side (Favorites tiles: left/right halves decide before/after).
 */
export function markDropTarget(element: HTMLElement, location: ItemLocation, index: number, intoFolderId: ItemId | null, isHorizontal: boolean = false): void {
  element.dataset.drop = "item";
  element.dataset.location = encodeLocation(location);
  element.dataset.index = String(index);
  if (intoFolderId !== null) {
    element.dataset.intoFolderId = intoFolderId;
  }
  if (isHorizontal) {
    element.dataset.horizontal = "true";
  }
}

/**
 * Makes an element (an empty section, the space below a list, a section title) drop items at the start or end of a
 * list.
 */
export function markListDropZone(element: HTMLElement, location: ItemLocation, position: "start" | "end"): void {
  element.dataset.drop = "list";
  element.dataset.location = encodeLocation(location);
  element.dataset.dropPosition = position;
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
 * Decides which part of an item target the pointer is over: before, after, or (folders only) inside.
 */
function findDropZone(event: DragEvent, element: HTMLElement): "before" | "after" | "into" {
  const rectangle = element.getBoundingClientRect();
  if (element.dataset.horizontal === "true") {
    const isLeftHalf = event.clientX < rectangle.left + rectangle.width / 2;
    return isLeftHalf ? "before" : "after";
  }
  const fraction = (event.clientY - rectangle.top) / rectangle.height;
  if (element.dataset.intoFolderId !== undefined) {
    if (fraction < FOLDER_EDGE_FRACTION) {
      return "before";
    }
    return fraction > 1 - FOLDER_EDGE_FRACTION ? "after" : "into";
  }
  return fraction < 0.5 ? "before" : "after";
}

function clearAllDropClasses(): void {
  for (const element of document.querySelectorAll<HTMLElement>(".drop-before, .drop-after, .drop-into")) {
    element.classList.remove(...DROP_CLASSES);
  }
}

/**
 * Returns the drop target under an event, or null.
 */
function findDropTarget(event: DragEvent): HTMLElement | null {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-drop]") : null;
  return target;
}

/**
 * True when something droppable is being dragged over a target: another sidebar item, or a link from outside.
 */
function acceptsDrag(event: DragEvent, target: HTMLElement): boolean {
  if (carriesExternalLink(event)) {
    return true;
  }
  return draggedItemId !== null && draggedItemId !== target.dataset.itemId;
}

/**
 * Shows where a drop over `target` would land.
 */
function showDropFeedback(event: DragEvent, target: HTMLElement): void {
  clearAllDropClasses();
  if (target.dataset.drop === "item") {
    target.classList.add(`drop-${findDropZone(event, target)}`);
    return;
  }
  target.classList.add("drop-into");
}

/**
 * Carries out a drop of the dragged sidebar item on a target.
 */
function dropItem(event: DragEvent, target: HTMLElement, itemId: ItemId): void {
  if (target.dataset.drop === "space") {
    const spaceId = target.dataset.spaceId;
    if (spaceId !== undefined) {
      dispatch({ type: "moveItemToSpace", itemId: itemId, spaceId: spaceId });
    }
    return;
  }
  const location = decodeLocation(target.dataset.location);
  if (location === null) {
    return;
  }
  if (target.dataset.drop === "list") {
    const index = target.dataset.dropPosition === "start" ? 0 : -1;
    dispatch({ type: "moveItem", itemId: itemId, target: location, index: index });
    return;
  }
  const zone = findDropZone(event, target);
  const intoFolderId = target.dataset.intoFolderId;
  if (zone === "into" && intoFolderId !== undefined) {
    dispatch({ type: "moveItem", itemId: itemId, target: { kind: "folder", folderId: intoFolderId }, index: -1 });
    return;
  }
  const targetIndex = Number(target.dataset.index ?? "0");
  const index = zone === "before" ? targetIndex : targetIndex + 1;
  dispatch({ type: "moveItem", itemId: itemId, target: location, index: index });
}

/**
 * Handles every drag and drop inside `root` with a few listeners on the root itself.
 */
export function installDragAndDrop(root: HTMLElement): void {
  root.addEventListener("dragstart", (event) => {
    const source = event.target instanceof Element ? event.target.closest<HTMLElement>("[draggable='true'][data-item-id]") : null;
    if (source === null || event.dataTransfer === null) {
      return;
    }
    const itemId = source.dataset.itemId ?? "";
    event.dataTransfer.setData(SIDEBAR_ITEM_TYPE, itemId);
    event.dataTransfer.effectAllowed = "move";
    draggedItemId = itemId;
    source.classList.add("is-dragging");
    notifyDragState(true);
  });
  root.addEventListener("dragend", (event) => {
    draggedItemId = null;
    const source = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-item-id]") : null;
    source?.classList.remove("is-dragging");
    clearAllDropClasses();
    notifyDragState(false);
  });
  root.addEventListener("dragover", (event) => {
    const target = findDropTarget(event);
    if (target === null || !acceptsDrag(event, target)) {
      return;
    }
    event.preventDefault();
    showDropFeedback(event, target);
  });
  root.addEventListener("dragleave", (event) => {
    const target = findDropTarget(event);
    target?.classList.remove(...DROP_CLASSES);
  });
  root.addEventListener("drop", (event) => {
    const target = findDropTarget(event);
    if (target === null) {
      return;
    }
    event.preventDefault();
    clearAllDropClasses();
    if (carriesExternalLink(event)) {
      openDroppedLink(event);
      return;
    }
    if (draggedItemId === null || draggedItemId === target.dataset.itemId) {
      return;
    }
    dropItem(event, target, draggedItemId);
  });
}
