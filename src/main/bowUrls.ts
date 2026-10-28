/**
 * WHY this file exists:
 *   bow:// addresses let other apps drive Bow: Raycast's script commands (integrations/raycast), Alfred, Shortcuts or a
 *   Terminal `open "bow://…"`. Each address names one harmless thing to do: open an address (in a Space), switch
 *   Spaces, search the open tabs, open the Command Bar with text, or a Little Window. Nothing that closes, deletes or
 *   reads anything: any app, or a link on a web page (Bow asks first for those), can open a bow:// address.
 *
 * Data source:
 *   The bow:// address macOS hands over (main.ts open-url), and the state's Spaces (findSpaceByNameOrNumber).
 *
 * Data flow:
 *   open-url "bow://…" → parseBowUrl() → bowUrlController.ts runs the command
 *
 * Rules: pure.
 *   bow://open?url=<address or words>&space=<Space name or number>
 *   bow://space?name=<Space name or number>
 *   bow://search-tabs?q=<words>
 *   bow://command-bar?q=<text>
 *   bow://little?url=<address>
 */
import type { BrowserState, Space } from "../shared/types";

/** One thing a bow:// address asks for. */
export type BowCommand =
  | { kind: "open"; text: string; spaceName: string | null }
  | { kind: "switchSpace"; spaceName: string }
  | { kind: "searchTabs"; query: string }
  | { kind: "commandBar"; text: string }
  | { kind: "little"; text: string | null };

/** Longest text a parameter may carry. Our choice: a long address fits; more is refused. */
const MAX_PARAMETER_LENGTH = 4096;

/**
 * A parameter's text, trimmed; "" when missing; null when too long.
 */
function readParameter(url: URL, name: string): string | null {
  const value = (url.searchParams.get(name) ?? "").trim();
  return value.length > MAX_PARAMETER_LENGTH ? null : value;
}

/**
 * What a bow:// address asks for, or null for anything else (another scheme, an unknown command, a missing or too
 * long parameter).
 * Example: "bow://open?url=github.com&space=Work" → { kind: "open", text: "github.com", spaceName: "Work" }
 */
export function parseBowUrl(text: string): BowCommand | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "bow:") {
    return null;
  }
  // "bow://open?…" puts the command in the host; "bow:open?…" in the path.
  const command = (url.hostname || url.pathname.replace(/^\/+/, "")).toLowerCase();
  if (command === "open") {
    const address = readParameter(url, "url");
    const space = readParameter(url, "space");
    return address === null || address === "" || space === null ? null : { kind: "open", text: address, spaceName: space === "" ? null : space };
  }
  if (command === "space") {
    const name = readParameter(url, "name");
    return name === null || name === "" ? null : { kind: "switchSpace", spaceName: name };
  }
  if (command === "search-tabs") {
    const query = readParameter(url, "q");
    return query === null ? null : { kind: "searchTabs", query: query };
  }
  if (command === "command-bar") {
    const query = readParameter(url, "q");
    return query === null ? null : { kind: "commandBar", text: query };
  }
  if (command === "little") {
    const address = readParameter(url, "url");
    return address === null ? null : { kind: "little", text: address === "" ? null : address };
  }
  return null;
}

/**
 * The Space a name or number means: an exact name (any letter case), else the first whose name starts with it, else
 * the Nth Space for a number ("2"). Null when none.
 * Example: Spaces "Personal", "Work" → "work" → Work; "2" → Work; "pers" → Personal
 */
export function findSpaceByNameOrNumber(state: BrowserState, nameOrNumber: string): Space | null {
  const wanted = nameOrNumber.trim().toLowerCase();
  const exact = state.spaces.find((space) => space.name.toLowerCase() === wanted);
  if (exact !== undefined) {
    return exact;
  }
  const prefix = state.spaces.find((space) => space.name.toLowerCase().startsWith(wanted));
  if (prefix !== undefined && wanted !== "") {
    return prefix;
  }
  const isNumber = /^[0-9]{1,2}$/.test(wanted);
  return isNumber ? (state.spaces[Number(wanted) - 1] ?? null) : null;
}
