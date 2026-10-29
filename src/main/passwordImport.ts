/**
 * WHY this file exists:
 *   People switching to Bow bring their saved passwords as the CSV file their old browser exports. This is the one
 *   place that asks for the file, reads it and merges it into a profile's vault, so Library › Passwords, File ›
 *   Import From Browser and the onboarding all behave the same. The file holds every password in plain text, so
 *   afterwards the user is offered to move it to the Trash; only the file just imported can be moved (the page never
 *   sends a path).
 *
 * Data source:
 *   The file the user picks in macOS's open sheet, passwordCsv.ts (parsing and merging) and the profile's vault
 *   (passwordVault.ts).
 *
 * Data flow:
 *   Library button / File menu → offerPasswordsFileImport() → importPasswordsFromFile → a message about the result
 *   the onboarding → importPasswordsFromFile(profileId, window) → open sheet → readLoginsFromCsv → changeVault(
 *   mergeImportedLogins) → PasswordImportOutcome (counts only) → describeImportOutcome in a message or the onboarding
 *   "Move to Trash" → moveImportedFileToTrash() → shell.trashItem(last imported path)
 */
import { dialog, shell } from "electron";
import type { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { MAX_PASSWORD_CSV_BYTES, describeImportOutcome, isImportedFileTrashable } from "../shared/passwords";
import type { PasswordImportOutcome } from "../shared/passwords";
import type { BrowserState, ProfileId } from "../shared/types";
import { getWindow } from "./browserCore";
import { ask } from "./dialogs";
import { mergeImportedLogins, readLoginsFromCsv } from "./passwordCsv";
import type { ImportMergeResult } from "./passwordCsv";
import { changeVault, openVault } from "./passwordVault";

/** The file imported last, so it can be moved to the Trash on request. Memory only, never saved or logged. */
let lastImportedPath: string | null = null;

/**
 * Asks for a passwords export, reads it and adds its logins to the profile's vault. A login Bow already has is never
 * changed. Nothing about the file's contents is logged or returned except counts.
 */
export async function importPasswordsFromFile(profileId: ProfileId, parentWindow: BrowserWindow | null): Promise<PasswordImportOutcome> {
  const options = {
    title: "Import Passwords",
    properties: ["openFile" as const],
    filters: [{ name: "Passwords (CSV)", extensions: ["csv"] }],
  };
  const choice = parentWindow === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(parentWindow, options);
  const filePath = choice.filePaths[0];
  if (choice.canceled || filePath === undefined) {
    return { kind: "cancelled" };
  }
  const file = readPasswordFile(filePath);
  if (file.kind === "tooLarge") {
    return { kind: "tooLarge" };
  }
  const readResult = file.kind === "text" ? readLoginsFromCsv(file.text) : null;
  if (readResult === null || !readResult.isRecognized) {
    return { kind: "unrecognized" };
  }
  const access = await openVault(profileId);
  if (access.status !== "ready") {
    return { kind: "vaultUnavailable" };
  }
  // changeVault runs the change only on a ready vault; the counts come out through this holder.
  const merged: { result: ImportMergeResult | null } = { result: null };
  const now = Date.now();
  await changeVault(profileId, (vault) => {
    merged.result = mergeImportedLogins(vault, readResult.logins, randomUUID, now);
    return merged.result.vault;
  });
  const mergeResult = merged.result;
  if (mergeResult === null) {
    return { kind: "vaultUnavailable" };
  }
  lastImportedPath = filePath;
  return {
    kind: "imported",
    addedCount: mergeResult.addedCount,
    alreadySavedCount: mergeResult.alreadySavedCount,
    keptDifferentCount: mergeResult.keptDifferentCount,
    // Rows without an address or password, and rows left out because the vault is full.
    skippedCount: readResult.skippedCount + mergeResult.skippedCount,
  };
}

type PasswordFile = { kind: "text"; text: string } | { kind: "tooLarge" } | { kind: "unreadable" };

/**
 * The file's text, unless it is over the limit or cannot be read.
 */
function readPasswordFile(filePath: string): PasswordFile {
  try {
    if (fs.statSync(filePath).size > MAX_PASSWORD_CSV_BYTES) {
      return { kind: "tooLarge" };
    }
    return { kind: "text", text: fs.readFileSync(filePath, "utf8") };
  } catch {
    return { kind: "unreadable" };
  }
}

/**
 * Moves the file imported last to the Trash (never deletes it) and forgets it. False when there is none or the move
 * failed.
 */
export async function moveImportedFileToTrash(): Promise<boolean> {
  const filePath = lastImportedPath;
  if (filePath === null) {
    return false;
  }
  lastImportedPath = null;
  try {
    await shell.trashItem(filePath);
    return true;
  } catch (error) {
    console.warn("Could not move the imported passwords file to the Trash:", error instanceof Error ? error.name : "");
    return false;
  }
}

/** The two buttons of the question after an import. The first is the default. */
const TRASH_BUTTONS = ["Move to Trash", "Keep File"];
const MOVE_TO_TRASH_INDEX = 0;
const TRASH_QUESTION = "The file holds your passwords in plain text. Move it to the Trash?";

/**
 * Library › Passwords › Import and File › Import From Browser › Passwords from a File: ask for the file, import it,
 * say how it went in a sheet on the focused window, and offer to move the file to the Trash.
 */
export async function offerPasswordsFileImport(state: BrowserState, profileId: ProfileId): Promise<void> {
  if (!state.profiles.some((profile) => profile.id === profileId)) {
    return;
  }
  const outcome = await importPasswordsFromFile(profileId, getWindow());
  if (outcome.kind === "cancelled") {
    return;
  }
  const message = describeImportOutcome(outcome);
  if (!isImportedFileTrashable(outcome)) {
    await ask({ type: "info", message: message });
    return;
  }
  const answer = await ask({ type: "info", message: message, detail: TRASH_QUESTION, buttons: TRASH_BUTTONS, defaultId: MOVE_TO_TRASH_INDEX, cancelId: TRASH_BUTTONS.length - 1 });
  if (answer === MOVE_TO_TRASH_INDEX) {
    await moveImportedFileToTrash();
  }
}
