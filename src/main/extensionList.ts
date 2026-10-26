/**
 * WHY this file exists:
 *   The saved list of Chrome extensions: which extension is added to which profile, and whether it is on. These pure
 *   functions change that list; extensionHost.ts makes the profile sessions match it.
 *
 * Data source:
 *   BrowserState.extensions.
 *
 * Data flow:
 *   Library › Extensions / Import from Arc / Load Unpacked → actions → here → applyChange → extensionHost.ts loads or
 *   unloads the extension in the profile's session
 */
import type { BrowserState, InstalledExtension, ProfileId } from "../shared/types";

/** Most extensions per profile. Our choice: far more than anyone runs; bounds what the state can hold. */
export const MAX_EXTENSIONS_PER_PROFILE = 100;

/**
 * Returns a profile's extensions in the order they were added.
 */
export function getProfileExtensions(state: BrowserState, profileId: ProfileId): InstalledExtension[] {
  return (state.extensions ?? []).filter((extension) => extension.profileId === profileId);
}

/**
 * Returns one extension of a profile, or undefined.
 */
export function findExtension(state: BrowserState, profileId: ProfileId, extensionId: string): InstalledExtension | undefined {
  return (state.extensions ?? []).find((extension) => extension.profileId === profileId && extension.id === extensionId);
}

/**
 * Adds an extension to its profile, or replaces the one with the same id there (a newer version, another folder).
 * Returns the same state when the profile does not exist or already holds the most extensions allowed.
 */
export function addExtension(state: BrowserState, extension: InstalledExtension): BrowserState {
  const profileExists = state.profiles.some((profile) => profile.id === extension.profileId);
  if (!profileExists) {
    return state;
  }
  const extensions = state.extensions ?? [];
  const existingIndex = extensions.findIndex((candidate) => candidate.profileId === extension.profileId && candidate.id === extension.id);
  if (existingIndex === -1) {
    if (getProfileExtensions(state, extension.profileId).length >= MAX_EXTENSIONS_PER_PROFILE) {
      return state;
    }
    return { ...state, extensions: [...extensions, extension] };
  }
  const updated = [...extensions];
  updated[existingIndex] = extension;
  return { ...state, extensions: updated };
}

/**
 * Turns an extension on or off. Returns the same state when nothing changes.
 */
export function setExtensionEnabled(state: BrowserState, profileId: ProfileId, extensionId: string, isEnabled: boolean): BrowserState {
  const extension = findExtension(state, profileId, extensionId);
  if (extension === undefined || extension.isEnabled === isEnabled) {
    return state;
  }
  return addExtension(state, { ...extension, isEnabled: isEnabled });
}

/**
 * Points every profile's copy of an updated Web Store extension at its new folder and version. Unpacked extensions
 * are never changed. Returns the same state when no extension has that id.
 */
export function updateExtensionFolder(state: BrowserState, extensionId: string, name: string, version: string, folder: string): BrowserState {
  const extensions = state.extensions ?? [];
  const isUpdated = (extension: InstalledExtension): boolean => extension.id === extensionId && extension.source !== "unpacked";
  if (!extensions.some(isUpdated)) {
    return state;
  }
  return { ...state, extensions: extensions.map((extension) => (isUpdated(extension) ? { ...extension, name: name, version: version, path: folder } : extension)) };
}

/**
 * Removes an extension from a profile. Returns the same state when it is not there.
 */
export function removeExtension(state: BrowserState, profileId: ProfileId, extensionId: string): BrowserState {
  if (findExtension(state, profileId, extensionId) === undefined) {
    return state;
  }
  const remaining = (state.extensions ?? []).filter((extension) => !(extension.profileId === profileId && extension.id === extensionId));
  return { ...state, extensions: remaining };
}
