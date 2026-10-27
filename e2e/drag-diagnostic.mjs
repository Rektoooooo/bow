// A window for a person to try a real drag in, logging every pointer and drag event of the sidebar page. Tests can
// only simulate drag events (Playwright's own drag hangs in Electron), so when a real tab drag fails, this shows where:
// no dragstart at all, a dragstart without dragover, or a drop that did not move the tab.
// It opens a dark window with four Today tabs (One … Four) for MINUTES_OPEN minutes, then prints the order.
// usage: npm run build && node e2e/drag-diagnostic.mjs     (log: e2e/output/drag-diagnostic.log)
import { _electron } from "playwright-core";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const outDir = process.env.E2E_OUTPUT_DIR || path.join(appDir, "e2e", "output");
const userDataDir = path.join(outDir, "user-data-drag-diagnostic");
const logFile = path.join(outDir, "drag-diagnostic.log");
const MINUTES_OPEN = 10;
// Dragover fires continuously; one line per this long is enough to see where the pointer went.
const DRAGOVER_LOG_INTERVAL_MS = 250;

fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });
fs.writeFileSync(logFile, "");
const now = Date.now();
const tab = (id, title) => ({ kind: "tab", id, url: "about:blank", title, customTitle: null, faviconUrl: null, homeUrl: null, lastActiveAt: now, isMuted: false });
fs.writeFileSync(
  path.join(userDataDir, "browser-state.json"),
  JSON.stringify({
    version: 4,
    items: { one: tab("one", "One"), two: tab("two", "Two"), three: tab("three", "Three"), four: tab("four", "Four") },
    profiles: [{ id: "profile-default", name: "Default", favoriteIds: [] }],
    spaces: [{ id: "space-a", name: "Drag test", icon: "✦", theme: { colors: ["#000000"], appearance: "dark", grain: 0 }, profileId: "profile-default", pinnedIds: [], todayIds: ["one", "two", "three", "four"], isPinnedOpen: true }],
    activeSpaceId: "space-a",
    selectedTabIdBySpace: { "space-a": "one" },
    focusedWindowId: "window-1",
    otherWindows: [],
    archive: [],
    settings: { archiveAfterMs: 43200000, isSidebarVisible: true },
  }),
);

const app = await _electron.launch({ executablePath: createRequire(import.meta.url)("electron"), args: [`--user-data-dir=${userDataDir}`, "--skip-welcome", appDir] });
let sidebar = null;
while (sidebar === null) {
  sidebar = app.windows().find((page) => page.url().endsWith("/renderer/index.html")) ?? null;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
await sidebar.waitForSelector(".space-title");
sidebar.on("console", (message) => fs.appendFileSync(logFile, `${message.text()}\n`));
await sidebar.evaluate((interval) => {
  let lastDragover = 0;
  const describe = (event) => {
    const element = event.target instanceof Element ? event.target.closest("[data-item-id], [data-drop]") : null;
    return element === null ? String(event.target?.nodeName) : `${element.className} item=${element.dataset.itemId ?? ""} drop=${element.dataset.drop ?? ""}`;
  };
  for (const type of ["pointerdown", "pointerup", "click", "dragstart", "dragend", "drop", "dragenter", "dragover"]) {
    document.addEventListener(
      type,
      (event) => {
        if (type === "dragover" && performance.now() - lastDragover < interval) {
          return;
        }
        lastDragover = type === "dragover" ? performance.now() : lastDragover;
        const types = event.dataTransfer ? Array.from(event.dataTransfer.types).join("|") : "-";
        console.log(`${Math.round(performance.now())} ${type} ${describe(event)} prevented=${event.defaultPrevented} types=${types}`);
      },
      true,
    );
  }
}, DRAGOVER_LOG_INTERVAL_MS);
console.log(`Drag "Two" below "Four" in the window that opened. Events go to ${logFile}.`);
await new Promise((resolve) => setTimeout(resolve, MINUTES_OPEN * 60 * 1000));
const state = JSON.parse(fs.readFileSync(path.join(userDataDir, "browser-state.json"), "utf8"));
const order = state.spaces[0].todayIds.join(", ");
fs.appendFileSync(logFile, `order after: ${order}\n`);
console.log(`Order after: ${order}`);
await app.close();
