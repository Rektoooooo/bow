/**
 * WHY this file exists:
 *   Asks "Save password for example.com?" after the user signed in on a page, like browsers do, and saves, updates
 *   or remembers "never for this site" in the profile's vault. The question comes only once the sign-in went through
 *   (the tab moved on to another page, or a single-page site reported it finished), so a wrong password is rarely
 *   offered, and only while that tab is the one on screen. A password the user did not type (a page script filled
 *   it in) is never offered.
 *
 * Data source:
 *   Form reports from formsBridge.ts (what was typed, in which tab and profile), the profile's vault
 *   (passwordVault.ts, rules in passwords.ts), and the tab's own navigation events.
 *
 * Data flow:
 *   page helper → formsBridge onFormSubmitted → a pending offer for that tab (the password stays here, in main's
 *   memory, until the offer ends) → the tab navigates / onLoginFinished → the offer is triggered → overlay panel
 *   "savePassword" (never holds the password) → Save / Never for this site / Not now (action answerPasswordOffer)
 *   → answerPasswordOffer() → changeVault() → a short confirmation. Escape or a click outside means Not now.
 */
import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import type { SubmittedMessage } from "../shared/forms";
import type { ItemId, ProfileId } from "../shared/types";
import { getState } from "./browserCore";
import { onFormSubmitted, onLoginFinished } from "./formsBridge";
import { isOverlayShown } from "./overlay";
import { closePasswordOffer, isPanelShown, onPanelEnded, openPasswordOffer } from "./overlayController";
import { addNeverSave, decideOffer, findLoginsForOrigin, saveLogin, updateLoginPassword } from "./passwords";
import type { OfferDecision, PasswordVault } from "./passwords";
import { changeVault, openVault } from "./passwordVault";
import { showToast } from "./statusBubble";
import { getShownTabIdsInWindow, getTabContents } from "./tabViews";

/** How long after sending the form the sign-in may still finish. Our choice: slow sites answer within seconds. */
const OFFER_TRIGGER_WINDOW_MS = 20_000;

/** How long a finished sign-in waits for its tab to be on screen and the overlay to be free. Our choice. */
const OFFER_SHOW_LIFETIME_MS = 120_000;

/** How often a waiting offer checks whether it can be shown (same reason as permissionPrompts.ts: a Peek may use the overlay). */
const BUSY_RETRY_MS = 1000;

/** Sites are shown without this prefix, as the address bar does. */
const LEADING_WWW = /^www\./;

export type PasswordOfferAnswer = "save" | "never" | "notNow";

/** The offer's decision when something is to be asked (never "nothing"). */
type AskDecision = Exclude<OfferDecision, { kind: "nothing" }>;

/** One sign-in waiting to be asked about. At most one per tab. */
interface PendingOffer {
  offerId: string;
  tabId: ItemId;
  profileId: ProfileId;
  origin: string;
  username: string;
  /** Only ever held here; deleted with the offer. */
  password: string;
  decision: AskDecision;
  submittedAt: number;
  /** Null until the sign-in went through. */
  triggeredAt: number | null;
  /** Ends the wait for a sign-in that never finished. */
  expiryTimer: NodeJS.Timeout | null;
  stopListeningToTab: () => void;
}

/** Offers in the order they came, by tab. */
const pendingOffers = new Map<ItemId, PendingOffer>();

let shownOfferId: string | null = null;
let offerCounter = 0;
let retryTimer: NodeJS.Timeout | null = null;

/**
 * Connects the offers to the forms bridge and to the overlay. Runs once at startup.
 */
export function initializePasswordOffers(): void {
  onFormSubmitted((report) => {
    rememberSubmit(report.tabId, report.profileId, report.origin, report.message).catch((error) => {
      console.error("Could not prepare the password offer:", error instanceof Error ? error.name : "");
    });
  });
  onLoginFinished((tabId, origin) => {
    const offer = pendingOffers.get(tabId);
    if (offer !== undefined && offer.origin === origin) {
      triggerOffer(offer);
    }
  });
  onPanelEnded((panel, reason) => {
    if (panel.kind === "savePassword" && panel.offerId === shownOfferId) {
      shownOfferId = null;
      if (reason === "closed") {
        // Escape or a click outside: Not now.
        dropOffer(panel.offerId);
      }
    }
    showNextOffer();
  });
}

/**
 * Decides from a sent form whether to offer anything, and keeps the offer until the sign-in went through.
 */
async function rememberSubmit(
  tabId: ItemId,
  profileId: ProfileId,
  origin: string,
  message: SubmittedMessage,
): Promise<void> {
  if (getState().settings.offersToSavePasswords === false) {
    return;
  }
  if (message.password === "" || !message.wasTyped) {
    return;
  }
  const access = await openVault(profileId);
  if (access.status !== "ready") {
    return;
  }
  const username = nameTheAccount(access.vault, origin, message);
  const decision = decideOffer(access.vault, origin, username, message.password);
  if (decision.kind === "nothing") {
    return;
  }
  const contents = getTabContents(tabId);
  if (contents === null) {
    return;
  }
  // A newer sign-in in the same tab replaces the older one.
  const olderOffer = pendingOffers.get(tabId);
  if (olderOffer !== undefined) {
    dropOffer(olderOffer.offerId);
  }
  offerCounter = offerCounter + 1;
  const offer: PendingOffer = {
    offerId: `password-offer-${offerCounter}`,
    tabId: tabId,
    profileId: profileId,
    origin: origin,
    username: username,
    password: message.password,
    decision: decision,
    submittedAt: Date.now(),
    triggeredAt: null,
    expiryTimer: null,
    stopListeningToTab: () => undefined,
  };
  offer.stopListeningToTab = triggerOnNavigation(contents, offer);
  offer.expiryTimer = setTimeout(() => dropOffer(offer.offerId), OFFER_TRIGGER_WINDOW_MS);
  pendingOffers.set(tabId, offer);
}

/**
 * The username of a sent form. A change-password page names no user: then the site's only saved login is meant.
 */
function nameTheAccount(
  vault: PasswordVault,
  origin: string,
  message: SubmittedMessage,
): string {
  if (message.username !== "" || !message.isNewPassword) {
    return message.username;
  }
  const savedLogins = findLoginsForOrigin(vault, origin);
  const onlyLogin = savedLogins.length === 1 ? savedLogins[0] : undefined;
  return onlyLogin === undefined ? "" : onlyLogin.username;
}

/**
 * Triggers the offer when the tab loads another page. Returns the function that stops listening.
 */
function triggerOnNavigation(contents: WebContents, offer: PendingOffer): () => void {
  const onNavigated = (): void => triggerOffer(offer);
  contents.on("did-navigate", onNavigated);
  return () => {
    if (!contents.isDestroyed()) {
      contents.removeListener("did-navigate", onNavigated);
    }
  };
}

/**
 * The sign-in went through: the offer may be shown now. Too late after the form was sent means it was something else.
 */
function triggerOffer(offer: PendingOffer): void {
  if (offer.triggeredAt !== null) {
    return;
  }
  const now = Date.now();
  if (now - offer.submittedAt > OFFER_TRIGGER_WINDOW_MS) {
    dropOffer(offer.offerId);
    return;
  }
  offer.triggeredAt = now;
  offer.stopListeningToTab();
  if (offer.expiryTimer !== null) {
    clearTimeout(offer.expiryTimer);
    offer.expiryTimer = null;
  }
  showNextOffer();
}

/**
 * Forgets an offer and its password, and takes it off screen when it is the one shown.
 */
function dropOffer(offerId: string): void {
  const offer = [...pendingOffers.values()].find((candidate) => candidate.offerId === offerId);
  if (offer === undefined) {
    return;
  }
  pendingOffers.delete(offer.tabId);
  offer.stopListeningToTab();
  if (offer.expiryTimer !== null) {
    clearTimeout(offer.expiryTimer);
  }
  if (shownOfferId === offerId) {
    shownOfferId = null;
    closePasswordOffer(offerId);
  }
}

/**
 * Drops offers whose tab is gone or that waited too long to be shown.
 */
function dropStaleOffers(): void {
  const now = Date.now();
  for (const offer of [...pendingOffers.values()]) {
    const isTabGone = getTabContents(offer.tabId) === null;
    const hasWaitedTooLong = offer.triggeredAt !== null && now - offer.triggeredAt > OFFER_SHOW_LIFETIME_MS;
    if (isTabGone || hasWaitedTooLong) {
      dropOffer(offer.offerId);
    }
  }
}

/**
 * Shows the first finished sign-in whose tab is on screen in the focused window, when nothing else is on the overlay.
 * Otherwise checks again in a moment.
 */
function showNextOffer(): void {
  if (shownOfferId !== null) {
    return;
  }
  dropStaleOffers();
  const finishedOffers = [...pendingOffers.values()].filter((offer) => offer.triggeredAt !== null);
  if (finishedOffers.length === 0) {
    return;
  }
  const shownTabIds = getShownTabIdsInWindow(getState().focusedWindowId);
  const nextOffer = finishedOffers.find((offer) => shownTabIds.includes(offer.tabId));
  const isOverlayBusy = isPanelShown() || isOverlayShown();
  if (nextOffer === undefined || isOverlayBusy) {
    if (retryTimer === null) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        showNextOffer();
      }, BUSY_RETRY_MS);
    }
    return;
  }
  shownOfferId = nextOffer.offerId;
  const host = new URL(nextOffer.origin).host.replace(LEADING_WWW, "");
  openPasswordOffer(nextOffer.offerId, host, nextOffer.username, nextOffer.decision.kind === "update");
}

/**
 * Save, Never for this site or Not now on a shown offer. Every answer ends the offer and forgets its password.
 */
export function answerPasswordOffer(offerId: string, answer: PasswordOfferAnswer): void {
  const offer = [...pendingOffers.values()].find((candidate) => candidate.offerId === offerId);
  if (offer === undefined) {
    return;
  }
  const { profileId, origin, username, password, decision } = offer;
  dropOffer(offerId);
  if (answer === "notNow") {
    return;
  }
  if (answer === "never") {
    changeVault(profileId, (vault) => addNeverSave(vault, origin)).catch(reportVaultError);
    return;
  }
  const change =
    decision.kind === "update"
      ? (vault: PasswordVault) => updateLoginPassword(vault, decision.loginId, password, Date.now())
      : (vault: PasswordVault) => saveLogin(vault, { origin: origin, username: username, password: password }, randomUUID(), Date.now());
  changeVault(profileId, change)
    .then((hasChanged) => {
      if (hasChanged) {
        showToast(decision.kind === "update" ? "Password updated" : "Password saved").catch(() => undefined);
      }
    })
    .catch(reportVaultError);
}

function reportVaultError(error: unknown): void {
  console.error("Could not change the password vault:", error instanceof Error ? error.name : "");
}
