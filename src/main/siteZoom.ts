/**
 * WHY this file exists:
 *   ⌘+ on a site should stay when you come back tomorrow. Chromium keeps a zoom per host only while the app runs;
 *   this remembers it in the state, per host like Chrome (mail.example.com and docs.example.com can differ).
 *
 * Data source:
 *   BrowserState.siteZooms (host → zoom factor; a site at 100% has no entry) and a page's address.
 *
 * Data flow:
 *   ⌘+ / ⌘- / ⌘0 or the Control Center → pageCommands.zoomPage → setSiteZoom (not from private windows)
 *   a page's dom-ready → main.ts → readSiteZoom → contents.setZoomFactor
 *
 * Rules: pure.
 */
import type { BrowserState } from "../shared/types";

/** 100%. */
export const DEFAULT_ZOOM_FACTOR = 1;

/** Two zoom factors closer than this are the same step. */
const ZOOM_TOLERANCE = 0.001;

/**
 * The host a page's zoom belongs to: web pages only (http and https), lowercase. Null for anything else.
 */
export function getZoomHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    const isWebPage = parsed.protocol === "http:" || parsed.protocol === "https:";
    return isWebPage && parsed.hostname !== "" ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * The zoom remembered for a page's host, or 100%.
 */
export function readSiteZoom(state: BrowserState, url: string): number {
  const host = getZoomHost(url);
  if (host === null) {
    return DEFAULT_ZOOM_FACTOR;
  }
  return state.siteZooms?.[host] ?? DEFAULT_ZOOM_FACTOR;
}

/**
 * Remembers a page's zoom for its host; 100% forgets it. Same state when nothing changes.
 */
export function setSiteZoom(state: BrowserState, url: string, zoomFactor: number): BrowserState {
  const host = getZoomHost(url);
  const isSame = Math.abs(readSiteZoom(state, url) - zoomFactor) < ZOOM_TOLERANCE;
  if (host === null || isSame) {
    return state;
  }
  const siteZooms = { ...(state.siteZooms ?? {}) };
  if (Math.abs(zoomFactor - DEFAULT_ZOOM_FACTOR) < ZOOM_TOLERANCE) {
    delete siteZooms[host];
  } else {
    siteZooms[host] = zoomFactor;
  }
  return { ...state, siteZooms: siteZooms };
}
