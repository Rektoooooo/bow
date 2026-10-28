/**
 * WHY this file exists:
 *   Library › Chains: where the user builds command chains (main/commandChains.ts). Each chain is a card with its
 *   name, its steps in order (move up, move down, remove) and ways to add a step: a Command Bar action or a web page.
 *   "Run" runs it here; in the Command Bar it is "Run <name>".
 *
 * Data source:
 *   LibraryData.commandChains and chainActions (overlayController.ts buildLibraryData).
 *
 * Data flow:
 *   an edit → dispatch saveCommandChain (the whole chain) → main checks it and saves → fresh LibraryData → the cards
 *   are drawn again only when the chains changed, so typing in another card's field is not interrupted by unrelated
 *   updates
 */
import type { LibraryData } from "../shared/overlay";
import { CHAIN_STEPS_LIMIT } from "../shared/settings.js";
import type { CommandChain, CommandChainStep } from "../shared/types";
import { createElement, createIconButton, createTextButton, dispatch } from "../renderer/dom.js";

/** What the cards were last drawn from, to skip redraws when the chains did not change. */
let drawnChainsKey = "";

/**
 * Whether fresh Library data changes what the cards show.
 */
export function haveChainsChanged(data: LibraryData): boolean {
  return describeChains(data) !== drawnChainsKey;
}

function describeChains(data: LibraryData): string {
  return JSON.stringify([data.commandChains, data.chainActions]);
}

/**
 * Saves a chain with new steps or a new name.
 */
function saveChain(chain: CommandChain, changes: Partial<Pick<CommandChain, "name" | "steps">>): void {
  dispatch({ type: "saveCommandChain", chain: { ...chain, ...changes } });
}

/**
 * The words a step shows: the action's Command Bar title, or the page's address.
 */
function describeStep(step: CommandChainStep, data: LibraryData): string {
  if (step.kind === "open") {
    return `Open ${step.url.replace(/^https?:\/\//, "")}`;
  }
  const action = data.chainActions.find((candidate) => candidate.id === step.actionId);
  return action === undefined ? "An action that is gone (it is skipped)" : action.title;
}

/**
 * A step's line: its number and words, and buttons to move it up or down, or remove it.
 */
function createStepLine(chain: CommandChain, index: number, data: LibraryData): HTMLElement {
  const step = chain.steps[index] as CommandChainStep;
  const line = createElement("div", "library-line chain-step");
  line.append(createElement("span", "chain-step-number", `${index + 1}`), createElement("span", "library-line-title", describeStep(step, data)));
  const moveStep = (offset: number): void => {
    const steps = [...chain.steps];
    const [moved] = steps.splice(index, 1);
    steps.splice(index + offset, 0, moved as CommandChainStep);
    saveChain(chain, { steps: steps });
  };
  const upButton = createIconButton("chevronUp", "Move up", "library-line-icon-button chain-step-up", () => moveStep(-1));
  upButton.disabled = index === 0;
  const downButton = createIconButton("chevronDown", "Move down", "library-line-icon-button chain-step-down", () => moveStep(1));
  downButton.disabled = index === chain.steps.length - 1;
  const removeButton = createIconButton("close", "Remove step", "library-line-icon-button chain-step-remove", () => {
    const steps = [...chain.steps];
    steps.splice(index, 1);
    saveChain(chain, { steps: steps });
  });
  line.append(upButton, downButton, removeButton);
  return line;
}

/**
 * The two ways to add a step: pick a Command Bar action, or type a web address.
 */
function createAddForms(chain: CommandChain, data: LibraryData): HTMLElement[] {
  const actionForm = document.createElement("form");
  actionForm.className = "routing-form chain-add-action";
  const actionSelect = document.createElement("select");
  actionSelect.className = "library-select chain-action-select";
  actionSelect.setAttribute("aria-label", "Action");
  for (const action of data.chainActions) {
    actionSelect.append(new Option(action.title, action.id));
  }
  const addActionButton = createSubmitButton("Add Action");
  actionForm.append(actionSelect, addActionButton);
  actionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (actionSelect.value !== "") {
      saveChain(chain, { steps: [...chain.steps, { kind: "action", actionId: actionSelect.value }] });
    }
  });

  const pageForm = document.createElement("form");
  pageForm.className = "routing-form chain-add-page";
  const addressInput = document.createElement("input");
  addressInput.className = "library-search chain-address-input";
  addressInput.placeholder = "github.com/notifications";
  addressInput.setAttribute("aria-label", "Web address");
  const problem = createElement("p", "library-setting-note chain-problem");
  const addPageButton = createSubmitButton("Add Page");
  pageForm.append(addressInput, addPageButton);
  pageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const typed = addressInput.value.trim();
    const address = /^https?:\/\//i.test(typed) ? typed : `https://${typed}`;
    if (typed === "" || !URL.canParse(address)) {
      problem.textContent = "Type a web address, such as github.com/notifications.";
      return;
    }
    saveChain(chain, { steps: [...chain.steps, { kind: "open", url: address }] });
  });

  const isFull = chain.steps.length >= CHAIN_STEPS_LIMIT;
  addActionButton.disabled = isFull;
  addPageButton.disabled = isFull;
  return [actionForm, pageForm, problem];
}

function createSubmitButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "submit";
  button.className = "library-chip";
  button.textContent = label;
  return button;
}

/**
 * One chain's card.
 */
function createChainCard(chain: CommandChain, data: LibraryData): HTMLElement {
  const card = createElement("div", "chain-card");
  card.dataset.chainId = chain.id;
  const header = createElement("div", "chain-header");
  const nameInput = document.createElement("input");
  nameInput.className = "library-search chain-name";
  nameInput.value = chain.name;
  nameInput.setAttribute("aria-label", "Chain name");
  // Saved when the field is left or Return is pressed; an empty name keeps the old one.
  nameInput.addEventListener("change", () => {
    const name = nameInput.value.trim();
    if (name === "") {
      nameInput.value = chain.name;
      return;
    }
    saveChain(chain, { name: name });
  });
  const runButton = createTextButton("Run", "library-chip is-active chain-run", () => dispatch({ type: "runCommandChain", chainId: chain.id }));
  runButton.disabled = chain.steps.length === 0;
  runButton.title = `Runs the steps in order; in the Command Bar: “Run ${chain.name}”`;
  const deleteButton = createIconButton("trash", "Delete chain", "library-line-icon-button chain-delete", () => dispatch({ type: "deleteCommandChain", chainId: chain.id }));
  header.append(nameInput, runButton, deleteButton);
  card.append(header);
  if (chain.steps.length === 0) {
    card.append(createElement("p", "library-setting-note", "No steps yet. Add an action or a page below."));
  }
  for (let index = 0; index < chain.steps.length; index++) {
    card.append(createStepLine(chain, index, data));
  }
  card.append(...createAddForms(chain, data));
  return card;
}

/**
 * Builds the Chains section: a New Chain button and a card per chain (the Library's empty state when there is none).
 */
export function renderChainsSection(body: HTMLElement, data: LibraryData, emptyState: HTMLElement): void {
  drawnChainsKey = describeChains(data);
  const section = createElement("div", "library-boosts library-chains");
  const toolbar = createElement("div", "library-toolbar");
  toolbar.append(createTextButton("New Chain", "library-chip chain-new", () => dispatch({ type: "createCommandChain" })));
  section.append(toolbar);
  if (data.commandChains.length === 0) {
    section.append(emptyState);
    body.replaceChildren(section);
    return;
  }
  const list = createElement("div", "library-list");
  list.append(...data.commandChains.map((chain) => createChainCard(chain, data)));
  section.append(list);
  body.replaceChildren(section);
}
