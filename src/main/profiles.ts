/**
 * WHY this file exists:
 *   Each profile keeps its own cookies, logins and site storage, like Arc's profiles. Electron does that with
 *   session partitions. Every session that shows web pages must get our permission rules the moment it is created:
 *   Electron would otherwise grant every website camera, microphone and location. Creating sessions only through
 *   getProfileSession() makes forgetting that impossible.
 *
 * Data source:
 *   Electron's session module. A profile id "profile-default" maps to the partition "persist:profile-default".
 *
 * Data flow:
 *   tabViews.ts needs a page for a tab → getProfileSession(profileId) → session with permission rules installed
 *   a page asks for the camera, … → permission handler → the decider (permissionPrompts.ts) → saved answer or prompt
 */
import { app, session } from "electron";
import type { Session, WebContents } from "electron";
import type { ProfileId, SitePermissionKind } from "../shared/types";
import { getPermissionOrigin, toPermissionKinds } from "./sitePermissions";

/**
 * Website permissions we allow without asking.
 */
const ALLOWED_WEB_PERMISSIONS = new Set(["fullscreen", "clipboard-sanitized-write"]);

/**
 * Decides the permissions the user is asked about (camera, microphone, location, notifications, clipboard).
 * permissionPrompts.ts provides it at startup; until then, and for anything else, the answer is no.
 */
export interface PermissionDecider {
  /** Quick checks (navigator.permissions, Notification.permission): true only for a saved "allow". */
  isAllowed(profileId: ProfileId | null, origin: string, kinds: SitePermissionKind[]): boolean;
  /** A real request: the saved answer, or ask the user. */
  request(contents: WebContents | null, profileId: ProfileId | null, origin: string, kinds: SitePermissionKind[]): Promise<boolean>;
  /** A link to an app (mailto:, zoommtg:, steam:, …): ask every time, like Chromium does by default. */
  requestOpenApp(contents: WebContents | null, origin: string, externalUrl: string): Promise<boolean>;
}

let permissionDecider: PermissionDecider | null = null;

/** The profile of each web page session; null for a private window's session. Our own pages' session is not here. */
const sessionProfileIds = new Map<Session, ProfileId | null>();

/**
 * Connects the permission handlers to the code that asks the user. Runs once at startup.
 */
export function setPermissionDecider(decider: PermissionDecider): void {
  permissionDecider = decider;
}

/**
 * Returns the profile a page's session belongs to: a profile id, null for a private window, undefined for our pages.
 */
export function findSessionProfileId(targetSession: Session): ProfileId | null | undefined {
  return sessionProfileIds.get(targetSession);
}

/** Sessions that already have our rules, so each is configured once. */
const configuredSessions = new Set<Session>();

/** Listeners that want to hear about every new profile session (downloads.ts attaches its handler this way). */
const sessionCreatedListeners: ((profileSession: Session) => void)[] = [];

/**
 * Installs the permission rules on a session: the permissions in ALLOWED_WEB_PERMISSIONS are granted, the ones the
 * user decides on go to the decider (only in web page sessions), everything else is refused.
 */
export function restrictWebPermissions(targetSession: Session): void {
  if (configuredSessions.has(targetSession)) {
    return;
  }
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (ALLOWED_WEB_PERMISSIONS.has(permission)) {
      callback(true);
      return;
    }
    const origin = getPermissionOrigin(details.requestingUrl);
    const profileId = sessionProfileIds.get(targetSession);
    if (permission === "openExternal") {
      const externalUrl = "externalURL" in details ? (details.externalURL ?? "") : "";
      if (origin === null || profileId === undefined || permissionDecider === null) {
        callback(false);
        return;
      }
      permissionDecider.requestOpenApp(webContents, origin, externalUrl).then(callback, () => callback(false));
      return;
    }
    const mediaTypes = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
    const kinds = toPermissionKinds(permission, mediaTypes);
    if (kinds === null || origin === null || profileId === undefined || permissionDecider === null) {
      callback(false);
      return;
    }
    permissionDecider.request(webContents, profileId, origin, kinds).then(callback, () => callback(false));
  });
  targetSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    if (ALLOWED_WEB_PERMISSIONS.has(permission)) {
      return true;
    }
    const kinds = toPermissionKinds(permission, details.mediaType === undefined ? [] : [details.mediaType]);
    const origin = getPermissionOrigin(requestingOrigin);
    const profileId = sessionProfileIds.get(targetSession);
    if (kinds === null || origin === null || profileId === undefined || permissionDecider === null) {
      return false;
    }
    return permissionDecider.isAllowed(profileId, origin, kinds);
  });
  configuredSessions.add(targetSession);
}

/**
 * Returns the session for a profile's web pages, creating and locking it down on first use.
 * Example: getProfileSession("profile-default") → the session for partition "persist:profile-default"
 */
export function getProfileSession(profileId: ProfileId): Session {
  const profileSession = session.fromPartition(`persist:${profileId}`);
  sessionProfileIds.set(profileSession, profileId);
  if (!configuredSessions.has(profileSession)) {
    restrictWebPermissions(profileSession);
    for (const listener of sessionCreatedListeners) {
      listener(profileSession);
    }
  }
  return profileSession;
}

/** Counts private windows, so each gets its own throwaway session. */
let privateSessionCounter = 0;

/**
 * Returns a new in-memory session for a private window: nothing it stores (cookies, cache, history) is written to
 * disk, and it disappears when the window closes. It gets the same permission rules as every profile.
 */
export function createPrivateSession(): Session {
  privateSessionCounter = privateSessionCounter + 1;
  // A partition name without "persist:" is kept in memory only.
  const privateSession = session.fromPartition(`private-${Date.now()}-${privateSessionCounter}`);
  sessionProfileIds.set(privateSession, null);
  restrictWebPermissions(privateSession);
  for (const listener of sessionCreatedListeners) {
    listener(privateSession);
  }
  return privateSession;
}

/**
 * Runs a function for every profile session created from now on.
 */
export function onProfileSessionCreated(listener: (profileSession: Session) => void): void {
  sessionCreatedListeners.push(listener);
}

/**
 * Removes "Electron/x.y.z" and our app name from the user agent. Some sites (Google sign-in among them) refuse
 * browsers that announce themselves as embedded, so we present the plain Chrome user agent Electron is built on.
 * Must run before the first page loads.
 */
export function useChromeUserAgent(): void {
  const electronUserAgent = app.userAgentFallback;
  const withoutElectron = electronUserAgent.replace(/ Electron\/\S+/, "");
  const appToken = ` ${app.getName()}/${app.getVersion()}`;
  const plainUserAgent = withoutElectron.replace(appToken, "");
  app.userAgentFallback = plainUserAgent;
}
