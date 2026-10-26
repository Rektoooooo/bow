/**
 * WHY this file exists:
 *   The sidebar redraws from every new state. Replacing its elements would throw away what makes it feel smooth:
 *   hover states, CSS transitions (a selection fading in), and any chance to animate rows coming and going.
 *   morphChildren() folds freshly built elements into the ones already on the page instead: an element with the same
 *   key is kept and only its attributes and text change; a new one is inserted (and grows in); a gone one shrinks
 *   away; a moved one slides to its new place.
 *
 * Data source:
 *   Freshly built elements (rows.ts, sidebar.ts, toolbar.ts). Elements in a list carry `data-key`; list items that
 *   should animate in and out also carry `data-presence` ("row" grows in height, "tile" fades and scales).
 *
 * Data flow:
 *   renderAll() → build elements → morphChildren(container, elements) → the page keeps its elements, updated
 *
 * Rules:
 *   Kept elements keep their event listeners, so built elements must not carry handlers that capture data (clicks
 *   are delegated in sidebarEvents.ts and read data-* attributes when they happen). Exceptions that are safe: a
 *   favicon <img>'s error handler and a rename <input>, which morphing never replaces while it has the focus.
 *   Motion uses the Web Animations API, never the style attribute, so a morph cannot cut an animation short.
 */

/** How long a row takes to grow in, shrink away or slide. Our choice, close to Arc's quick, soft motion. */
const PRESENCE_DURATION_MS = 180;
const MOVE_DURATION_MS = 200;

/** Arc-like easing: fast start, gentle stop. */
const MOTION_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** Moves smaller than this (in pixels) are not animated. */
const MIN_MOVE_PX = 0.5;

/** Elements shrinking away: still in the page until their animation ends, but no longer part of any list. */
const leavingElements = new WeakSet<Element>();

/** Attributes that make an element clickable, draggable or a drop target (sidebarEvents.ts, dragDrop.ts). */
const INTERACTIVE_ATTRIBUTES = ["data-key", "data-row", "data-action", "data-drop", "data-item-id", "draggable"];

export interface MorphOptions {
  /** False for the first draw and for big changes (a Space switch), where rows should just appear. */
  animate: boolean;
}

/**
 * True when the user asked the system for less motion.
 */
function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Returns an element's list key, or null for nodes without one.
 */
function getKey(node: Node): string | null {
  if (!(node instanceof HTMLElement)) {
    return null;
  }
  return node.dataset.key ?? null;
}

/**
 * Copies attributes from the new element to the kept one: changed values are set, missing ones removed.
 */
function syncAttributes(kept: Element, fresh: Element): void {
  for (const attribute of Array.from(fresh.attributes)) {
    if (kept.getAttribute(attribute.name) !== attribute.value) {
      kept.setAttribute(attribute.name, attribute.value);
    }
  }
  for (const attribute of Array.from(kept.attributes)) {
    if (!fresh.hasAttribute(attribute.name)) {
      kept.removeAttribute(attribute.name);
    }
  }
}

/**
 * Makes `kept` look like `fresh` and returns the element that belongs in the page: `kept` when it could be updated,
 * otherwise `fresh` (a different tag cannot be morphed).
 */
function morphElement(kept: Element, fresh: Element, options: MorphOptions): Element {
  if (kept.tagName !== fresh.tagName) {
    return fresh;
  }
  // A field the user is typing in stays exactly as it is.
  const isActiveField = (kept instanceof HTMLInputElement || kept instanceof HTMLTextAreaElement) && kept === document.activeElement;
  if (isActiveField) {
    return kept;
  }
  syncAttributes(kept, fresh);
  if (kept instanceof HTMLButtonElement && fresh instanceof HTMLButtonElement) {
    kept.disabled = fresh.disabled;
  }
  morphChildren(kept as HTMLElement, Array.from(fresh.childNodes), options);
  return kept;
}

/**
 * Makes a text node or element from the new tree fit the old one, or returns the new node to put in its place.
 */
function morphNode(kept: Node, fresh: Node, options: MorphOptions): Node {
  if (kept.nodeType === Node.TEXT_NODE && fresh.nodeType === Node.TEXT_NODE) {
    if (kept.nodeValue !== fresh.nodeValue) {
      kept.nodeValue = fresh.nodeValue;
    }
    return kept;
  }
  if (kept instanceof Element && fresh instanceof Element && getKey(kept) === getKey(fresh)) {
    return morphElement(kept, fresh, options);
  }
  return fresh;
}

/**
 * Grows a new list item in (height for rows, scale for tiles).
 */
function animateIn(element: HTMLElement): void {
  if (element.dataset.presence === "tile") {
    element.animate([{ opacity: 0, transform: "scale(0.85)" }, { opacity: 1, transform: "scale(1)" }], { duration: PRESENCE_DURATION_MS, easing: MOTION_EASING });
    return;
  }
  const height = element.getBoundingClientRect().height;
  element.animate(
    [
      { height: "0px", opacity: 0, overflow: "hidden" },
      { height: `${height}px`, opacity: 1, overflow: "hidden" },
    ],
    { duration: PRESENCE_DURATION_MS, easing: MOTION_EASING },
  );
}

/**
 * Shrinks a removed list item away, then takes it out of the page.
 */
function animateOut(element: HTMLElement): void {
  leavingElements.add(element);
  // A shrinking row is only a picture of what was there: nothing may click, drag or drop on it.
  for (const name of INTERACTIVE_ATTRIBUTES) {
    element.removeAttribute(name);
  }
  element.classList.add("is-leaving");
  element.inert = true;
  const frames: Keyframe[] =
    element.dataset.presence === "tile"
      ? [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.85)" }]
      : [
          { height: `${element.getBoundingClientRect().height}px`, opacity: 1, overflow: "hidden" },
          { height: "0px", opacity: 0, overflow: "hidden", paddingTop: "0px", paddingBottom: "0px", marginTop: "0px", marginBottom: "0px" },
        ];
  const animation = element.animate(frames, { duration: PRESENCE_DURATION_MS, easing: MOTION_EASING, fill: "forwards" });
  animation.addEventListener("finish", () => element.remove());
}

/**
 * Slides a kept element from where it was to where it is now (the FLIP technique).
 */
function animateMove(element: HTMLElement, previous: DOMRect): void {
  const current = element.getBoundingClientRect();
  const deltaX = previous.left - current.left;
  const deltaY = previous.top - current.top;
  if (Math.abs(deltaX) < MIN_MOVE_PX && Math.abs(deltaY) < MIN_MOVE_PX) {
    return;
  }
  element.animate([{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: "translate(0, 0)" }], { duration: MOVE_DURATION_MS, easing: MOTION_EASING });
}

/**
 * Makes a container's children match `freshChildren`, keeping, updating, adding, moving and removing as needed.
 */
export function morphChildren(container: HTMLElement, freshChildren: Node[], options: MorphOptions): void {
  const shouldAnimate = options.animate && !prefersReducedMotion();
  const currentChildren = Array.from(container.childNodes).filter((node) => !leavingElements.has(node as Element));
  const keyedCurrent = new Map<string, Element>();
  for (const node of currentChildren) {
    const key = getKey(node);
    if (key !== null) {
      keyedCurrent.set(key, node as Element);
    }
  }
  const unkeyedCurrent = currentChildren.filter((node) => getKey(node) === null);
  const previousPositions = new Map<Element, DOMRect>();
  if (shouldAnimate) {
    for (const element of keyedCurrent.values()) {
      if (element instanceof HTMLElement && element.dataset.presence !== undefined) {
        previousPositions.set(element, element.getBoundingClientRect());
      }
    }
  }

  // Decide, for each new child, which node ends up in the page.
  const placed: Node[] = [];
  const entering: HTMLElement[] = [];
  let unkeyedIndex = 0;
  for (const fresh of freshChildren) {
    const key = getKey(fresh);
    let match: Node | undefined;
    if (key !== null) {
      match = keyedCurrent.get(key);
      keyedCurrent.delete(key);
    } else {
      match = unkeyedCurrent[unkeyedIndex];
      unkeyedIndex = unkeyedIndex + 1;
    }
    const result = match === undefined ? fresh : morphNode(match, fresh, options);
    placed.push(result);
    if (result === fresh && fresh instanceof HTMLElement && fresh.dataset.presence !== undefined) {
      entering.push(fresh);
    }
  }

  // Take out what is no longer there: list items shrink away, everything else goes at once.
  const placedSet = new Set(placed);
  for (const node of currentChildren) {
    if (placedSet.has(node)) {
      continue;
    }
    if (shouldAnimate && node instanceof HTMLElement && node.dataset.presence !== undefined) {
      animateOut(node);
    } else {
      node.parentNode?.removeChild(node);
    }
  }

  // Put the nodes in order, stepping over items that are still shrinking away.
  let cursor: ChildNode | null = container.firstChild;
  for (const node of placed) {
    while (cursor !== null && leavingElements.has(cursor as Element)) {
      cursor = cursor.nextSibling;
    }
    if (cursor === node) {
      cursor = cursor.nextSibling;
      continue;
    }
    container.insertBefore(node, cursor);
  }

  if (!shouldAnimate) {
    return;
  }
  for (const element of entering) {
    animateIn(element);
  }
  for (const [element, previous] of previousPositions) {
    if (placedSet.has(element)) {
      animateMove(element as HTMLElement, previous);
    }
  }
}
