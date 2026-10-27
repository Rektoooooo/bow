/**
 * WHY this file exists:
 *   Arc's sidebar is arranged by dragging: a tab dragged into Pinned is pinned, into the Favorites row becomes a
 *   Favorite, onto a folder goes inside it, onto a Space button moves it to that Space. This file turns a drag on the
 *   sidebar into one "moveItem" action. Items are dragged with pointer events, not the system's drag and drop: the
 *   user could not even pick a tab up with the system's (2026-10-27), while presses and clicks always arrive. A copy
 *   of the item follows the pointer. Released over another main window, main hands the drop to that window's
 *   sidebar. Links dragged in from a page or another app (a system drag) still open as a new tab.
 *
 * Data source:
 *   Pointer events, drag events for links from outside, and the drop information each element carries as data
 *   attributes (set with markDropTarget() and markListDropZone()). Nothing is captured when an element is built: the
 *   sidebar keeps its elements across redraws (morph.ts), so a position read when the drop happens is always the
 *   current one.
 *
 * Data flow:
 *   pointerdown on [draggable][data-item-id] → moved DRAG_THRESHOLD_PX with the button held → dispatch beginItemDrag,
 *   the copy follows the pointer, the [data-drop] element under it shows a line or highlight → pointerup here →
 *   dispatch moveItem / moveItemToSpace; pointerup outside the window → dispatch dropItemInOtherWindow (main →
 *   that sidebar's dropItemSentFromOtherWindow() → moveItem + takeItemFromOtherWindow) → dispatch endItemDrag
 */
import type { ItemId, ItemLocation } from "../shared/types";
import { dispatch } from "./dom.js";

/** The type name under which a dragged sidebar item's id travels. */
const SIDEBAR_ITEM_TYPE = "application/x-sidebar-item";

/**
 * Part of a folder row (top and bottom) that still means "before" / "after" instead of "inside"; the same for a tab
 * or split row, whose middle means "side by side" (Arc: a tab dropped on a tab makes a split view of the two).
 */
const FOLDER_EDGE_FRACTION = 0.25;

/** How far the pointer moves with the button held before a press becomes a drag. Our choice, about macOS's own. */
const DRAG_THRESHOLD_PX = 4;

/** A place in the page, as pointer and drag events give it. */
interface PagePoint {
  clientX: number;
  clientY: number;
}

/** A press on an item that may become a drag, and the drag once it is one. */
interface PointerDrag {
  pointerId: number;
  itemId: ItemId;
  source: HTMLElement;
  start: PagePoint;
  /** Where in the item the pointer took hold, so the copy keeps that spot under the pointer. */
  grip: PagePoint;
  /** The copy of the item that follows the pointer; null until the press became a drag. */
  ghost: HTMLElement | null;
}

/** The press or drag going on, or null. */
let pointerDrag: PointerDrag | null = null;

/** True right after a drag ended: the click the release fires must not open the item. */
let isClickAfterDrag = false;

/** The kind of row being dragged here ("tab", "folder", "split", "favorite"), or null: only tabs go side by side. */
let draggedRowKind: string | null = null;

/** CSS classes that show where a drop will land. */
const DROP_CLASSES = ["drop-before", "drop-after", "drop-into"];

/** The item being dragged right now. dataTransfer cannot be read during dragover, so it is kept here. */
let draggedItemId: ItemId | null = null;

/** The item another window's sidebar is dragging right now, as main reported it, or null. */
let itemFromOtherWindow: ItemId | null = null;

/**
 * Hears from main which item another window is dragging (null when none), so a drop here can take it.
 */
export function setItemDraggedInOtherWindow(itemId: ItemId | null): void {
  itemFromOtherWindow = itemId;
}

/**
 * The item a drop here would move: this page's own drag, or another window's.
 */
function findDraggedItemId(): ItemId | null {
  return draggedItemId ?? itemFromOtherWindow;
}

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
 * Lets a tab dropped on the middle of a tab or split row go side by side with it (Arc's): the drop makes a split view
 * of the two, or adds a pane to the split. `tabId` is the tab that keeps its place (a split's first tab).
 */
export function markSplitTarget(element: HTMLElement, tabId: ItemId): void {
  element.dataset.splitWith = tabId;
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
  return findDraggedItemId() === null && types.includes("text/uri-list");
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
function findDropZone(point: PagePoint, element: HTMLElement): "before" | "after" | "into" {
  const rectangle = element.getBoundingClientRect();
  if (element.dataset.horizontal === "true") {
    const isLeftHalf = point.clientX < rectangle.left + rectangle.width / 2;
    return isLeftHalf ? "before" : "after";
  }
  const fraction = (point.clientY - rectangle.top) / rectangle.height;
  const canGoSideBySide = element.dataset.splitWith !== undefined && (draggedRowKind === "tab" || draggedRowKind === null);
  if (element.dataset.intoFolderId !== undefined || canGoSideBySide) {
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
 * Shows where a drop over `target` would land.
 */
function showDropFeedback(point: PagePoint, target: HTMLElement): void {
  clearAllDropClasses();
  if (target.dataset.drop === "item") {
    target.classList.add(`drop-${findDropZone(point, target)}`);
    return;
  }
  target.classList.add("drop-into");
}

/**
 * Carries out a drop of the dragged sidebar item on a target.
 */
function dropItem(point: PagePoint, target: HTMLElement, itemId: ItemId): void {
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
  const zone = findDropZone(point, target);
  const intoFolderId = target.dataset.intoFolderId;
  if (zone === "into" && intoFolderId !== undefined) {
    dispatch({ type: "moveItem", itemId: itemId, target: { kind: "folder", folderId: intoFolderId }, index: -1 });
    return;
  }
  const splitWithTabId = target.dataset.splitWith;
  if (zone === "into" && splitWithTabId !== undefined) {
    dispatch({ type: "splitTabs", firstTabId: splitWithTabId, secondTabId: itemId });
    return;
  }
  const targetIndex = Number(target.dataset.index ?? "0");
  const index = zone === "before" ? targetIndex : targetIndex + 1;
  dispatch({ type: "moveItem", itemId: itemId, target: location, index: index });
}

/**
 * Drops an item dragged in another window: it moves like any drop, and then a tab or split comes along into this
 * window with its page (except on a Space button, which only moves it to that Space).
 */
function dropItemFromOtherWindow(point: PagePoint, target: HTMLElement, itemId: ItemId): void {
  dropItem(point, target, itemId);
  itemFromOtherWindow = null;
  if (target.dataset.drop !== "space") {
    dispatch({ type: "takeItemFromOtherWindow", itemId: itemId });
  }
}

/**
 * The drop target under a point of the page, or null (the copy that follows the pointer takes no pointer events).
 */
function findDropTargetAt(point: PagePoint): HTMLElement | null {
  const element = document.elementFromPoint(point.clientX, point.clientY);
  return element === null ? null : element.closest<HTMLElement>("[data-drop]");
}

/**
 * The nearest part of the sidebar around an element that scrolls, or null.
 */
function findScrollingParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll") {
      return parent;
    }
  }
  return null;
}

/** Near a list's top or bottom edge a drag scrolls the list, this far per pointer move. Our choice. */
const AUTO_SCROLL_EDGE_PX = 28;
const AUTO_SCROLL_STEP_PX = 12;

/**
 * Scrolls the list the drag started in when the pointer is near its top or bottom edge, so long lists can be crossed.
 */
function scrollNearEdge(source: HTMLElement, point: PagePoint): void {
  const list = findScrollingParent(source);
  if (list === null) {
    return;
  }
  const box = list.getBoundingClientRect();
  if (point.clientY < box.top + AUTO_SCROLL_EDGE_PX) {
    list.scrollTop -= AUTO_SCROLL_STEP_PX;
  } else if (point.clientY > box.bottom - AUTO_SCROLL_EDGE_PX) {
    list.scrollTop += AUTO_SCROLL_STEP_PX;
  }
}

/**
 * The copy of the item that follows the pointer: the item itself, lifted, in its own list (so it looks the same).
 */
function createGhost(source: HTMLElement): HTMLElement {
  const box = source.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.classList.add("drag-ghost");
  ghost.classList.remove("is-dragging");
  ghost.removeAttribute("data-item-id");
  ghost.removeAttribute("data-drop");
  ghost.removeAttribute("draggable");
  ghost.style.width = `${box.width}px`;
  ghost.style.height = `${box.height}px`;
  source.parentElement?.append(ghost);
  return ghost;
}

/**
 * Puts the copy under the pointer, held where the item was taken.
 */
function placeGhost(drag: PointerDrag, point: PagePoint): void {
  if (drag.ghost === null) {
    return;
  }
  drag.ghost.style.left = `${point.clientX - drag.grip.clientX}px`;
  drag.ghost.style.top = `${point.clientY - drag.grip.clientY}px`;
}

/**
 * Shows where a drop at a point would land, or nothing where it cannot land.
 */
function showFeedbackAt(point: PagePoint, itemId: ItemId): void {
  const target = findDropTargetAt(point);
  if (target === null || target.dataset.itemId === itemId) {
    clearAllDropClasses();
    return;
  }
  showDropFeedback(point, target);
}

/**
 * A press became a drag: the pointer is held by the item, its copy follows the pointer, and redraws wait.
 */
function beginDrag(drag: PointerDrag): void {
  try {
    drag.source.setPointerCapture(drag.pointerId);
  } catch {
    // The pointer is gone already; the drag still ends on the next release or cancel.
  }
  drag.ghost = createGhost(drag.source);
  draggedItemId = drag.itemId;
  draggedRowKind = drag.source.dataset.row ?? null;
  drag.source.classList.add("is-dragging");
  notifyDragState(true);
  dispatch({ type: "beginItemDrag", itemId: drag.itemId });
}

/**
 * The drag is over (dropped or cancelled): the copy goes, the lines go, redraws go on.
 */
function endDrag(drag: PointerDrag): void {
  drag.ghost?.remove();
  drag.source.classList.remove("is-dragging");
  clearAllDropClasses();
  draggedItemId = null;
  draggedRowKind = null;
  notifyDragState(false);
  dispatch({ type: "endItemDrag" });
}

/**
 * Drops the dragged item where the pointer was let go: on a target here, or, outside this window, in the main window
 * under the pointer (main hands it to that sidebar).
 */
function dropAt(point: PagePoint, itemId: ItemId): void {
  const isInsideWindow = point.clientX >= 0 && point.clientY >= 0 && point.clientX < window.innerWidth && point.clientY < window.innerHeight;
  if (!isInsideWindow) {
    dispatch({ type: "dropItemInOtherWindow", itemId: itemId, screenX: window.screenX + point.clientX, screenY: window.screenY + point.clientY });
    return;
  }
  const target = findDropTargetAt(point);
  if (target === null || target.dataset.itemId === itemId) {
    return;
  }
  dropItem(point, target, itemId);
}

/**
 * A press on an item (not on a button or field inside it) may become a drag.
 */
function handlePointerDown(event: PointerEvent): void {
  isClickAfterDrag = false;
  const pressed = event.target instanceof Element ? event.target : null;
  const source = pressed?.closest<HTMLElement>("[draggable='true'][data-item-id]") ?? null;
  if (event.button !== 0 || pointerDrag !== null || pressed === null || source === null) {
    return;
  }
  const control = pressed.closest("button, input, textarea, [contenteditable='true']");
  if (control !== null && control !== source && source.contains(control)) {
    return;
  }
  const box = source.getBoundingClientRect();
  pointerDrag = {
    pointerId: event.pointerId,
    itemId: source.dataset.itemId ?? "",
    source: source,
    start: { clientX: event.clientX, clientY: event.clientY },
    grip: { clientX: event.clientX - box.left, clientY: event.clientY - box.top },
    ghost: null,
  };
}

/**
 * The pointer moved while an item is pressed: past the threshold it becomes a drag; a drag moves its copy, shows
 * where it would land and scrolls a long list.
 */
function handlePointerMove(event: PointerEvent): void {
  const drag = pointerDrag;
  if (drag === null || event.pointerId !== drag.pointerId) {
    return;
  }
  // The button came up where we could not hear it: no drag goes on.
  if ((event.buttons & 1) === 0) {
    handlePointerCancel(event);
    return;
  }
  if (drag.ghost === null) {
    const distance = Math.hypot(event.clientX - drag.start.clientX, event.clientY - drag.start.clientY);
    if (distance < DRAG_THRESHOLD_PX) {
      return;
    }
    beginDrag(drag);
  }
  placeGhost(drag, event);
  showFeedbackAt(event, drag.itemId);
  scrollNearEdge(drag.source, event);
}

/**
 * The button came up: a drag drops (and the click that follows is swallowed), a plain press was a click.
 */
function handlePointerUp(event: PointerEvent): void {
  const drag = pointerDrag;
  if (drag === null || event.pointerId !== drag.pointerId) {
    return;
  }
  pointerDrag = null;
  if (drag.ghost === null) {
    return;
  }
  isClickAfterDrag = true;
  dropAt(event, drag.itemId);
  endDrag(drag);
}

/**
 * The system took the pointer away (or the button came up unheard): the drag ends without a drop.
 */
function handlePointerCancel(event: PointerEvent): void {
  const drag = pointerDrag;
  if (drag === null || event.pointerId !== drag.pointerId) {
    return;
  }
  pointerDrag = null;
  if (drag.ghost !== null) {
    endDrag(drag);
  }
}

/**
 * The release after a drag fires a click on the item; it must not open or select it.
 */
function swallowClickAfterDrag(event: MouseEvent): void {
  if (!isClickAfterDrag) {
    return;
  }
  isClickAfterDrag = false;
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Drops an item that another window's sidebar was dragging, let go here at a point (main sent it: the drag has no
 * events in this window). It lands like any drop, and a tab or split comes along into this window.
 */
export function dropItemSentFromOtherWindow(itemId: ItemId, point: PagePoint): void {
  const target = findDropTargetAt(point);
  if (target === null || target.dataset.itemId === itemId) {
    return;
  }
  dropItemFromOtherWindow(point, target, itemId);
}

/**
 * Handles every drag and drop inside `root` with a few listeners on the root itself: pointer events move sidebar
 * items, drag events bring links in from outside.
 */
export function installDragAndDrop(root: HTMLElement): void {
  root.addEventListener("pointerdown", handlePointerDown);
  root.addEventListener("pointermove", handlePointerMove);
  root.addEventListener("pointerup", handlePointerUp);
  root.addEventListener("pointercancel", handlePointerCancel);
  root.addEventListener("click", swallowClickAfterDrag, true);
  // Items never start the system's drag: pointer events move them.
  root.addEventListener("dragstart", (event) => {
    const source = event.target instanceof Element ? event.target.closest("[draggable='true'][data-item-id]") : null;
    if (source !== null) {
      event.preventDefault();
    }
  });
  root.addEventListener("dragover", (event) => {
    const target = findDropTarget(event);
    if (target === null || !carriesExternalLink(event)) {
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
    if (target === null || !carriesExternalLink(event)) {
      return;
    }
    event.preventDefault();
    clearAllDropClasses();
    openDroppedLink(event);
  });
}
