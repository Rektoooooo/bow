// End-to-end check of folder sync (Library › Settings › Sync) with two copies of Bow standing in for two Macs, each
// with its own throwaway --user-data-dir, syncing through one folder under e2e/output. Made-up data only.
//   - Mac A starts syncing in an empty folder: no question, its file appears, Today tabs stay out of it.
//   - Mac B is asked before joining; Cancel leaves everything as it was. Join keeps a "Before Sync" copy, brings A's
//     Space, pinned tabs and note, and keeps B's own Space and Today tabs.
//   - Changes travel both ways while both run: B's Space reaches A (without its Today tab), a rename on B reaches A,
//     a note edited on A reaches B, a tab deleted on A goes on B.
//   - A file in the folder that is not a sync file is reported in the Library and breaks nothing.
//   - Stop Syncing: B no longer receives A's changes.
// The folder dialog and the question are replaced in each main process (a test cannot click macOS sheets).
// usage: npm run build && node e2e/check-sync.mjs
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataA = path.join(outDir, "user-data-sync-a");
const userDataB = path.join(outDir, "user-data-sync-b");
const pickedFolder = path.join(outDir, "sync-shared");
const syncFolder = path.join(pickedFolder, "Bow Sync");
for (const folder of [userDataA, userDataB, pickedFolder]) {
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// ---------- Two made-up setups ----------
const now = Date.now();
const tab = (id, url, title, homeUrl = null) => ({ kind: "tab", id, url, title, customTitle: null, faviconUrl: null, homeUrl, lastActiveAt: now, isMuted: false });
const NOTE_ID = "note-sync-e2e";
const theme = (color) => ({ colors: [color], appearance: "auto", grain: 0 });
function writeSetup(userDataDir, items, spaces, selected) {
  fs.writeFileSync(
    path.join(userDataDir, "browser-state.json"),
    JSON.stringify({
      version: 2,
      items: items,
      profiles: [{ id: "profile-default", name: "Default", favoriteIds: [] }],
      spaces: spaces,
      activeSpaceId: spaces[0].id,
      selectedTabIdBySpace: selected,
      archive: [],
      settings: { archiveAfterMs: 43200000, isSidebarVisible: true },
    }),
  );
}
writeSetup(
  userDataA,
  {
    "tab-mail": tab("tab-mail", "https://mail.example.invalid/", "Mail", "https://mail.example.invalid/"),
    "tab-note": tab("tab-note", `sidebar-note:${NOTE_ID}`, "Groceries"),
    "tab-news": tab("tab-news", "https://news.example.invalid/", "News"),
  },
  [{ id: "space-work", name: "Work", icon: "💼", theme: theme("#000000"), profileId: "profile-default", pinnedIds: ["tab-mail", "tab-note"], todayIds: ["tab-news"], isPinnedOpen: true }],
  // Nothing that loads a web page is on screen at start: a page failing to load during launch can hang Playwright.
  { "space-work": "tab-note" },
);
fs.mkdirSync(path.join(userDataA, "Notes"), { recursive: true });
fs.writeFileSync(path.join(userDataA, "Notes", `${NOTE_ID}.html`), "<p>Groceries</p>");
writeSetup(
  userDataB,
  {
    "tab-recipes": tab("tab-recipes", "https://recipes.example.invalid/", "Recipes", "https://recipes.example.invalid/"),
    "tab-weather": tab("tab-weather", "https://weather.example.invalid/", "Weather"),
  },
  [{ id: "space-home", name: "Home", icon: "🏠", theme: theme("#e9d8d4"), profileId: "profile-default", pinnedIds: ["tab-recipes"], todayIds: ["tab-weather"], isPinnedOpen: true }],
  { "space-home": null },
);

// ---------- Two running copies ----------
async function launch(userDataDir) {
  const app = await _electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", "--sync-poll-ms=500", appDir],
    timeout: 60000,
  });
  const mainLog = [];
  app.process().stderr.on("data", (data) => mainLog.push(data.toString()));
  const findPage = async (suffix, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const page = app.windows().find((candidate) => candidate.url().includes(suffix));
      if (page) return page;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`No page ending in ${suffix}`);
  };
  const sidebar = await findPage("/renderer/index.html");
  await sidebar.emulateMedia({ reducedMotion: "reduce" });
  await sidebar.waitForSelector(".space-title");
  // The folder dialog picks the shared folder; the question answers with globalThis.messageResponse and is recorded.
  await app.evaluate(({ dialog }, folder) => {
    globalThis.messages = [];
    globalThis.messageResponse = 0;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    dialog.showMessageBox = async (...parts) => {
      const options = parts.at(-1);
      globalThis.messages.push(`${options.message} | ${options.detail ?? ""}`);
      return { response: globalThis.messageResponse, checkboxChecked: false };
    };
  }, pickedFolder);
  return {
    app,
    sidebar,
    mainLog,
    findPage,
    dispatch: (action) => sidebar.evaluate((value) => window.browserApi.dispatch(value), action),
    getState: () => sidebar.evaluate(() => window.browserApi.getState()),
    messages: () => app.evaluate(() => globalThis.messages),
  };
}

async function waitFor(read, isDone, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!isDone(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = await read();
  }
  return value;
}
const spaceNamed = (state, name) => state.spaces.find((space) => space.name === name);
/** Every tab address of a Space's Pinned or Today list. */
const addressesIn = (state, itemIds) => itemIds.map((itemId) => state.items[itemId]).filter((item) => item?.kind === "tab").map((item) => item.url);
const syncFiles = () => (fs.existsSync(syncFolder) ? fs.readdirSync(syncFolder).filter((name) => name.endsWith(".json")) : []);
const noteText = (userDataDir) => {
  const filePath = path.join(userDataDir, "Notes", `${NOTE_ID}.html`);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
};
/** The text of Library › Settings › Sync. */
async function readSyncSettings(mac) {
  await mac.dispatch({ type: "openLibrary" });
  const overlay = await mac.findPage("/overlay/overlay.html");
  await overlay.waitForSelector(".library-tab[data-section='settings']", { timeout: 5000 });
  await overlay.click(".library-tab[data-section='settings']");
  await overlay.waitForSelector(".setting-group", { timeout: 5000 });
  const text = await overlay.evaluate(() => {
    const groups = [...document.querySelectorAll(".setting-group")];
    const sync = groups.find((group) => group.querySelector(".library-setting-heading")?.textContent === "Sync");
    return sync?.innerText ?? "";
  });
  await overlay.keyboard.press("Escape");
  return text;
}

const macA = await launch(userDataA);

// ---------- Mac A starts syncing ----------
await macA.dispatch({ type: "chooseSyncFolder" });
const filesAfterA = await waitFor(async () => syncFiles(), (names) => names.length === 1);
check("Mac A syncing in an empty folder writes its file in a “Bow Sync” folder", filesAfterA.length === 1, filesAfterA.join(", "));
check("with no other Mac there, nothing is asked", (await macA.messages()).length === 0, (await macA.messages()).join(" / "));
const fileA = filesAfterA.length === 1 ? JSON.parse(fs.readFileSync(path.join(syncFolder, filesAfterA[0]), "utf8")) : {};
const textA = JSON.stringify(fileA);
check("the file is a sync file with the pinned tabs and the note", fileA.format === "bow-sync" && textA.includes("mail.example.invalid") && fileA.notes?.[NOTE_ID] === "<p>Groceries</p>");
check("Today tabs stay on their Mac", !textA.includes("news.example.invalid"));
const settingsA = await readSyncSettings(macA);
check("Library › Settings › Sync says where it syncs", settingsA.includes("Syncing through sync-shared") && settingsA.includes("Stop Syncing"), settingsA.replaceAll("\n", " | "));

// ---------- Mac B is asked, cancels, then joins ----------
const macB = await launch(userDataB);
await macB.app.evaluate(() => {
  globalThis.messageResponse = 1;
});
const beforeCancel = await macB.getState();
await macB.dispatch({ type: "chooseSyncFolder" });
const cancelMessages = await waitFor(() => macB.messages(), (messages) => messages.length > 0);
await new Promise((resolve) => setTimeout(resolve, 1500));
const afterCancel = await macB.getState();
check("Mac B is asked before joining the Macs already in the folder", cancelMessages[0]?.startsWith("Join the Macs syncing in this folder?"), cancelMessages[0]);
check("Cancel leaves B's setup as it was and writes nothing", JSON.stringify(afterCancel.spaces) === JSON.stringify(beforeCancel.spaces) && syncFiles().length === 1);

await macB.app.evaluate(() => {
  globalThis.messageResponse = 0;
});
await macB.dispatch({ type: "chooseSyncFolder" });
const joinedB = await waitFor(() => macB.getState(), (state) => spaceNamed(state, "Work") !== undefined);
const workOnB = spaceNamed(joinedB, "Work");
const homeOnB = spaceNamed(joinedB, "Home");
check("joining brings A's Space and its pinned tabs to B", workOnB !== undefined && addressesIn(joinedB, workOnB.pinnedIds).includes("https://mail.example.invalid/"));
check("B keeps its own Space and Today tabs", homeOnB !== undefined && addressesIn(joinedB, homeOnB.pinnedIds).includes("https://recipes.example.invalid/") && addressesIn(joinedB, homeOnB.todayIds).includes("https://weather.example.invalid/"));
check("A's Today tabs don't come along", workOnB !== undefined && workOnB.todayIds.length === 0);
const noteOnB = await waitFor(async () => noteText(userDataB), (text) => text !== "");
check("A's note arrives on B", noteOnB === "<p>Groceries</p>", noteOnB);
const backupsB = path.join(userDataB, "Backups");
const beforeSyncCopies = fs.existsSync(backupsB) ? fs.readdirSync(backupsB).filter((name) => name.startsWith("Before Sync ")) : [];
check("B keeps a “Before Sync” copy of its setup first", beforeSyncCopies.length === 1, beforeSyncCopies.join(", "));
const filesAfterB = await waitFor(async () => syncFiles(), (names) => names.length === 2);
check("B writes its own file next to A's", filesAfterB.length === 2, filesAfterB.join(", "));

// ---------- Changes travel both ways ----------
const homeOnA = await waitFor(() => macA.getState(), (state) => spaceNamed(state, "Home") !== undefined);
const homeSpaceOnA = spaceNamed(homeOnA, "Home");
check("B's Space reaches A with its pinned tab", homeSpaceOnA !== undefined && addressesIn(homeOnA, homeSpaceOnA.pinnedIds).includes("https://recipes.example.invalid/"));
check("but not B's Today tab", homeSpaceOnA !== undefined && homeSpaceOnA.todayIds.length === 0);

await macB.dispatch({ type: "renameItem", itemId: "tab-mail", name: "Inbox" });
const renamedOnA = await waitFor(() => macA.getState(), (state) => state.items["tab-mail"]?.customTitle === "Inbox");
check("a rename on B reaches A", renamedOnA.items["tab-mail"]?.customTitle === "Inbox", String(renamedOnA.items["tab-mail"]?.customTitle));

await macA.sidebar.evaluate((noteId) => window.browserApi.saveNote(noteId, "<p>Groceries and bread</p>", "Groceries and bread"), NOTE_ID);
const editedOnB = await waitFor(async () => noteText(userDataB), (text) => text.includes("bread"));
check("a note edited on A reaches B", editedOnB.includes("bread"), editedOnB);

await macA.dispatch({ type: "deleteItem", itemId: "tab-recipes" });
const deletedOnB = await waitFor(() => macB.getState(), (state) => state.items["tab-recipes"] === undefined);
check("a tab deleted on A goes on B", deletedOnB.items["tab-recipes"] === undefined);

// ---------- A damaged file in the folder ----------
fs.writeFileSync(path.join(syncFolder, "damaged.json"), "{ not a sync file");
await new Promise((resolve) => setTimeout(resolve, 2000));
const settingsB = await readSyncSettings(macB);
check("a file that is not a sync file is reported in the Library", settingsB.includes("damaged.json"), settingsB.replaceAll("\n", " | "));
await macA.dispatch({ type: "renameItem", itemId: "tab-mail", name: "Post" });
const stillSyncing = await waitFor(() => macB.getState(), (state) => state.items["tab-mail"]?.customTitle === "Post");
check("and sync goes on around it", stillSyncing.items["tab-mail"]?.customTitle === "Post");

// ---------- Stop Syncing ----------
await macB.dispatch({ type: "stopSyncing" });
await macA.dispatch({ type: "renameItem", itemId: "tab-mail", name: "Letters" });
await new Promise((resolve) => setTimeout(resolve, 5000));
const afterStop = await macB.getState();
check("after Stop Syncing, B no longer receives A's changes", afterStop.items["tab-mail"]?.customTitle === "Post", String(afterStop.items["tab-mail"]?.customTitle));
const settingsAfterStop = await readSyncSettings(macB);
check("and the Library offers to choose a folder again", settingsAfterStop.includes("Choose Folder"), settingsAfterStop.replaceAll("\n", " | "));

const errors = [...macA.mainLog, ...macB.mainLog].join("").split("\n").filter((line) => /sync/i.test(line) && /error|failed/i.test(line));
check("no sync errors in either main process", errors.length === 0, errors.join(" | "));

await macA.app.close();
await macB.app.close();
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} sync checks passed.`);
process.exit(failed === 0 ? 0 : 1);
