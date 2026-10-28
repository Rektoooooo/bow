// Duplicate tabs: an address you already have open is switched to; Close Duplicate Tabs keeps one copy.
import { describe, expect, it } from "vitest";
import { findDuplicateTodayTabs, findOpenTabForUrl } from "../src/main/duplicateTabs";
import { createProfile, setSpaceProfile } from "../src/main/spaces";
import { pinTab, selectTab } from "../src/main/state";
import type { ItemId } from "../src/shared/types";
import { ONE_PM, openPinnedTabs, openTabs, PERSONAL_SPACE_ID, WORK_SPACE_ID } from "./builders";

describe("findOpenTabForUrl", () => {
  const { state, tabIds } = openTabs(["https://mail.example/inbox", "https://news.example/"]);

  it("finds the tab showing the address, whatever the scheme, www. or trailing slash", () => {
    expect(findOpenTabForUrl(state, "http://www.mail.example/inbox/", PERSONAL_SPACE_ID)).toBe(tabIds[0]);
    expect(findOpenTabForUrl(state, "https://mail.example/other", PERSONAL_SPACE_ID)).toBeNull();
  });

  it("finds a pinned tab by its home address too", () => {
    const pinned = openPinnedTabs(["https://calendar.example/"]);
    expect(findOpenTabForUrl(pinned.state, "https://calendar.example", PERSONAL_SPACE_ID)).toBe(pinned.tabIds[0]);
  });

  it("looks only in the Space's profile: another profile is another sign-in", () => {
    const created = createProfile(state, "Other", ONE_PM);
    const separate = setSpaceProfile(created.state, WORK_SPACE_ID, created.profileId);
    expect(findOpenTabForUrl(separate, "https://news.example/", WORK_SPACE_ID)).toBeNull();
    expect(findOpenTabForUrl(state, "https://news.example/", WORK_SPACE_ID)).toBe(tabIds[1]);
  });
});

describe("findDuplicateTodayTabs", () => {
  it("keeps the most recently used Today copy, and every pinned copy", () => {
    const built = openTabs(["https://a.example/", "https://a.example", "https://b.example/", "https://b.example/"]);
    const [olderCopy, newerCopy, todayB, pinnedB] = built.tabIds as [ItemId, ItemId, ItemId, ItemId];
    const used = selectTab(built.state, newerCopy, ONE_PM + 5 * 60 * 60 * 1000);
    const withPinned = pinTab(used, pinnedB);
    expect(findDuplicateTodayTabs(withPinned).sort()).toEqual([olderCopy, todayB].sort());
  });
});
