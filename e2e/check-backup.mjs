// End-to-end check of backups (File › Export Bow Backup… and Restore from Backup…) with made-up data:
//   - Export writes one Bow backup file with the Spaces, tabs, folders, Notes and Boosts, and nothing from other windows.
//   - Restore › Replace My Setup brings a changed setup back exactly (keeping a copy of it first); a note's text comes
//     back; a JavaScript Boost arrives switched off.
//   - Restore › Add Its Spaces puts the backup's Spaces next to the current ones, its note under a new id.
//   - A file that is not a backup is refused; an unsafe tab address in a backup is left out, and the question says so.
//   - Automatic snapshots: a change leads to a copy in Bow's Backups folder (every 1.5 s here, through
//     --snapshot-interval-ms); with the setting off, none; Restore opens in that folder.
// The save, open and message dialogs are replaced in the main process (a test cannot click macOS sheets).
// usage: npm run build && node e2e/check-backup.mjs      (uses a throwaway --user-data-dir)
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-backup");
const filesDir = path.join(outDir, "backup-files");
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.rmSync(filesDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(filesDir, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// ---------- A made-up setup ----------
const now = Date.now();
const tab = (id, url, title, homeUrl = null) => ({ kind: "tab", id, url, title, customTitle: null, faviconUrl: null, homeUrl, lastActiveAt: now, isMuted: false });
const NOTE_ID = "note-e2e";
const NOTE_TEXT = "<p>Remember the milk</p>";
fs.writeFileSync(
  path.join(userDataDir, "browser-state.json"),
  JSON.stringify({
    version: 2,
    items: {
      "folder-reading": { kind: "folder", id: "folder-reading", title: "Reading", childIds: ["tab-docs"], isOpen: true },
      "tab-docs": tab("tab-docs", "https://docs.example.invalid/", "Docs", "https://docs.example.invalid/"),
      "tab-mail": tab("tab-mail", "https://mail.example.invalid/", "Mail", "https://mail.example.invalid/"),
      "tab-note": tab("tab-note", `sidebar-note:${NOTE_ID}`, "Groceries"),
      "tab-news": tab("tab-news", "https://news.example.invalid/", "News"),
      "tab-home": tab("tab-home", "https://home.example.invalid/", "Home page"),
    },
    profiles: [{ id: "profile-default", name: "Default", favoriteIds: [] }],
    spaces: [
      { id: "space-work", name: "Work", icon: "💼", theme: { colors: ["#000000"], appearance: "dark", grain: 0 }, profileId: "profile-default", pinnedIds: ["folder-reading", "tab-mail"], todayIds: ["tab-note", "tab-news"], isPinnedOpen: true },
      { id: "space-home", name: "Home", icon: "🏠", theme: { colors: ["#e9d8d4"], appearance: "auto", grain: 0 }, profileId: "profile-default", pinnedIds: [], todayIds: ["tab-home"], isPinnedOpen: true },
    ],
    activeSpaceId: "space-work",
    selectedTabIdBySpace: { "space-work": "tab-news", "space-home": "tab-home" },
    archive: [],
    settings: { archiveAfterMs: 43200000, isSidebarVisible: true },
    boosts: [{ id: "boost-1", site: "news.example.invalid", css: "body { color: teal }", zappedSelectors: [], isEnabled: true, javascript: "document.title = 'boosted'", isJavaScriptOn: true }],
  }),
);
fs.mkdirSync(path.join(userDataDir, "Notes"), { recursive: true });
fs.writeFileSync(path.join(userDataDir, "Notes", `${NOTE_ID}.html`), NOTE_TEXT);

const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", "--snapshot-interval-ms=1500", appDir],
  timeout: 30000,
});
const mainLog = [];
app.process().stderr.on("data", (data) => mainLog.push(data.toString()));
let sidebar;
while (!sidebar) {
  sidebar = app.windows().find((candidate) => candidate.url().endsWith("/renderer/index.html"));
  if (!sidebar) await new Promise((resolve) => setTimeout(resolve, 150));
}
await sidebar.emulateMedia({ reducedMotion: "reduce" });
await sidebar.waitForSelector(".space-title");

const dispatch = (action) => sidebar.evaluate((value) => window.browserApi.dispatch(value), action);
const getState = () => sidebar.evaluate(() => window.browserApi.getState());
async function waitFor(read, isDone, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!isDone(value) && Date.now() < deadline) {
    await sidebar.waitForTimeout(200);
    value = await read();
  }
  return value;
}
const spaceNames = (state) => state.spaces.map((space) => space.name);
/** Every tab address of a Space, Pinned (with folders) then Today. */
function addressesOf(state, space) {
  const urls = [];
  const walk = (itemIds) => {
    for (const itemId of itemIds) {
      const item = state.items[itemId];
      if (item?.kind === "tab") urls.push(item.url);
      else if (item) walk(item.childIds);
    }
  };
  walk(space.pinnedIds);
  walk(space.todayIds);
  return urls;
}

// The dialogs answer from globals the checks set; messages are recorded.
const backupPath = path.join(filesDir, "My Setup.bowbackup");
await app.evaluate(({ dialog }, savePath) => {
  globalThis.messages = [];
  globalThis.messageResponse = 0;
  globalThis.restorePath = null;
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: savePath });
  dialog.showOpenDialog = async (...parts) => {
    globalThis.lastOpenOptions = parts.at(-1);
    return { canceled: false, filePaths: [globalThis.restorePath] };
  };
  dialog.showMessageBox = async (...parts) => {
    const options = parts.at(-1);
    globalThis.messages.push(`${options.message} | ${options.detail ?? ""}`);
    return { response: globalThis.messageResponse, checkboxChecked: false };
  };
}, backupPath);
const setDialogs = (restorePath, response) =>
  app.evaluate((_electron, values) => {
    globalThis.restorePath = values.restorePath;
    globalThis.messageResponse = values.response;
    globalThis.messages = [];
  }, { restorePath, response });
const readMessages = () => app.evaluate(() => globalThis.messages);

// ---------- Export ----------
const original = await getState();
await dispatch({ type: "exportBackup" });
await waitFor(() => fs.existsSync(backupPath), (exists) => exists);
const exported = fs.existsSync(backupPath) ? JSON.parse(fs.readFileSync(backupPath, "utf8")) : null;
check("Export writes a Bow backup file", exported?.format === "bow-backup" && exported.formatVersion === 1, exported ? `${exported.format} v${exported.formatVersion}` : "no file");
check("with the Spaces, tabs and folders", JSON.stringify(spaceNames(exported?.state ?? { spaces: [] })) === JSON.stringify(["Work", "Home"]) && exported?.state.items["folder-reading"]?.childIds.includes("tab-docs"));
check("with the text of the Notes its tabs use", exported?.notes?.[NOTE_ID] === NOTE_TEXT);
check("and nothing of other windows", Array.isArray(exported?.state.otherWindows) && exported.state.otherWindows.length === 0);

// ---------- Change things, then Replace ----------
await dispatch({ type: "deleteSpace", spaceId: "space-home" });
await dispatch({ type: "renameItem", itemId: "folder-reading", name: "Renamed" });
fs.writeFileSync(path.join(userDataDir, "Notes", `${NOTE_ID}.html`), "<p>Changed</p>");
await waitFor(getState, (state) => state.spaces.length === 1);
await setDialogs(backupPath, 0);
await dispatch({ type: "restoreBackup" });
let state = await waitFor(getState, (current) => current.spaces.length === 2);
const question = (await readMessages())[0] ?? "";
check("Restore asks first, saying what the backup holds", question.startsWith("Restore this backup?") && question.includes("2 Spaces") && question.includes("1 Note,"), question.slice(0, 120));
check("Replace My Setup brings the Spaces back", JSON.stringify(spaceNames(state)) === JSON.stringify(spaceNames(original)), spaceNames(state).join(", "));
check(
  "with the same tabs in the same places",
  state.spaces.every((space, index) => JSON.stringify(addressesOf(state, space)) === JSON.stringify(addressesOf(original, original.spaces[index]))),
);
check("and the folder's name", state.items["folder-reading"]?.title === "Reading", state.items["folder-reading"]?.title);
check("the note's text comes back", fs.readFileSync(path.join(userDataDir, "Notes", `${NOTE_ID}.html`), "utf8") === NOTE_TEXT);
check("a JavaScript Boost arrives switched off", state.boosts?.[0]?.javascript?.includes("boosted") && state.boosts[0].isJavaScriptOn === false && question.includes("switched off"));
const keptCopies = fs.existsSync(path.join(userDataDir, "Backups")) ? fs.readdirSync(path.join(userDataDir, "Backups")) : [];
check("Bow kept a copy of the setup it replaced", keptCopies.some((name) => name.startsWith("Before Restore") && name.endsWith(".bowbackup")), keptCopies.join(", "));

// ---------- Add Its Spaces ----------
await setDialogs(backupPath, 1);
await dispatch({ type: "restoreBackup" });
state = await waitFor(getState, (current) => current.spaces.length === 4);
check("Add Its Spaces puts them next to the current ones", JSON.stringify(spaceNames(state)) === JSON.stringify(["Work", "Home", "Work", "Home"]), spaceNames(state).join(", "));
const addedWork = state.spaces[2];
const addedNoteUrl = addedWork ? addressesOf(state, addedWork).find((url) => url.startsWith("sidebar-note:")) : undefined;
const addedNoteId = addedNoteUrl?.slice("sidebar-note:".length);
const addedNotePath = addedNoteId ? path.join(userDataDir, "Notes", `${addedNoteId}.html`) : "";
check(
  "under new ids, its note copied under a new id too",
  addedWork?.id !== "space-work" && addedNoteId !== undefined && addedNoteId !== NOTE_ID && fs.existsSync(addedNotePath) && fs.readFileSync(addedNotePath, "utf8") === NOTE_TEXT,
  String(addedNoteId),
);

// ---------- Files that must not get in ----------
const notBackupPath = path.join(filesDir, "not-a-backup.bowbackup");
fs.writeFileSync(notBackupPath, "hello");
await setDialogs(notBackupPath, 1);
await dispatch({ type: "restoreBackup" });
await waitFor(readMessages, (messages) => messages.length > 0);
const refusal = (await readMessages())[0] ?? "";
check("a file that is not a backup is refused", refusal.startsWith("This backup can't be restored") && (await getState()).spaces.length === 4, refusal.slice(0, 80));

const unsafe = JSON.parse(fs.readFileSync(backupPath, "utf8"));
unsafe.state.items["tab-news"].url = "javascript:alert(document.cookie)";
const unsafePath = path.join(filesDir, "unsafe.bowbackup");
fs.writeFileSync(unsafePath, JSON.stringify(unsafe));
await setDialogs(unsafePath, 1);
await dispatch({ type: "restoreBackup" });
state = await waitFor(getState, (current) => current.spaces.length === 6);
const unsafeQuestion = (await readMessages())[0] ?? "";
const anyScriptAddress = Object.values(state.items).some((item) => item.kind === "tab" && item.url.startsWith("javascript:"));
check("an unsafe tab address in a backup is left out, and the question says so", state.spaces.length === 6 && !anyScriptAddress && unsafeQuestion.includes("left out"), unsafeQuestion.split(" | ")[1]?.split("\n").filter(Boolean).at(-1));

// ---------- Automatic snapshots ----------
const backupsFolder = path.join(userDataDir, "Backups");
const snapshotFiles = () => (fs.existsSync(backupsFolder) ? fs.readdirSync(backupsFolder).filter((name) => name.startsWith("Snapshot ")) : []);
await dispatch({ type: "renameItem", itemId: "folder-reading", name: "Snapshotted" });
const afterChange = await waitFor(async () => snapshotFiles(), (names) => names.length > 0, 10000);
check("after a change, Bow keeps an automatic copy in its Backups folder", afterChange.length > 0, afterChange.join(", "));
const snapshotText = afterChange.length > 0 ? fs.readFileSync(path.join(backupsFolder, afterChange.at(-1)), "utf8") : "{}";
check("which is a backup like an exported one", JSON.parse(snapshotText).format === "bow-backup");
await dispatch({ type: "setSnapshots", isOn: false });
await sidebar.waitForTimeout(2000);
const countWhenOff = snapshotFiles().length;
await dispatch({ type: "renameItem", itemId: "folder-reading", name: "Not snapshotted" });
await sidebar.waitForTimeout(4000);
check("with automatic backups off, no new copies", snapshotFiles().length === countWhenOff, `${countWhenOff} → ${snapshotFiles().length}`);
const openOptions = await app.evaluate(() => globalThis.lastOpenOptions);
check("Restore opens in Bow's Backups folder", openOptions?.defaultPath === backupsFolder, openOptions?.defaultPath);

const errors = mainLog.join("").split("\n").filter((line) => /backup/i.test(line) && /error|failed/i.test(line));
check("no backup errors in the main process", errors.length === 0, errors.join(" | "));

await app.close();
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} backup checks passed.`);
process.exit(failed === 0 ? 0 : 1);
