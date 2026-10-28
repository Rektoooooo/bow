# Sync between your Macs

Library › Settings › Sync › **Choose Folder…** syncs a setup between Macs without an account or a server. Pick a
folder every Mac can reach (iCloud Drive, Dropbox, a shared drive); Bow makes a `Bow Sync` folder inside it and keeps
**one file per Mac** there, named after that Mac's random id. Each Mac writes only its own file and reads the others.

## What syncs

| Syncs | Stays on each Mac |
| --- | --- |
| Spaces (name, icon, theme, profile) and their order | Today tabs and the Archive |
| Pinned tabs, folders and split views (address, names, home address) | Where a tab has browsed to since it was pinned |
| Favorites and profile names | Windows, sidebar width, which folders are open |
| Notes and Easels that pinned tabs or Favorites show | Extensions, site permissions, settings |
| Boosts (JavaScript arrives switched off) and Air Traffic Control rules | A live folder's items (each Mac fills them from the source) |

## How changes merge

The setup is cut into small units: a tab, a folder, a split view, a Space's name and look, a Space's Pinned order, the
Space order, a profile's Favorites, a Boost, the rules, a Note, an Easel. Each Mac records a fingerprint of every unit
and when it last changed there (`src/main/sync.ts`). When another Mac's file changes:

- A unit changed later on the other Mac takes its version. Units this Mac doesn't have are added.
- A deletion wins over an older edit or one made at the same moment; an edit made after a deletion brings the unit
  back.
- Changes on two Macs less than 3 seconds apart may be ordered wrongly by clocks that differ: the Library counts them
  as conflicts. Both Macs still decide them the same way (the later time, then the larger fingerprint), so they always
  end up alike.
- A Note changed on both Macs keeps the losing Mac's text as a copy next to it, named "… (before <Mac>'s change)",
  and that copy syncs too: no text is lost.
- Renaming a tab on one Mac and pinning a page on the other keeps both: they are different units.

Joining a folder where other Macs already sync asks first and keeps a **Before Sync** copy of this Mac's setup in
Bow's Backups folder (`docs/backup-format.md`). Where the two setups differ, the folder's wins; Spaces and tabs only
the joining Mac has are added for the others. **Stop Syncing** leaves this Mac's setup and its last file as they are.

## The file

```json
{
  "format": "bow-sync",
  "formatVersion": 1,
  "deviceId": "<random id>",
  "deviceName": "<the Mac's network name>",
  "writtenAt": 1793190000000,
  "state": { "version": 4, "items": { … }, "spaces": [ … ], … },
  "stamps": { "item:<id>": { "hash": "<fingerprint>", "updatedAt": 1793190000000 }, … },
  "tombstones": { "item:<id>": 1793190000000 },
  "notes": { "<note id>": "<HTML>" },
  "easels": { "<easel id>": "<board JSON>" }
}
```

`state` is the synced part of Bow's state (same shape as in a backup, without Today tabs, the Archive and windows).
Another Mac's file is checked like a restored backup: only web, note and easel addresses get in, references must
exist, and a file from a newer Bow is not read until this one is updated. Deletions are remembered for 30 days.

A Mac's id is chosen at random and kept in `Sync.json` in Bow's own folder, with a fingerprint of the Mac's hardware
id (the start of its SHA-256). Migration Assistant copies that file to a new Mac; there the fingerprint differs, so
the new Mac takes its own id and joins the folder like any new Mac (its setup came from the old one anyway).

Bow writes its file two seconds after a synced change, reads the folder when macOS reports a change, and also every
minute (network drives often don't report changes). A folder that does not answer within 10 seconds is shown as a
problem in the Library instead of freezing the window.
