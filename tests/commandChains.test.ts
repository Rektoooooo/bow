/**
 * WHY this file exists:
 *   A command chain runs steps for the user, and chains arrive from the Library, backups and other Macs. These tests
 *   pin down what a chain may hold (actions that are not chains, web pages, within the limits) and how chains are
 *   added, changed and deleted.
 */
import { describe, expect, it } from "vitest";
import { checkCommandChain, checkCommandChains, createCommandChain, deleteCommandChain, isChainableActionId, NEW_CHAIN_NAME, saveCommandChain, toChainActionId } from "../src/main/commandChains";
import { createInitialState } from "../src/main/state";
import { CHAIN_NAME_MAX_LENGTH, CHAIN_STEPS_LIMIT, CHAINS_LIMIT } from "../src/shared/settings";
import type { CommandChain } from "../src/shared/types";
import { ONE_PM } from "./builders";

const MORNING: CommandChain = {
  id: "chain-1-1",
  name: "Morning",
  steps: [
    { kind: "action", actionId: "space:space-work" },
    { kind: "open", url: "https://github.com/notifications" },
    { kind: "action", actionId: "toggle-sidebar" },
  ],
};

describe("checking a chain", () => {
  it("keeps a chain of actions and web pages, its name trimmed", () => {
    expect(checkCommandChain(MORNING)).toEqual(MORNING);
    expect(checkCommandChain({ ...MORNING, name: "  Morning  " })?.name).toBe("Morning");
  });

  it("refuses a chain with any bad step whole", () => {
    const badSteps = [
      { kind: "open", url: "javascript:alert(1)" },
      { kind: "open", url: "file:///etc/passwd" },
      { kind: "action", actionId: toChainActionId("chain-2-2") },
      { kind: "action", actionId: "line\nbreak" },
      { kind: "run", command: "rm" },
    ];
    for (const step of badSteps) {
      expect(checkCommandChain({ ...MORNING, steps: [...MORNING.steps, step] }), JSON.stringify(step)).toBeNull();
    }
  });

  it("refuses a bad id, an empty or long name, and too many steps", () => {
    expect(checkCommandChain({ ...MORNING, id: "../../evil" })).toBeNull();
    expect(checkCommandChain({ ...MORNING, name: "   " })).toBeNull();
    expect(checkCommandChain({ ...MORNING, name: "x".repeat(CHAIN_NAME_MAX_LENGTH + 1) })).toBeNull();
    const manySteps = Array.from({ length: CHAIN_STEPS_LIMIT + 1 }, () => ({ kind: "action", actionId: "toggle-sidebar" }));
    expect(checkCommandChain({ ...MORNING, steps: manySteps })).toBeNull();
    expect(checkCommandChain("Morning")).toBeNull();
  });

  it("keeps each chain of a file once, and counts what it left out", () => {
    const result = checkCommandChains([MORNING, MORNING, { ...MORNING, id: "chain-3-3", steps: [{ kind: "open", url: "javascript:x" }] }]);
    expect(result.chains).toEqual([MORNING]);
    expect(result.leftOut).toBe(2);
  });

  it("never lets a chain run another chain", () => {
    expect(isChainableActionId("toggle-sidebar")).toBe(true);
    expect(isChainableActionId(toChainActionId(MORNING.id))).toBe(false);
  });
});

describe("changing chains", () => {
  it("adds an empty chain, saves changes to it and deletes it", () => {
    const state = createInitialState(ONE_PM);
    const created = createCommandChain(state, "chain-1-1");
    expect(created.commandChains).toEqual([{ id: "chain-1-1", name: NEW_CHAIN_NAME, steps: [] }]);
    const saved = saveCommandChain(created, MORNING);
    expect(saved.commandChains).toEqual([MORNING]);
    expect(saveCommandChain(saved, MORNING)).toBe(saved);
    expect(deleteCommandChain(saved, MORNING.id).commandChains).toEqual([]);
  });

  it("change nothing for an unknown chain or past the limit", () => {
    const state = createInitialState(ONE_PM);
    expect(saveCommandChain(state, MORNING)).toBe(state);
    expect(deleteCommandChain(state, "chain-9-9")).toBe(state);
    const full = { ...state, commandChains: Array.from({ length: CHAINS_LIMIT }, (_, index) => ({ ...MORNING, id: `chain-1-${index}` })) };
    expect(createCommandChain(full, "chain-2-1")).toBe(full);
  });
});
