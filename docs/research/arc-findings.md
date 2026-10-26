# Arc findings

Everything learned about Arc while mapping it, in one place. The visual version with the full feature table
is [`../arc-teardown.html`](../arc-teardown.html); this file is the text version for people and agents.

**Target:** Arc 1.170.0 (build 89123) for macOS, installed at `/Applications/Arc.app`.
**Method:** read-only inspection only. Bundle listing, `Info.plist`, `Arc.sdef`, bundled JSON/JS files, `strings`,
and the Swift reflection metadata (`__swift5_reflstr`) of the arm64 slice, plus REA's
`inspect-desktop-application`. **No decompilation finished** (see [Still unknown](#5-still-unknown-needs-a-disassembler)).
**Runtime evidence (2026-10-26):** the files Arc writes for a real user (shapes and timings only, see
[arc-data-model.md](arc-data-model.md)) and Arc's public help center.

Status words used below: **Observed** = seen in the shipped files. **Inferred** = our reading of what was seen.
**Unknown** = needs decompilation or runtime observation.

## 1. How Arc is built

| Layer | Evidence | What it is |
|---|---|---|
| Feature modules | 48 `Resources/ARC_*.bundle` | One Swift package per feature (CommandBar, LittleBrowser, EaselUI, BoostsEditor, …) |
| Design system / clients | `ARCUI_ARCUI`, `ARCClients_*`, `ARCFoundation_*` | Shared UI, icons, fonts, service clients |
| App shell | Source paths `Browser/Application`, `Browser/Windows`, `Browser/WindowContent`, `Browser/Sidebar`, `Browser/CommandBar`, `Browser/DataStore`, `Browser/PictureInPicture` | AppKit/SwiftUI windows, sidebar, web content card, app state |
| ADK bridge | `ADK_ADK.bundle`, symbols `ADK`, `ADKClientLive` | Swift API over Chromium (likely "Arc Development Kit", **Inferred**) |
| Engine | `Frameworks/ArcCore.framework` (591 MB, `.pak` files, `DevTools`, `app_mode-Info.plist`) | A Chromium build |

- Main executable: 166 MB universal Mach-O (x86_64 + arm64). The arm64 slice is 76 MB,
  SHA-256 `77be289e16a139056dd9d0bf145ad4707d4e217289bb279a333949dcfd39c52d`. Only 862 defined symbols (stripped),
  so decompiled functions will mostly be unnamed. Swift type/field names survive in reflection metadata.
- Bundle id `company.thebrowser.Browser`, minimum macOS 13.0.
- Other frameworks: Sparkle (updates), Sentry, Lottie, FirebaseFirestoreInternal, gRPC/abseil/openssl_grpc.
- Resource bundles name more dependencies: Firebase Auth/Core/Firestore, LaunchDarkly (feature flags), Datadog,
  SDWebImage, YouTubePlayerKit, ZIPFoundation, swift-crypto, DomainParser, leveldb, nanopb.
- The reducer/State/Action/`*ClientKey`/`LiveValue` naming throughout matches Point-Free's Composable Architecture
  and swift-dependencies (**Inferred**).

### All 48 feature bundles

AboutWindow, AdBlocking, AppTray, ArcMenu, ArcRichTextEditor, AskArc, AuthFeature, BaseHomeComponents, BoostsDialog,
BoostsEditor, Capture, CommandBar, ContentPanel, ContextMenus, CustomInfoPicker, DeleteAccountFeature, EaselUI, Emojis,
Favicons, GlowProgressLoadingIndicator (Metal), HomeButton, ImportFeature, ImportMenuFeature, LittleBrowser,
MediaControlsFeature, MembershipCard, PictureInPicture, PreferencesFeature, ProfilesUI, ReferralCodeFeature, SadTab,
SharableObjectsFeature, SidebarBanner, SidebarPlusButton, SidebarSyncCloudKit, SiteControlCenter,
SoftwareUpdaterClient, SoundEffects, SpaceCreation, SpaceStyleEditor, StorableSidebar, TextEditor, TopDomains,
Translation, URLInputter, WebContentBehaviorConfigurationClient, WelcomeToArcFeature, WindowThemeUI (Metal).

### Notable bundled files (Observed)

| File | What it tells us |
|---|---|
| `web_content_behavior.json` | `keepaliveAllowList` (21 URL regexes: Slack, Gmail, Google Calendar, Notion, Spotify, WhatsApp, Figma, Google Docs, Outlook, …), `pipDisallowList` (3), `pipSiteConfigs` (5), `tidyTitles` (rules for 24 domains) |
| `command_bar_behavior.json` | `dedupByTitleAndHostList` (10 entries) |
| `TopDomains.json`, `TLD-short-list.json`, `popularDomains.json` | URL autocomplete data |
| `ADK_ADK.bundle/adblock_list.json`, `selectors.css` | Built-in ad blocking: network list + cosmetic selectors |
| `ARC_BoostsEditor/SelectorPicker.js` | "Zap": builds a selector from tag, id, classes and child index |
| `ARC_EaselUI/DisableInlineLinks.js` | Easel helper script |
| `ARC_HomeButton/*.json` | Lottie icons for the Library: archive, screenshots, spaces, easels, downloads, boosts |
| `ARC_SpaceStyleEditor/{sun,moon,automatic}.json` | Light / dark / automatic per Space |
| `ARC_WelcomeToArcFeature/*.mp4` | Onboarding: pinning, space_swiping, new_tab, split_view |
| `Arc.sdef` + `Resources/README.md` | AppleScript: classes application, window, space, tab; commands make, select, focus, execute (JS), reload, go back/forward, stop, close |
| `Info.plist` | URL schemes http, https, mailto, `arcBrowser`; Handoff via `NSUserActivityTypeBrowsingWeb`; Dock tile plugin |

Do not copy these files, rule lists, icons, sounds, videos or shaders into this project. Use them to understand
behavior, then write our own.

## 2. Auto-archive

### Where it lives (Observed, from source paths left in the binary)

- `Frameworks/ARC/Sources/Archive/ArchiveState.swift`
- `Frameworks/ARC/Sources/Archive/ArchiveState+AutoArchive.swift`
- `Frameworks/ARC/Sources/StorableArchive/StorableArchive.swift`
- `Frameworks/ARC/Sources/SharedWindowFeature/WindowData+Archive.swift`
- `Frameworks/ARC/Sources/HomeButton/Pages/Archive/ArchiveReducer.swift`
- `Frameworks/ARC/Sources/SharedArchiveFeature/SharedArchiveFeature.swift`

### Structure (Observed, from Swift field and case names)

| Part | Names |
|---|---|
| Reducer dependencies | `_mainQueue`, `_date`, `_userDefaultsClient`, `_archiveDataStoreClient`, `_analyticsClient` |
| Auto-archive state | `autoArchiveStartTime`, `itemsToExclude`, `sidebar`, `autoArchiveLittleArcWindowsEnabled`, `perProfileAutoArchivePrefAvailable` |
| Cancellable timers | `autoArchiveTimer`, `cleanupTimer` |
| Actions | `didLaunch`, `runAutoArchive`, `autoArchiveItems`, `removeExpiredItems`, `willTerminate`, `simulateAutoArchive` (debug) |
| Archive kinds | `todayTabs`, `littleArc` |
| Threshold cases | `twentySeconds` (debug), `oneHour`, `sixHours`, `twelveHours`, `twentyFourHours`, `sevenDays`, `thirtyDays`, `never` |
| Settings fields | `autoArchiveTimeThreshold`, `autoArchiveLittleArcTimeThreshold`, `autoArchiveTimeThresholdsPerProfile`, `eligibleToSeeAutoArchiveEducationBanner`, `didSyncArchiveTime`, `didSyncLittleArcArchiveTime`, `didSyncArchiveTimesPerProfile` |
| Settings UI | `currentArchiveTabThreshold`, `currentArchiveLittleArcThreshold`, `currentArchiveProfileThresholds`, `allowNeverArchivePreference`, `allowDebugArchivePreference`, `isPerProfile`; actions `onSetAutoArchiveTabsTimeThreshold`, `…ForProfile`, `…ForAllProfiles`, `onSetAutoArchiveLittleArcTimeThreshold` |
| Activity tracking (window state) | `itemLastActiveDates`, `lastActiveTabsPerSpace`, `sidebarItemUserAttentionRequest`; timer `itemLastActiveDateUpdateTimer` → `onItemLastActiveDateUpdateTimerFired` |
| Archive store client | `items`, `subscription`, `archiveItems`, `unarchiveItems`, `clear`, `storeSnapshot`; internals `itemsMulticaster`, `storableDataStore`, `faviconCache`, `snapshotClient` (`fetchSnapshots`, `cacheSnapshot`, `removeSnapshots`) |
| Archived item | `sidebarItem`, `reason`, `archivedAt`, `source`, `version`, `items`, `spaceID_legacy`; sources `standaloneSidebar`, `unknown` |
| Reasons | `auto`, `manual`, `clearButton`, `clearTabGroup` |
| Library filters | `space`, `all`, `littleArc`, `autoArchived`, `manuallyArchived` |
| Files on disk | `StorableArchive.json`, `StorableArchiveItems.json` |
| UI / log strings | "Auto archived %d tabs", "Archiving %s: %s", "Arc will now archive your tabs after %@", "Arc will never auto-archive your tabs.", "Enter Archive inactivity threshold in seconds", "Simulate Auto-Archive", "Reset synced archive time preference" |

A separate, possibly newer feature also exists and is **Unknown**: `autoCleanInactiveTabsEnabled`,
`autoCleanInactiveTabsThreshold`, `lastCleanTabsDate`, `cleanTabsRecentlyClosedEduShown`,
### Answered from runtime evidence (2026-10-26)

Ghidra could not run (the Mac was out of swap), so the five open questions were answered from the user's own Arc
files instead: `StorableArchiveItems.json` (250 archived tabs, each with `archivedAt`, `reason`, `source` and the
tab's `timeLastActiveAt`), the preferences plist, and Arc's public help center. **Evidence** says what each answer rests on.

| Question | Answer | Evidence |
|---|---|---|
| Default threshold | **12 hours** for tabs, **6 hours** for Little Arc windows | The user never changed the setting (`autoArchiveTimeThresholdsPerProfile` = `{"thresholds":[]}`, no `autoArchiveTimeThreshold` key), and their auto-archived tabs (Little Arc excluded) were idle at least 12.000 h when archived, median 12.05 h. The two auto-archived Little Arc tabs were idle 6.02 h and 6.07 h. The help center states the same defaults. |
| Sweep interval (`autoArchiveTimer`) | **Every 5 minutes** | The 97 auto-archive batches are separated by exact multiples of 5.0 minutes, and tabs overshoot the threshold by 0–5 minutes (median ≈ 2.5–3 min). |
| Retention (`removeExpiredItems`) | **Most likely a cap of 250 items**, not a time limit | The archive held exactly 250 items, oldest first, the oldest 60.2 days old. A time limit would rarely land on a round count. Not yet confirmed by watching the count while new items arrive. |
| Launch rule | Inactivity **restarts at launch** (our rule matches) | 11 of the 16 tabs archived after much more than 12 h idle were archived 11.96 h after the last recorded activity, i.e. 12 h after Arc started, not at the first sweep after launch. |
| `autoArchiveStartTime` | **A one-time date**, not reset per launch | `StorableArchive.json` holds a date in February 2024 (when the feature started for this user), not today's launch. So the launch rule above lives in memory. |
| Last-active refresh (`itemLastActiveDateUpdateTimer`) | **Every 60 seconds, for the visible tab** | Live sampling of `StorableSidebar.json` for 7 minutes while Arc ran: only the visible tab's `timeLastActiveAt` changed, each time by +60.0 s (±0.1 s). See [Last-active refresh](#last-active-refresh). |
| `itemsToExclude` | **Unknown.** It sits in the auto-archive state next to `autoArchiveStartTime`; most likely the tabs live right now | Swift metadata only |

Our browser uses the same values: 12 h threshold, 5-minute sweep, 1-minute refresh of tabs in use, launch rule,
Little Windows after 6 h, and an archive of the newest 250 entries; see `src/shared/settings.ts`.

### Last-active refresh

Sampled on 2026-10-26: a script read the live `StorableSidebar.json` every 5 seconds while Arc was open and logged
every change to a tab's `timeLastActiveAt` (hashed ids only). Arc rewrote the file several times a minute, but only one
tab's `timeLastActiveAt` ever changed: the tab on screen, by +60.0 s each minute. Background tabs were never touched.
No tab was playing sound during the sample, so whether audible or picture-in-picture tabs also count is still open
(our browser counts them). The help center adds that viewing or clicking a tab resets its timer.

### Inferred

- `keepaliveAllowList` is web-content configuration with no archive field pointing to it. It most likely keeps
  those pages running in the background, **not** exempts them from archiving. (An earlier version of the map
  claimed the opposite; that was corrected.)
- An earlier version of this file guessed that `autoArchiveStartTime` restarts the countdown at launch. The file on
  disk shows it does not (it is a 2024 date); the launch rule exists, but is kept somewhere else.

## 3. Other features (static strings, Swift metadata, public docs)

Collected on 2026-10-26 from `strings`, `__swift5_reflstr` (via `tools/swift-reflstr.py`), the compiled
`Resources/Base.lproj/MainMenu.nib`, and the help center (resources.arc.net, read through Wayback copies from 2025).
Names only; numbers (widths, limits, intervals) are compiled constants and still need a disassembler.

### Command Bar (internally "type travel")

- **Result kinds (Observed):** navigate / search what you typed, `tab` (open tabs: "switch to tab" is a flag
  `switchToTabAllowed` per entry point), `topDomain`, `siteSearch`, `typeTravel` (app actions), `easel`, `document`,
  Chromium history, search suggestions, bookmarks, calculator answers, other engines, and Ask-GPT results.
- **Ranking (Observed field names, Inferred meaning):** a per-feature score with boosts, not one number. Features:
  URL match, title match, "hot word" match (position and percentage each), fuzzy-search confidence, visit frequency,
  typed count, most-visited rank, site engagement, global site rank, last navigated, Chromium's own relevance.
  Boosts: custom-title prefix, very recent tab, Favorite ("topApp"), recently used action. Match classes: exact base
  domain, exact URL, exact hot word, base domain. Results carry a `dedupKey`; the current tab's URL is ranked down
  (`derankCurrentItemURLEnabled`).
- **Learning (Observed):** it records `query → archetype` selections with `frequency`, so a query you keep using
  promotes the result you pick.
- **Entry points:** new tab (⌘T), address bar (⌘L), command bar, Little Arc placeholder, new split pane.
- **Actions** come from the main menu: each menu item carries an action id, title, icon, trigger words and a
  ranking bump, so the menu doubles as the action list.

### Peek

- Outcome of Arc's link-routing rules (`opensInPeek`, next to `opensNewForegroundTab`, `opensNewBackgroundTab`,
  `opensSplitView`, `opensLittleArc`, `opensNewWindow`). Rules match on URL, Space, Little Arc, profile, most recent.
- Settings: "Open a Peek window when clicking on links to other sites" (from Pinned tabs and Favorites) and
  "… with Shift held" (from any tab).
- State: `peekedPinnedSidebarItemID`, `transientPeekedItems`: a Peek is a transient item that is not saved; the
  undo manager can reopen a closed Peek.
- Help center: expand to a tab with ⌘O or the arrows button; Split button; dismiss with Esc, ⌘W, X or a click outside.

### Split View

- A sidebar item kind `splitView` with `layoutOrientation` (horizontal / vertical), `itemWidthFactors` and
  `focusItemID`; its children are ordinary tabs. It shows as one row in the sidebar.
- Operations: add left / right / top / bottom split, convert orientation, separate a tab, close the focused pane,
  unsplit. Errors include `splitViewMaximumPanesExceeded`; the shortcuts page says up to 4 panes.

### Little Arc

- Separate window kind (`littleBrowserWindow`). Opens for links from other apps (setting "Links from other apps open
  in Little Arc"), with ⌥⌘N or a global hotkey, and by ⌥⌘-click. A Move button sends it into a Space (⌘O: most
  recent Space). Its own archive threshold (default 6 h) and archive source `littleArc`.

### Favorites, Pinned, folders

- Favorites are "top apps" internally, one container per profile (see `arc-data-model.md`). Maximum 12.
- Pinned tabs keep a saved URL; "Reset Tab to Original URL" goes back to it. Links that leave a Pinned tab's page
  open in Peek.
- Folders are `list` items; they nest. A GitHub "live folder" fills itself with pull requests.

### Sidebar and windows

- Sidebar modes (Observed): `anchored`, `floating`, `hidden`, `locked`, `noChrome`; fields `sidebarWidth`,
  `isSidebarHovered`, `floatingSidebarOuterLeftEdgeHoverState` (hover the left edge to reveal it when hidden).
- Sections: pinned footer, unpinned header, New Tab button, Space switcher, `plusButton` menu, setting
  `collapseBottomBar`. Library tabs: Archive, Spaces, Media, Easels & Notes, Downloads, Boosts.
- The user's own setup runs with the toolbar above the page (`topBarURLEnabled`).

### Site Control Center

- Buttons: share / copy link, Boost, capture, screenshot. Rows: Block ads & trackers (with per-site exception),
  Clear cookies and refresh, Never translate this site, Developer Mode, Sidebar Preview, Content Blocking,
  Picture-in-Picture, Extensions with pin buttons, All Site Settings. Permission kinds: camera, microphone,
  location, notifications, images, JavaScript, sound.

### Main menu titles (from `MainMenu.nib`)

Tabs: New Tab, Pin/Unpin Tab, Archive Tab, Clear Unpinned Tabs, Restore Last Closed Tab, Reset Tab to Original URL,
Reset all tabs in this Space, Cycle Tab Forward/Backward, Tab Switcher, Reveal Tab in Sidebar, Duplicate, Rename.
Spaces: New Space, Rename Space, Manage Spaces, Next/Previous Space, Edit Theme. Sidebar: Show/Hide Sidebar,
Show/Hide Toolbar, New Folder, Collapse/Expand All Folders, Collapse/Expand Pinned Section. Windows: New Window,
New Little Arc Window, New Incognito Window, Blank Window. Split: Add Split View, Close this Split Pane, Separate Page
from Split View, Expand Current Split. Copy: Copy URL, Copy URL as Markdown, Copy URL as Quote, Capture, Capture Full
Page. Library: View Library, Archive, Downloads, History, Boosts, Media, Easels & Notes. Developer: Task Manager,
Network Inspector.

## 4. Keyboard shortcuts

From the help center's shortcuts page (macOS). Users can remap them in Settings › Shortcuts; key bindings are
attached to menu items at runtime (`arcKeyBindingID`), which is why the nib has no key equivalents.

| Action | Keys |
|---|---|
| New tab (Command Bar) | ⌘T |
| Edit current URL | ⌘L |
| Close tab | ⌘W |
| Reopen closed tab | ⇧⌘T |
| Pin / unpin | ⌘D |
| Copy URL / as Markdown | ⇧⌘C / ⌥⇧⌘C |
| Toggle sidebar | ⌘S |
| Back / forward | ⌘[ / ⌘] or ⌘← / ⌘→ |
| Reload / stop | ⌘R / ⌘. |
| Next / previous tab | ⌥⌘↓ / ⌥⌘↑ |
| Next / previous Space | ⌥⌘→ / ⌥⌘← |
| Space N | ⌃1 … ⌃9 |
| Tab N | ⌘1 … ⌘9 |
| Recent tab | ⌃Tab |
| Split view: add / close / focus pane N | ⌃⇧= / ⌃⇧- / ⌃⇧1…4 |
| Little Arc | ⌥⌘N |
| Peek: expand / dismiss | ⌘O / Esc |
| Library / Downloads / History | ⇧⌘L / ⇧⌘J / ⌘Y |
| Find | ⌘F |
| New window / incognito | ⌘N / ⇧⌘N |
| Zoom in / out / reset | ⌘+ / ⌘- / ⌘0 |
| Clear unpinned tabs | ⇧⌘K |

## 5. Still unknown (needs a disassembler)

1. All numeric constants: sidebar width limits, maximum Split View panes, the last-active refresh timer.
2. `itemsToExclude`.
3. How Command Bar features are weighted against each other.
4. Sidebar sync merge (CloudKit + Firestore), Easel live captures, `ARCClients_BlockListClient`, sharing rules.

How to run that pass: [reverse-engineering-setup.md](reverse-engineering-setup.md#rerunning-the-ghidra-pass).

## 6. Arc data on this Mac

This Mac has two macOS accounts. The account where this research started has no Arc data. The other
account is the one that uses Arc: Spaces, Favorites, pinned tabs, folders and the archive are in
`~/Library/Application Support/Arc/`. Its shape is written up in [arc-data-model.md](arc-data-model.md).

A full copy (1 GB: sidebar, archive, caches, Chromium profiles, and the preferences plist) was made on 2026-10-26
to `~/Arc-Backup-2026-10-26/` on that account. It is personal data and is **not** in this repository.
