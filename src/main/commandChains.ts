/**
 * WHY this file exists:
 *   A command chain runs several Command Bar steps with one command: "Run Morning" can switch to the Work Space,
 *   open the team's board and hide the sidebar. The user builds chains in Library › Chains from the Command Bar's
 *   actions and web addresses. This file is the pure part: what a valid chain is (a chain arrives from the Library,
 *   a backup or another Mac, all untrusted) and how chains are added, changed and deleted.
 *
 * Data source:
 *   The state's commandChains, and chains from the Library (ipc.ts), a backup (backup.ts) or a sync peer (sync.ts,
 *   through backup.ts).
 *
 * Data flow:
 *   Library › Chains → action → checkCommandChain() → saveCommandChain() → applyChange
 *   Command Bar "Run <name>" → commandBarActions.ts runs the steps one by one
 *
 * Rules: pure. Same object back when nothing changed. A chain never runs another chain (no loops).
 */
import { CHAIN_NAME_MAX_LENGTH, CHAIN_STEPS_LIMIT, CHAINS_LIMIT } from "../shared/settings";
import type { BrowserState, CommandChain, CommandChainStep } from "../shared/types";
import { isRestorableUrl } from "./backup";

/** The name a new chain gets until the user renames it. */
export const NEW_CHAIN_NAME = "New Chain";

/** A chain's id, as createId("chain", now) makes it. */
const CHAIN_ID_PATTERN = /^chain-[0-9]+-[0-9]+$/;

/** A Command Bar action id: printable text without line breaks ("toggle-sidebar", "space:space-1", "theme:Mint"). */
const ACTION_ID_PATTERN = /^[\x20-\x7E]{1,120}$/;

/** The Command Bar ids of chains themselves: a step may not run one. */
const CHAIN_ACTION_PREFIX = "chain:";

/**
 * Whether a Command Bar action may be a step of a chain: any action except running a chain.
 */
export function isChainableActionId(actionId: string): boolean {
  return !actionId.startsWith(CHAIN_ACTION_PREFIX);
}

/**
 * The Command Bar id of the action that runs a chain.
 */
export function toChainActionId(chainId: string): string {
  return `${CHAIN_ACTION_PREFIX}${chainId}`;
}

/**
 * A step as it may be kept: an action that is not a chain, or a web page (http or https), else null.
 */
function checkStep(raw: unknown): CommandChainStep | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const step = raw as Record<string, unknown>;
  const isAction = step.kind === "action" && typeof step.actionId === "string" && ACTION_ID_PATTERN.test(step.actionId);
  if (isAction && isChainableActionId(step.actionId as string)) {
    return { kind: "action", actionId: step.actionId as string };
  }
  const isWebPage = step.kind === "open" && isRestorableUrl(step.url) && /^https?:/i.test(step.url);
  if (isWebPage) {
    return { kind: "open", url: step.url as string };
  }
  return null;
}

/**
 * A chain as it may be kept, or null when it is not one: a chain id, a name of 1 to CHAIN_NAME_MAX_LENGTH characters,
 * and at most CHAIN_STEPS_LIMIT steps, each valid (a chain with a bad step is refused whole, so nothing runs other
 * than what the user saw).
 */
export function checkCommandChain(raw: unknown): CommandChain | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const chain = raw as Record<string, unknown>;
  const name = typeof chain.name === "string" ? chain.name.trim() : "";
  const isIdUsable = typeof chain.id === "string" && CHAIN_ID_PATTERN.test(chain.id);
  const isNameUsable = name !== "" && name.length <= CHAIN_NAME_MAX_LENGTH;
  if (!isIdUsable || !isNameUsable || !Array.isArray(chain.steps) || chain.steps.length > CHAIN_STEPS_LIMIT) {
    return null;
  }
  const steps: CommandChainStep[] = [];
  for (const rawStep of chain.steps) {
    const step = checkStep(rawStep);
    if (step === null) {
      return null;
    }
    steps.push(step);
  }
  return { id: chain.id as string, name: name, steps: steps };
}

/**
 * The chains of a backup or a peer's file: each valid one once, at most CHAINS_LIMIT. Returns how many were left out.
 */
export function checkCommandChains(raw: unknown[]): { chains: CommandChain[]; leftOut: number } {
  const chains: CommandChain[] = [];
  let leftOut = 0;
  for (const entry of raw) {
    const chain = checkCommandChain(entry);
    const isUsable = chain !== null && chains.length < CHAINS_LIMIT && !chains.some((kept) => kept.id === chain.id);
    if (!isUsable) {
      leftOut += 1;
      continue;
    }
    chains.push(chain);
  }
  return { chains: chains, leftOut: leftOut };
}

/**
 * Adds an empty chain named NEW_CHAIN_NAME at the end. Same state when CHAINS_LIMIT chains exist.
 */
export function createCommandChain(state: BrowserState, chainId: string): BrowserState {
  const chains = state.commandChains ?? [];
  if (chains.length >= CHAINS_LIMIT) {
    return state;
  }
  return { ...state, commandChains: [...chains, { id: chainId, name: NEW_CHAIN_NAME, steps: [] }] };
}

/**
 * Puts a changed chain in place of the one with its id. Same state when there is none, or nothing changed.
 */
export function saveCommandChain(state: BrowserState, chain: CommandChain): BrowserState {
  const chains = state.commandChains ?? [];
  const index = chains.findIndex((candidate) => candidate.id === chain.id);
  const current = chains[index];
  if (current === undefined || JSON.stringify(current) === JSON.stringify(chain)) {
    return state;
  }
  const changed = [...chains];
  changed[index] = chain;
  return { ...state, commandChains: changed };
}

/**
 * Deletes a chain. Same state when there is none with that id.
 */
export function deleteCommandChain(state: BrowserState, chainId: string): BrowserState {
  const chains = state.commandChains ?? [];
  if (!chains.some((chain) => chain.id === chainId)) {
    return state;
  }
  return { ...state, commandChains: chains.filter((chain) => chain.id !== chainId) };
}
