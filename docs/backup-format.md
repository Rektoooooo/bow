# Bow backup format

A Bow backup (`File › Export Bow Backup…`, extension `.bowbackup`) is a JSON file you can read without Bow. Bow's own
copies (the one it keeps before a restore, and the automatic hourly snapshots) use the same format and live in
`~/Library/Application Support/Bow/Backups/`: "Snapshot <date> <time>.bowbackup" every hour while something changes
(the newest 12, then one a day for 7 days) and "Before Restore <date> <time>.bowbackup" (the newest 5).

```json
{
  "format": "bow-backup",
  "formatVersion": 1,
  "createdAt": "2026-10-28T11:35:32.000Z",
  "appVersion": "0.1.0",
  "state": { "version": 4, "items": { … }, "profiles": [ … ], "spaces": [ … ], … },
  "notes": { "<note id>": "<the note's HTML>" },
  "easels": { "<easel id>": "<the board as JSON text>" }
}
```

## `state`

Bow's saved state (`src/shared/types.ts`, `BrowserState`), in the version it had when the backup was made; newer Bows
upgrade older versions. The parts that matter for reading it by hand:

- `items`: every sidebar item by id. A **tab** has `url`, `title`, an optional `customTitle` (your rename) and a
  `homeUrl` (the address a pinned tab or Favorite goes back to). A **folder** has a `title` and `childIds`; a live
  folder also has `live.source` (GitHub list or feed address). A **split view** has `childIds` (its panes) and an
  `orientation`.
- `spaces`: in switcher order. Each has `name`, `icon`, `theme` (colors, light/dark/auto, grain), `profileId`,
  `pinnedIds` and `todayIds` (ids into `items`, in sidebar order).
- `profiles`: each with `favoriteIds` (the Favorites tiles, ids into `items`).
- `archive`: archived tabs, newest first, with when and why they were archived.
- `settings`, `boosts` (per-site styles and scripts), `routingRules` (Air Traffic Control), `sitePermissions`,
  `developerModeSites`, `adBlockOffSites`.

Order lives only in these id lists: an item's place is the list that holds its id.

## What a backup leaves out

Things that only mean something on the Mac that made it:

- other windows' places and choices (`otherWindows` is empty);
- installed extensions' files: `extensions` lists them by name with an empty `path`, so a restore can tell you what to
  install again;
- pictures in the Library (screenshots and captures) and browsing history.

## Restoring

Restoring treats the file as untrusted, whoever made it:

- only `http:`, `https:`, note, easel and `about:blank` addresses survive; anything else is left out;
- ids must point at real items; an item in two lists, a folder inside itself or a missing child is left out;
- JavaScript Boosts arrive switched off (their code stays, and runs again once you turn it on);
- Air Traffic Control rules and permission answers must point at a Space and profile in the backup.

**Replace My Setup** puts the backup in place of your Spaces and tabs; Bow first keeps a copy of the current setup in
its Backups folder. Your open windows, the sidebar new windows start with and your installed extensions stay.
**Add Its Spaces** puts the backup's Spaces next to yours under new ids (Notes and Easels too); its Favorites join
their profile up to the limit of 12, without repeating an address; Boosts join for sites without one.
