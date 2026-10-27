/**
 * WHY this file exists:
 *   Arc's sidebar scrolls with a macOS overlay scroller: no bar takes room from the rows, a thin knob shows while the
 *   list moves and fades away a moment later. Chromium in Electron draws a classic 15 pt bar when a mouse is
 *   connected (measured 2026-10-27), and a styled ::-webkit-scrollbar still takes its width from every row. So the
 *   list hides its own bar and this draws the knob: placed from the scroll position, shown on scroll, draggable.
 *
 * Data source:
 *   The scrolling element's scrollTop, scrollHeight and clientHeight.
 *
 * Data flow:
 *   scroll (wheel, trackpad, drag's auto-scroll) → showThumb() → the knob's place and size → hidden after
 *   THUMB_HIDE_DELAY_MS; pressing the knob and moving the pointer → scrollTop
 */

/** The knob stays this long after the list stops moving. Our choice, close to macOS's overlay scrollers. */
const THUMB_HIDE_DELAY_MS = 900;

/** The knob never gets shorter than this, so a long list still has something to grab. Our choice. */
const THUMB_MIN_HEIGHT_PX = 24;

/** Space above and below the knob inside the list's height. Our choice. */
const THUMB_END_INSET_PX = 2;

/** A knob being dragged: where the press started and the scroll position then. */
interface ThumbDrag {
  pointerId: number;
  startY: number;
  startScrollTop: number;
}

/**
 * Puts the knob in place for the current scroll position. Returns false when the list fits and needs no knob.
 */
function placeThumb(scroller: HTMLElement, thumb: HTMLElement): boolean {
  const visibleHeight = scroller.clientHeight;
  const contentHeight = scroller.scrollHeight;
  if (contentHeight <= visibleHeight) {
    return false;
  }
  const trackHeight = visibleHeight - THUMB_END_INSET_PX * 2;
  const thumbHeight = Math.max(THUMB_MIN_HEIGHT_PX, (trackHeight * visibleHeight) / contentHeight);
  const scrollRange = contentHeight - visibleHeight;
  // A list shorter than the knob's minimum leaves it no room to travel (never upward).
  const thumbTravel = Math.max(0, trackHeight - thumbHeight);
  const thumbOffset = (scroller.scrollTop / scrollRange) * thumbTravel;
  thumb.style.top = `${scroller.offsetTop + THUMB_END_INSET_PX + thumbOffset}px`;
  thumb.style.height = `${thumbHeight}px`;
  return true;
}

/**
 * Draws an overlay knob for a scrolling list. The list must hide its own bar (scrollbar-width: none) and sit in a
 * positioned parent, which the knob is added to.
 */
export function installOverlayScrollbar(scroller: HTMLElement): void {
  const parent = scroller.parentElement;
  if (parent === null) {
    return;
  }
  const thumb = document.createElement("div");
  thumb.className = "overlay-scroll-thumb";
  thumb.setAttribute("aria-hidden", "true");
  parent.append(thumb);
  let hideTimer: number | null = null;
  let drag: ThumbDrag | null = null;

  const scheduleHide = (): void => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
    }
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      if (drag === null && !thumb.matches(":hover")) {
        thumb.classList.remove("is-visible");
      }
    }, THUMB_HIDE_DELAY_MS);
  };

  const showThumb = (): void => {
    const hasThumb = placeThumb(scroller, thumb);
    thumb.classList.toggle("is-visible", hasThumb);
    if (hasThumb) {
      scheduleHide();
    }
  };

  scroller.addEventListener("scroll", showThumb, { passive: true });
  thumb.addEventListener("pointerleave", scheduleHide);
  // The knob sits over the list, not in it: scrolling with the pointer on it must still move the list.
  thumb.addEventListener(
    "wheel",
    (event) => {
      scroller.scrollBy({ top: event.deltaY });
    },
    { passive: true },
  );
  thumb.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    thumb.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, startY: event.clientY, startScrollTop: scroller.scrollTop };
    thumb.classList.add("is-dragging");
  });
  thumb.addEventListener("pointermove", (event) => {
    if (drag === null || event.pointerId !== drag.pointerId) {
      return;
    }
    // The knob's travel maps onto the whole scroll range.
    const thumbTravel = scroller.clientHeight - THUMB_END_INSET_PX * 2 - thumb.offsetHeight;
    const scrollRange = scroller.scrollHeight - scroller.clientHeight;
    if (thumbTravel <= 0) {
      return;
    }
    const pointerTravel = event.clientY - drag.startY;
    scroller.scrollTop = drag.startScrollTop + (pointerTravel * scrollRange) / thumbTravel;
  });
  const endDrag = (event: PointerEvent): void => {
    if (drag === null || event.pointerId !== drag.pointerId) {
      return;
    }
    drag = null;
    thumb.classList.remove("is-dragging");
    scheduleHide();
  };
  thumb.addEventListener("pointerup", endDrag);
  thumb.addEventListener("pointercancel", endDrag);
  thumb.addEventListener("lostpointercapture", endDrag);
}
