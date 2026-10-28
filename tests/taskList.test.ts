// Library › Task Manager: one line per awake tab from the app's processes, biggest first, and the totals.
import { describe, expect, it } from "vitest";
import { buildTaskList } from "../src/main/taskList";
import type { ItemId } from "../src/shared/types";
import { openTabs } from "./builders";

describe("buildTaskList", () => {
  const { state, tabIds } = openTabs(["https://mail.example/", "https://docs.example/a", "https://docs.example/b"]);
  const [mailTab, docsTab, otherDocsTab] = tabIds as [ItemId, ItemId, ItemId];
  const pages = [
    { tabId: mailTab, processId: 11, canSleep: false },
    { tabId: docsTab, processId: 12, canSleep: true },
    { tabId: otherDocsTab, processId: 12, canSleep: true },
  ];
  const processes = [
    { processId: 1, memoryKilobytes: 200 * 1024, cpuPercent: 3 },
    { processId: 11, memoryKilobytes: 80 * 1024, cpuPercent: 0.4 },
    { processId: 12, memoryKilobytes: 150 * 1024, cpuPercent: 12.6 },
  ];
  const list = buildTaskList(state, pages, processes, 4);

  it("lists each awake tab with its process's memory and processor use, biggest first", () => {
    expect(list.lines.map((line) => line.tabId)).toEqual([docsTab, otherDocsTab, mailTab]);
    expect(list.lines[0]).toMatchObject({ memoryMb: 150, cpuPercent: 13, canSleep: true });
    expect(list.lines[2]).toMatchObject({ memoryMb: 80, cpuPercent: 0, canSleep: false });
  });

  it("marks tabs that share a process, and counts that process once", () => {
    expect(list.lines[0]?.sharedWith).toBe(1);
    expect(list.lines[2]?.sharedWith).toBe(0);
    expect(list.pagesMemoryMb).toBe(230);
  });

  it("puts every other process under Bow itself, and passes on how many tabs sleep", () => {
    expect(list.bowMemoryMb).toBe(200);
    expect(list.sleepingCount).toBe(4);
  });

  it("leaves out pages whose process or tab is gone", () => {
    const gone = buildTaskList(state, [...pages, { tabId: "tab-missing", processId: 12, canSleep: true }, { tabId: mailTab, processId: 99, canSleep: true }], processes, 0);
    expect(gone.lines).toHaveLength(3);
  });
});
