# Arc findings

Everything learned about Arc while mapping it, in one place. The visual version with the full feature table
is [`../arc-teardown.html`](../arc-teardown.html); this file is the text version for people and agents.

**Target:** Arc 1.170.0 (build 89123) for macOS, installed at `/Applications/Arc.app`.
**Method:** read-only inspection only. Bundle listing, `Info.plist`, `Arc.sdef`, bundled JSON/JS files, `strings`,
and the Swift reflection metadata (`__swift5_reflstr`) of the arm64 slice, plus REA's
`inspect-desktop-application`. **No decompilation finished** (see [Open questions](#open-questions)).

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
`cleanTabsInactivityThresholdChanged`, flags `autoCleanTabs` and `autoCleanInactiveTabs`.

### Inferred

- `autoArchiveStartTime` beside `didLaunch` most likely restarts the countdown at launch, so a Mac that was off
  for a week does not empty the sidebar. Our browser implements this rule.
- `keepaliveAllowList` is web-content configuration with no archive field pointing to it. It most likely keeps
  those pages running in the background, **not** exempts them from archiving. (An earlier version of the map
  claimed the opposite; that was corrected.)

### Unknown (needs Ghidra)

1. How often `autoArchiveTimer`, `cleanupTimer` and `itemLastActiveDateUpdateTimer` fire.
2. What goes into `itemsToExclude`.
3. Which tabs get their last-active date refreshed (selected only? visible in split view? audible? PiP?).
4. How long archived items are kept before `removeExpiredItems` deletes them.
5. The default threshold for new installs.

Where to start: cross-references to the strings "Auto archived %d tabs" and "Archiving %s: %s", and to the
source-path string `ArchiveState+AutoArchive.swift` (used by assertions/logging in that file). REA also offers
`analyze_swift_types` and `demangle_swift`, which may name the closures. How to run that pass:
[reverse-engineering-setup.md](reverse-engineering-setup.md#rerunning-the-ghidra-pass).

## 3. Other features that need decompilation

Marked **Binary** in the feature map, ranked by how much each shapes the feel of Arc:

1. Command Bar ranking: source weights and duplicate rules (`command_bar_behavior.json` gives only the dedup list).
2. Peek triggers: which tabs and links open a Peek, which modifiers.
3. Sidebar sync merge: how concurrent edits combine (CloudKit + Firestore).
4. Easel live captures: how captured regions refresh.
5. `ARCClients_BlockListClient`: purpose not visible from the bundle.
6. Sharing (`ARC_SharableObjectsFeature` + Firestore): access rules.

## 4. Arc data on this Mac

This macOS account has no Arc sidebar data: `~/Library/Application Support/Arc/` holds only
`User Data/NativeMessagingHosts`, and the app was installed from another account. Spaces, pinned tabs and folders
live in `~/Library/Application Support/Arc/StorableSidebar.json` on the account where Arc is actually used.
Back it up before Arc stops working; it is also the best reference for the sidebar data model.
