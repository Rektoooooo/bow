/**
 * WHY this file exists:
 *   Moving to another Mac (or another browser): a vault cannot simply be copied, because it is encrypted with a key in
 *   this Mac's Keychain. So a profile's saved logins leave Bow as the CSV file Chrome exports, which Bow on the other
 *   Mac (Library › Passwords › Import passwords…) and other browsers read. That file holds every password in plain
 *   text: the user proves it is them first, every time (Touch ID or the Mac's password), the file is readable by this
 *   macOS user only from its first byte (written to a new file of its own, then moved into place), it goes to
 *   Downloads by default (iCloud syncs Documents and Desktop for many people), and the closing sheet says to delete it
 *   once imported. Only the profile id comes from the page; passwords never leave the main process except into the
 *   file the user named.
 *
 * Data source:
 *   The profile's vault (passwordVault.ts) and buildPasswordsCsv (passwordCsv.ts).
 *
 * Data flow:
 *   Library › Passwords › Export passwords… → exportPasswordsToFile(state, profileId) → openVault → ensureUserPresent →
 *   save sheet → buildPasswordsCsv → file (owner only) → a sheet with the count
 */
import { app } from "electron";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BrowserState, ProfileId } from "../shared/types";
import { ask, askWhereToSave } from "./dialogs";
import { ensureUserPresent } from "./passwordAuth";
import { buildPasswordsCsv } from "./passwordCsv";
import { openVault } from "./passwordVault";

/** Read and write for this macOS user, nothing for anyone else (the file holds passwords in plain text). */
const OWNER_ONLY_FILE_MODE = 0o600;

/** Characters a file name cannot hold on macOS (a profile name may have them). */
const UNSAFE_FILE_NAME_CHARACTERS = /[/:]/g;

/** What macOS says Touch ID is for. An export always asks, even right after Show or Copy password. */
const EXPORT_TOUCH_ID_REASON = "export your saved passwords to a file";

/**
 * Writes the text to a new file next to the target, readable by this user only from the start ("wx": never an existing
 * file), then moves it over the target. An existing file is replaced whole, so its old permissions never apply. On
 * any failure nothing is left behind and the target is as it was. Returns whether it worked.
 */
function writeOwnerOnlyFile(filePath: string, text: string): boolean {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, text, { mode: OWNER_ONLY_FILE_MODE, flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
    return true;
  } catch {
    fs.rmSync(temporaryPath, { force: true });
    return false;
  }
}

/**
 * Library › Passwords › Export passwords…: writes the profile's saved logins to a CSV file the user names. Form memory
 * and the sites Bow never saves for are not in it (the file is for passwords only, as in Chrome).
 */
export async function exportPasswordsToFile(state: BrowserState, profileId: ProfileId): Promise<void> {
  const profile = state.profiles.find((candidate) => candidate.id === profileId);
  if (profile === undefined) {
    return;
  }
  const access = await openVault(profileId);
  if (access.status !== "ready") {
    await ask({ type: "warning", message: "Bow can't open these passwords", detail: "Nothing was exported. Try again from Library › Passwords." });
    return;
  }
  const logins = access.vault.logins;
  if (logins.length === 0) {
    await ask({ type: "info", message: `${profile.name} has no saved passwords to export.` });
    return;
  }
  const isUserPresent = await ensureUserPresent(EXPORT_TOUCH_ID_REASON, false);
  if (!isUserPresent) {
    return;
  }
  const safeProfileName = profile.name.replace(UNSAFE_FILE_NAME_CHARACTERS, "-");
  const filePath = await askWhereToSave({
    title: "Export Passwords",
    message: "The file holds your passwords in plain text. Keep it somewhere only you can reach, and delete it once imported.",
    defaultPath: path.join(app.getPath("downloads"), `Bow Passwords - ${safeProfileName}.csv`),
    filters: [{ name: "Passwords (CSV)", extensions: ["csv"] }],
  });
  if (filePath === null) {
    return;
  }
  const isWritten = writeOwnerOnlyFile(filePath, buildPasswordsCsv(logins));
  if (!isWritten) {
    await ask({ type: "warning", message: "The passwords could not be exported", detail: "Bow could not write the file there. Try another folder." });
    return;
  }
  const countText = logins.length === 1 ? "1 password" : `${logins.length} passwords`;
  await ask({
    type: "info",
    message: `Exported ${countText} from ${profile.name}`,
    detail: "The file is not encrypted: anyone who opens it can read every password. On your other Mac, open Library › Passwords, choose the profile and click Import passwords…, then delete the file here.",
  });
}
