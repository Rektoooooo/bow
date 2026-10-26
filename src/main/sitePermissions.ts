/**
 * WHY this file exists:
 *   Sites ask before using the camera, microphone, location, notifications or reading the clipboard, and the user's
 *   answer is remembered per profile and site, like in Arc (Chromium). These pure functions translate Electron's
 *   permission names into our kinds and read and change the saved answers.
 *
 * Data source:
 *   BrowserState.sitePermissions; Electron's permission names ("media" with media types, "geolocation", …).
 *
 * Data flow:
 *   page asks → profiles.ts permission handlers → toPermissionKinds() → permissionPrompts.ts → findPermissionAnswer()
 *   → stored answer, or a prompt → setPermissionAnswer() → applyChange
 */
import type { BrowserState, ProfileId, SitePermission, SitePermissionKind } from "../shared/types";

/** Most saved answers. Our choice: years of browsing; bounds what the state can hold. The oldest go first. */
export const MAX_SITE_PERMISSIONS = 1000;

/** Electron's permission names that we ask the user about, and what they mean. Media is handled by media type. */
const PERMISSION_KINDS: Record<string, SitePermissionKind> = {
  notifications: "notifications",
  geolocation: "location",
  "clipboard-read": "clipboard",
};

/**
 * Translates an Electron permission into the kinds the user decides on. Null for permissions we never offer.
 * Examples: ("media", ["video", "audio"]) → ["camera", "microphone"]; ("geolocation") → ["location"]; ("midi") → null
 */
export function toPermissionKinds(permission: string, mediaTypes: readonly string[] = []): SitePermissionKind[] | null {
  if (permission === "media") {
    const kinds: SitePermissionKind[] = [];
    if (mediaTypes.includes("video")) {
      kinds.push("camera");
    }
    if (mediaTypes.includes("audio")) {
      kinds.push("microphone");
    }
    return kinds.length === 0 ? null : kinds;
  }
  const kind = PERMISSION_KINDS[permission];
  return kind === undefined ? null : [kind];
}

/**
 * Returns the origin of a web page address, or null for anything that is not http or https.
 * Example: "https://meet.google.com/abc-defg" → "https://meet.google.com"
 */
export function getPermissionOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * Returns the saved answer for one kind, or null when the site has not asked yet.
 */
export function findPermissionAnswer(state: BrowserState, profileId: ProfileId, origin: string, kind: SitePermissionKind): boolean | null {
  const answer = (state.sitePermissions ?? []).find((candidate) => candidate.profileId === profileId && candidate.origin === origin && candidate.kind === kind);
  return answer === undefined ? null : answer.isAllowed;
}

/**
 * Returns a site's saved answers in one profile.
 */
export function getSitePermissions(state: BrowserState, profileId: ProfileId, origin: string): SitePermission[] {
  return (state.sitePermissions ?? []).filter((candidate) => candidate.profileId === profileId && candidate.origin === origin);
}

/**
 * Saves an answer, replacing an earlier one for the same profile, site and kind. Returns the same state when the
 * answer is already saved.
 */
export function setPermissionAnswer(state: BrowserState, profileId: ProfileId, origin: string, kind: SitePermissionKind, isAllowed: boolean): BrowserState {
  if (findPermissionAnswer(state, profileId, origin, kind) === isAllowed) {
    return state;
  }
  const others = (state.sitePermissions ?? []).filter((candidate) => !(candidate.profileId === profileId && candidate.origin === origin && candidate.kind === kind));
  const answers = [...others, { profileId: profileId, origin: origin, kind: kind, isAllowed: isAllowed }];
  return { ...state, sitePermissions: answers.slice(-MAX_SITE_PERMISSIONS) };
}

/**
 * Forgets an answer, so the site asks again next time. Returns the same state when there is none.
 */
export function removePermissionAnswer(state: BrowserState, profileId: ProfileId, origin: string, kind: SitePermissionKind): BrowserState {
  if (findPermissionAnswer(state, profileId, origin, kind) === null) {
    return state;
  }
  const remaining = (state.sitePermissions ?? []).filter((candidate) => !(candidate.profileId === profileId && candidate.origin === origin && candidate.kind === kind));
  return { ...state, sitePermissions: remaining };
}
