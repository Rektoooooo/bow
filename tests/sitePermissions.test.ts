/**
 * WHY this file exists:
 *   Permission answers decide what a site may use; these tests pin down how Electron's names map to our kinds and
 *   that answers stay per profile and per site.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE_ID } from "../src/shared/settings";
import {
  findPermissionAnswer,
  getPermissionOrigin,
  getSitePermissions,
  MAX_SITE_PERMISSIONS,
  removePermissionAnswer,
  setPermissionAnswer,
  toPermissionKinds,
} from "../src/main/sitePermissions";
import { createInitialState } from "../src/main/state";

const MEET = "https://meet.example.com";

describe("site permissions", () => {
  it("map Electron's permission names to the kinds the user decides on", () => {
    expect(toPermissionKinds("media", ["video", "audio"])).toEqual(["camera", "microphone"]);
    expect(toPermissionKinds("media", ["audio"])).toEqual(["microphone"]);
    expect(toPermissionKinds("media", [])).toBeNull();
    expect(toPermissionKinds("geolocation")).toEqual(["location"]);
    expect(toPermissionKinds("notifications")).toEqual(["notifications"]);
    expect(toPermissionKinds("clipboard-read")).toEqual(["clipboard"]);
    expect(toPermissionKinds("midi")).toBeNull();
  });

  it("only give web pages an origin", () => {
    expect(getPermissionOrigin("https://meet.example.com/abc?x=1")).toBe(MEET);
    expect(getPermissionOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(getPermissionOrigin("file:///etc/hosts")).toBeNull();
    expect(getPermissionOrigin("not a url")).toBeNull();
  });

  it("remember answers per profile, site and kind, and forget them", () => {
    const allowed = setPermissionAnswer(createInitialState(), DEFAULT_PROFILE_ID, MEET, "camera", true);
    const blocked = setPermissionAnswer(allowed, DEFAULT_PROFILE_ID, MEET, "microphone", false);

    expect(findPermissionAnswer(blocked, DEFAULT_PROFILE_ID, MEET, "camera")).toBe(true);
    expect(findPermissionAnswer(blocked, DEFAULT_PROFILE_ID, MEET, "microphone")).toBe(false);
    expect(findPermissionAnswer(blocked, "profile-work", MEET, "camera")).toBeNull();
    expect(findPermissionAnswer(blocked, DEFAULT_PROFILE_ID, "https://other.example.com", "camera")).toBeNull();
    expect(setPermissionAnswer(blocked, DEFAULT_PROFILE_ID, MEET, "camera", true)).toBe(blocked);
    expect(getSitePermissions(setPermissionAnswer(blocked, DEFAULT_PROFILE_ID, MEET, "camera", false), DEFAULT_PROFILE_ID, MEET)).toHaveLength(2);

    const forgotten = removePermissionAnswer(blocked, DEFAULT_PROFILE_ID, MEET, "camera");
    expect(findPermissionAnswer(forgotten, DEFAULT_PROFILE_ID, MEET, "camera")).toBeNull();
    expect(removePermissionAnswer(forgotten, DEFAULT_PROFILE_ID, MEET, "camera")).toBe(forgotten);
  });

  it("keep the newest answers when there are too many", () => {
    let state = createInitialState();
    for (let index = 0; index <= MAX_SITE_PERMISSIONS; index++) {
      state = setPermissionAnswer(state, DEFAULT_PROFILE_ID, `https://site${index}.example.com`, "notifications", false);
    }
    expect(state.sitePermissions).toHaveLength(MAX_SITE_PERMISSIONS);
    expect(findPermissionAnswer(state, DEFAULT_PROFILE_ID, "https://site0.example.com", "notifications")).toBeNull();
  });
});
