/**
 * WHY this file exists:
 *   Library › Task Manager shows what each awake page costs, so you can see which ones to put to sleep. Pages are
 *   separate processes, and a few pages of one site may share one. This turns the app's process list into one line
 *   per awake tab, biggest first, plus what Bow itself uses (its windows, the GPU, extensions).
 *
 * Data source:
 *   The state (titles, icons, addresses), each awake tab's process id and whether it may sleep now (main side,
 *   tabSleepController.ts), and the app's processes with their memory and processor use (Electron's getAppMetrics).
 *
 * Data flow:
 *   tabSleepController.collectTaskList() → buildTaskList(state, pages, processes) → LibraryData.tasks → library.ts
 *
 * Rules: pure.
 */
import type { TaskLine, TaskListData } from "../shared/overlay";
import type { BrowserState, ItemId } from "../shared/types";

/** One awake page: its tab, its process, and whether it may be put to sleep now (not on screen, not in use). */
export interface AwakePage {
  tabId: ItemId;
  processId: number;
  canSleep: boolean;
}

/** One process of the app, as Electron measures it. */
export interface ProcessUse {
  processId: number;
  /** Working set in kilobytes (Electron's memory.workingSetSize). */
  memoryKilobytes: number;
  /** Processor use since the previous measurement, in percent of one core. */
  cpuPercent: number;
}

const KILOBYTES_PER_MEGABYTE = 1024;

/**
 * One line per awake tab (largest memory first) and the totals. A process several tabs share is listed with each of
 * them, marked as shared, and counted once in the total.
 */
export function buildTaskList(state: BrowserState, pages: AwakePage[], processes: ProcessUse[], sleepingCount: number): TaskListData {
  const processById = new Map(processes.map((process) => [process.processId, process]));
  const tabsPerProcess = new Map<number, number>();
  for (const page of pages) {
    tabsPerProcess.set(page.processId, (tabsPerProcess.get(page.processId) ?? 0) + 1);
  }
  const lines: TaskLine[] = [];
  for (const page of pages) {
    const tab = state.items[page.tabId];
    const process = processById.get(page.processId);
    if (tab === undefined || tab.kind !== "tab" || process === undefined) {
      continue;
    }
    lines.push({
      tabId: tab.id,
      title: tab.customTitle ?? tab.title,
      url: tab.url,
      faviconUrl: tab.faviconUrl,
      memoryMb: Math.round(process.memoryKilobytes / KILOBYTES_PER_MEGABYTE),
      cpuPercent: Math.round(process.cpuPercent),
      sharedWith: (tabsPerProcess.get(page.processId) ?? 1) - 1,
      canSleep: page.canSleep,
    });
  }
  lines.sort((first, second) => second.memoryMb - first.memoryMb);
  const pageProcessIds = new Set(pages.map((page) => page.processId));
  let pagesKilobytes = 0;
  let bowKilobytes = 0;
  for (const process of processes) {
    if (pageProcessIds.has(process.processId)) {
      pagesKilobytes += process.memoryKilobytes;
    } else {
      bowKilobytes += process.memoryKilobytes;
    }
  }
  return {
    lines: lines,
    pagesMemoryMb: Math.round(pagesKilobytes / KILOBYTES_PER_MEGABYTE),
    bowMemoryMb: Math.round(bowKilobytes / KILOBYTES_PER_MEGABYTE),
    sleepingCount: sleepingCount,
  };
}
