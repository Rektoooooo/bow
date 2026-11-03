/**
 * WHY this file exists:
 *   Some sites (and proxies) answer a page request with "401, sign in with a username and password" (HTTP
 *   authentication). Electron hands that question to the app's "login" event; without an answer the user only saw
 *   the bare 401 page. This asks the user on a card in the overlay, built like the permission prompt, and gives the
 *   page the credentials, or nothing (the site's own page then shows, as before).
 *   Bow Passwords joins in: a saved login for the site can be used with one click (its password is read here and
 *   never goes to the overlay), and typed credentials are saved once the sign-in is known to have worked.
 *   Only a tab's page and the Peek page are asked about. Everything else (Little Windows, popups) is left alone, so
 *   Electron cancels the request as it always did.
 *
 * Data source:
 *   app "login" events (host, realm, proxy or site), the page's profile (profiles.ts), the profile's vault
 *   (passwordVault.ts, rules in passwords.ts).
 *
 * Data flow:
 *   page request answers 401 → "login" → handleLogin() → a pending card (same host and realm share one) → overlay
 *   panel "httpSignIn" → Sign In / Use saved login / Cancel (action answerHttpSignIn) → answerHttpSignIn() → every
 *   waiting request gets its answer → typed credentials wait for the page to finish loading → changeVault(saveLogin).
 *   The same host asking again soon after means the credentials were wrong: nothing is saved.
 *   Escape, a click outside, or the tab closing settles the card as Cancel.
 */
import { randomUUID } from "node:crypto";
import { app } from "electron";
import type { AuthInfo, Event, WebContents } from "electron";
import type { ProfileId } from "../shared/types";
import { isOverlayShown } from "./overlay";
import { closeHttpSignIn, isPanelShown, onPanelEnded, openHttpSignIn } from "./overlayController";
import { findLoginsForOrigin, normalizeLoginOrigin, saveLogin } from "./passwords";
import type { SavedLogin } from "./passwords";
import { changeVault, openVault } from "./passwordVault";
import { getPeekContents } from "./peek";
import { findSessionProfileId } from "./profiles";
import { showToast } from "./statusBubble";
import { findTabIdOfContents } from "./tabViews";

/** How often a waiting card checks whether the overlay is free again (it can be busy with a Peek). */
const BUSY_RETRY_MS = 1000;

/**
 * If the same host and realm ask again within this long after credentials were given, the server refused them: they
 * were wrong and are not saved. Our choice: a server answers a sent password in well under a second, so ten
 * seconds cover slow networks without mistaking a later, separate sign-in for a refusal.
 */
const WRONG_CREDENTIALS_WINDOW_MS = 10_000;

/** How long typed credentials wait for the page to finish loading before they are forgotten unsaved. Our choice. */
const CONFIRMATION_LIFETIME_MS = 60_000;

/** The longest realm shown. Our choice: the server's text is untrusted and may be very long. */
const REALM_DISPLAY_LIMIT = 80;

/** Control characters in the server's text (line breaks, escapes) are shown as spaces. */
const CONTROL_CHARACTERS = /\p{Cc}/gu;

type Credentials = { username: string; password: string };

/**
 * One request waiting for the answer: the page that asked, and Electron's callback. Electron throws when a callback
 * is used twice, and that would be an uncaught error in the main process, so `answer` is the only way to use it and
 * it works once.
 */
interface Requester {
  contents: WebContents;
  answer: (credentials: Credentials | null) => void;
}

/** A card waiting for the user. Requests for the same host and realm share it. */
interface PendingSignIn {
  id: string;
  key: string;
  /** Null for a private window: nothing is read from or saved to a vault. */
  profileId: ProfileId | null;
  /** The login origin for the vault, null for a proxy or an address a vault cannot hold. */
  origin: string | null;
  host: string;
  realm: string;
  isProxy: boolean;
  requesters: Requester[];
  /** For each page that asked: the function to stop listening for its end. Cleared when the card settles. */
  stopWatchingPages: Map<WebContents, () => void>;
  /** False until the vault was looked at (the card waits for it so it shows the saved login at once). */
  isReady: boolean;
  isVaultReady: boolean;
  /** Kept in main's memory only; the card gets the username. */
  savedLogin: SavedLogin | null;
}

/** Typed credentials that were given to a page and wait to be saved once the page loaded (so they worked). */
interface Confirmation {
  profileId: ProfileId;
  origin: string;
  credentials: Credentials;
  answeredAt: number;
  contents: WebContents;
  onFinishedLoading: () => void;
  expiryTimer: NodeJS.Timeout;
}

const pendingSignIns: PendingSignIn[] = [];
const confirmations = new Map<string, Confirmation>();

let shownSignInId: string | null = null;
let signInCounter = 0;
let retryTimer: NodeJS.Timeout | null = null;

/**
 * Connects the card to Electron's "login" event and to the overlay. Runs once at startup.
 */
export function initializeHttpSignIn(): void {
  app.on("login", (event, contents, details, authInfo, callback) => {
    try {
      handleLogin(event, contents, details.url, authInfo, callback);
    } catch (error) {
      // An error escaping an Electron event handler pops up a dialog; the request just stays unanswered by us.
      console.error("Could not handle a sign-in request:", error instanceof Error ? error.name : "");
    }
  });
  onPanelEnded((panel, reason) => {
    if (panel.kind === "httpSignIn" && panel.requestId === shownSignInId) {
      shownSignInId = null;
      if (reason === "closed") {
        // Escape or a click outside: the site's own page shows.
        const pending = pendingSignIns.find((candidate) => candidate.id === panel.requestId);
        if (pending !== undefined) {
          settle(pending, null);
        }
      }
    }
    showNextSignIn();
  });
}

/**
 * A request asks for credentials. Tab and Peek pages get the card; everything else is left to Electron (which cancels).
 */
function handleLogin(event: Event, contents: WebContents | null, url: string, authInfo: AuthInfo, callback: (username?: string, password?: string) => void): void {
  if (contents === null || contents.isDestroyed()) {
    return;
  }
  const profileId = findSessionProfileId(contents.session);
  const isTabPage = findTabIdOfContents(contents) !== null;
  const isPeekPage = contents === getPeekContents();
  if (profileId === undefined || (!isTabPage && !isPeekPage)) {
    return;
  }
  event.preventDefault();
  const key = [profileId ?? "private", authInfo.isProxy ? "proxy" : "site", `${authInfo.host}:${authInfo.port}`, authInfo.realm].join("|");
  // Asking again right after credentials were given means the server did not accept them.
  const earlier = confirmations.get(key);
  if (earlier !== undefined && Date.now() - earlier.answeredAt <= WRONG_CREDENTIALS_WINDOW_MS) {
    dropConfirmation(key);
  }
  const requester: Requester = { contents: contents, answer: createOneTimeAnswer(callback) };
  const sameQuestion = pendingSignIns.find((pending) => pending.key === key);
  if (sameQuestion !== undefined) {
    addRequester(sameQuestion, requester);
    return;
  }
  signInCounter = signInCounter + 1;
  const pending: PendingSignIn = {
    id: `http-sign-in-${signInCounter}`,
    key: key,
    profileId: profileId,
    origin: authInfo.isProxy ? null : normalizeLoginOrigin(url),
    host: authInfo.isProxy ? `${authInfo.host}:${authInfo.port}` : readHost(url, authInfo),
    realm: shortenRealm(authInfo.realm),
    isProxy: authInfo.isProxy,
    requesters: [],
    stopWatchingPages: new Map(),
    isReady: false,
    isVaultReady: false,
    savedLogin: null,
  };
  pendingSignIns.push(pending);
  addRequester(pending, requester);
  lookUpSavedLogin(pending).then(
    () => showNextSignIn(),
    () => showNextSignIn(),
  );
}

/**
 * The host (with a non-default port) of a request's address; the sign-in's own host if the address cannot be read.
 */
function readHost(url: string, authInfo: AuthInfo): string {
  try {
    return new URL(url).host;
  } catch {
    return `${authInfo.host}:${authInfo.port}`;
  }
}

/**
 * Wraps Electron's callback so that the first answer goes through and any later one is ignored.
 */
function createOneTimeAnswer(callback: (username?: string, password?: string) => void): (credentials: Credentials | null) => void {
  let isAnswered = false;
  return (credentials) => {
    if (isAnswered) {
      return;
    }
    isAnswered = true;
    try {
      if (credentials === null) {
        callback();
      } else {
        callback(credentials.username, credentials.password);
      }
    } catch (error) {
      console.error("Could not answer a sign-in request:", error instanceof Error ? error.name : "");
    }
  };
}

/**
 * Adds a request to a card. A page that closes while it waits is answered with nothing; the card goes away with its
 * last request.
 */
function addRequester(pending: PendingSignIn, requester: Requester): void {
  pending.requesters.push(requester);
  if (pending.stopWatchingPages.has(requester.contents)) {
    return;
  }
  const contents = requester.contents;
  const onDestroyed = (): void => {
    pending.stopWatchingPages.delete(contents);
    const goneRequesters = pending.requesters.filter((known) => known.contents === contents);
    pending.requesters = pending.requesters.filter((known) => known.contents !== contents);
    for (const gone of goneRequesters) {
      gone.answer(null);
    }
    if (pending.requesters.length === 0) {
      settle(pending, null);
    }
  };
  contents.once("destroyed", onDestroyed);
  pending.stopWatchingPages.set(contents, () => contents.removeListener("destroyed", onDestroyed));
}

/**
 * Looks in the profile's vault for a login of the site. Sites only: a proxy's sign-in is never filled from a site's.
 */
async function lookUpSavedLogin(pending: PendingSignIn): Promise<void> {
  try {
    if (pending.profileId === null || pending.origin === null) {
      return;
    }
    const access = await openVault(pending.profileId);
    if (access.status !== "ready") {
      return;
    }
    pending.isVaultReady = true;
    pending.savedLogin = findLoginsForOrigin(access.vault, pending.origin)[0] ?? null;
  } finally {
    pending.isReady = true;
  }
}

/**
 * The server's realm as safe text to show: control characters become spaces, and long text is cut.
 */
function shortenRealm(realm: string): string {
  const plain = realm.replace(CONTROL_CHARACTERS, " ").trim();
  return plain.length > REALM_DISPLAY_LIMIT ? `${plain.slice(0, REALM_DISPLAY_LIMIT)}…` : plain;
}

/**
 * Shows the first card that is ready when nothing else is on the overlay.
 */
function showNextSignIn(): void {
  const next = pendingSignIns.find((pending) => pending.isReady);
  if (shownSignInId !== null || next === undefined) {
    return;
  }
  if (isPanelShown() || isOverlayShown()) {
    if (retryTimer === null) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        showNextSignIn();
      }, BUSY_RETRY_MS);
    }
    return;
  }
  shownSignInId = next.id;
  openHttpSignIn({
    kind: "httpSignIn",
    requestId: next.id,
    host: next.host,
    realm: next.realm,
    isProxy: next.isProxy,
    savedUsername: next.savedLogin === null ? null : next.savedLogin.username,
    canSave: next.isVaultReady,
  });
}

/**
 * Gives every request waiting on a card its answer (nothing means "no credentials") and takes the card off screen.
 */
function settle(pending: PendingSignIn, credentials: Credentials | null): void {
  const index = pendingSignIns.indexOf(pending);
  if (index === -1) {
    return;
  }
  pendingSignIns.splice(index, 1);
  const requesters = pending.requesters;
  pending.requesters = [];
  for (const stopWatching of pending.stopWatchingPages.values()) {
    stopWatching();
  }
  pending.stopWatchingPages.clear();
  for (const requester of requesters) {
    requester.answer(credentials);
  }
  if (shownSignInId === pending.id) {
    closeHttpSignIn(pending.id);
  }
}

/**
 * Sign In, Use saved login or Cancel on a shown card. Typed credentials are saved only if asked to and only after
 * the page they unlocked has loaded.
 */
export function answerHttpSignIn(requestId: string, choice: "signIn" | "useSaved" | "cancel", username: string, password: string, shouldSave: boolean): void {
  const pending = pendingSignIns.find((candidate) => candidate.id === requestId);
  if (pending === undefined) {
    return;
  }
  const firstRequester = pending.requesters[0];
  if (choice === "useSaved" && pending.savedLogin !== null) {
    settle(pending, { username: pending.savedLogin.username, password: pending.savedLogin.password });
    return;
  }
  if (choice !== "signIn" || firstRequester === undefined) {
    settle(pending, null);
    return;
  }
  settle(pending, { username: username, password: password });
  const { profileId, origin } = pending;
  if (!shouldSave || !pending.isVaultReady || profileId === null || origin === null || username.trim() === "") {
    return;
  }
  waitForSignInToWork(pending.key, profileId, origin, { username: username, password: password }, firstRequester.contents);
}

/**
 * Keeps typed credentials until the page they were given to has finished loading, then saves them.
 */
function waitForSignInToWork(key: string, profileId: ProfileId, origin: string, credentials: Credentials, contents: WebContents): void {
  dropConfirmation(key);
  const onFinishedLoading = (): void => {
    const confirmation = confirmations.get(key);
    dropConfirmation(key);
    if (confirmation !== undefined) {
      saveWorkingCredentials(confirmation);
    }
  };
  contents.once("did-finish-load", onFinishedLoading);
  const expiryTimer = setTimeout(() => dropConfirmation(key), CONFIRMATION_LIFETIME_MS);
  confirmations.set(key, { profileId: profileId, origin: origin, credentials: credentials, answeredAt: Date.now(), contents: contents, onFinishedLoading: onFinishedLoading, expiryTimer: expiryTimer });
}

/**
 * Forgets credentials that were not confirmed (and with them the password).
 */
function dropConfirmation(key: string): void {
  const confirmation = confirmations.get(key);
  if (confirmation === undefined) {
    return;
  }
  confirmations.delete(key);
  clearTimeout(confirmation.expiryTimer);
  if (!confirmation.contents.isDestroyed()) {
    confirmation.contents.removeListener("did-finish-load", confirmation.onFinishedLoading);
  }
}

function saveWorkingCredentials(confirmation: Confirmation): void {
  const login = { origin: confirmation.origin, username: confirmation.credentials.username, password: confirmation.credentials.password };
  changeVault(confirmation.profileId, (vault) => saveLogin(vault, login, randomUUID(), Date.now()))
    .then((hasChanged) => {
      if (hasChanged) {
        showToast("Password saved").catch(() => undefined);
      }
    })
    .catch((error) => console.error("Could not save the sign-in:", error instanceof Error ? error.name : ""));
}
