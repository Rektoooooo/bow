// End-to-end check of the first-start onboarding (onboarding/onboarding.ts, in its own window, onboardingWindow.ts):
// a real first start plays the intro (a see-through window whose glow grows into the onboarding window's place) and
// opens it in a window of its own (about 70 % of the screen, centred) while the browser window stays hidden; ↩, → and ← and the dots move through its six scenes; "Bring your things." lists every browser Bow imports
// from (those not here dimmed), reads one before importing anything, lets parts be left out, ticks each part off as it
// lands and fills the glass sidebar (real imports, from a made-up home folder: e2e/fixtures/importHome.mjs); picking
// a color changes the Space in place and the whole window takes it; the tour's demos run, and hold still with reduced
// motion; the default-browser scene's switches turn ad blocking and the shortcut from any app on; Open Bow closes it
// and shows the browser, for good; Help › Welcome to Bow… opens it again and Escape ends it; a restart does not show
// it; every scene fits its smallest window; no text has a dash; no window was made visible by a fade in the e2e
// background mode.
// usage: npm run build && node e2e/check-onboarding.mjs      (uses a throwaway --user-data-dir and home folder)
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { IMPORT_HOME_COUNTS, createImportHome } from "./fixtures/importHome.mjs";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-onboarding");
const importHome = createImportHome(path.join(outDir, "home-onboarding"));
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(path.join(userDataDir, "adblock"), { recursive: true });
// Filter lists of one comment each, so turning ad blocking on downloads nothing.
fs.writeFileSync(path.join(userDataDir, "adblock", "easylist.txt"), "! Test list\n");
fs.writeFileSync(path.join(userDataDir, "adblock", "easyprivacy.txt"), "! Test list\n");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

/** Starts Bow on the throwaway profile and home folder, as a real first start (no --skip-welcome). */
async function launch() {
  const app = await _electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [`--user-data-dir=${userDataDir}`, `--import-home=${importHome}`, appDir],
    timeout: 30000,
  });
  const findPage = async (suffix) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const found = app.windows().find((candidate) => candidate.url().endsWith(suffix));
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`No page ending in ${suffix}`);
  };
  const sidebar = await findPage("/renderer/index.html");
  await sidebar.waitForSelector(".space-title", { state: "attached", timeout: 15000 });
  return { app, sidebar, findPage };
}

let { app, sidebar, findPage } = await launch();
const ONBOARDING_PAGE = "/onboarding/onboarding.html";
const INTRO_PAGE = "/onboarding/intro.html";
// The intro's window comes and goes in the first seconds: note whether it was there while the onboarding was hidden.
const introSeen = await (async () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = await app.evaluate(({ BrowserWindow }, pages) => {
      const windows = BrowserWindow.getAllWindows().filter((candidate) => !candidate.isDestroyed());
      const intro = windows.find((candidate) => candidate.webContents.getURL().includes(pages.intro));
      const onboarding = windows.find((candidate) => candidate.webContents.getURL().endsWith(pages.onboarding));
      if (intro === undefined) return null;
      return { isTransparentClickThrough: !intro.isFocusable(), coversScreen: intro.getBounds().width > (onboarding?.getBounds().width ?? 0), isOnboardingShown: onboarding?.isVisible() ?? false };
    }, { intro: INTRO_PAGE, onboarding: ONBOARDING_PAGE });
    if (found !== null) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
})();
const pageErrors = [];
/** The onboarding's page; a new window (Help › Welcome to Bow…) brings a new page. */
let page = null;
async function findOnboarding() {
  page = await findPage(ONBOARDING_PAGE);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  return page;
}
await findOnboarding();
const getState = () => sidebar.evaluate(() => window.browserApi.getState());
const activeTheme = async () => {
  const state = await getState();
  return state.spaces.find((space) => space.id === state.activeSpaceId).theme;
};
/** The addresses in our history (main's own module: the built file by its full path is the instance the app runs). */
const historyPath = path.join(appDir, "dist", "node", "main", "historyStore.js");
const historyUrls = () => app.evaluate((_electron, modulePath) => process.mainModule.require(modulePath).getHistory().map((entry) => entry.url), historyPath);
/** The scene on screen and the dot that is lit. */
const currentScene = () =>
  page.evaluate(() => {
    const scene = Array.from(document.querySelectorAll(".onboarding-scene")).find((element) => !element.hidden);
    const dots = Array.from(document.querySelectorAll(".onboarding-dot"));
    return { scene: scene?.dataset.scene ?? null, dot: dots.findIndex((dot) => dot.classList.contains("is-active")) };
  });
const waitForScene = async (name, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  let shown = await currentScene();
  while (shown.scene !== name && Date.now() < deadline) {
    await page.waitForTimeout(100);
    shown = await currentScene();
  }
  // Let the arrival finish before looking further.
  await page.waitForTimeout(800);
  return shown;
};
/** Waits until a condition in the page holds (or the time is up), and returns its last value. */
const waitInPage = async (condition, argument, timeoutMs = 6000) => {
  const deadline = Date.now() + timeoutMs;
  let value = await page.evaluate(condition, argument);
  while (!value && Date.now() < deadline) {
    await page.waitForTimeout(150);
    value = await page.evaluate(condition, argument);
  }
  return value;
};
const visible = (selector) => `.onboarding-scene:not([hidden]) ${selector}`;
/** The onboarding window (isOpen false when none), its screen's work area, and whether the browser window shows. */
const onboardingWindowInfo = () =>
  app.evaluate(({ BrowserWindow, screen }) => {
    const windows = BrowserWindow.getAllWindows().filter((candidate) => !candidate.isDestroyed());
    const onboarding = windows.find((candidate) => candidate.webContents.getURL().endsWith("/onboarding/onboarding.html"));
    const browser = windows.find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
    if (onboarding === undefined) {
      return { isOpen: false, isBrowserVisible: browser?.isVisible() ?? false };
    }
    const area = screen.getDisplayMatching(onboarding.getBounds()).workArea;
    return { isOpen: true, bounds: onboarding.getBounds(), area: area, isBrowserVisible: browser?.isVisible() ?? false };
  });
const openWelcomeFromHelp = () =>
  app.evaluate(({ Menu }) => {
    const find = (items) => {
      for (const item of items) {
        if (item.label === "Welcome to Bow…") return item;
        const inside = item.submenu ? find(item.submenu.items) : null;
        if (inside) return inside;
      }
      return null;
    };
    find(Menu.getApplicationMenu().items)?.click();
  });
/** Text in the onboarding with a dash of any kind ("-", "–", "—"), for the no-dash rule. */
const dashedTexts = () =>
  page.evaluate(() => {
    const text = document.querySelector(".onboarding")?.innerText ?? "";
    return text.match(/.{0,24}[-–—].{0,24}/g) ?? [];
  });
const dashesSeen = [];

// ---------- First start ----------

await page.waitForSelector(".onboarding", { timeout: 10000 });
// The intro breathes (at least 1.5 s), grows (1 s), then the onboarding window shows and plays its entrance.
const shownAt = Date.now();
let isEntered = false;
while (!isEntered && Date.now() - shownAt < 10000) {
  isEntered = await page.evaluate(() => document.querySelector(".onboarding")?.classList.contains("has-entered") ?? false);
  await page.waitForTimeout(100);
}
// After the window has taken over, the intro lifts its dimming of the desktop (about 0.7 s), then goes.
const isIntroThere = () => app.evaluate(({ BrowserWindow }, introPage) => BrowserWindow.getAllWindows().some((candidate) => !candidate.isDestroyed() && candidate.webContents.getURL().includes(introPage)), INTRO_PAGE);
const goneBy = Date.now() + 3000;
let introGone = !(await isIntroThere());
while (!introGone && Date.now() < goneBy) {
  await page.waitForTimeout(100);
  introGone = !(await isIntroThere());
}
check(
  "a first start plays the intro over the screen (never taking the keyboard), then the onboarding window takes over and the intro goes",
  introSeen !== null && introSeen.isTransparentClickThrough && introSeen.coversScreen && !introSeen.isOnboardingShown && isEntered && introGone,
  JSON.stringify({ introSeen, isEntered, introGone }),
);
await page.waitForTimeout(1600);
const heroTitle = await page.textContent(".scene-hello .scene-title");
const firstPlace = await onboardingWindowInfo();
const shareOf = (part, whole) => Math.round((part / whole) * 100);
const isSeventyPercent = firstPlace.isOpen && Math.abs(shareOf(firstPlace.bounds.width, firstPlace.area.width) - 70) <= 2 && Math.abs(shareOf(firstPlace.bounds.height, firstPlace.area.height) - 70) <= 2;
const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const isCentred = firstPlace.isOpen && Math.abs(centre(firstPlace.bounds).x - centre(firstPlace.area).x) <= 2 && Math.abs(centre(firstPlace.bounds).y - centre(firstPlace.area).y) <= 2;
check(
  "a first start opens the onboarding in its own window, about 70 % of the screen and centred",
  heroTitle === "Welcome to Bow." && isSeventyPercent && isCentred,
  JSON.stringify({ heroTitle, firstPlace }),
);
check("the browser window stays hidden while the onboarding is open", firstPlace.isBrowserVisible === false);
const firstScene = await currentScene();
const firstLook = await page.evaluate(() => ({
  isLightText: document.body.classList.contains("dark"),
  hasPickedLook: document.querySelector(".onboarding").classList.contains("has-picked-look"),
  wash: document.querySelector(".onboarding").style.getPropertyValue("--wash-2"),
  hasSentence: document.querySelector(".scene-hello .scene-lede") !== null,
}));
check(
  "it starts on the welcome with its dot lit, in Bow's own look (light text on its colors, whatever the system's), one line and a button",
  firstScene.scene === "hello" && firstScene.dot === 0 && firstLook.isLightText && !firstLook.hasPickedLook && firstLook.wash === "#a35cff" && !firstLook.hasSentence,
  JSON.stringify({ firstScene, firstLook }),
);

// ---------- Keys and dots ----------

await page.keyboard.press("Enter");
const afterEnter = await waitForScene("import");
await page.keyboard.press("ArrowLeft");
const afterLeft = await waitForScene("hello");
await page.keyboard.press("ArrowRight");
const afterRight = await waitForScene("import");
check("↩ and → go on, ← goes back", afterEnter.scene === "import" && afterLeft.scene === "hello" && afterRight.scene === "import" && afterRight.dot === 1, JSON.stringify([afterEnter, afterLeft, afterRight]));
const dotStates = await page.$$eval(".onboarding-dot", (dots) => dots.map((dot) => dot.disabled));
await page.click(".onboarding-dot:nth-child(1)");
const afterDot = await waitForScene("hello");
await page.click(visible(".scene-primary"));
const afterGo = await waitForScene("import");
check(
  "a dot goes back to a scene already seen (later ones wait), and the round button goes on",
  dotStates.join() === "false,true,true,true,true,true" && afterDot.scene === "hello" && afterGo.scene === "import",
  JSON.stringify({ dotStates, afterDot, afterGo }),
);

// ---------- Bring your things: the browsers ----------

const tiles = await waitInPage(() => {
  const found = Array.from(document.querySelectorAll(".browser-tile")).map((tile) => {
    const logo = tile.querySelector("img");
    return { id: tile.dataset.browser, isMissing: tile.disabled, text: tile.innerText.trim(), title: tile.title, hasLogo: logo !== null && logo.complete && logo.naturalWidth > 0 };
  });
  return found.every((tile) => tile.hasLogo) ? found : null;
});
const tileIds = (tiles ?? []).map((tile) => tile.id);
check(
  "every browser Bow imports from is listed, those with something here first",
  tileIds.join() === "arc,dia,chrome,safari,firefox,brave,edge,vivaldi,opera,chromium" && tiles.slice(0, 3).every((tile) => tile.isMissing === false),
  tileIds.join(),
);
check(
  "every browser shows its own logo; one with nothing to import here is dimmed, with no extra text under it",
  tiles !== null && tiles.every((tile) => tile.hasLogo) && tiles.slice(3).every((tile) => tile.isMissing && tile.title === "Not on this Mac" && !tile.text.includes("Not on this Mac")),
  JSON.stringify(tiles?.slice(2, 5)),
);

// ---------- Bring your things: Chrome, read first, then only the bookmarks ----------

const historyBefore = (await historyUrls()).length;
await page.click(".browser-tile[data-browser='chrome']");
const chromeSentence = await waitInPage(() => {
  const text = document.querySelector(".import-sentence")?.textContent ?? "";
  return text.startsWith("Found") ? text : null;
});
const chromeView = await page.evaluate(() => ({
  bold: Array.from(document.querySelectorAll(".import-sentence strong")).map((element) => element.textContent),
  primary: document.querySelector(".import-source .scene-primary").textContent,
  isChecklistShown: !document.querySelector(".import-checklist").hidden,
}));
const stateAfterRead = await getState();
const bookmarkUrls = ["https://docs.example.com/", "https://news.example.org/", "https://shop.example.net/", "https://maps.example.com/", "https://wiki.example.org/"];
const importedBookmarks = (state) => Object.values(state.items).filter((item) => item.kind === "tab" && bookmarkUrls.includes(item.url)).length;
check(
  "picking a browser reads it first and says what it holds, numbers in bold",
  chromeSentence === `Found ${IMPORT_HOME_COUNTS.chromeDefault.bookmarks} bookmarks and ${IMPORT_HOME_COUNTS.chromeDefault.history} sites from your history.` &&
    chromeView.bold.join() === "5 bookmarks,12 sites" &&
    chromeView.primary === "Import everything" &&
    !chromeView.isChecklistShown,
  JSON.stringify({ chromeSentence, chromeView }),
);
check("reading imports nothing", importedBookmarks(stateAfterRead) === 0 && (await historyUrls()).length === historyBefore);
await page.click(".import-source .scene-secondary");
await page.waitForTimeout(500);
const rows = await page.$$eval(".import-source .import-row", (elements) => elements.map((row) => `${row.dataset.part}:${row.getAttribute("aria-checked")}`));
await page.click(".import-row[data-part='history']");
await page.waitForTimeout(200);
const afterUntick = await page.evaluate(() => ({
  history: document.querySelector(".import-row[data-part='history']").getAttribute("aria-checked"),
  primary: document.querySelector(".import-source .scene-primary").textContent,
}));
check(
  "Choose what to import opens the checklist, every part ticked; a part can be left out",
  rows.join() === "bookmarks:true,history:true" && afterUntick.history === "false" && afterUntick.primary === "Import selected",
  JSON.stringify({ rows, afterUntick }),
);
await page.click(".import-source .scene-primary");
const chromeDone = await waitInPage(() => {
  const note = document.querySelector(".import-source .scene-note");
  if (!note.classList.contains("is-positive")) return null;
  return {
    note: note.textContent,
    bookmarks: document.querySelector(".import-row[data-part='bookmarks']").className,
    history: document.querySelector(".import-row[data-part='history']").className,
    primary: document.querySelector(".import-source .scene-primary").textContent,
  };
});
const stateAfterChrome = await getState();
const chromeHistory = (await historyUrls()).filter((url) => url.includes("chrome.example.com")).length;
check(
  "only the chosen part comes over: Chrome's bookmarks, not its history",
  importedBookmarks(stateAfterChrome) === IMPORT_HOME_COUNTS.chromeDefault.bookmarks && chromeHistory === 0,
  JSON.stringify({ bookmarks: importedBookmarks(stateAfterChrome), chromeHistory }),
);
check(
  "its row is ticked off, the part left out stays dimmed, and the scene says it is done",
  chromeDone !== null &&
    chromeDone.bookmarks.includes("is-done") &&
    chromeDone.history.includes("is-left-out") &&
    chromeDone.note === "Done. Your things from Chrome are in Bow." &&
    chromeDone.primary === "Continue",
  JSON.stringify(chromeDone),
);
dashesSeen.push(...(await dashedTexts()));

// ---------- Bring your things: Dia, every space at once, each as a Space of its own ----------

await page.click(".import-source .source-back");
await page.waitForTimeout(600);
await page.click(".browser-tile[data-browser='dia']");
const readDiaView = () =>
  page.evaluate(() => {
    const pane = document.querySelector(".import-profiles");
    return {
      sentence: pane.querySelector(".import-sentence").textContent,
      rows: Array.from(pane.querySelectorAll(".import-row")).map((row) => `${row.querySelector(".import-row-title").textContent}|${row.querySelector(".import-row-count").textContent}|${row.getAttribute("aria-checked")}`),
      primary: pane.querySelector(".scene-primary").textContent,
      note: pane.querySelector(".scene-note").textContent,
      hasChips: document.querySelector(".source-profile") !== null,
    };
  });
await waitInPage(() => (document.querySelector(".import-profiles .import-sentence")?.textContent ?? "").startsWith("Found"));
const diaView = await readDiaView();
const countsText = (space) => [space.bookmarks > 0 ? `${space.bookmarks} bookmark${space.bookmarks === 1 ? "" : "s"}` : null, space.history > 0 ? `${space.history} sites` : null].filter(Boolean).join(", ");
const expectedDiaRows = IMPORT_HOME_COUNTS.diaSpaces.map((space) => `${space.name}|${countsText(space)}|true`);
check(
  "a browser with several profiles lists them all at once, ticked: Dia's 4 spaces",
  diaView.sentence === "Found 4 spaces in Dia." && diaView.rows.join() === expectedDiaRows.join() && diaView.primary === "Import all 4 spaces" && !diaView.hasChips,
  JSON.stringify(diaView),
);
const schoolRow = ".import-profiles .import-row[data-source='chromium:dia:Profile 2']";
await page.click(schoolRow);
await page.waitForTimeout(200);
const afterUntickSchool = await readDiaView();
await page.click(schoolRow);
await page.waitForTimeout(200);
const afterTickSchool = await readDiaView();
check(
  "a space can be left out, and taken back",
  afterUntickSchool.primary === "Import 3 spaces" && afterUntickSchool.rows[2].endsWith("|false") && afterTickSchool.primary === "Import all 4 spaces",
  JSON.stringify({ untick: afterUntickSchool.primary, tick: afterTickSchool.primary }),
);
const profilesBefore = (await getState()).profiles.map((profile) => profile.id);
await page.click(".import-profiles .scene-primary");
const diaDone = await waitInPage(() => {
  const pane = document.querySelector(".import-profiles");
  const note = pane.querySelector(".scene-note");
  if (!note.classList.contains("is-positive")) return null;
  return { note: note.textContent, done: pane.querySelectorAll(".import-row.is-done").length, primary: pane.querySelector(".scene-primary").textContent };
}, undefined, 8000);
const stateAfterDia = await getState();
const diaSpaces = IMPORT_HOME_COUNTS.diaSpaces.map((expected) => {
  const space = stateAfterDia.spaces.find((candidate) => candidate.name === expected.name && !candidate.id.startsWith("space-personal"));
  const profile = stateAfterDia.profiles.find((candidate) => candidate.id === space?.profileId);
  return {
    name: expected.name,
    hasOwnProfile: profile !== undefined && !profilesBefore.includes(profile.id) && profile.name === expected.name,
    pinned: space?.pinnedIds.length ?? -1,
    expectedPinned: expected.bookmarks,
  };
});
const ownProfileIds = new Set(diaSpaces.map((space) => stateAfterDia.spaces.find((candidate) => candidate.name === space.name)?.profileId));
const diaHistory = (await historyUrls()).filter((url) => url.includes("dia-")).length;
const expectedDiaHistory = IMPORT_HOME_COUNTS.diaSpaces.reduce((sum, space) => sum + space.history, 0);
check(
  "Import all brings each space over as a Space of its own, with its own sign-ins and its bookmarks pinned",
  diaSpaces.every((space) => space.hasOwnProfile && space.pinned === space.expectedPinned) && ownProfileIds.size === 4,
  JSON.stringify(diaSpaces),
);
check(
  "their history comes in, every row ticks off, and the scene says it is done",
  diaHistory === expectedDiaHistory && diaDone !== null && diaDone.done === 4 && diaDone.note === "Done. Your 4 spaces from Dia are in Bow." && diaDone.primary === "Continue",
  JSON.stringify({ diaHistory, expectedDiaHistory, diaDone }),
);
dashesSeen.push(...(await dashedTexts()));

// ---------- Bring your things: Arc, everything, filling the sidebar ----------

await page.click(".import-profiles .source-back");
await page.waitForTimeout(600);
const chromeTileImported = await page.$eval(".browser-tile[data-browser='chrome']", (tile) => tile.classList.contains("is-imported"));
await page.click(".browser-tile[data-browser='arc']");
const arcSentence = await waitInPage(() => {
  const text = document.querySelector(".import-sentence")?.textContent ?? "";
  return text.startsWith("Found") ? text : null;
});
check(
  "back at the browsers Chrome shows it was imported, and Arc says what it holds",
  chromeTileImported && arcSentence === "Found 2 Spaces with 4 tabs, 4 Favorites and 30 sites from your history.",
  JSON.stringify({ chromeTileImported, arcSentence }),
);
await page.click(".import-source .scene-primary");
const working = await waitInPage(
  () => {
    const rowsWorking = Array.from(document.querySelectorAll(".import-source .import-row")).map((row) => `${row.dataset.part}:${row.classList.contains("is-working") || row.classList.contains("is-done")}`);
    const primary = document.querySelector(".import-source .scene-primary");
    return primary.disabled ? { rows: rowsWorking, primary: primary.textContent } : null;
  },
  undefined,
  3000,
);
const arcDone = await waitInPage(() => (document.querySelector(".import-source .scene-note").classList.contains("is-positive") ? Array.from(document.querySelectorAll(".import-source .import-row.is-done")).map((row) => row.dataset.part) : null));
check(
  "Import everything shows every part working, then ticks each off",
  working !== null && working.primary === "Importing…" && working.rows.join() === "spaces:true,favorites:true,history:true" && arcDone?.join() === "spaces,favorites,history",
  JSON.stringify({ working, arcDone }),
);
const stateAfterArc = await getState();
const spaceNames = stateAfterArc.spaces.map((space) => space.name);
const activeSpace = stateAfterArc.spaces.find((space) => space.id === stateAfterArc.activeSpaceId);
const arcHistory = (await historyUrls()).filter((url) => url.includes("arc.example.org")).length;
check(
  "Arc's Spaces, Favorites (in the first Space, which opens) and history arrive",
  spaceNames.includes("Studio") && spaceNames.includes("Home") && activeSpace.name === "Studio" && activeSpace.favoriteIds.length === IMPORT_HOME_COUNTS.arc.favorites && arcHistory === IMPORT_HOME_COUNTS.arc.history,
  JSON.stringify({ spaceNames, active: activeSpace.name, favorites: activeSpace.favoriteIds.length, arcHistory }),
);
const preview = await page.evaluate(() => ({
  isShown: document.querySelector(".onboarding").classList.contains("shows-preview"),
  space: document.querySelector(".preview-space-name").textContent,
  favorites: document.querySelectorAll(".preview-favorite.is-filled").length,
  pinned: Array.from(document.querySelectorAll(".preview-row-title")).map((title) => title.textContent),
  isEmpty: document.querySelector(".sidebar-preview").classList.contains("is-empty"),
}));
check(
  "the glass sidebar fills in with what arrived",
  preview.isShown && preview.space === "Studio" && preview.favorites === 4 && preview.pinned.join() === "Projects,Design review" && !preview.isEmpty,
  JSON.stringify(preview),
);
dashesSeen.push(...(await dashedTexts()));

// ---------- Choose a color ----------

await page.click(".import-source .scene-primary");
await waitForScene("look");
const washBefore = await page.evaluate(() => document.querySelector(".onboarding").style.getPropertyValue("--wash-2"));
const previewTintBefore = await page.evaluate(() => document.querySelector(".sidebar-preview").style.getPropertyValue("--preview-1"));
await page.evaluate(() => {
  window.onboardingRootBefore = document.querySelector(".onboarding");
});
await page.click(".look-swatch[aria-label='Mint']");
await page.waitForTimeout(1200);
const mintTheme = await activeTheme();
const lookAfterMint = await page.evaluate(() => ({
  isSameRoot: window.onboardingRootBefore === document.querySelector(".onboarding"),
  chosen: document.querySelector(".look-swatch[aria-checked='true']")?.getAttribute("aria-label") ?? null,
  hasPickedLook: document.querySelector(".onboarding").classList.contains("has-picked-look"),
  wash: document.querySelector(".onboarding").style.getPropertyValue("--wash-2"),
  previewTint: document.querySelector(".sidebar-preview").style.getPropertyValue("--preview-1"),
}));
check("a swatch gives the Space that color", JSON.stringify(mintTheme.colors) === JSON.stringify(["#cdeadb", "#c2e3e8"]), JSON.stringify(mintTheme));
check(
  "the scene changes in place and the whole window and the glass sidebar take the color",
  lookAfterMint.isSameRoot && lookAfterMint.chosen === "Mint" && lookAfterMint.hasPickedLook && lookAfterMint.wash !== washBefore && lookAfterMint.previewTint !== previewTintBefore,
  JSON.stringify({ ...lookAfterMint, washBefore, previewTintBefore }),
);
await page.click(".look-appearance-choice:nth-child(3)");
await page.waitForTimeout(900);
const darkTheme = await activeTheme();
const isDarkScene = await page.evaluate(() => document.body.classList.contains("dark"));
await page.click(".look-appearance-choice:nth-child(2)");
await page.waitForTimeout(900);
const isLightScene = await page.evaluate(() => !document.body.classList.contains("dark"));
check("Dark and Light set the Space's appearance, and the whole scene follows", darkTheme.appearance === "dark" && isDarkScene && (await activeTheme()).appearance === "light" && isLightScene);

// ---------- The essentials ----------

await page.click(visible(".scene-primary"));
await waitForScene("essentials");
const previewHidden = await page.evaluate(() => !document.querySelector(".onboarding").classList.contains("shows-preview"));
// The demos' own loops (Web Animations), not CSS transitions and animations such as a demo fading out.
await page.evaluate(() => {
  window.demoLoops = (element) => element.getAnimations({ subtree: true }).filter((animation) => !(animation instanceof CSSTransition) && !(animation instanceof CSSAnimation));
});
const tourStart = await page.evaluate(() => {
  const demoLoops = window.demoLoops;
  const items = Array.from(document.querySelectorAll(".tour-item"));
  const demos = Array.from(document.querySelectorAll(".tour-demo"));
  const active = demos.findIndex((demo) => demo.classList.contains("is-active"));
  const running = active === -1 ? 0 : demoLoops(demos[active]).filter((animation) => animation.playState === "running").length;
  return { items: items.length, activeItem: items.findIndex((item) => item.classList.contains("is-active")), activeDemo: active, running };
});
check("the tour starts on its first item with that demo running (the glass sidebar has gone)", previewHidden && tourStart.items === 5 && tourStart.activeItem === 0 && tourStart.activeDemo === 0 && tourStart.running > 0, JSON.stringify({ previewHidden, tourStart }));
await page.click(".tour-item:nth-child(3)");
await page.waitForTimeout(600);
const tourPicked = await page.evaluate(() => {
  const demoLoops = window.demoLoops;
  const demos = Array.from(document.querySelectorAll(".tour-demo"));
  const firstStill = demoLoops(demos[0]).length === 0;
  const thirdRunning = demoLoops(demos[2]).filter((animation) => animation.playState === "running").length;
  return { firstStill, thirdRunning, thirdActive: demos[2].classList.contains("is-active"), auto: document.querySelector(".tour-item.is-auto") !== null };
});
check("picking an item shows its demo, stops the other's, and the tour stops moving on by itself", tourPicked.firstStill && tourPicked.thirdRunning > 0 && tourPicked.thirdActive && !tourPicked.auto, JSON.stringify(tourPicked));
await page.emulateMedia({ reducedMotion: "reduce" });
await page.click(".tour-item:nth-child(4)");
await page.waitForTimeout(400);
const reduced = await page.evaluate(() => {
  const demoLoops = window.demoLoops;
  const demo = document.querySelectorAll(".tour-demo")[3];
  const states = demoLoops(demo).map((animation) => animation.playState);
  const washAnimation = getComputedStyle(document.querySelector(".wash-light")).animationName;
  return { states: [...new Set(states)], washAnimation };
});
check("with reduced motion the demo holds still and the wash stops drifting", reduced.states.length === 1 && reduced.states[0] === "paused" && reduced.washAnimation === "none", JSON.stringify(reduced));
await page.emulateMedia({ reducedMotion: "no-preference" });

// ---------- Your default browser ----------

await page.click(visible(".scene-primary"));
await waitForScene("defaults");
const defaultScene = await page.evaluate(() => {
  const scene = document.querySelector(".scene-defaults");
  const demo = scene.querySelector(".link-demo");
  const loops = demo.getAnimations({ subtree: true }).filter((animation) => !(animation instanceof CSSTransition) && !(animation instanceof CSSAnimation));
  return {
    state: scene.querySelector(".scene-actions").dataset.state,
    isPrimaryDisabled: scene.querySelector(".scene-primary").disabled,
    note: scene.querySelector(".scene-note").textContent,
    linkLoops: loops.filter((animation) => animation.playState === "running").length,
  };
});
check(
  "a build from source cannot become the default browser and says so; the link's Little Window plays beside it",
  defaultScene.state === "unavailable" && defaultScene.isPrimaryDisabled && defaultScene.note.startsWith("Only the installed app can be the default.") && defaultScene.linkLoops > 0,
  JSON.stringify(defaultScene),
);
await page.click(".default-switch[aria-label='Block ads and trackers']");
await page.click(".default-switch[aria-label='Open Bow from any app']");
await page.waitForTimeout(900);
const settingsAfterSwitches = (await getState()).settings;
const switchStates = await page.$$eval(".default-switch", (switches) => switches.map((element) => element.getAttribute("aria-checked")));
const shortcutLabel = await page.textContent(".switch-row:nth-child(2) .switch-row-label");
check(
  "the switches turn ad blocking and the shortcut from any app (⌥⌘Space) on, and show it",
  settingsAfterSwitches.isAdBlockOn === true && settingsAfterSwitches.globalShortcut === "Alt+Command+Space" && switchStates.join() === "true,true" && shortcutLabel === "Open Bow from any app with ⌥⌘Space",
  JSON.stringify({ isAdBlockOn: settingsAfterSwitches.isAdBlockOn, globalShortcut: settingsAfterSwitches.globalShortcut, switchStates, shortcutLabel }),
);
dashesSeen.push(...(await dashedTexts()));

// ---------- You're all set ----------

await page.click(visible(".scene-secondary"));
await waitForScene("ready");
const readyView = await page.evaluate(() => ({
  primary: document.querySelector(".scene-ready .scene-primary").textContent,
  isSkipHidden: document.querySelector(".onboarding-skip").classList.contains("is-hidden"),
}));
check("Not now goes on; the last scene's button says Open Bow and Skip setup has gone", readyView.primary === "Open Bow" && readyView.isSkipHidden, JSON.stringify(readyView));
dashesSeen.push(...(await dashedTexts()));
check("no text in the onboarding has a dash", dashesSeen.length === 0, JSON.stringify(dashesSeen.slice(0, 3)));
await page.click(visible(".scene-primary"));
await sidebar.waitForTimeout(1600);
const afterOpen = await onboardingWindowInfo();
check(
  "Open Bow plays the outro, closes the onboarding window and shows the browser, for good",
  !afterOpen.isOpen && afterOpen.isBrowserVisible && (await getState()).settings.hasSeenWelcome === true,
  JSON.stringify(afterOpen),
);
const opacities = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((candidate) => !candidate.isDestroyed()).map((candidate) => candidate.getOpacity()));
check("the hand-over fades left every window invisible in the e2e background mode", opacities.every((opacity) => opacity === 0), JSON.stringify(opacities));

// ---------- Help › Welcome to Bow… and Escape ----------

await openWelcomeFromHelp();
await findOnboarding();
await page.waitForSelector(".onboarding", { timeout: 5000 }).catch(() => undefined);
await page.waitForTimeout(1200);
const replayed = await currentScene();
const replayedView = await page.evaluate(() => document.querySelector(".scene-import").dataset.view);
check("Help › Welcome to Bow… opens it again, in its own window, from the start", replayed.scene === "hello" && replayedView === "pick" && (await onboardingWindowInfo()).isOpen, JSON.stringify({ replayed, replayedView }));
await page.keyboard.press("Escape");
await sidebar.waitForTimeout(1600);
check("Escape ends it", !(await onboardingWindowInfo()).isOpen);

// ---------- Fits a small window ----------

/** Every part of the scene on screen lies between the window's top bar and the dots, and nothing scrolls. */
const fitsScene = () =>
  page.evaluate(() => {
    const scene = Array.from(document.querySelectorAll(".onboarding-scene")).find((element) => !element.hidden);
    const dotsTop = document.querySelector(".onboarding-dots").getBoundingClientRect().top;
    const textColumn = scene.querySelector(".scene-text").getBoundingClientRect();
    // Glows may spill on purpose; the demos' moving parts are measured by their frames.
    const parts = Array.from(scene.querySelectorAll(".scene-text *, .scene-art > *")).filter((element) => element.closest(".hello-glow") === null);
    const boxes = parts.map((element) => element.getBoundingClientRect()).filter((box) => box.width > 0 && box.height > 0);
    const top = Math.min(...boxes.map((box) => box.top));
    const bottom = Math.max(...boxes.map((box) => box.bottom));
    const right = Math.max(...boxes.map((box) => box.right));
    const isScrolling = document.documentElement.scrollHeight > window.innerHeight + 1 || document.documentElement.scrollWidth > window.innerWidth + 1;
    const fits = top >= 28 && bottom <= dotsTop - 4 && right <= window.innerWidth + 1 && textColumn.left >= 0 && !isScrolling;
    return { scene: scene.dataset.scene, fits, top: Math.round(top), bottom: Math.round(bottom), right: Math.round(right), dotsTop: Math.round(dotsTop) };
  });
await openWelcomeFromHelp();
await findOnboarding();
await page.waitForSelector(".onboarding", { timeout: 5000 }).catch(() => undefined);
// The onboarding window at its smallest (onboardingWindow.ts: 760 × 520).
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/onboarding/onboarding.html")).setSize(760, 520));
await page.waitForTimeout(1500);
const fitResults = [];
for (let index = 0; index < 6; index++) {
  fitResults.push(await fitsScene());
  if (index === 1) {
    // The import scene with a browser picked and its checklist open, the tallest it gets.
    await page.click(".browser-tile[data-browser='chrome']");
    await page.waitForTimeout(1200);
    await page.click(".import-source .scene-secondary");
    await page.waitForTimeout(800);
    fitResults.push({ ...(await fitsScene()), scene: "import (checklist)" });
    await page.click(".import-source .source-back");
    await page.waitForTimeout(600);
    await page.click(".browser-tile[data-browser='dia']");
    await page.waitForTimeout(1400);
    fitResults.push({ ...(await fitsScene()), scene: "import (Dia's spaces)" });
  }
  if (index < 5) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(1300);
  }
}
check("every scene fits the onboarding window at its smallest, nothing scrolls", fitResults.every((result) => result.fits), JSON.stringify(fitResults.filter((result) => !result.fits)));
await page.keyboard.press("Escape");
// Escape closes the onboarding window (and its page): wait on the browser's page.
await sidebar.waitForTimeout(1500);
check("no errors in the onboarding's page", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await app.close();

// ---------- A restart does not show it again ----------

({ app, sidebar, findPage } = await launch());
await sidebar.waitForTimeout(2500);
const afterRestart = await onboardingWindowInfo();
check("a restart does not show it again, and the browser shows at once", !afterRestart.isOpen && afterRestart.isBrowserVisible, JSON.stringify(afterRestart));
await app.close();
fs.rmSync(importHome, { recursive: true, force: true });

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} onboarding checks passed.`);
process.exit(failed === 0 ? 0 : 1);
