/**
 * WHY this file exists:
 *   The connection between Bow Passwords and the web pages. It installs the page helper (src/preload/formsPreload.ts)
 *   in every profile session (never in a private window), listens to what the helper reports, and sends a login or a
 *   remembered value back to one page when the user picks it. A page can send anything on these channels, so no
 *   message is trusted: main finds the tab, the profile and the site itself (from the sender, never from the
 *   message), refuses anything that is not a tab's own top frame on an http(s) site, limits how fast a page may talk,
 *   and checks every payload (formsMessages.ts). Credentials only ever go out through fillLogin / fillValue, to the
 *   one frame whose site the caller named.
 *
 * Data source:
 *   IpcMainEvent (sender, senderFrame, session) + getTabViews() + findSessionProfileId().
 *
 * Data flow:
 *   page helper → FORMS_CHANNELS.* → registerFormsIpc() checks → listeners (onFieldFocused, onFieldLeft,
 *   onFormSubmitted, onLoginFinished) for the field list, the save prompt and form memory
 *   fillLogin / fillValue → that tab's top frame → the helper writes into the field the user is in
 */
import { ipcMain } from "electron";
import type { IpcMainEvent, Session, WebContents } from "electron";
import * as path from "node:path";
import { FORMS_CHANNELS } from "../shared/forms";
import type { FieldFocusedMessage, FieldRole, FillMessage, FillValueMessage, SubmittedMessage } from "../shared/forms";
import type { ItemId, ProfileId } from "../shared/types";
import { parseFieldFocusedMessage, parseSubmittedMessage } from "./formsMessages";
import { normalizeLoginOrigin } from "./passwords";
import { findSessionProfileId } from "./profiles";
import { getTabContents, getTabViews } from "./tabViews";

/** The id of the helper in a session's preload scripts (tests look for it). */
export const FORMS_HELPER_ID = "bow-forms";

/** Most messages one page may send in any one second. Our choice: fast typing is about 15 keystrokes a second. */
export const MAX_FORMS_MESSAGES_PER_SECOND = 60;

const RATE_WINDOW_MS = 1000;

/** What the field list needs to know about a field the user is in. */
export interface FieldReport {
  tabId: ItemId;
  profileId: ProfileId;
  origin: string;
  message: FieldFocusedMessage;
}

/** What the save prompt and form memory need to know about a sent form. */
export interface SubmittedReport {
  tabId: ItemId;
  profileId: ProfileId;
  origin: string;
  message: SubmittedMessage;
}

/** Who a checked message came from. */
interface Sender {
  tabId: ItemId;
  profileId: ProfileId;
  origin: string;
}

/** Counts of accepted messages, for end-to-end checks only. Never holds a value from a page. */
export interface FormsMessageCounts {
  fieldFocused: number;
  fieldLeft: number;
  submitted: number;
  loginFinished: number;
  refused: number;
  lastRole: FieldRole | null;
  lastOrigin: string | null;
}

const fieldFocusedListeners: ((report: FieldReport) => void)[] = [];
const fieldLeftListeners: ((tabId: ItemId) => void)[] = [];
const formSubmittedListeners: ((report: SubmittedReport) => void)[] = [];
const loginFinishedListeners: ((tabId: ItemId, origin: string) => void)[] = [];

const messageCounts: FormsMessageCounts = {
  fieldFocused: 0,
  fieldLeft: 0,
  submitted: 0,
  loginFinished: 0,
  refused: 0,
  lastRole: null,
  lastOrigin: null,
};

/** When each page (by web contents id) sent its recent messages, newest last. */
const recentMessageTimes = new Map<number, number[]>();

export function onFieldFocused(listener: (report: FieldReport) => void): void {
  fieldFocusedListeners.push(listener);
}

export function onFieldLeft(listener: (tabId: ItemId) => void): void {
  fieldLeftListeners.push(listener);
}

export function onFormSubmitted(listener: (report: SubmittedReport) => void): void {
  formSubmittedListeners.push(listener);
}

export function onLoginFinished(listener: (tabId: ItemId, origin: string) => void): void {
  loginFinishedListeners.push(listener);
}

export function getFormsMessageCounts(): FormsMessageCounts {
  return { ...messageCounts };
}

/**
 * Gives a profile session's pages the forms helper. Private windows get nothing: their sessions are in memory and no
 * login or form value of theirs may be saved or offered.
 */
export function registerFormsHelper(profileSession: Session): void {
  if (!profileSession.isPersistent()) {
    return;
  }
  const isAlreadyRegistered = profileSession.getPreloadScripts().some((script) => script.id === FORMS_HELPER_ID);
  if (isAlreadyRegistered) {
    return;
  }
  const filePath = path.join(__dirname, "..", "preload", "formsPreload.js");
  profileSession.registerPreloadScript({ id: FORMS_HELPER_ID, type: "frame", filePath: filePath });
}

/** True when this page has sent more than the limit in the last second (and records this message). */
function isOverRateLimit(contents: WebContents, now: number): boolean {
  let times = recentMessageTimes.get(contents.id);
  if (times === undefined) {
    times = [];
    recentMessageTimes.set(contents.id, times);
    const contentsId = contents.id;
    contents.once("destroyed", () => recentMessageTimes.delete(contentsId));
  }
  while (times.length > 0 && now - times[0] >= RATE_WINDOW_MS) {
    times.shift();
  }
  if (times.length >= MAX_FORMS_MESSAGES_PER_SECOND) {
    return true;
  }
  times.push(now);
  return false;
}

function findTabIdOfContents(contents: WebContents): ItemId | null {
  for (const [tabId, view] of getTabViews()) {
    if (view.webContents === contents) {
      return tabId;
    }
  }
  return null;
}

/**
 * Who sent this message, or null when it must be refused: not a tab's page, not its top frame, not an http(s) site,
 * not a profile's session, or too fast.
 */
function identifySender(event: IpcMainEvent): Sender | null {
  const contents = event.sender;
  if (isOverRateLimit(contents, Date.now())) {
    return null;
  }
  const tabId = findTabIdOfContents(contents);
  const frame = event.senderFrame;
  if (tabId === null || !frame) {
    return null;
  }
  const topFrame = contents.mainFrame;
  const isTopFrame = frame.processId === topFrame.processId && frame.routingId === topFrame.routingId;
  if (!isTopFrame) {
    return null;
  }
  const origin = normalizeLoginOrigin(frame.origin);
  if (origin === null || origin !== frame.origin) {
    return null;
  }
  // null is a private window and undefined is one of our own pages: neither gets a password manager.
  const profileId = findSessionProfileId(contents.session);
  if (typeof profileId !== "string") {
    return null;
  }
  return { tabId: tabId, profileId: profileId, origin: origin };
}

function acceptMessage(origin: string): void {
  messageCounts.lastOrigin = origin;
}

function handleFieldFocused(event: IpcMainEvent, payload: unknown): void {
  const sender = identifySender(event);
  const message = parseFieldFocusedMessage(payload);
  if (sender === null || message === null) {
    messageCounts.refused = messageCounts.refused + 1;
    return;
  }
  messageCounts.fieldFocused = messageCounts.fieldFocused + 1;
  messageCounts.lastRole = message.role;
  acceptMessage(sender.origin);
  const report: FieldReport = { tabId: sender.tabId, profileId: sender.profileId, origin: sender.origin, message: message };
  for (const listener of fieldFocusedListeners) {
    listener(report);
  }
}

function handleFieldLeft(event: IpcMainEvent): void {
  const sender = identifySender(event);
  if (sender === null) {
    messageCounts.refused = messageCounts.refused + 1;
    return;
  }
  messageCounts.fieldLeft = messageCounts.fieldLeft + 1;
  acceptMessage(sender.origin);
  for (const listener of fieldLeftListeners) {
    listener(sender.tabId);
  }
}

function handleSubmitted(event: IpcMainEvent, payload: unknown): void {
  const sender = identifySender(event);
  const message = parseSubmittedMessage(payload);
  if (sender === null || message === null) {
    messageCounts.refused = messageCounts.refused + 1;
    return;
  }
  messageCounts.submitted = messageCounts.submitted + 1;
  acceptMessage(sender.origin);
  const report: SubmittedReport = { tabId: sender.tabId, profileId: sender.profileId, origin: sender.origin, message: message };
  for (const listener of formSubmittedListeners) {
    listener(report);
  }
}

function handleLoginFinished(event: IpcMainEvent): void {
  const sender = identifySender(event);
  if (sender === null) {
    messageCounts.refused = messageCounts.refused + 1;
    return;
  }
  messageCounts.loginFinished = messageCounts.loginFinished + 1;
  acceptMessage(sender.origin);
  for (const listener of loginFinishedListeners) {
    listener(sender.tabId, sender.origin);
  }
}

/**
 * Starts listening to the page helpers. Runs once at startup.
 */
export function registerFormsIpc(): void {
  ipcMain.on(FORMS_CHANNELS.fieldFocused, handleFieldFocused);
  ipcMain.on(FORMS_CHANNELS.fieldLeft, handleFieldLeft);
  ipcMain.on(FORMS_CHANNELS.submitted, handleSubmitted);
  ipcMain.on(FORMS_CHANNELS.loginFinished, handleLoginFinished);
}

/**
 * Sends one message to the top frame of a tab, but only while that frame still shows the site the caller meant (the
 * page may have navigated since the list opened). Then returns the keyboard focus to the page: picking in Bow's list
 * with the mouse took it away.
 */
function sendToTopFrame(tabId: ItemId, expectedOrigin: string, channel: string, message: FillMessage | FillValueMessage): boolean {
  const contents = getTabContents(tabId);
  if (contents === null) {
    return false;
  }
  if (contents.mainFrame.origin !== expectedOrigin) {
    return false;
  }
  contents.mainFrame.send(channel, message);
  contents.focus();
  return true;
}

/** Fills the sign-in form of the field the user is in. False when the page is gone or is no longer on that site. */
export function fillLogin(tabId: ItemId, expectedOrigin: string, credentials: FillMessage): boolean {
  return sendToTopFrame(tabId, expectedOrigin, FORMS_CHANNELS.fill, credentials);
}

/** Puts a remembered value into the field the user is in. False when the page is gone or is no longer on that site. */
export function fillValue(tabId: ItemId, expectedOrigin: string, message: FillValueMessage): boolean {
  return sendToTopFrame(tabId, expectedOrigin, FORMS_CHANNELS.fillValue, message);
}
