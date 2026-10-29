/**
 * WHY this file exists:
 *   "Bring your things." lists every browser Bow imports from, each with its own logo (those not on this Mac
 *   dimmed). Picking one reads it first and says, in one sentence with the numbers in bold, what it holds; then one
 *   click brings it all over, or a checklist lets the user leave parts out. While it imports, each part's circle turns
 *   into a spinner and then a check, and the glass sidebar beside it (sidebarPreview.ts) fills in. Nothing is imported
 *   before the user says so.
 *
 * Data source:
 *   WelcomeData.browsers (every supported browser and its profiles here), WelcomeData.imports (each source's progress,
 *   from main/onboardingWindow.ts), and the browsers' logos next to the page (browser-logos/<id>.png: Arc's from its
 *   app, the others from the open browser-logos collection; each a trademark of its maker, shown only to name it).
 *
 * Data flow:
 *   tile picked → onboardingApi.readSource() → "reading" → "found" (counts) → Import → onboardingApi.bringOver(parts)
 *   → "importing" (parts tick off) → "done" → Continue
 *   a browser with several profiles → profilesImport.ts (every profile at once, each as a Space)
 */
import type { ImportFound, ImportPart, WelcomeBrowser, WelcomeData, WelcomeImport } from "../shared/onboarding";
import { IMPORT_PART_LABELS, describeFound, describePartCount } from "../shared/onboarding.js";
import { createElement, createTextButton } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";
import type { IconName } from "../renderer/icons.js";
import { createProfilesPane } from "./profilesImport.js";
import { createSceneActions, createSceneFrame, createSceneLede, createSceneNote, createSceneTitle, markReveal, revealParts } from "./sceneParts.js";
import type { SceneView } from "./sceneParts.js";

/** Each part's icon in the checklist. */
const PART_ICONS: Record<ImportPart, IconName> = {
  spaces: "spaces",
  favorites: "star",
  archive: "archiveOutline",
  bookmarks: "book",
  extensions: "puzzle",
  history: "clock",
};

/**
 * Parts land in milliseconds; each check still waits its turn, this far after the one before, so the user sees them
 * come over one by one. Our choice.
 */
const PART_TICK_MS = 340;

/** What the scene shows: the browsers to pick from, or the one picked. */
interface ImportView {
  browserId: string | null;
  sourceId: string | null;
  /** The checklist is open: the user is choosing parts. */
  isChoosing: boolean;
  /** The parts ticked in the checklist, by source (all it found, until some are left out). */
  chosenParts: Map<string, Set<ImportPart>>;
  /** When each source's import started, so its checks can take their turns. */
  importStartedAt: Map<string, number>;
}

/** One browser's tile and the parts an update changes. */
interface BrowserTile {
  browserId: string;
  button: HTMLButtonElement;
}

/** Where the browsers' logos are, next to the page (the build copies src/onboarding/browser-logos). */
const BROWSER_LOGO_FOLDER = "./browser-logos";

/** One checklist row and the parts an update changes. */
interface ChecklistRow {
  part: ImportPart;
  button: HTMLButtonElement;
  count: HTMLElement;
}

/**
 * A browser's logo, in a holder of the tile's (or the picked browser's) size.
 */
function fillBrowserLogo(holder: HTMLElement, browserId: string): void {
  const image = document.createElement("img");
  image.alt = "";
  image.src = `${BROWSER_LOGO_FOLDER}/${browserId}.png`;
  image.className = "browser-icon-image";
  holder.replaceChildren(image);
}

/**
 * One tile of the grid: the logo and the name; a browser with nothing to import here is dimmed (its tooltip and
 * VoiceOver say why).
 */
function createBrowserTile(browser: WelcomeBrowser, onPick: (browserId: string) => void): BrowserTile {
  const button = createTextButton("", "browser-tile", () => onPick(browser.id));
  button.dataset.browser = browser.id;
  const isHere = browser.sources.length > 0;
  button.disabled = !isHere;
  button.classList.toggle("is-missing", !isHere);
  if (!isHere) {
    button.title = "Not on this Mac";
    button.setAttribute("aria-label", `${browser.name}, not on this Mac`);
  }
  const iconHolder = createElement("span", "browser-icon");
  fillBrowserLogo(iconHolder, browser.id);
  const doneMark = createElement("span", "browser-done");
  doneMark.append(createIcon("checkmark", "icon"));
  button.append(iconHolder, createElement("span", "browser-name", browser.name), doneMark);
  return { browserId: browser.id, button: button };
}

/**
 * Writes the "what it holds" sentence: the numbers and their nouns bold, the joining words plain.
 */
function writeFoundSentence(target: HTMLElement, found: ImportFound): void {
  const pieces = describeFound(found).map((part) => (part.isBold ? createElement("strong", "", part.text) : document.createTextNode(part.text)));
  target.replaceChildren(...pieces);
}

/**
 * Builds the scene. `goNext` moves on to the next scene.
 */
export function createImportScene(data: WelcomeData, goNext: () => void): SceneView {
  const frame = createSceneFrame("import", false);
  const view: ImportView = { browserId: null, sourceId: null, isChoosing: false, chosenParts: new Map(), importStartedAt: new Map() };
  let current: WelcomeData = data;
  let doneTimer: number | null = null;

  // The grid of browsers.
  const pickPane = createElement("div", "import-pick");
  const pickLede = createSceneLede("Pick the browser you use now. Bow looks first, and brings nothing over until you say so.");
  const grid = markReveal(createElement("div", "browser-grid"));
  const tiles = data.browsers.map((browser) => createBrowserTile(browser, (browserId) => pickBrowser(browserId)));
  grid.append(...tiles.map((tile) => tile.button));
  const pickActions = createSceneActions("", () => undefined, "Start fresh", goNext);
  pickActions.primary.hidden = true;
  pickPane.append(pickLede, grid, pickActions.element, createSceneNote("Everything stays on this Mac."));

  // One browser, picked.
  const sourcePane = createElement("div", "import-source");
  const sourceBar = markReveal(createElement("div", "source-bar"));
  const backButton = createTextButton("", "source-back", () => showGrid());
  backButton.append(createIcon("chevronLeft", "icon"), createElement("span", "", "All browsers"));
  const sourceIcon = createElement("span", "source-icon");
  const sourceName = createElement("span", "source-name");
  sourceBar.append(backButton, sourceIcon, sourceName);
  const sentence = markReveal(createElement("p", "scene-lede import-sentence"));
  sentence.setAttribute("aria-live", "polite");
  const checklist = createElement("div", "import-checklist");
  const sourceActions = createSceneActions("", () => runPrimary(), "", () => runSecondary());
  const sourceNote = createSceneNote("");
  sourcePane.append(sourceBar, sentence, checklist, sourceActions.element, sourceNote);
  sourcePane.hidden = true;

  // A browser with several profiles (Dia's spaces): all of them at once, each as a Space (profilesImport.ts).
  const profilesPane = createProfilesPane(data, goNext, () => showGrid());

  frame.text.append(createSceneTitle("Bring your things."), pickPane, sourcePane, profilesPane.element);
  let rows: ChecklistRow[] = [];
  let rowsSourceId: string | null = null;

  const findBrowser = (): WelcomeBrowser | undefined => current.browsers.find((browser) => browser.id === view.browserId);
  const findImport = (): WelcomeImport | undefined => (view.sourceId === null ? undefined : current.imports[view.sourceId]);

  const chosenFor = (sourceId: string, found: ImportFound): Set<ImportPart> => {
    const existing = view.chosenParts.get(sourceId);
    if (existing !== undefined) {
      return existing;
    }
    const allParts = new Set(found.parts);
    view.chosenParts.set(sourceId, allParts);
    return allParts;
  };

  // Main ignores a read of a source it is already reading, importing or has imported.
  const readSource = (sourceId: string): void => {
    window.onboardingApi.readSource(sourceId).catch((error) => console.error("Reading an import source failed:", error));
  };

  const pickSource = (sourceId: string): void => {
    view.sourceId = sourceId;
    view.isChoosing = false;
    const phase = current.imports[sourceId]?.phase;
    if (phase === undefined || phase === "failed" || phase === "needsAccess") {
      readSource(sourceId);
    }
    draw();
  };

  const pickBrowser = (browserId: string): void => {
    const browser = current.browsers.find((candidate) => candidate.id === browserId);
    const firstSource = browser?.sources[0];
    if (browser === undefined || firstSource === undefined) {
      return;
    }
    view.browserId = browserId;
    pickPane.hidden = true;
    if (browser.sources.length > 1) {
      view.sourceId = null;
      profilesPane.show(browser, (holder) => fillBrowserLogo(holder, browser.id));
      draw();
      return;
    }
    sourcePane.hidden = false;
    fillBrowserLogo(sourceIcon, browser.id);
    sourceName.textContent = browser.name;
    pickSource(firstSource.id);
    revealParts(sourcePane, 0);
  };

  const showGrid = (): void => {
    view.browserId = null;
    view.sourceId = null;
    sourcePane.hidden = true;
    profilesPane.hide();
    pickPane.hidden = false;
    draw();
    revealParts(pickPane, 0);
  };

  const buildRows = (sourceId: string, found: ImportFound): void => {
    rows = found.parts.map((part) => {
      const button = createTextButton("", "import-row", () => toggleRow(part));
      button.dataset.part = part;
      button.setAttribute("role", "checkbox");
      const iconBox = createElement("span", "import-row-icon");
      iconBox.append(createIcon(PART_ICONS[part], "icon"));
      const words = createElement("span", "import-row-words");
      const count = createElement("span", "import-row-count", describePartCount(part, found));
      words.append(createElement("span", "import-row-title", IMPORT_PART_LABELS[part].title), count);
      const mark = createElement("span", "import-row-mark");
      mark.append(createElement("span", "import-row-circle"), createElement("span", "import-row-spinner"), createIcon("checkmark", "icon import-row-check"));
      button.append(iconBox, words, mark);
      return { part: part, button: button, count: count };
    });
    checklist.replaceChildren(...rows.map((row) => row.button));
    rowsSourceId = sourceId;
  };

  const toggleRow = (part: ImportPart): void => {
    const welcomeImport = findImport();
    if (view.sourceId === null || welcomeImport === undefined || welcomeImport.found === null || welcomeImport.phase !== "found") {
      return;
    }
    const chosen = chosenFor(view.sourceId, welcomeImport.found);
    if (chosen.has(part)) {
      chosen.delete(part);
    } else {
      chosen.add(part);
    }
    draw();
  };

  const runPrimary = (): void => {
    const welcomeImport = findImport();
    const sourceId = view.sourceId;
    if (sourceId === null || welcomeImport === undefined) {
      return;
    }
    if (welcomeImport.phase === "needsAccess") {
      window.onboardingApi.openFullDiskAccess().catch(() => undefined);
      return;
    }
    if (welcomeImport.phase === "failed") {
      readSource(sourceId);
      return;
    }
    const found = welcomeImport.found;
    if (welcomeImport.phase !== "found" || found === null || found.parts.length === 0) {
      goNext();
      return;
    }
    const chosen = view.isChoosing ? Array.from(chosenFor(sourceId, found)) : found.parts;
    view.importStartedAt.set(sourceId, Date.now());
    window.onboardingApi.bringOver(sourceId, chosen).catch((error) => console.error("Bringing an import over failed:", error));
  };

  const runSecondary = (): void => {
    const welcomeImport = findImport();
    if (view.sourceId !== null && welcomeImport?.phase === "needsAccess") {
      readSource(view.sourceId);
      return;
    }
    if (welcomeImport?.phase === "found" && (welcomeImport.found?.parts.length ?? 0) > 0 && !view.isChoosing) {
      view.isChoosing = true;
      draw();
      revealParts(checklist, 0);
      return;
    }
    showGrid();
  };

  // The import shows as done once every chosen part has had its turn to tick (PART_TICK_MS each).
  const isShownDone = (sourceId: string, welcomeImport: WelcomeImport): boolean => {
    if (welcomeImport.phase !== "done") {
      return false;
    }
    const startedAt = view.importStartedAt.get(sourceId) ?? 0;
    const shownAt = startedAt + welcomeImport.parts.length * PART_TICK_MS;
    const waitMs = shownAt - Date.now();
    if (waitMs <= 0) {
      return true;
    }
    if (doneTimer === null) {
      doneTimer = window.setTimeout(() => {
        doneTimer = null;
        draw();
      }, waitMs);
    }
    return false;
  };

  const drawRows = (sourceId: string, welcomeImport: WelcomeImport): void => {
    const found = welcomeImport.found;
    if (found === null) {
      return;
    }
    if (rowsSourceId !== sourceId || rows.length !== found.parts.length) {
      buildRows(sourceId, found);
    }
    const chosen = chosenFor(sourceId, found);
    const isImporting = welcomeImport.phase === "importing" || welcomeImport.phase === "done";
    const startedAt = view.importStartedAt.get(sourceId) ?? Date.now();
    let turn = 0;
    for (const row of rows) {
      const isTaken = isImporting ? welcomeImport.parts.includes(row.part) : chosen.has(row.part);
      const isDone = welcomeImport.doneParts.includes(row.part) || (welcomeImport.phase === "done" && isTaken);
      row.button.setAttribute("aria-checked", String(isTaken));
      row.button.disabled = isImporting;
      row.button.classList.toggle("is-left-out", isImporting && !isTaken);
      row.button.classList.toggle("is-working", isImporting && isTaken && !isDone);
      if (isImporting && isTaken) {
        turn += 1;
        const tickDelay = Math.max(0, startedAt + turn * PART_TICK_MS - Date.now());
        row.button.style.setProperty("--tick-delay", `${tickDelay}ms`);
      }
      row.button.classList.toggle("is-done", isImporting && isDone);
    }
  };

  const drawSource = (): void => {
    const browser = findBrowser();
    const sourceId = view.sourceId;
    const welcomeImport = findImport();
    if (browser === undefined || sourceId === null) {
      return;
    }
    const phase = welcomeImport?.phase ?? "reading";
    const found = welcomeImport?.found ?? null;
    const isEmpty = found !== null && found.parts.length === 0;
    const isDoneShown = welcomeImport !== undefined && isShownDone(sourceId, welcomeImport);
    const isWorking = phase === "importing" || (phase === "done" && !isDoneShown);
    let shownPhase: string = phase;
    if (isWorking) {
      shownPhase = "importing";
    }
    if (isDoneShown) {
      shownPhase = "done";
    }
    sourcePane.dataset.phase = shownPhase;
    sentence.classList.toggle("is-reading", phase === "reading");
    if (phase === "reading") {
      sentence.textContent = `Looking at ${browser.name}…`;
    } else if (phase === "needsAccess") {
      sentence.textContent = "macOS keeps Safari's files private. Turn on Bow in Full Disk Access, then try again.";
    } else if (phase === "failed") {
      sentence.textContent = `Bow couldn't read ${browser.name}. Try again, or import later from the File menu.`;
    } else if (isEmpty) {
      sentence.textContent = `Nothing new to bring over from ${browser.name}.`;
    } else if (found !== null) {
      writeFoundSentence(sentence, found);
    }
    const showsChecklist = found !== null && !isEmpty && (view.isChoosing || isWorking || isDoneShown);
    checklist.hidden = !showsChecklist;
    if (showsChecklist && welcomeImport !== undefined) {
      drawRows(sourceId, welcomeImport);
    }
    drawSourceActions(browser, phase, found, isEmpty, isWorking, isDoneShown);
  };

  const drawSourceActions = (browser: WelcomeBrowser, phase: WelcomeImport["phase"], found: ImportFound | null, isEmpty: boolean, isWorking: boolean, isDoneShown: boolean): void => {
    const primary = sourceActions.primary;
    const secondary = sourceActions.secondary;
    sourceActions.element.hidden = phase === "reading";
    primary.disabled = isWorking;
    secondary.hidden = isWorking;
    sourceNote.classList.toggle("is-positive", isDoneShown);
    sourceNote.textContent = isDoneShown ? `Done. Your things from ${browser.name} are in Bow.` : "Everything stays on this Mac.";
    if (phase === "needsAccess") {
      primary.textContent = "Open System Settings";
      secondary.textContent = "Try again";
      return;
    }
    if (phase === "failed") {
      primary.textContent = "Try again";
      secondary.textContent = "Choose another browser";
      return;
    }
    if (isWorking) {
      primary.textContent = "Importing…";
      return;
    }
    if (isDoneShown || isEmpty || found === null) {
      primary.textContent = "Continue";
      secondary.textContent = "Import from another browser";
      return;
    }
    const chosenCount = view.sourceId === null ? 0 : chosenFor(view.sourceId, found).size;
    primary.textContent = view.isChoosing ? "Import selected" : "Import everything";
    primary.disabled = view.isChoosing && chosenCount === 0;
    secondary.textContent = view.isChoosing ? "Choose another browser" : "Choose what to import";
  };

  const drawTiles = (): void => {
    for (const tile of tiles) {
      const browser = current.browsers.find((candidate) => candidate.id === tile.browserId);
      if (browser === undefined) {
        continue;
      }
      const isImported = browser.sources.some((source) => current.imports[source.id]?.phase === "done");
      tile.button.classList.toggle("is-imported", isImported);
    }
  };

  const draw = (): void => {
    let shownView = "pick";
    if (view.browserId !== null) {
      shownView = view.sourceId === null ? "profiles" : "source";
    }
    frame.element.dataset.view = shownView;
    drawTiles();
    if (view.sourceId !== null) {
      drawSource();
    }
  };

  const update = (fresh: WelcomeData): void => {
    current = fresh;
    draw();
    profilesPane.update(fresh);
  };
  update(data);
  return { element: frame.element, update: update, enter: () => revealParts(frame.text, 0), leave: () => undefined };
}
