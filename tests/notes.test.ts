/**
 * WHY this file exists:
 *   Notes are tabs with an address of our own; these tests pin down the address rules (the id names a file, so it
 *   must be safe) and how a note is created and named.
 */
import { describe, expect, it } from "vitest";
import { createNoteUrl, getNoteId, isNoteUrl, NEW_NOTE_TITLE } from "../src/shared/notes";
import { createInitialState, createNote, getSelectedTabId, setNoteTitle } from "../src/main/state";
import { findTab } from "../src/main/tree";
import { ONE_PM } from "./builders";

describe("notes", () => {
  it("have their own address, and only safe ids count", () => {
    expect(isNoteUrl(createNoteUrl("note-1-2"))).toBe(true);
    expect(getNoteId("sidebar-note:note-1-2")).toBe("note-1-2");
    expect(getNoteId("sidebar-note:../../etc/passwd")).toBeNull();
    expect(getNoteId("https://example.com/")).toBeNull();
  });

  it("open at the top of Today, selected, named New Note until their first line names them", () => {
    const state = createNote(createInitialState(), "note-1-2", ONE_PM);
    const tab = findTab(state, getSelectedTabId(state)!)!;
    const named = setNoteTitle(state, tab.url, "  Shopping list  ");

    expect(tab.url).toBe("sidebar-note:note-1-2");
    expect(tab.title).toBe(NEW_NOTE_TITLE);
    expect(findTab(named, tab.id)!.title).toBe("Shopping list");
    expect(setNoteTitle(named, tab.url, "Shopping list")).toBe(named);
    expect(findTab(setNoteTitle(named, tab.url, ""), tab.id)!.title).toBe(NEW_NOTE_TITLE);
  });
});
