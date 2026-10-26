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
 */
import { app, session } from "electron";
import type { Session } from "electron";
import type { ProfileId } from "../shared/types";

/**
 * Website permissions we allow without asking. Everything else is refused until a permission prompt exists.
 */
const ALLOWED_WEB_PERMISSIONS = new Set(["fullscreen", "clipboard-sanitized-write"]);

/** Sessions that already have our rules, so each is configured once. */
const configuredSessions = new Set<Session>();

/** Listeners that want to hear about every new profile session (downloads.ts attaches its handler this way). */
const sessionCreatedListeners: ((profileSession: Session) => void)[] = [];

/**
 * Installs the permission rules on a session: only the permissions in ALLOWED_WEB_PERMISSIONS are granted.
 */
export function restrictWebPermissions(targetSession: Session): void {
  if (configuredSessions.has(targetSession)) {
    return;
  }
  targetSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const isAllowed = ALLOWED_WEB_PERMISSIONS.has(permission);
    callback(isAllowed);
  });
  targetSession.setPermissionCheckHandler((_webContents, permission) => {
    return ALLOWED_WEB_PERMISSIONS.has(permission);
  });
  configuredSessions.add(targetSession);
}

/**
 * Returns the session for a profile's web pages, creating and locking it down on first use.
 * Example: getProfileSession("profile-default") → the session for partition "persist:profile-default"
 */
export function getProfileSession(profileId: ProfileId): Session {
  const profileSession = session.fromPartition(`persist:${profileId}`);
  if (!configuredSessions.has(profileSession)) {
    restrictWebPermissions(profileSession);
    for (const listener of sessionCreatedListeners) {
      listener(profileSession);
    }
  }
  return profileSession;
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
