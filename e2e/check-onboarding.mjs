// End-to-end check of the first-start onboarding (overlay/onboarding.ts): a real first start shows it over the whole
// window; Continue, ↩, → and ← move through its six scenes; an import started from it shows its progress and then
// what arrived on its card (a stand-in import: the real ones read this Mac's browsers); picking a look changes the
// Space in place (nothing is redrawn from scratch, the wash takes its colors) and light / dark follow it; the tour
// moves between its demos, which run, and hold still with reduced motion; the defaults' switches turn ad blocking and
// the shortcut from any app on; ⌘T does not replace it; Start Browsing ends it for good; Help › Welcome to Bow…
// shows it again and Escape ends it; a restart does not show it; every scene fits a 640 × 400 window.
// usage: npm run build && node e2e/check-onboarding.mjs      (uses a throwaway --user-data-dir)
import "./background.mjs";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-onboarding");
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

/** Starts Bow on the throwaway profile, as a real first start (no --skip-welcome). */
async function launch() {
  const app = await _electron.launch({ executablePath: createRequire(import.meta.url)("electron"), args: [`--user-data-dir=${userDataDir}`, appDir], timeout: 30000 });
  const findPage = async (suffix) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const page = app.windows().find((candidate) => candidate.url().endsWith(suffix));
      if (page) return page;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`No page ending in ${suffix}`);
  };
  const sidebar = await findPage("/renderer/index.html");
  await sidebar.waitForSelector(".space-title", { state: "attached", timeout: 15000 });
  const overlay = await findPage("/overlay/overlay.html");
  return { app, sidebar, overlay };
}

let { app, sidebar, overlay } = await launch();
const overlayErrors = [];
overlay.on("pageerror", (error) => overlayErrors.push(error.message));
overlay.on("console", (message) => {
  if (message.type() === "error") overlayErrors.push(message.text());
});
const getState = () => sidebar.evaluate(() => window.browserApi.getState());
const activeTheme = async () => {
  const state = await getState();
  return state.spaces.find((space) => space.id === state.activeSpaceId).theme;
};
/** The scene on screen (its class names the scene) and the progress mark that is lit. */
const currentScene = () =>
  overlay.evaluate(() => {
    const scene = Array.from(document.querySelectorAll(".onboarding-scene")).find((element) => !element.hidden);
    const marks = Array.from(document.querySelectorAll(".onboarding-mark"));
    return { scene: scene?.className.replace("onboarding-scene ", "") ?? null, mark: marks.findIndex((mark) => mark.classList.contains("is-active")) };
  });
const waitForScene = async (name, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  let shown = await currentScene();
  while (shown.scene !== `scene-${name}` && Date.now() < deadline) {
    await overlay.waitForTimeout(100);
    shown = await currentScene();
  }
  // Let the arrival finish before looking further.
  await overlay.waitForTimeout(700);
  return shown;
};
const overlayInWindow = () =>
  app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html"));
    const view = window?.contentView.children.find((child) => child.webContents?.getURL().endsWith("/overlay/overlay.html"));
    return view === undefined ? null : { bounds: view.getBounds(), content: window.getContentSize() };
  });

// ---------- First start ----------

await overlay.waitForSelector(".onboarding", { timeout: 10000 });
await overlay.waitForTimeout(1500);
const heroTitle = await overlay.getAttribute(".onboarding-title-hero", "aria-label");
const firstPlace = await overlayInWindow();
const isBackdropHidden = await overlay.evaluate(() => document.getElementById("backdrop").hidden);
check(
  "a first start shows the onboarding over the whole window, with no backdrop of the panels",
  heroTitle === "Welcome to Bow" && firstPlace !== null && firstPlace.bounds.width === firstPlace.content[0] && firstPlace.bounds.height === firstPlace.content[1] && isBackdropHidden,
  JSON.stringify({ heroTitle, firstPlace, isBackdropHidden }),
);
check("it starts on the first scene with its progress mark lit", (await currentScene()).scene === "scene-hello" && (await currentScene()).mark === 0);

// ---------- Keys ----------

await overlay.keyboard.press("Enter");
const afterEnter = await waitForScene("import");
await overlay.keyboard.press("ArrowLeft");
const afterLeft = await waitForScene("hello");
await overlay.keyboard.press("ArrowRight");
const afterRight = await waitForScene("import");
check("↩ and → go on, ← goes back", afterEnter.scene === "scene-import" && afterLeft.scene === "scene-hello" && afterRight.scene === "scene-import" && afterRight.mark === 1, JSON.stringify([afterEnter, afterLeft, afterRight]));
const backShown = await overlay.evaluate(() => !document.querySelector(".onboarding-back").classList.contains("is-hidden"));
check("Back shows from the second scene on", backShown);

// ---------- Bring your things ----------

const sourceIds = await overlay.$$eval(".import-card", (cards) => cards.map((card) => card.dataset.source));
const noneNote = await overlay.$(".import-none");
check("the import scene lists what this Mac has to import from (or says there is nothing)", sourceIds.length > 0 || noneNote !== null, sourceIds.join(", "));
if (sourceIds.length > 0) {
  // A stand-in for the import (the real ones read this Mac's browsers), run through the real progress and summary.
  const firstSource = sourceIds[0];
  // The built module by its full path: the same instance (Node's module cache) the app runs.
  const controllerPath = path.join(appDir, "dist", "node", "main", "overlayController.js");
  await app.evaluate((_electron, details) => {
    const controller = process.mainModule.require(details.controllerPath);
    controller.runWelcomeImport(details.sourceId, () => new Promise((resolve) => setTimeout(() => resolve({ spaces: 2, tabs: 14, bookmarks: 0, historyPages: 1200 }), 1200)));
  }, { sourceId: firstSource, controllerPath });
  await overlay.waitForTimeout(400);
  const running = await overlay.$eval(`.import-card[data-source="${firstSource}"]`, (card) => ({ phase: card.dataset.phase, disabled: card.disabled, status: card.querySelector(".import-status").textContent }));
  await overlay.waitForTimeout(1500);
  const done = await overlay.$eval(`.import-card[data-source="${firstSource}"]`, (card) => ({ phase: card.dataset.phase, status: card.querySelector(".import-status").textContent }));
  check("an import shows on its card while it runs", running.phase === "running" && running.disabled && running.status === "Bringing it over…", JSON.stringify(running));
  check("and then what arrived, in one line", done.phase === "done" && done.status === "2 Spaces · 14 tabs · 1,200 pages of history", JSON.stringify(done));
}

// ---------- Make it yours ----------

await overlay.click(".onboarding-next");
await waitForScene("look");
const washBefore = await overlay.evaluate(() => document.querySelector(".onboarding").style.getPropertyValue("--wash-2"));
await overlay.evaluate(() => {
  window.onboardingRootBefore = document.querySelector(".onboarding");
  window.previewBefore = document.querySelector(".look-preview .mini-window");
});
await overlay.click(".look-swatch[aria-label='Mint']");
await overlay.waitForTimeout(1200);
const mintTheme = await activeTheme();
const lookAfterMint = await overlay.evaluate(() => ({
  isSameRoot: window.onboardingRootBefore === document.querySelector(".onboarding"),
  isSamePreview: window.previewBefore === document.querySelector(".look-preview .mini-window"),
  chosen: document.querySelector(".look-swatch[aria-checked='true']")?.getAttribute("aria-label") ?? null,
  previewColor: document.querySelector(".look-preview .mini-window").style.getPropertyValue("--mini-1"),
  wash: document.querySelector(".onboarding").style.getPropertyValue("--wash-2"),
}));
check("a swatch gives the Space that look", JSON.stringify(mintTheme.colors) === JSON.stringify(["#cdeadb", "#c2e3e8"]), JSON.stringify(mintTheme));
check(
  "the scene changes in place: the same page, the swatch chosen, the preview painted, the wash in the new colors",
  lookAfterMint.isSameRoot && lookAfterMint.isSamePreview && lookAfterMint.chosen === "Mint" && lookAfterMint.previewColor !== "" && lookAfterMint.wash !== washBefore,
  JSON.stringify({ ...lookAfterMint, washBefore }),
);
await overlay.click(".look-appearance-choice:nth-child(3)");
await overlay.waitForTimeout(900);
const darkTheme = await activeTheme();
const isDarkScene = await overlay.evaluate(() => document.body.classList.contains("dark"));
await overlay.click(".look-appearance-choice:nth-child(2)");
await overlay.waitForTimeout(900);
const isLightScene = await overlay.evaluate(() => !document.body.classList.contains("dark"));
check("Dark and Light set the Space's appearance, and the whole scene follows", darkTheme.appearance === "dark" && isDarkScene && (await activeTheme()).appearance === "light" && isLightScene);

// ---------- The essentials ----------

await overlay.click(".onboarding-next");
await waitForScene("essentials");
// The demos' own loops (Web Animations), not CSS transitions and animations such as a demo fading out.
await overlay.evaluate(() => {
  window.demoLoops = (element) => element.getAnimations({ subtree: true }).filter((animation) => !(animation instanceof CSSTransition) && !(animation instanceof CSSAnimation));
});
const tourStart = await overlay.evaluate(() => {
  const demoLoops = window.demoLoops;
  const items = Array.from(document.querySelectorAll(".tour-item"));
  const demos = Array.from(document.querySelectorAll(".tour-demo"));
  const active = demos.findIndex((demo) => demo.classList.contains("is-active"));
  const running = active === -1 ? 0 : demoLoops(demos[active]).filter((animation) => animation.playState === "running").length;
  return { items: items.length, activeItem: items.findIndex((item) => item.classList.contains("is-active")), activeDemo: active, running };
});
check("the tour starts on its first item with that demo running", tourStart.items === 5 && tourStart.activeItem === 0 && tourStart.activeDemo === 0 && tourStart.running > 0, JSON.stringify(tourStart));
await overlay.click(".tour-item:nth-child(3)");
await overlay.waitForTimeout(600);
const tourPicked = await overlay.evaluate(() => {
  const demoLoops = window.demoLoops;
  const demos = Array.from(document.querySelectorAll(".tour-demo"));
  const firstStill = demoLoops(demos[0]).length === 0;
  const thirdRunning = demoLoops(demos[2]).filter((animation) => animation.playState === "running").length;
  return { firstStill, thirdRunning, thirdActive: demos[2].classList.contains("is-active"), auto: document.querySelector(".tour-item.is-auto") !== null };
});
check("picking an item shows its demo, stops the other's, and the tour stops moving on by itself", tourPicked.firstStill && tourPicked.thirdRunning > 0 && tourPicked.thirdActive && !tourPicked.auto, JSON.stringify(tourPicked));
await overlay.emulateMedia({ reducedMotion: "reduce" });
await overlay.click(".tour-item:nth-child(4)");
await overlay.waitForTimeout(400);
const reduced = await overlay.evaluate(() => {
  const demoLoops = window.demoLoops;
  const demo = document.querySelectorAll(".tour-demo")[3];
  const states = demoLoops(demo).map((animation) => animation.playState);
  const washAnimation = getComputedStyle(document.querySelector(".wash-light")).animationName;
  return { states: [...new Set(states)], washAnimation };
});
check("with reduced motion the demo holds still and the wash stops drifting", reduced.states.length === 1 && reduced.states[0] === "paused" && reduced.washAnimation === "none", JSON.stringify(reduced));
await overlay.emulateMedia({ reducedMotion: "no-preference" });

// ---------- A few good defaults ----------

await overlay.click(".onboarding-next");
await waitForScene("defaults");
const defaultRow = await overlay.evaluate(() => ({ state: document.querySelector(".default-control").dataset.state, note: document.querySelector(".default-row .default-note").textContent }));
check("a build from source cannot become the default browser and says so", defaultRow.state === "unavailable" && defaultRow.note === "Available in the installed app.", JSON.stringify(defaultRow));
await overlay.click(".default-switch[aria-label='Block ads and trackers']");
await overlay.click(".default-switch[aria-label='Open Bow from any app']");
await overlay.waitForTimeout(900);
const settingsAfterSwitches = (await getState()).settings;
const switchStates = await overlay.$$eval(".default-switch", (switches) => switches.map((element) => element.getAttribute("aria-checked")));
check(
  "the switches turn ad blocking and the shortcut from any app (⌥⌘Space) on, and show it",
  settingsAfterSwitches.isAdBlockOn === true && settingsAfterSwitches.globalShortcut === "Alt+Command+Space" && switchStates.join() === "true,true",
  JSON.stringify({ isAdBlockOn: settingsAfterSwitches.isAdBlockOn, globalShortcut: settingsAfterSwitches.globalShortcut, switchStates }),
);

// ---------- Nothing replaces it ----------

await sidebar.evaluate(() => window.browserApi.dispatch({ type: "openCommandBar", mode: "newTab" }));
await overlay.waitForTimeout(600);
const stillOnboarding = await overlay.evaluate(() => document.body.dataset.panel === "welcome" && document.querySelector(".onboarding") !== null && document.querySelector(".command-input") === null);
check("⌘T (or any panel) does not replace the onboarding", stillOnboarding);

// ---------- You're all set ----------

await overlay.click(".onboarding-next");
await waitForScene("ready");
check("the last scene's button says Start Browsing", (await overlay.textContent(".onboarding-next")) === "Start Browsing");
await overlay.click(".onboarding-next");
await overlay.waitForTimeout(1600);
check("Start Browsing plays the outro and leaves the browser, for good", (await overlayInWindow()) === null && (await getState()).settings.hasSeenWelcome === true);

// ---------- Help › Welcome to Bow… and Escape ----------

await app.evaluate(({ Menu }) => {
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
await overlay.waitForSelector(".onboarding", { timeout: 5000 }).catch(() => undefined);
await overlay.waitForTimeout(1200);
const replayed = await currentScene();
check("Help › Welcome to Bow… shows it again from the start", replayed.scene === "scene-hello", JSON.stringify(replayed));
await overlay.keyboard.press("Escape");
await overlay.waitForTimeout(1600);
check("Escape ends it", (await overlayInWindow()) === null);

// ---------- Fits a small window ----------

const fitsScene = () =>
  overlay.evaluate(() => {
    const scene = Array.from(document.querySelectorAll(".onboarding-scene")).find((element) => !element.hidden);
    const stage = document.querySelector(".onboarding-stage").getBoundingClientRect();
    // Glows and ripples may spill on purpose; everything else must be inside the stage.
    const parts = Array.from(scene.querySelectorAll("*")).filter((element) => element.closest(".hello-glow, .ready-ripple, .mini-window") === null || element.classList.contains("mini-window"));
    const boxes = parts.map((element) => element.getBoundingClientRect()).filter((box) => box.width > 0 && box.height > 0);
    const top = Math.min(...boxes.map((box) => box.top));
    const bottom = Math.max(...boxes.map((box) => box.bottom));
    const isScrolling = document.documentElement.scrollHeight > window.innerHeight + 1;
    return { scene: scene.className.replace("onboarding-scene ", ""), fits: top >= stage.top - 1 && bottom <= stage.bottom + 1 && !isScrolling, top: Math.round(top), bottom: Math.round(bottom), stage: [Math.round(stage.top), Math.round(stage.bottom)] };
  });
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().endsWith("/renderer/index.html")).setContentSize(640, 400));
await sidebar.waitForTimeout(600);
await app.evaluate(({ Menu }) => {
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
await overlay.waitForSelector(".onboarding", { timeout: 5000 }).catch(() => undefined);
await overlay.waitForTimeout(1500);
const fitResults = [];
for (let index = 0; index < 6; index++) {
  fitResults.push(await fitsScene());
  if (index < 5) {
    await overlay.click(".onboarding-next");
    await overlay.waitForTimeout(1300);
  }
}
check("every scene fits a 640 × 400 window, nothing scrolls", fitResults.every((result) => result.fits), JSON.stringify(fitResults.filter((result) => !result.fits)));
await overlay.keyboard.press("Escape");
await overlay.waitForTimeout(1500);
check("no errors in the onboarding's page", overlayErrors.length === 0, overlayErrors.slice(0, 3).join(" | "));
await app.close();

// ---------- A restart does not show it again ----------

({ app, sidebar, overlay } = await launch());
await sidebar.waitForTimeout(2500);
check("a restart does not show it again", (await overlayInWindow()) === null && (await overlay.$(".onboarding")) === null);
await app.close();

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} onboarding checks passed.`);
process.exit(failed === 0 ? 0 : 1);
