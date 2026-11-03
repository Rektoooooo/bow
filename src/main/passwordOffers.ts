/**
 * WHY this file exists:
 *   Asks "Save password for example.com?" after the user signed in on a page, like browsers do, and saves, updates
 *   or remembers "never for this site" in the profile's vault. The question comes only once the sign-in went through
 *   (the page moved on to another page, or a single-page site reported it finished), so a wrong password is rarely
 *   offered. A password the user did not type (a page script filled it in) is never offered.
 *   Where it is asked: a tab gets the overlay's card, and only while that tab is the one on screen. A Peek and a
 *   Little Window get a native macOS sheet on their window (the overlay is busy drawing the Peek, and a Little Window
 *   has none). A sign-in popup usually closes right after signing in, before any navigation or report, so its offer
 *   also triggers when the popup is destroyed; it is asked where its opener lives.
 *
 * Data source:
 *   Form reports from formsBridge.ts (what was typed, in which page and profile), the profile's vault
 *   (passwordVault.ts, rules in passwords.ts), pageHosts.ts (the page and its opener) and the page's own events.
 *
 * Data flow:
 *   page helper → formsBridge onFormSubmitted → a pending offer for that page (the password stays here, in main's
 *   memory, until the offer ends) → the page navigates / onLoginFinished / a popup is destroyed → the offer is
 *   triggered → overlay panel "savePassword" (never holds the password) for a tab, or a sheet (dialog.showMessageBox,
 *   no password in it) for a Peek or Little Window → Save / Never for this site / Not now
 *   → answerPasswordOffer() → changeVault() → a short confirmation. Escape or a click outside means Not now.
 */
import { randomUUID } from "node:crypto";
import { dialog } from "electron";
import type { SubmittedMessage } from "../shared/forms";
import type { ProfileId } from "../shared/types";
import { getState } from "./browserCore";
import { onFormSubmitted, onLoginFinished } from "./formsBridge";
import { isOverlayShown } from "./overlay";
import { findHomeHost, isPageHostAlive } from "./pageHosts";
import type { PageHost } from "./pageHosts";
import { closePasswordOffer, isPanelShown, onPanelEnded, openPasswordOffer } from "./overlayController";
import { addNeverSave, decideOffer, findLoginsForOrigin, saveLogin, updateLoginPassword } from "./passwords";
import type { OfferDecision, PasswordVault } from "./passwords";
import { changeVault, openVault } from "./passwordVault";
import { showToast } from "./statusBubble";
import { getShownTabIdsInWindow } from "./tabViews";

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

/** One sign-in waiting to be asked about. At most one per page. */
interface PendingOffer {
  offerId: string;
  /** The page that sent the form. A popup's offer is asked where its opener lives (see findHomeHost). */
  page: PageHost;
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
  stopListeningToPage: () => void;
}

/** Offers in the order they came, by the key of their page. */
const pendingOffers = new Map<string, PendingOffer>();

/** The card on the overlay, if an offer is shown there. */
let shownOfferId: string | null = null;

/** Offers whose sheet is open now (one sheet each; the answer ends the offer). */
const offersInSheet = new Set<string>();
let offerCounter = 0;
let retryTimer: NodeJS.Timeout | null = null;

/**
 * Connects the offers to the forms bridge and to the overlay. Runs once at startup.
 */
export function initializePasswordOffers(): void {
  onFormSubmitted((report) => {
    rememberSubmit(report.page, report.profileId, report.origin, report.message).catch((error) => {
      console.error("Could not prepare the password offer:", error instanceof Error ? error.name : "");
    });
  });
  onLoginFinished((page, origin) => {
    const offer = pendingOffers.get(page.key);
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
  page: PageHost,
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
  // A popup may close before the vault answered; its offer still counts (it triggers at once, see below).
  const hasClosed = page.contents.isDestroyed();
  if (hasClosed && page.kind !== "popup") {
    return;
  }
  // A newer sign-in in the same page replaces the older one.
  const olderOffer = pendingOffers.get(page.key);
  if (olderOffer !== undefined) {
    dropOffer(olderOffer.offerId);
  }
  offerCounter = offerCounter + 1;
  const offer: PendingOffer = {
    offerId: `password-offer-${offerCounter}`,
    page: page,
    profileId: profileId,
    origin: origin,
    username: username,
    password: message.password,
    decision: decision,
    submittedAt: Date.now(),
    triggeredAt: null,
    expiryTimer: null,
    stopListeningToPage: () => undefined,
  };
  offer.stopListeningToPage = triggerOnPageEvents(page, offer);
  offer.expiryTimer = setTimeout(() => dropOffer(offer.offerId), OFFER_TRIGGER_WINDOW_MS);
  pendingOffers.set(page.key, offer);
  if (hasClosed) {
    triggerOffer(offer);
  }
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
 * Triggers the offer when the page loads another page. A popup also triggers it when it is destroyed: a sign-in popup
 * usually closes itself right after the form was sent, before anything else could say that it went through (a closing
 * before the trigger window ends counts, the same as a navigation does). Returns the function that stops listening.
 */
function triggerOnPageEvents(page: PageHost, offer: PendingOffer): () => void {
  const contents = page.contents;
  if (contents.isDestroyed()) {
    return () => undefined;
  }
  const onNavigated = (): void => triggerOffer(offer);
  contents.on("did-navigate", onNavigated);
  const isPopup = page.kind === "popup";
  if (isPopup) {
    contents.once("destroyed", onNavigated);
  }
  return () => {
    if (contents.isDestroyed()) {
      return;
    }
    contents.removeListener("did-navigate", onNavigated);
    contents.removeListener("destroyed", onNavigated);
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
  offer.stopListeningToPage();
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
  pendingOffers.delete(offer.page.key);
  offer.stopListeningToPage();
  if (offer.expiryTimer !== null) {
    clearTimeout(offer.expiryTimer);
  }
  if (shownOfferId === offerId) {
    shownOfferId = null;
    closePasswordOffer(offerId);
  }
}

/** The page an offer is asked at: its own, or for a popup the page that opened it. */
function findOfferHome(offer: PendingOffer): PageHost {
  return findHomeHost(offer.page);
}

/**
 * Drops offers whose page is gone (a popup's goes when its opener does: the popup itself is expected to close) or
 * that waited too long to be shown.
 */
function dropStaleOffers(): void {
  const now = Date.now();
  for (const offer of [...pendingOffers.values()]) {
    const isTabGone = !isPageHostAlive(findOfferHome(offer));
    const hasWaitedTooLong = offer.triggeredAt !== null && now - offer.triggeredAt > OFFER_SHOW_LIFETIME_MS;
    if (isTabGone || hasWaitedTooLong) {
      dropOffer(offer.offerId);
    }
  }
}

/**
 * Asks every finished sign-in that is not a tab's in a sheet, then shows the first finished tab sign-in whose tab is
 * on screen in the focused window, when nothing else is on the overlay. Otherwise checks again in a moment.
 */
function showNextOffer(): void {
  dropStaleOffers();
  const finishedOffers = [...pendingOffers.values()].filter((offer) => offer.triggeredAt !== null);
  const sheetOffers = finishedOffers.filter((offer) => findOfferHome(offer).kind !== "tab");
  for (const offer of sheetOffers) {
    askInSheet(offer);
  }
  if (shownOfferId !== null) {
    return;
  }
  const cardOffers = finishedOffers.filter((offer) => findOfferHome(offer).kind === "tab");
  if (cardOffers.length === 0) {
    return;
  }
  const shownTabIds = getShownTabIdsInWindow(getState().focusedWindowId);
  const nextOffer = cardOffers.find((offer) => shownTabIds.includes(findOfferHome(offer).key));
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
  openPasswordOffer(nextOffer.offerId, nameTheSite(nextOffer.origin), nextOffer.username, nextOffer.decision.kind === "update");
}

function nameTheSite(origin: string): string {
  return new URL(origin).host.replace(LEADING_WWW, "");
}

/**
 * Asks about an offer in a native sheet on the window of the page it belongs to. The sheet never holds the password.
 * Closing that window ends the offer without an answer. Does nothing for an offer whose sheet is already open.
 */
function askInSheet(offer: PendingOffer): void {
  const window = findOfferHome(offer).window;
  if (offersInSheet.has(offer.offerId)) {
    return;
  }
  if (window === null || window.isDestroyed()) {
    dropOffer(offer.offerId);
    return;
  }
  offersInSheet.add(offer.offerId);
  const isUpdate = offer.decision.kind === "update";
  const saveButton = isUpdate ? "Update" : "Save";
  // "Never for This Site" is not offered for an update, as on the card.
  const choices: { label: string; answer: PasswordOfferAnswer }[] = isUpdate
    ? [{ label: saveButton, answer: "save" }, { label: "Not Now", answer: "notNow" }]
    : [{ label: saveButton, answer: "save" }, { label: "Never for This Site", answer: "never" }, { label: "Not Now", answer: "notNow" }];
  const notNowIndex = choices.length - 1;
  const handleWindowClose = (): void => dropOffer(offer.offerId);
  window.once("close", handleWindowClose);
  dialog
    .showMessageBox(window, {
      type: "question",
      message: `${saveButton} password for ${nameTheSite(offer.origin)}?`,
      detail: offer.username,
      buttons: choices.map((choice) => choice.label),
      defaultId: 0,
      cancelId: notNowIndex,
    })
    .then((result) => {
      const chosen = choices[result.response];
      answerPasswordOffer(offer.offerId, chosen === undefined ? "notNow" : chosen.answer);
    })
    .catch((error) => {
      console.error("Could not ask about the password:", error instanceof Error ? error.name : "");
      dropOffer(offer.offerId);
    })
    .finally(() => {
      offersInSheet.delete(offer.offerId);
      if (!window.isDestroyed()) {
        window.removeListener("close", handleWindowClose);
      }
    });
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
