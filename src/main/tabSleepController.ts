/**
 * WHY this file exists:
 *   Putting pages to sleep when you ask (a tab's menu, the Command Bar, the Task Manager) instead of waiting for
 *   "Sleep unused tabs after", and measuring what the awake pages cost for Library › Task Manager. tabSleep.ts decides
 *   which pages may sleep; tabViews.ts does the sleeping.
 *
 * Data source:
 *   The state (browserCore.ts), the awake pages and what is on screen (tabViews.ts), the pages in use (activity.ts,
 *   pictureInPicture.ts), and the app's processes (Electron's app.getAppMetrics).
 *
 * Data flow:
 *   Sleep Tab → sleepTabNow(tabId) → tabViews.sleepTabView → runtime push (the sidebar dims the tab)
 *   Sleep Other Tabs → sleepOtherTabsNow() → findTabsAllowedToSleep → sleepTabView each → runtime push
 *   Library › Task Manager → collectTaskList() → taskList.buildTaskList
 */
import { app } from "electron";
import { findTabsInUse } from "./activity";
import { getState, scheduleRuntimePush } from "./browserCore";
import { getPictureInPictureTabId } from "./pictureInPicture";
import { findTabsAllowedToSleep } from "./tabSleep";
import { buildTaskList } from "./taskList";
import type { AwakePage, ProcessUse } from "./taskList";
import { findWindowShowingTab, getShownTabIds, getSleepingTabIds, getTabViews, sleepTabView } from "./tabViews";
import type { TaskListData } from "../shared/overlay";
import type { ItemId } from "../shared/types";

/**
 * The pages in use now: on screen, playing sound, in picture-in-picture or in a call.
 */
function findInUseTabIds(): ItemId[] {
  return findTabsInUse(getTabViews(), getShownTabIds(), getPictureInPictureTabId());
}

/**
 * Sleep Tab: puts one page to sleep now, whatever the timer says (a page on screen or in a call refuses).
 */
export function sleepTabNow(tabId: ItemId): boolean {
  const isAsleep = sleepTabView(tabId);
  if (isAsleep) {
    scheduleRuntimePush();
  }
  return isAsleep;
}

/**
 * Sleep Other Tabs: puts every page to sleep that may sleep at all (not on screen, not in use, not kept awake).
 */
export function sleepOtherTabsNow(): number {
  const awakeTabIds = Array.from(getTabViews().keys());
  const tabIdsToSleep = findTabsAllowedToSleep(getState(), awakeTabIds, findInUseTabIds());
  let sleptCount = 0;
  for (const tabId of tabIdsToSleep) {
    if (sleepTabView(tabId)) {
      sleptCount += 1;
    }
  }
  if (sleptCount > 0) {
    scheduleRuntimePush();
  }
  return sleptCount;
}

/**
 * Whether a page could be put to sleep now: it is awake, not on screen and not in use.
 */
export function canSleepNow(tabId: ItemId): boolean {
  const isAwake = getTabViews().has(tabId);
  const inUseTabIds = findInUseTabIds();
  return isAwake && findWindowShowingTab(tabId) === null && !inUseTabIds.includes(tabId);
}

/**
 * What the Task Manager shows: each awake page's memory and processor use, and Bow's own.
 */
export function collectTaskList(): TaskListData {
  const inUseTabIds = new Set(findInUseTabIds());
  const pages: AwakePage[] = [];
  for (const [tabId, view] of getTabViews()) {
    if (view.webContents.isDestroyed()) {
      continue;
    }
    const isOnScreen = findWindowShowingTab(tabId) !== null;
    pages.push({ tabId: tabId, processId: view.webContents.getOSProcessId(), canSleep: !isOnScreen && !inUseTabIds.has(tabId) });
  }
  const processes: ProcessUse[] = app.getAppMetrics().map((metric) => ({
    processId: metric.pid,
    memoryKilobytes: metric.memory.workingSetSize,
    cpuPercent: metric.cpu.percentCPUUsage,
  }));
  return buildTaskList(getState(), pages, processes, getSleepingTabIds().length);
}
