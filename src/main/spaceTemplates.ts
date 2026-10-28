/**
 * WHY this file exists:
 *   Space templates: save a Space as a template (its icon, theme, Pinned tabs and folders, and its own defaults:
 *   search engine, new-tab page, archive timing), then make new Spaces like it in one step, such as a fresh "Client"
 *   Space for each client. The new Space gets fresh tabs at the template's addresses; nothing else is shared with the
 *   Space the template came from.
 *
 * Data source:
 *   The state's Spaces and items (saving), the state's spaceTemplates (making a Space), and templates from a backup
 *   or another Mac (checkSpaceTemplates, untrusted).
 *
 * Data flow:
 *   Space menu › Save as Template → saveSpaceAsTemplate() → applyChange
 *   + menu / Command Bar › New Space from Template → createSpaceFromTemplate() → applyChange → live folders refresh
 *
 * Rules: pure; `now` is a parameter. A template keeps web pages only: Notes and Easels are left out (their content is
 * not part of the template), a split view's tabs become plain Pinned tabs, a live folder keeps its source and fills
 * itself again in the new Space.
 */
import { isSearchEngineId } from "../shared/searchEngines";
import { SPACE_TEMPLATE_DEPTH_LIMIT, SPACE_TEMPLATE_ITEMS_LIMIT, SPACE_TEMPLATES_LIMIT } from "../shared/settings";
import type { BrowserState, FolderItem, ItemId, SidebarItem, Space, SpaceTemplate, SpaceTemplateItem, TabItem } from "../shared/types";
import { checkLiveFolder, checkTheme, isRestorableUrl } from "./backup";
import { createSpace } from "./spaces";
import { createTab } from "./state";
import { createId, findSpace } from "./tree";

/** Longest name or title a template keeps. Our choice: well above any Space name or tab title shown. */
const MAX_TEMPLATE_TEXT_LENGTH = 300;

/** A template's id, as createId("template", now) makes it. */
const TEMPLATE_ID_PATTERN = /^template-[0-9]+-[0-9]+$/;

/**
 * Whether an address is a web page a template may keep (not a Note, an Easel or our own page).
 */
function isWebPage(url: unknown): url is string {
  return isRestorableUrl(url) && /^https?:/i.test(url);
}

/**
 * A Space's Pinned items as template items, in order, at most `budget.left` of them.
 */
function collectTemplateItems(state: BrowserState, itemIds: ItemId[], depth: number, budget: { left: number }): SpaceTemplateItem[] {
  const collected: SpaceTemplateItem[] = [];
  for (const itemId of itemIds) {
    const item = state.items[itemId];
    if (item === undefined || budget.left <= 0) {
      continue;
    }
    collected.push(...toTemplateItems(state, item, depth, budget));
  }
  return collected;
}

/**
 * One sidebar item as template items: a tab as its home page, a folder with what is inside (a live folder: only its
 * source), a split view as its tabs. Nothing for a Note or an Easel, or past the depth limit.
 */
function toTemplateItems(state: BrowserState, item: SidebarItem, depth: number, budget: { left: number }): SpaceTemplateItem[] {
  if (item.kind === "split") {
    return collectTemplateItems(state, item.childIds, depth, budget);
  }
  if (item.kind === "tab") {
    const url = item.homeUrl ?? item.url;
    if (!isWebPage(url)) {
      return [];
    }
    budget.left -= 1;
    // A tab that browsed away shows another page's title: its home page is named by its address until it loads.
    const isOnHomePage = item.homeUrl === null || item.homeUrl === item.url;
    const title = item.customTitle ?? (isOnHomePage ? item.title : url);
    return [{ kind: "tab", url: url, title: title }];
  }
  if (depth >= SPACE_TEMPLATE_DEPTH_LIMIT) {
    return [];
  }
  budget.left -= 1;
  if (item.live !== undefined) {
    return [{ kind: "folder", title: item.title, children: [], live: item.live.source }];
  }
  return [{ kind: "folder", title: item.title, children: collectTemplateItems(state, item.childIds, depth + 1, budget) }];
}

/**
 * Saves a Space as a template under the Space's name; a template of the same name is replaced (keeping its id).
 * Same state when the Space is missing, or the limit is reached and nothing would be replaced.
 */
export function saveSpaceAsTemplate(state: BrowserState, spaceId: string, templateId: string): BrowserState {
  const space = findSpace(state, spaceId);
  if (space === undefined) {
    return state;
  }
  const templates = state.spaceTemplates ?? [];
  const existing = templates.find((template) => template.name === space.name);
  if (existing === undefined && templates.length >= SPACE_TEMPLATES_LIMIT) {
    return state;
  }
  const template: SpaceTemplate = {
    id: existing?.id ?? templateId,
    name: space.name,
    icon: space.icon,
    theme: space.theme,
    pinned: collectTemplateItems(state, space.pinnedIds, 0, { left: SPACE_TEMPLATE_ITEMS_LIMIT }),
  };
  copySpaceDefaults(space, template);
  const replaced = templates.map((candidate) => (candidate.id === template.id ? template : candidate));
  const changed = existing === undefined ? [...templates, template] : replaced;
  return { ...state, spaceTemplates: changed };
}

/**
 * Copies a Space's own defaults (search engine, new-tab page, archive timing) onto a template or a Space.
 */
function copySpaceDefaults(from: Pick<Space, "searchEngine" | "newTabUrl" | "archiveAfterMs">, to: Pick<Space, "searchEngine" | "newTabUrl" | "archiveAfterMs">): void {
  if (from.searchEngine !== undefined) {
    to.searchEngine = from.searchEngine;
  }
  if (from.newTabUrl !== undefined) {
    to.newTabUrl = from.newTabUrl;
  }
  if (from.archiveAfterMs !== undefined) {
    to.archiveAfterMs = from.archiveAfterMs;
  }
}

/**
 * Makes the sidebar items of template items: Pinned tabs at their pages, folders (open) with their contents.
 * Returns the new items and the top-level ids in order.
 */
function buildItems(templateItems: SpaceTemplateItem[], now: number): { items: Record<ItemId, SidebarItem>; ids: ItemId[] } {
  const items: Record<ItemId, SidebarItem> = {};
  const ids: ItemId[] = [];
  for (const templateItem of templateItems) {
    if (templateItem.kind === "tab") {
      const tab: TabItem = { ...createTab(templateItem.url, now), title: templateItem.title, homeUrl: templateItem.url };
      items[tab.id] = tab;
      ids.push(tab.id);
      continue;
    }
    const inside = buildItems(templateItem.children, now);
    const folder: FolderItem = { kind: "folder", id: createId("folder", now), title: templateItem.title, childIds: inside.ids, isOpen: true };
    if (templateItem.live !== undefined) {
      folder.live = { source: templateItem.live, hiddenUrls: [] };
    }
    Object.assign(items, inside.items);
    items[folder.id] = folder;
    ids.push(folder.id);
  }
  return { items: items, ids: ids };
}

/**
 * Makes a new Space from a template and switches to it: the template's look, defaults and Pinned tree, in the active
 * Space's profile. Same state when the template is missing or no more Spaces fit.
 */
export function createSpaceFromTemplate(state: BrowserState, templateId: string, now: number): BrowserState {
  const template = (state.spaceTemplates ?? []).find((candidate) => candidate.id === templateId);
  if (template === undefined) {
    return state;
  }
  const withSpace = createSpace(state, { name: template.name, icon: template.icon, theme: template.theme }, now);
  if (withSpace === state) {
    return state;
  }
  const newSpace = withSpace.spaces.find((space) => space.id === withSpace.activeSpaceId) as Space;
  const built = buildItems(template.pinned, now);
  const filledSpace: Space = { ...newSpace, pinnedIds: built.ids };
  copySpaceDefaults(template, filledSpace);
  const spaces = withSpace.spaces.map((space) => (space.id === newSpace.id ? filledSpace : space));
  return { ...withSpace, items: { ...withSpace.items, ...built.items }, spaces: spaces };
}

/**
 * Deletes a template. Same state when there is none with that id.
 */
export function deleteSpaceTemplate(state: BrowserState, templateId: string): BrowserState {
  const templates = state.spaceTemplates ?? [];
  if (!templates.some((template) => template.id === templateId)) {
    return state;
  }
  return { ...state, spaceTemplates: templates.filter((template) => template.id !== templateId) };
}

/**
 * Text a template may keep: a string, trimmed and cut to MAX_TEMPLATE_TEXT_LENGTH; the fallback otherwise.
 */
function readTemplateText(value: unknown, fallback: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? fallback : trimmed.slice(0, MAX_TEMPLATE_TEXT_LENGTH);
}

/**
 * Template items from a file: web pages and folders, within the depth and item limits. Bad items are left out and
 * counted.
 */
function checkTemplateItems(raw: unknown, depth: number, budget: { left: number }, counter: { leftOut: number }): SpaceTemplateItem[] {
  const checked: SpaceTemplateItem[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const item = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    const isTab = item.kind === "tab" && isWebPage(item.url);
    const isFolder = item.kind === "folder" && depth < SPACE_TEMPLATE_DEPTH_LIMIT;
    if (budget.left <= 0 || (!isTab && !isFolder)) {
      counter.leftOut += 1;
      continue;
    }
    budget.left -= 1;
    if (isTab) {
      checked.push({ kind: "tab", url: item.url as string, title: readTemplateText(item.title, item.url as string) });
      continue;
    }
    const folder: SpaceTemplateItem = { kind: "folder", title: readTemplateText(item.title, "Folder"), children: checkTemplateItems(item.children, depth + 1, budget, counter) };
    const live = item.live === undefined ? undefined : checkLiveFolder({ source: item.live, hiddenUrls: [] });
    if (live !== undefined) {
      folder.live = live.source;
      folder.children = [];
    }
    checked.push(folder);
  }
  return checked;
}

/**
 * The templates of a backup or another Mac's file: each once, at most SPACE_TEMPLATES_LIMIT, with only what a
 * template may hold (web pages, folders, a known engine, a web new-tab page). Returns how many parts were left out.
 */
export function checkSpaceTemplates(raw: unknown[]): { templates: SpaceTemplate[]; leftOut: number } {
  const templates: SpaceTemplate[] = [];
  const counter = { leftOut: 0 };
  for (const entry of raw) {
    const record = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : null;
    const isUsable = record !== null && typeof record.id === "string" && TEMPLATE_ID_PATTERN.test(record.id);
    if (!isUsable || templates.length >= SPACE_TEMPLATES_LIMIT || templates.some((kept) => kept.id === record.id)) {
      counter.leftOut += 1;
      continue;
    }
    const template: SpaceTemplate = {
      id: record.id as string,
      name: readTemplateText(record.name, "Space"),
      icon: readTemplateText(record.icon, "✦").slice(0, 64),
      theme: checkTheme(record.theme),
      pinned: checkTemplateItems(record.pinned, 0, { left: SPACE_TEMPLATE_ITEMS_LIMIT }, counter),
    };
    if (isSearchEngineId(record.searchEngine)) {
      template.searchEngine = record.searchEngine;
    }
    if (isWebPage(record.newTabUrl)) {
      template.newTabUrl = record.newTabUrl;
    }
    const isTiming = typeof record.archiveAfterMs === "number" && Number.isFinite(record.archiveAfterMs) && record.archiveAfterMs > 0;
    if (record.archiveAfterMs === null || isTiming) {
      template.archiveAfterMs = record.archiveAfterMs as number | null;
    }
    templates.push(template);
  }
  return { templates: templates, leftOut: counter.leftOut };
}
