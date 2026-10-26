# Arc's data model on disk

How Arc 1.170.0 stores the sidebar and the archive, read from a real user's files on 2026-10-26 (shapes only;
no titles, URLs or ids from that data appear here). Item kinds that the user's files did not contain come from the
Swift reflection metadata of the binary and are marked **(binary)**.

Use this to understand behavior and to write the "Import from Arc" reader. Do not copy Arc's code or assets.

## Files

All in `~/Library/Application Support/Arc/` of the macOS account that uses Arc.

| File | What it holds |
|---|---|
| `StorableSidebar.json` | Spaces, Favorites, Pinned and Today items, folders, Space themes. Arc rewrites it on every sidebar change. |
| `StorableSidebar.<date>.json` | Copies kept from earlier app versions (one per update). |
| `StorableArchiveItems.json` | The Archive: tabs that left the sidebar, with reason and source. |
| `StorableArchive.json` | `{ "version": 1, "autoArchiveStartTime": <seconds> }` |
| `SidebarItemsFaviconCache/`, `ArchiveItemsFaviconCache/`, `ArchiveSnapshotCache/` | Favicons (16×16 PNG files named `md5(<item id>)` in lowercase hex; checked: 23 of 26 tabs matched) and page snapshots |
| `User Data/` | The Chromium profiles (history, cookies, logins); one folder per Arc profile |
| `~/Library/Preferences/company.thebrowser.Browser.plist` | App settings (`defaults read company.thebrowser.Browser`) |

## Encoding rules

1. **Timestamps** are seconds since 2001-01-01 UTC (Apple's reference date). Add `978307200` for Unix seconds.
2. **Ordered dictionaries are flat arrays of pairs**: `[key1, value1, key2, value2, …]`. This is how Swift encodes a
   dictionary whose keys are not strings, and Arc uses it for `items`, `spaces`, `containerIDs` and
   `topAppsContainerIDs`. Read it as `zip(array[0::2], array[1::2])`.
3. **Swift enums with payloads** become one-key objects: `{"tab": {...}}`, `{"custom": {"_0": {...}}}`,
   `{"default": true}`. The key is the case name; `_0` is the first unnamed payload.
4. **Ids** are UUID strings, except a few built-in objects (the first Space and its containers) whose ids are other strings.

## `StorableSidebar.json`

```text
{
  "version": 1,
  "sidebar": {
    "containers": [
      { "global": {} },                          // placeholder
      {
        "spaces":              [spaceId, Space, …],
        "items":               [itemId, Item, …],
        "topAppsContainerIDs": [ProfileKey, containerItemId, …]
      }
    ]
  },
  "sidebarSyncState":  { … older copy for CloudKit sync … },
  "firebaseSyncState": { … older copy for Firebase sync … }
}
```

The live data is `sidebar.containers[1]`. The two sync states hold older copies plus sync bookkeeping
(`encodedCKRecordFields`, `lastChangeDate`, `lastChangedDevice`); an importer should ignore them.

### Space

| Field | Meaning |
|---|---|
| `id`, `title` | Space id and name |
| `containerIDs` | Pairs: `["unpinned", <container item id>, "pinned", <container item id>]` |
| `newContainerIDs` | The same containers, keyed by enum objects: `{"unpinned": {"_0": {"shared": {}}}}`, `{"pinned": {}}` |
| `profile` | `{"default": true}` or `{"custom": {"_0": {"directoryBasename": "Profile 1", "machineID": <uuid>}}}`; the Chromium profile folder in `User Data/` |
| `customInfo.iconType` | `{"icon": "<name>"}` for a built-in icon (planet, star, leaf, …); **(binary)** also `emoji` and `symbol` cases. Missing = default icon |
| `customInfo.windowTheme` | The Space theme (below). Missing = default theme |

### Item

Every sidebar object is an item in one flat `items` list, linked both ways (`parentID` and `childrenIds`).

| Field | Meaning |
|---|---|
| `id` | Item id |
| `parentID` | The parent item (a container, folder or split view); `null` for top-level containers |
| `childrenIds` | Ordered children. Order in the sidebar = order here |
| `title` | **The user's rename.** `null` unless the user renamed the item |
| `isUnread` | A pinned tab that changed in the background (the unread dot) |
| `createdAt` | Creation time |
| `originatingDevice` | Device id |
| `data` | One-key enum: the item kind (below) |

Item kinds (`data` keys):

| Kind | Payload | Notes |
|---|---|---|
| `tab` | `savedURL`, `savedTitle`, `timeLastActiveAt`, `savedMuteStatus` (`allowAudio` / `mute`), `activeTabBeforeCreationID`, `referrerID` | `savedTitle` is the page title; `savedURL` is the pinned "home" URL for Pinned and Favorite tabs. **(binary)** also `savedFavicon`, `liveItemID`, `tabType` |
| `list` | `{}`; optional `customInfo.iconType`, `automaticLiveFolderData` | **A folder.** With `automaticLiveFolderData` it is a *live folder* filled from a data source (`{"github": {…}}`: pull requests), with `lastFetch` status and `hiddenItems` |
| `itemContainer` | `containerType`: `{"spaceItems": {"_0": spaceId}}` or `{"topApps": {"_0": ProfileKey}}` | The roots: each Space has a pinned and an unpinned container, each profile has one Favorites ("top apps") container |
| `splitView` **(binary)** | `layoutOrientation` (`horizontal` / `vertical`), `itemWidthFactors`, `focusItemID` | Children are ordinary tab items |
| `easel`, `arcDocument`, `tabGroup`, `sharedObject`, `instantLinks`, `archiveContent`, `download`, `arcSearch`, `welcomeToArc` **(binary)** | — | Not in the user's data |

### How the sidebar is assembled

```text
Favorites (per profile) = items[topAppsContainerIDs[profile]].childrenIds
For each Space in `spaces` order:
  Pinned = items[space.containerIDs["pinned"]].childrenIds      (tabs, folders, split views; folders nest)
  Today  = items[space.containerIDs["unpinned"]].childrenIds
```

- **Favorites belong to a profile, not a Space.** Every Space that uses the same profile shows the same Favorites.
  Arc's help center gives a maximum of 12.
- Space order also lives in `sidebarSyncState.container.value.orderedSpaceIDs`; the order of `spaces` matched it.

### Space theme (`windowTheme`)

```text
background.single._0:
  style.color._0: one of
    blendedSingleColor._0: { color: RGBA, modifiers, translucencyStyle }
    blendedGradient._0:    { baseColors: [RGBA…], overlayColors: [RGBA…], wheel: {analogous|complimentary…},
                             modifiers, translucencyStyle }
    basicColor (binary)
  modifiers: { intensityFactor 0…1, noiseFactor 0…1, overlay: "grain" (binary: sand, denim, tweed) }
  isVibrant: bool
  contentOverBackgroundAppearance: "light" | "dark"
primaryColorPalette:  { tintedLight, midTone, shaded, shadedDark }            (RGBA each)
semanticColorPalette.appearanceBased.{light,dark}:
  { background, backgroundExtra, cutoutColor, focus, foregroundPrimary, foregroundSecondary, foregroundTertiary, … }
```

RGBA = `{ red, green, blue, alpha, colorSpace: "extendedSRGB" }`, channels 0…1. The style editor in the binary has
`keyColor`, `numberOfComplimentaryColors`, `saturation`, `lightnessRange` and `appearance` (`light` / `dark` / `auto`):
a theme is one to three key colors on a color wheel plus intensity and grain sliders.

An importer only needs the base color(s) and whether the content is light or dark; the palettes are derived.

## `StorableArchiveItems.json`

```text
{ "version": 1, "items": [itemId, ArchivedItem, …] }       // oldest first
ArchivedItem = {
  archivedAt,
  reason: "auto" | "manual"              (binary: also "clearButton", "clearTabGroup")
  source: {"space": {"_0": spaceId}} | {"littleArc": {}} | {"unknown": {}}
  sidebarItem: Item                      (parentID and title are null; data is a tab)
}
```

The user's archive held **exactly 250 items** (the oldest 60 days old), see `arc-findings.md` §2.

## Settings worth knowing (`company.thebrowser.Browser.plist`)

`autoArchiveTimeThresholdsPerProfile` (JSON string `{"thresholds":[…]}`; empty = default), `topBarURLEnabled`
(the toolbar above the page), `toolbarShowFullURLsEnabledPreference`, `tidyTabsEnabled`, `recentTabIndicatorEnabled`,
`instantLinksEnabled`, `LittleBrowserWindow_size`, `LastPiPPosition`, `autoPipDisabledForHosts`, `currentAppIconName`,
`arc_quitAlwaysKeepsWindows`.
