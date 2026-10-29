/**
 * WHY this file exists:
 *   A browser with several profiles (Dia keeps each of its spaces as one) comes over all at once, each profile as a
 *   Space of its own with its own sign-ins (the user, 2026-10-29: Dia showed 4 spaces but only 1 came over). This is
 *   that view of "Bring your things.": every profile read at once, one row per profile with what it holds, all ticked;
 *   one button brings the ticked ones; each row spins, then ticks, as its Space lands.
 *
 * Data source:
 *   WelcomeData.browsers (the picked browser and its profiles here) and WelcomeData.imports (each profile's progress,
 *   from main/onboardingWindow.ts).
 *
 * Data flow:
 *   importScene.ts picks a browser with several profiles → show(browser) → onboardingApi.readSource() for each →
 *   rows fill in → the button → onboardingApi.bringOverAll(browserId, ticked ids) → each row importing → done
 */
import type { WelcomeBrowser, WelcomeData, WelcomeImport } from "../shared/onboarding";
import { describeImportProfilesButton, describeProfileCounts, describeProfilesDone, describeProfilesFound, profileNounFor } from "../shared/onboarding.js";
import { createElement, createTextButton } from "../renderer/dom.js";
import { createIcon } from "../renderer/icons.js";
import { createSceneActions, createSceneNote, markReveal, revealParts } from "./sceneParts.js";

/** Each row's check waits its turn, this far after the one before (the same rhythm as importScene.ts). Our choice. */
const ROW_TICK_MS = 340;

/** One profile's row and the parts an update changes. */
interface ProfileRow {
  sourceId: string;
  button: HTMLButtonElement;
  count: HTMLElement;
}

/** The view and what importScene.ts does with it. */
export interface ProfilesPane {
  element: HTMLElement;
  /** Shows a browser's profiles; `fillLogo` puts the browser's logo into the holder it is given. */
  show(browser: WelcomeBrowser, fillLogo: (holder: HTMLElement) => void): void;
  hide(): void;
  update(data: WelcomeData): void;
}

/**
 * True when a profile was read and has something to bring.
 */
function isReadable(welcomeImport: WelcomeImport | undefined): boolean {
  const phase = welcomeImport?.phase;
  return phase === "found" || phase === "importing" || phase === "done";
}

/**
 * Builds the view. `goNext` moves on to the next scene; `showGrid` goes back to the browsers.
 */
export function createProfilesPane(data: WelcomeData, goNext: () => void, showGrid: () => void): ProfilesPane {
  const element = createElement("div", "import-profiles");
  element.hidden = true;
  const sourceBar = markReveal(createElement("div", "source-bar"));
  const backButton = createTextButton("", "source-back", () => showGrid());
  backButton.append(createIcon("chevronLeft", "icon"), createElement("span", "", "All browsers"));
  const logoHolder = createElement("span", "source-icon");
  const name = createElement("span", "source-name");
  sourceBar.append(backButton, logoHolder, name);
  const sentence = markReveal(createElement("p", "scene-lede import-sentence"));
  sentence.setAttribute("aria-live", "polite");
  const checklist = markReveal(createElement("div", "import-checklist"));
  const actions = createSceneActions("", () => runPrimary(), "", () => runSecondary());
  const note = createSceneNote("");
  element.append(sourceBar, sentence, checklist, actions.element, note);

  let current: WelcomeData = data;
  let browser: WelcomeBrowser | null = null;
  let rows: ProfileRow[] = [];
  const chosen = new Set<string>();
  let importStartedAt: number | null = null;
  let doneTimer: number | null = null;

  const importOf = (sourceId: string): WelcomeImport | undefined => current.imports[sourceId];

  const toggleRow = (sourceId: string): void => {
    const phase = importOf(sourceId)?.phase;
    if (phase !== "found") {
      return;
    }
    if (chosen.has(sourceId)) {
      chosen.delete(sourceId);
    } else {
      chosen.add(sourceId);
    }
    draw();
  };

  const buildRows = (picked: WelcomeBrowser): void => {
    const rowIcon = profileNounFor(picked.id) === "space" ? "spaces" : "person";
    rows = picked.sources.map((source) => {
      const button = createTextButton("", "import-row", () => toggleRow(source.id));
      button.dataset.source = source.id;
      button.setAttribute("role", "checkbox");
      const iconBox = createElement("span", "import-row-icon");
      iconBox.append(createIcon(rowIcon, "icon"));
      const words = createElement("span", "import-row-words");
      const count = createElement("span", "import-row-count");
      words.append(createElement("span", "import-row-title", source.profileName ?? picked.name), count);
      const mark = createElement("span", "import-row-mark");
      mark.append(createElement("span", "import-row-circle"), createElement("span", "import-row-spinner"), createIcon("checkmark", "icon import-row-check"));
      button.append(iconBox, words, mark);
      return { sourceId: source.id, button: button, count: count };
    });
    checklist.replaceChildren(...rows.map((row) => row.button));
  };

  const show = (picked: WelcomeBrowser, fillLogo: (holder: HTMLElement) => void): void => {
    browser = picked;
    chosen.clear();
    picked.sources.forEach((source) => chosen.add(source.id));
    importStartedAt = null;
    fillLogo(logoHolder);
    name.textContent = picked.name;
    buildRows(picked);
    // Main ignores a read of a profile it is already reading or has brought over.
    for (const source of picked.sources) {
      const phase = importOf(source.id)?.phase;
      if (phase === undefined || phase === "failed" || phase === "needsAccess") {
        window.onboardingApi.readSource(source.id).catch((error) => console.error("Reading a profile failed:", error));
      }
    }
    element.hidden = false;
    draw();
    revealParts(element, 0);
  };

  const chosenReadableIds = (): string[] => rows.map((row) => row.sourceId).filter((sourceId) => chosen.has(sourceId) && isReadable(importOf(sourceId)));

  const runPrimary = (): void => {
    if (browser === null) {
      return;
    }
    const takenIds = chosenReadableIds();
    const isDone = takenIds.length > 0 && takenIds.every((sourceId) => importOf(sourceId)?.phase === "done");
    if (isDone) {
      goNext();
      return;
    }
    if (takenIds.length === 0) {
      return;
    }
    importStartedAt = Date.now();
    window.onboardingApi.bringOverAll(browser.id, takenIds).catch((error) => console.error("Bringing every profile over failed:", error));
  };

  const runSecondary = (): void => {
    showGrid();
  };

  // The import shows as done once every row has had its turn to tick (ROW_TICK_MS each).
  const isShownDone = (takenCount: number): boolean => {
    const waitMs = (importStartedAt ?? 0) + takenCount * ROW_TICK_MS - Date.now();
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

  const drawRow = (row: ProfileRow, isImporting: boolean, turn: number): void => {
    const welcomeImport = importOf(row.sourceId);
    const phase = welcomeImport?.phase;
    const isTaken = chosen.has(row.sourceId) && isReadable(welcomeImport);
    const found = welcomeImport?.found ?? null;
    if (phase === undefined || phase === "reading") {
      row.count.textContent = "Looking…";
    } else if (found !== null) {
      row.count.textContent = describeProfileCounts(found);
    } else {
      row.count.textContent = "Couldn't read it";
    }
    row.button.setAttribute("aria-checked", String(isTaken));
    row.button.disabled = isImporting || phase !== "found";
    row.button.classList.toggle("is-left-out", isImporting && !isTaken);
    row.button.classList.toggle("is-working", isImporting && isTaken && phase !== "done");
    row.button.classList.toggle("is-done", isImporting && isTaken && phase === "done");
    const tickDelay = Math.max(0, (importStartedAt ?? Date.now()) + turn * ROW_TICK_MS - Date.now());
    row.button.style.setProperty("--tick-delay", `${tickDelay}ms`);
  };

  const draw = (): void => {
    const picked = browser;
    if (picked === null || element.hidden) {
      return;
    }
    const imports = rows.map((row) => importOf(row.sourceId));
    const isAllRead = imports.every((welcomeImport) => welcomeImport !== undefined && welcomeImport.phase !== "reading");
    const readableCount = imports.filter((welcomeImport) => isReadable(welcomeImport)).length;
    const takenIds = chosenReadableIds();
    const isAnyMoving = takenIds.some((sourceId) => importOf(sourceId)?.phase === "importing");
    const isAllLanded = takenIds.length > 0 && takenIds.every((sourceId) => importOf(sourceId)?.phase === "done");
    const isImporting = isAnyMoving || isAllLanded;
    const isDoneShown = isAllLanded && isShownDone(takenIds.length);
    let turn = 0;
    for (const row of rows) {
      const isTaken = takenIds.includes(row.sourceId);
      turn = isTaken ? turn + 1 : turn;
      drawRow(row, isImporting, turn);
    }
    sentence.classList.toggle("is-reading", !isAllRead);
    sentence.textContent = isAllRead ? describeProfilesFound(readableCount, picked.id, picked.name) : `Looking at ${picked.name}…`;
    let shownPhase = "found";
    if (isImporting) {
      shownPhase = isDoneShown ? "done" : "importing";
    }
    element.dataset.phase = shownPhase;
    actions.element.hidden = !isAllRead;
    note.classList.toggle("is-positive", isDoneShown);
    note.textContent = isDoneShown ? describeProfilesDone(takenIds.length, picked.id, picked.name) : `Everything stays on this Mac. Each ${profileNounFor(picked.id)} becomes a Space of its own.`;
    actions.secondary.hidden = isImporting && !isDoneShown;
    actions.secondary.textContent = isDoneShown ? "Import from another browser" : "Choose another browser";
    actions.primary.disabled = (isImporting && !isDoneShown) || takenIds.length === 0;
    if (isDoneShown) {
      actions.primary.textContent = "Continue";
    } else if (isImporting) {
      actions.primary.textContent = "Importing…";
    } else {
      actions.primary.textContent = describeImportProfilesButton(takenIds.length, readableCount, picked.id);
    }
  };

  const update = (fresh: WelcomeData): void => {
    current = fresh;
    draw();
  };

  const hide = (): void => {
    element.hidden = true;
    browser = null;
  };

  return { element: element, show: show, hide: hide, update: update };
}
