/**
 * WHY this file exists:
 *   A Space template is saved from a Space and makes new Spaces like it; templates also arrive from backups and other
 *   Macs. These tests pin down what a template keeps (web pages, folders, a live folder's source, the Space's own
 *   defaults), what a new Space gets from it, and what a crafted template may not bring in.
 */
import { describe, expect, it } from "vitest";
import { checkSpaceTemplates, createSpaceFromTemplate, deleteSpaceTemplate, saveSpaceAsTemplate } from "../src/main/spaceTemplates";
import { createFolder, moveItem, setSpaceNewTabUrl, setSpaceSearchEngine, updateTabPage } from "../src/main/state";
import { createNoteUrl } from "../src/shared/notes";
import type { BrowserState, FolderItem, ItemId, SpaceTemplate, TabItem } from "../src/shared/types";
import { getPinnedIds, ONE_PM, openPinnedTabs, PERSONAL_SPACE_ID } from "./builders";

/** A Space with two pinned pages (one browsed away from its home), a folder holding one, a live folder and a Note. */
function buildSetup(): BrowserState {
  const pinned = openPinnedTabs(["https://docs.example/", "https://mail.example/"]);
  const browsed = updateTabPage(pinned.state, pinned.tabIds[1] as ItemId, "https://mail.example/inbox/42", "A mail");
  const withFolder = createFolder(browsed, "Reading", ONE_PM);
  const folderId = getPinnedIds(withFolder).at(-1) as ItemId;
  const filed = moveItem(withFolder, pinned.tabIds[0] as ItemId, { kind: "folder", folderId: folderId }, 0, ONE_PM);
  const withLive = createFolder(filed, "Pull Requests", ONE_PM, { source: { kind: "github", list: "pullRequests" }, hiddenUrls: [] });
  const note: TabItem = { kind: "tab", id: "tab-note", url: createNoteUrl("note-1"), title: "Plans", customTitle: null, faviconUrl: null, homeUrl: createNoteUrl("note-1"), lastActiveAt: ONE_PM, isMuted: false };
  const personal = withLive.spaces.find((space) => space.id === PERSONAL_SPACE_ID);
  const spaces = withLive.spaces.map((space) => (space === personal ? { ...space, pinnedIds: [...space.pinnedIds, note.id] } : space));
  const withNote: BrowserState = { ...withLive, items: { ...withLive.items, [note.id]: note }, spaces: spaces };
  const withEngine = setSpaceSearchEngine(withNote, PERSONAL_SPACE_ID, "kagi");
  return setSpaceNewTabUrl(withEngine, PERSONAL_SPACE_ID, "https://news.example/");
}

describe("saving a Space as a template", () => {
  it("keeps home pages, folders, a live folder's source and the Space's defaults, and leaves Notes out", () => {
    const saved = saveSpaceAsTemplate(buildSetup(), PERSONAL_SPACE_ID, "template-1-1");
    const template = saved.spaceTemplates?.[0];
    expect(template?.pinned).toEqual([
      { kind: "tab", url: "https://mail.example/", title: "https://mail.example/" },
      { kind: "folder", title: "Reading", children: [{ kind: "tab", url: "https://docs.example/", title: "https://docs.example/" }] },
      { kind: "folder", title: "Pull Requests", children: [], live: { kind: "github", list: "pullRequests" } },
    ]);
    expect(template).toMatchObject({ id: "template-1-1", searchEngine: "kagi", newTabUrl: "https://news.example/" });
  });

  it("replaces the template of the same name, keeping its id", () => {
    const once = saveSpaceAsTemplate(buildSetup(), PERSONAL_SPACE_ID, "template-1-1");
    const twice = saveSpaceAsTemplate(once, PERSONAL_SPACE_ID, "template-2-2");
    expect(twice.spaceTemplates?.map((template) => template.id)).toEqual(["template-1-1"]);
  });
});

describe("a Space from a template", () => {
  it("is made with the template's look, defaults and fresh Pinned tabs and folders, and opened", () => {
    const saved = saveSpaceAsTemplate(buildSetup(), PERSONAL_SPACE_ID, "template-1-1");
    const made = createSpaceFromTemplate(saved, "template-1-1", ONE_PM + 1000);
    const newSpace = made.spaces.find((space) => space.id === made.activeSpaceId);
    expect(made.spaces.length).toBe(saved.spaces.length + 1);
    expect(newSpace).toMatchObject({ searchEngine: "kagi", newTabUrl: "https://news.example/" });
    const pinned = (newSpace?.pinnedIds ?? []).map((itemId) => made.items[itemId]);
    expect(pinned.map((item) => (item?.kind === "tab" ? item.homeUrl : item?.kind === "folder" ? item.title : null))).toEqual(["https://mail.example/", "Reading", "Pull Requests"]);
    const reading = pinned[1] as FolderItem;
    expect((made.items[reading.childIds[0] as ItemId] as TabItem).url).toBe("https://docs.example/");
    expect((pinned[2] as FolderItem).live).toEqual({ source: { kind: "github", list: "pullRequests" }, hiddenUrls: [] });
    const originalIds = new Set(Object.keys(saved.items));
    expect(newSpace?.pinnedIds.some((itemId) => originalIds.has(itemId))).toBe(false);
  });

  it("changes nothing for a missing template, and a deleted one is gone", () => {
    const saved = saveSpaceAsTemplate(buildSetup(), PERSONAL_SPACE_ID, "template-1-1");
    expect(createSpaceFromTemplate(saved, "template-9-9", ONE_PM)).toBe(saved);
    expect(deleteSpaceTemplate(saved, "template-1-1").spaceTemplates).toEqual([]);
    expect(deleteSpaceTemplate(saved, "template-9-9")).toBe(saved);
  });
});

describe("templates from a file", () => {
  it("keep web pages and folders, and leave out what is not one", () => {
    const crafted = {
      id: "template-1-1",
      name: "Client",
      icon: "💼",
      theme: { colors: ["#000000"], appearance: "dark", grain: 0 },
      searchEngine: "evil",
      newTabUrl: "javascript:alert(1)",
      pinned: [
        { kind: "tab", url: "https://ok.example/", title: "OK" },
        { kind: "tab", url: "javascript:alert(document.cookie)", title: "Bad" },
        { kind: "tab", url: "file:///etc/passwd", title: "Bad" },
        { kind: "folder", title: "Live", children: [], live: { kind: "github", list: "everything" } },
      ],
    };
    const result = checkSpaceTemplates([crafted, { ...crafted, id: "../../evil" }]);
    const template = result.templates[0] as SpaceTemplate;
    expect(result.templates.length).toBe(1);
    expect(template.pinned).toEqual([
      { kind: "tab", url: "https://ok.example/", title: "OK" },
      { kind: "folder", title: "Live", children: [] },
    ]);
    expect(template.searchEngine).toBeUndefined();
    expect(template.newTabUrl).toBeUndefined();
    expect(result.leftOut).toBe(3);
  });
});
