# Sidebar Browser — to-do

## Done

- [x] Map Arc's bundle, features and architecture (`docs/arc-teardown.html`, `docs/research/arc-findings.md`)
- [x] Choose a build path: Electron + TypeScript
- [x] Node 24 + REA 6.8.0 installed and registered with Claude Code (other macOS account)
- [x] Ghidra 12.1.4 + JDK 21 installed, Apple Silicon decompiler built, connected to REA, test decompile OK (other macOS account)
- [x] Auto-archive design mapped from Arc's Swift metadata
- [x] Milestone 1: sidebar, Spaces, pinned/today tabs, inset card, Archive, auto-archive, saving, permission lockdown
- [x] Tests: 20 unit, 23 end-to-end + permission check
- [x] Public repo: https://github.com/Rektoooooo/bow
- [x] 2026-10-26: Arc data backed up to `~/Arc-Backup-2026-10-26` (Application Support/Arc + preferences plist; not in the repo)

## Milestone 2 — "as close to Arc as we can" (started 2026-10-26)

Goal: the user's Arc setup (screenshots in `reference/arc-ui/`, git-ignored) should feel at home in this browser,
and every Arc behavior we can observe is written down before Arc shuts down.

### 2.1 Research without Ghidra (Ghidra is blocked: swap is full)
- [x] Arc's data model from the user's own `StorableSidebar.json` (shape only, no personal values)
- [x] Auto-archive answers from `StorableArchiveItems.json`: sweep every 5 min, default 12 h, Little Arc 6 h,
      archive holds 250 items, `autoArchiveStartTime` is a one-time date (not reset per launch)
- [x] Last-active refresh cadence: every 60 s for the visible tab (sampled the live sidebar file)
- [x] Public docs: shortcuts and behavior specs (Peek, Split View, Favorites, Little Arc, Library, …)
- [x] Static strings / Swift metadata pass on the other features (Command Bar, Peek, Split View, themes, menus)
- [x] Write it up: `docs/research/arc-findings.md`, new `docs/research/arc-data-model.md`
- [ ] Teardown page (`docs/arc-teardown.html`): auto-archive answers + new feature notes

### 2.2 Data model v2 (foundation)
- [x] Items tree like Arc's: tab / folder / split items, ordered child id lists, Spaces with pinned + today lists
- [x] Profiles (own cookie jar via session partitions) with Favorites per profile (max 12, like Arc)
- [x] Migration v1 → v2, tested; runtime-only state (loading, audible, can go back) kept out of the saved file

### 2.3 Arc-style window
- [x] Sidebar: traffic lights + sidebar toggle, Favorites grid, Space title, Pinned tree with folders,
      divider with Clear, "+ New Tab", Today list, bottom bar (Library, Space icons, + menu)
- [x] Top toolbar like the user's Arc (`topBarURLEnabled`): back / forward / reload, domain, site controls
- [x] Real favicons, loading state, audio indicator + mute, pinned "navigated away" slash + reset
- [x] Per-Space themes (color, gradient, grain), light / dark / auto

### 2.4 Overlay layer
- [x] Transparent overlay view above the page for: Command Bar (⌘T new tab, ⌘L edit URL; tabs, history,
      suggestions, actions), Find in page, Library (archive with filters + search, downloads), Site controls

### 2.5 Browser basics
- [x] App menu with Arc's shortcuts (table in `docs/research/arc-findings.md`), Edit roles for copy/paste
- [x] Context menus: tab, folder, page (open link in new tab, copy link, inspect, …)
- [x] Links: target=_blank → new tab; real popup windows for sign-in flows; downloads
- [x] History store (bounded) for the Command Bar

### 2.6 Arc features
- [x] Spaces: create (then name it inline) / rename / icon / theme / delete, swipe and ⌃1–9 to switch
- [x] Peek for links from Favorites and Pinned tabs to other sites, and Shift-click (⌘O tab, Split, Esc / ⌘W close)
- [x] Split View (up to 4 panes)
- [x] Hide sidebar (⌘S), hover the left edge to reveal it (the page slides aside, no reflow)
- [x] Little Arc-style small window (⌥⌘N, links from other apps), archives after 6 h
- [x] Import from Arc: Spaces, Favorites, Pinned folders/tabs, Today tabs, themes, cached favicons (File › Import from Arc…)

- [x] Media: sidebar player for a tab playing in the background; automatic picture-in-picture when leaving a playing
      video (our own floating window since 2026-10-27)
- [x] Import Arc's archive (250 tabs) and browsing history (Chromium History via sqlite3)

- [x] Profiles UI (Space menu › Profile), private windows (⇧⌘N), resizable sidebar, unread dot, window bounds remembered

- [x] Air Traffic Control (route links from other apps to a Space), theme editor, Boosts (CSS + Zap)
- [x] Link status bubble, crashed-tab page, loading glow
- [x] Packaged app (`npm run package`), own icon, Set as Default Browser, links that launch the app
- [x] Chrome extensions: load unpacked, import the user's Arc extensions per profile (keep Arc's on/off),
      Library › Extensions (on/off, remove), toolbar extensions menu with action popups
- [x] Permission prompts (camera, microphone, location, notifications, clipboard; per profile and site), Print,
      spelling suggestions
- [x] Links to apps ask first (mailto:, zoommtg:, steam:)
- [x] Chrome Web Store: Add Extension on its pages, verified CRX3 install, updates every 5 hours
- [x] Command Bar: Tab to search a site (YouTube, Wikipedia, GitHub, …)

### 2.7 Wrap-up
- [x] Unit tests for every pure module (166); e2e for the app, overlay, extensions, permissions, packaged app
- [x] README screenshots regenerated, CLAUDE.md, handoff, teardown page marks what is built (27 of 53, 4 partly)

## Milestone 3 — Arc 1:1 look, smooth motion, remaining features (plan: user-approved 2026-10-26)
User: "poorly polished, icons weird, not smooth — make it 1:1 with my Arc screenshots, finish every feature, no time
limit, UI-test until perfect." Skip Arc Max (AI) and server features (sync, sharing, accounts).

### 3.1 Motion foundation
- [x] Keyed, in-place sidebar rendering (rows created once per key, updated on push) + delegated events
- [x] CSS motion system: hover/selection transitions, row enter/leave + FLIP, folder open/close, Space slide,
      theme cross-fade, reduced motion
- [x] Native view motion for ⌘S and the sidebar peek: the main process glides the page view (tabViews.ts, cubic
      ease-out, 260 ms) and the sidebar page moves its card on the same curve. Electron's own
      `setBounds(…, {animate})` reports the end place at once and could not be verified without screen recording,
      so we step it ourselves (e2e/check-motion.mjs proves the in-between places).
- [x] Glide for split panes and Peek grow/shrink (e64c8db)
- [x] Panels animate in (centering moved to `translate`), the Command Bar highlight moves without rebuilding rows,
      the Control Center redraws in place instead of animating in again
- [x] Panels animate out (overlay "closing" round trip, 120 ms)

### 3.2 Arc's look 1:1
Reference scale corrected: the screenshots are 1 px per pt (the window is 1888 × 1032 pt at 56, 38 in the image).
`node e2e/arc-compare.mjs` renders our window at that size and writes side-by-side crops + our element boxes.
- [x] SF Symbols rendered by macOS for every icon (CSS mask, tintable, per-context scale) · [ ] native menu icons
- [x] Palette engine (frame #313131 for black/dark; light shows dark colors as #e6e6e6) + Arc theme import with
      intensity; Spaces without a theme get Arc's neutral grey
- [x] Card with the toolbar inside (uniform page radius, toolbar tinted per site from the page's top row, 50-site
      cache, near-black tops shown #424242 like Arc's GitHub), link icon + host/path like Arc
- [x] Developer Mode per site (shot 5 was this, not a "full URL" option): striped 38 pt toolbar, full address in
      monospace, copy / capture / screenshot / console / network / inspect, nav buttons in the sidebar's strip with
      reload ▾, dashed yellow tab outline with the host; on by default for local servers
- [x] Arc's global "Show full URLs" preference (toolbarShowFullURLsEnabledPreference): Library › Settings, View menu,
      Command Bar
- [x] Sidebar to the measurements: width 242 (rows 7…241.5), card at 249, toolbar 31 + hairline, Favorites at 43,
      46 tall, 7 apart; rows 35.33 on a 40.33 pitch (long lists), Space title as tall as a row, children indented
      as whole rows by 16, divider only while Today has tabs (10.5 under the last pinned row), New Tab highlighted
      while the Command Bar makes a new tab, our own folder drawings in Arc's proportions, traffic lights (12, 16)
- [x] Overlay strengths calibrated to Arc's pixels (Chromium blends in the display's color space)
- [x] Command Bar (shot 3): 750 wide a third down, 62 input row with tips, 44 rows titled only, inverted arrow
- [x] Control Center (shot 4): Share sheet, Boost, Screenshot, Capture (drag a region), extension grid with +,
      Settings rows (sound, zoom, Boost, permission answers), Secure pill, "…" native menu
- [x] Library (grouped settings with switches), Find, theme editor (with intensity), Boost editor, Little Window
      reviewed in the same language · [x] permission prompt (two lines like Chromium's bubble, no empty gap)
      · [x] Peek frame, status bubble, crash page review (e2e/review-shots.mjs; the crash page says why in words)
- [x] Verify the traffic lights and native rendering (2026-10-27, `screencapture -l` of our own window, converted
      from the display profile to sRGB like the reference shots): close button at the same pixels as Arc's (12–25,
      16–29), minimize and zoom 0.5 / 1 pt further right (macOS's spacing; Electron cannot change it), corners the same
      size by eye, frame 49 vs Arc's 50. Left: inactive traffic lights are plain grey here and keep coloured rims in
      Arc (drawn by macOS; `UIDesignRequiresCompatibility` does not help, it brings back the old 12 pt buttons)

### 3.3 Remaining Arc features
- [x] Tab hover tooltip (was a preview card until 3.7) · [x] Recent-tab switcher (⌃Tab, with page pictures) · [x] Inline URL autocomplete (also
      well-known sites) · [x] Tidy titles (our own rules)
- [x] Capture (Control Center) · [x] Library Media · [x] Library Spaces/Boosts · [x] Notes · [x] Easels (text, pen,
      pictures, live captures taken again from their page; no sharing: server feature) · [x] Boost colors/fonts/JS
- Sound effects: removed on purpose (the user, 2026-10-27: "no one does that") · [x] Alternate app icons (Dock
      while running; Finder icon needs a Dock tile plug-in Electron cannot ship) · [x] Ad & tracker blocking (own
      engine, EasyList/EasyPrivacy downloaded)
- [x] Translate page (Google Translate, labelled) · [x] Handoff (unverified: needs signing and a second device)
- [x] Renamed Bow with our own bow icon (data folder and bundle id keep the first name)
- [x] Search engine setting (Google, DuckDuckGo, Bing, Brave Search, Kagi; suggestions from the chosen engine)
- [x] Import from Chrome/Brave/Edge/Vivaldi/Safari (bookmarks + history; no passwords) · [x] First-run welcome
- [x] Developer Mode (shot 5)
- [x] Live folders: GitHub pull requests / review requests / assigned issues (read with the profile's GitHub sign-in,
      HTML first, hidden window for script-drawn lists; verified on a real public GitHub list), RSS/Atom/JSON feeds
      from the page on screen; Arc import keeps Arc's GitHub live folder live
- [x] Password-manager bridges: native messaging works (round trip checked in e2e); hosts of Arc, Brave, Edge,
      Vivaldi and Chromium are linked in at startup
- Not doing (documented): Arc Max (user's choice), sync/sharing/accounts (user's choice), AppleScript (needs
  native Cocoa scripting code), auto-updates (needs published releases: ask first)

### 3.5 Multiple main windows (⌘N, like Arc) — started 2026-10-27
Design: the focused window's choices stay at the top of BrowserState (`activeSpaceId`, `selectedTabIdBySpace`), the
other windows' are parked in `otherWindows` and swapped in on focus; every pure function keeps working on "the
focused window", and each window's sidebar gets the state projected for it. Bounds stay in window-state.json (keyed
by window id), because they change on every drag.
- [x] Step 1: saved shape v3 (`focusedWindowId`, `otherWindows`), pure `windows.ts` (project, focus, open, close,
      repair after every change), migrate v2 → v3 (+ v1 chain), live folders keep every window's selection; tests
- [x] Step 2: main process: window registry in browserCore (focused = last focused main window, never
      `getFocusedWindow()`), per-window pushes and runtime (sidebar peek, New Tab highlight, tabs shown elsewhere),
      tabViews per window (release before claim; a tab stays with the window that shows it), overlay / Peek /
      status bubble follow the focused window and leave a closing window, actions from a background window's
      sidebar focus it first, File › New Window ⌘N and Close Window ⇧⌘W, quit with the last main window (⌘Q keeps
      every window for the next start), bounds per window, extensions see each tab's window
- [x] Step 3: placeholder card "Open in another window" with Move to This Window; e2e/check-windows.mjs in
      `npm run e2e`; README, teardown page, handoff

### 3.6 Multiple windows, closer to Arc (user: "get as close as possible to Arc", 2026-10-27)
Evidence: the user's StorableWindows snapshots (Arc backup, read only). Each window has its own `sidebarMode`
(anchored / noChrome), `sidebarWidth`, `spacesWithCollapsedPinnedSections` and `expandedItems` (open folders); the
top-level `sidebarViewPreferences` matches the last window that closed (three snapshots have one open window that
differs from it), and new windows start from it.
- [x] Piece 1: saved shape v4: per window sidebar shown/hidden (⌘S), width, collapsed Pinned sections and open
      folders (the focused window's stay in settings / Space.isPinnedOpen / FolderItem.isOpen, parked windows keep
      their own); `newWindowSidebar` = the last closed window's; sidebar peek and glide per window; migrate v3 → v4
- [x] Piece 2: Notes and Easels in two windows get the same "Open in another window" card as pages (Arc's notes are
      tab content too), so one editor at a time saves the file
- [x] Piece 3: drag an item from one window's sidebar into another's (Favorites, Pinned, Today, folders, splits,
      Space switcher): main carries the dragged item id between windows; a dropped tab is selected there and its
      page moves along

### 3.7 Live Arc comparison (user's screen recording of Arc, 2026-10-27; frames in reference/arc-live/, git-ignored)
Found by watching the user's real Arc (active window) next to ours. Each item: what Arc does → what we do.
User's go-ahead and order (2026-10-27): 1 active look, 2 theme editor, 3 Peek, 4 Library, 5 folder hover list, 6 tab
tooltip, 7 sidebar width, then AppleScript.
- [x] Active vs inactive window: Arc's whole sidebar palette is darker while its window is active. Measured on the
      user's black "Main" Space (sRGB values; active = recording frame f0136, inactive = live window capture):
      frame 17 vs 53, selected row 55 vs 73, Space label 113 vs 145, row text 211 vs 217, GitHub (near-black page)
      toolbar 56 vs 66. Our tokens and palette match only the inactive column (all five reference shots were inactive).
      The hidden sidebar shown at the edge is its own darker floating panel (6, rounded, bordered).
      Done: RuntimeState.isWindowActive → data-window on the sidebar page; frame lifts 0.0745 / 0.204 and two token
      sets, calibrated on the real screen (screencapture → sRGB): ours active 20/57/115/213, tile 38; background
      52/73/145/216, tile 73. The old values had been calibrated on Chromium's own snapshots and were 7–23 levels too
      light on screen. Not measured yet: icon, faint, dot, line, field tokens, light themes, the floating peek panel.
- [x] Library lives in the sidebar column: a vertical icon rail (Media, Downloads, Easels, Spaces, Boosts, Archived
      Tabs) with the list beside it; Spaces spread over the window in columns → ours was a floating panel. Done,
      measured on frames f0177–f0243: the column is 410 pt (card at 417) at any sidebar width, rail 112 pt with a
      hairline, sections 80 pt boxes 100 pt apart and centered, search 36 pt tall; ours adds History, Extensions and
      Settings to Arc's rail (no Easels section: Easels are tabs here). The overlay is exactly the column and draws
      see-through over the sidebar's frame; the page glides aside (check-motion). Not done: Spaces spread over the
      window in columns (Library › Spaces stays a list)
- [x] Peek: a card almost the whole page card wide, over the toolbar, with its own toolbar row (back, forward,
      reload, address) inside; close / expand / split stacked vertically outside its right edge; page dimmed behind →
      ours was a smaller card with a header above it. Done, measured on frame f0491: the card hangs from the window's
      top edge, toolbar row 44 pt in the frame's color, 80 % of the page card wide, 12 pt above the bottom; only the
      page card dims (black 55 %); round black buttons 34 pt, 42 pt apart, 12 pt right of the card. Not possible: the
      page's top corners stay rounded under the row (Electron gives a view one radius for all corners)
- [x] Theme editor and icon picker are popovers above the sidebar's bottom bar (compared side by side with the
      recording on the real screen: place, size, colors within a few levels; Arc's pad mapping is unknown, ours is
      documented in shared/themePad.ts) (theme: auto/light/dark, grainy colour
      field with handle and − / +, preset dots with arrows, wavy slider, dial; icon: Emoji / Icon tabs and a grid) →
      ours are overlay panels
- [x] Hovering a closed folder opens a searchable list of its tabs with "1 minute ago" times → was missing. Done,
      measured on frame f0023: 245 pt wide, 4 pt right of the sidebar, 48 pt search row (focused), 45 pt rows newest
      first, at most 316 pt, centered on the row but 18 pt from the window's edges; it closes 300 ms after the pointer
      left both the row and the list (the sidebar and the overlay each report their side to main)
- [x] Hovering a tab row: × button and a small tooltip "Title / Double-click to rename" (no page preview seen after
      3 s) → ours showed a page preview card. Done: Arc's black tooltip beside the pointer (measured 29 / 44 pt tall,
      10 pt padding), the rename hint only on the selected tab (Arc's other tabs show the title alone), hidden as soon
      as the pointer moves
- [x] Sidebar width: the user's Arc is 254 pt (StorableWindows sidebarWidth) → ours 242; the Arc import should carry it.
      Done: Arc's width reaches the page card (card at 254, measured live), ours stops 7 pt earlier, so the first
      import sets 247 (`readArcSidebarWidth`); a later run leaves the width alone
- [x] Sidebar scrollbar: Arc's overlay knob (overlayScrollbar.ts): no width taken, shown while scrolling, fades
- [x] ⌘S like Arc's (the user's recording, 2026-10-27): the traffic lights hide with the sidebar, the card's toolbar
      starts at the window's edge with the sidebar button and moves rigidly with the card, which slides over the
      sidebar (no longer squeezed); the sidebar's own buttons go at once
- [x] The page meets the toolbar square on every site, with rounded bottom corners: page views are square and two
      tiny views draw the window's frame over the card's bottom corners (main/cornerMasks.ts, src/corner)
- [x] The selected Favorite: Arc's 2 pt border in the icon's colour and a tinted fill (main/faviconAccents.ts)
- [x] (Fixed by pointer-event dragging, confirmed by the user 2026-10-27) Dragging tabs in the sidebar does not work for the user with a real mouse ("could not even grab it"; e2e only
      simulates drag events). Ruled out: window drag regions (rows clear in ELECTRON_DEBUG_DRAGGABLE_REGIONS). Tried:
      a press no longer takes the tooltip's / folder list's view out of the window mid-press. To confirm with the
      user: does a drag work when pressed within half a second of reaching a row (before the tooltip shows)? The
      diagnostic window (logs every pointer and drag event) is in the handoff. If it still fails: replace native drag
      with pointer events (testable with Playwright's mouse; cross-window drops then need main's help)
- New window: the purple window in the first recording was most likely incognito (⇧⌘N; the user is not sure), so
  Arc's ⌘N window and its "open in another window" placeholder are still unobserved; no change planned
- [ ] AppleScript dictionary (the user runs Raycast, which talks to Arc through AppleScript; ours has none yet).
      Electron answers only the standard "open location"; Arc's own commands (tabs, Spaces, `make new tab`) need an
      `.sdef` plus native Apple Event handlers (an Objective-C addon) or a URL-scheme / CLI bridge for Raycast script
      commands instead. Needs the user's choice (handoff 2026-10-27-arc-polish)

User decisions (2026-10-27): publish releases on GitHub for auto-updates (yes); notarize with the user's Apple
Developer account (yes; the repo is open source, so certificates, notary credentials and team ids never go into the
repo: the user stores them in their own keychain); Arc Max and sync/sharing stay skipped.

### 3.4 Verification
- [x] e2e/arc-compare.mjs (side-by-side with the reference; positions match within about a point)
- [x] Motion checks for ⌘S, peek and resize (e2e/check-motion.mjs, part of `npm run e2e`)
- [x] 331-tab sidebar within a frame (e2e/check-performance.mjs, DevTools metrics): was 35 ms per change and 44 ms
      per selection; unchanged rows now come as placeholders morph.ts keeps as they are, move animations only
      measure when the order changed, the toolbar tint restyles the card alone → about 8 ms per redraw
- [ ] Hands-on runs of the packaged app; all suites green; docs + teardown page current

## Milestone 4 — "Arc but better" (user-approved 2026-10-28: "everything you mentioned I love, do them all 1 by 1")
From a discovery pass over v0.1.0, Arc users' complaints (HN, reviews, migration write-ups) and rivals (Zen, Dia,
Vivaldi, Edge, Orion). Done one at a time: build, unit + e2e tests, full suite green, commit, push. Sizes: S hours,
M about a day, L several days.

### 4.1 Top five
- [x] 1. (a: Export / Restore with replace or add, docs/backup-format.md, e2e/check-backup.mjs; b: hourly
      snapshots, 12 hourly + 7 daily kept, a switch in Settings; c: folder sync, one file per Mac, merged unit by
      unit, docs/sync.md, e2e/check-sync.mjs with two copies of Bow) Backup and export of everything (Spaces, pins, folders, Live Folders, Boosts, rules, settings, Notes,
      Easels) to an open, documented file; restore with a preview (merge or replace); rolling automatic snapshots;
      account-free sync through a folder such as iCloud Drive (L)
- [x] 2. (keepAwakeSites + Keep Favorites awake switch, pinned tabs sleep like Arc's, rows fade, Sleep Tab / Sleep
      Other Tabs in the tab menu, Tabs menu and Command Bar, Library › Task Manager; e2e in check-tab-sleep and
      check-overlay) Smarter tab sleeping: per-site Keep Awake list (Settings, Control Center, tab menu), a decision for
      pinned tabs and Favorites, sleeping tabs dimmed in the sidebar, Sleep Tab Now / Sleep Other Tabs, a Task
      Manager with memory and CPU per tab (M)
- [x] 3. (Never Archive per tab, also through Clear; a Space's own timing incl. Never; Undo in the sidebar after the
      sweep or Clear, places kept; "20m" on Today rows in their last hour; ⇧⌘T only reopens tabs you closed)
      Archive without surprises: Never Archive per tab and per Space, archive timing per Space, an Undo toast
      after the sweep or Clear, an "archives soon" hint, ⇧⌘T reopens only tabs you closed (M)
- [x] 4. (⌘, Settings; ⌘/ shortcuts sheet read from the menu; zoom per host; download folder / ask; search
      keywords; Save Page As ⇧⌘S and Export as PDF) Everyday basics: zoom remembered per site; downloads folder or ask where to save; ⌘, opens Settings;
      custom search engines with keywords; Save Page As and Save as PDF; a Keyboard Shortcuts sheet (S each)
- [x] 5. (⌘/⇧-click picks Pinned and Today rows, menu Close / Move / Pin / Split for two, Close with Undo;
      typed, Command Bar and routed links switch to an open copy with "Open Another"; Close Duplicate Tabs; ⇧⌘A
      Search Tabs with Space and "open in another window". Not done: Favorites in the selection, dragging several)
      Tab power tools: select several tabs (⇧/⌘-click) for close, move, pin, split; duplicate-tab detection
      ("already open, switch to it?"); tab search ⌘⇧A that shows each tab's Space and window (M)

### 4.2 Arc features, done better
- [x] 6. Link menu: Open Link in Little Window, in Peek, in Split View (S)
- [x] 7. Split view: drag the divider to resize, swap panes, 2×2 grid and keyboard layouts (M)
- [x] 8. Boosts: share and import as files; a clear badge while a JavaScript Boost runs (S)
- [x] 9. (GitHub Notifications and Issues You Opened; Issues from This Page reads a Jira filter or Linear list in a
      hidden window with the profile's sign-in, asks to sign in and refills on the next visit; Hacker News preset;
      Feed from This Page falls back to a subreddit's /.rss. Checked against local fakes, not the real services)
      Live Folders: GitHub notifications and issues, Linear and Jira through the user's sign-in, ready-made feed
      presets (Hacker News, subreddits) (M)
- [x] 10. (Sums and unit conversions with Return to copy, no currencies (they need a server); the 3 tabs you closed
      last below the recent ones and "Reopen" for matches; "yesterday", "monday", "3 days ago", "last week" + words
      list that time's history (last visit only: history keeps one per page); Library › Chains builds command chains
      of actions and pages, "Run <name>" in the Command Bar, in backups and sync)
      Command Bar: calculator and unit conversion, recently closed tabs and history by date, user-made action
      chains (M)
- [x] 11. (Space menu › Search Engine and New Tab Opens (a page of the Space's own instead of the Command Bar), kept
      per Mac; Save as Template / New Space from Template (+ menu, Command Bar, Library › Spaces) with the Pinned
      tree, live folder sources and the defaults; templates in backups and sync)
      Per-Space defaults (search engine, new-tab behaviour) and Space templates (M)
- [x] 12. (Rules "Link comes from <app>" by bundle id, the sender read as the front app with /usr/bin/lsappinfo
      when the link arrives; the form lists running apps and recent senders; Test a link shows the Space or Little
      Window by the same shared matching; Library › Settings keeps typed text and focus through redraws)
      Air Traffic Control by source app (links from Slack go to Work) and a "test this link" box (S)

### 4.3 Beyond Arc
- [x] 13. (View › Toggle Toolbar ⇧⌘D, Compact Mode ⌥⌘S, Focus Mode ⇧⌘F, also in the Command Bar; the hidden toolbar
      slides in from the top edge like the sidebar from the left, the page moving without resizing; the toolbar's
      setting is per window like the sidebar's; Focus Mode is per window and not saved)
      Compact mode (sidebar and toolbar hidden, both slide in from the edge) and Focus mode (page only) (M)
- [x] 14. (⌃⌘R / View / Command Bar / a toolbar button on pages that look like articles; our own extraction in an
      isolated world (the block with the most paragraph text), checked as plain text and web images; drawn in the card
      over the hidden page; A− / A+ text size remembered; navigating away leaves it. 2026-10-28: on Wikipedia it
      showed the language list and the title twice; now hidden parts, lists that are mostly links, role=navigation
      and tables inside the article are left out, the title is shown once without the site's name, and headings
      left with nothing under them go. Forms too are left out only inside the article: a page wrapped in one form,
      like old ASP.NET WebForms sites, is read)
      Reader view (M)
- [x] 15. (Library › Settings › Shortcut from any app: off, ⌥Space, ⌥⌘Space, ⌃⌥Space, ⇧⌥Space or ⌃⌥⌘B, opening the
      Command Bar or a Little Window; says when another app holds the keys; e2e runs record the keys instead of
      taking them from the Mac)
      System-wide shortcut: Command Bar or a Little Window from any app (S)
- [x] 16. (bow://open, space, search-tabs, command-bar, little; declared in Info.plist; Raycast as three script
      commands in integrations/raycast with no dependencies. Not done: a full Raycast store extension with its own
      tab list, which needs @raycast/api and publishing: ask first)
      `bow://` URL scheme and a Raycast extension (search tabs, open in a Space, switch Spaces) (M)
- [x] 17. (Library › Privacy: the blocker's week (total, bars, top sites and trackers, 30 days kept, counts only);
      HTTPS-Only Mode with "Open with HTTP" only for loads Bow upgraded; Forget Site Data on Quit per profile (a
      Space's profile, from the Space menu), cleared at quit and again at start, extensions' storage kept)
      Privacy report (trackers blocked per site and week), HTTPS-only mode, per-Space "forget cookies on quit" (M)
- [x] 18. (Add Note… / Edit Note… in a tab's or folder's menu: a short note written in place, shown in italics under
      the title, in backups and sync with the item)
      Tab notes: attach a Note to a tab or folder (S)
- [x] 19. (Library › Shortcuts: every app-menu command by menu; click its keys and press new ones (the menu's keys are
      unregistered while recording, so ⌘T can be recorded); keys in use or macOS's own are refused and recording goes
      on; × removes, Reset, Reset All; the menu bar is rebuilt with your keys; in backups)
      Shortcut editor (M)

### 4.4 Trust and polish
- [x] 20. (tab-history.json: each tab's Back list with Chromium's page state (scroll, form values), saved every 5 s and
      before quit, restored the first time each tab is shown; a killed app comes back scrolled where it was. Not for
      private windows or profiles that forget site data. The sidebar: saved within 0.5 s, hourly snapshots from item 1)
      Crash-proof restore: scroll positions come back; snapshots from item 1 cover the sidebar (S)
- [x] 21. (The card's two corner pages are opened by the window's sidebar page (window.open, allowed for exactly those
      pages), so they run in its process: two processes fewer per window. Measured with macOS's footprint: 1 window
      300 → 257 MB, 2 windows 447 → 369 MB; the "70–90 MB" were working sets, which count shared memory. A sidebar
      whose process is gone now loads again and its corners come back. Overlay and status bubble stay on their own:
      one each for the whole app, not per window)
      Less memory for Bow's own helper views (70–90 MB each per window) (M)
- [x] Bow shows up in System Settings › Desktop & Dock › Default web browser (the user, 2026-10-28: it could not be
      picked there). macOS lists apps that open HTML files as well as http/https links: the Info.plist declares
      public.html and public.xhtml, and an HTML file from Finder (open-file) opens like a link from another app.
- [x] 22. The Control Center no longer rebuilds when nothing changed (an unclickable panel under bursts of
      refreshes, found 2026-10-27; the fix is uncommitted in the main checkout's src/overlay/siteControls.ts) (S)

## Milestone 5 — Onboarding (user-approved 2026-10-28: "really clean and professional, nice animations")
Plan: a full-window, animated first run replacing the welcome card (six scenes: hello, bring your things, make it
yours, the essentials, a few good defaults, you're all set). Our own CSS/DOM/SVG only, no sound.
- [x] 1. Plumbing: welcome panel data (active Space + theme, system dark, sources + Arc, import status, defaults), an
      in-place `update` message, refresh after actions and around imports, nothing replaces the tour, every way out
      records hasSeenWelcome, skeleton scenes with navigation, keys and progress; check-app updated
- [x] 2. Scenes 1–3: hello, import cards with inline status, live theme preview and the aurora re-tint; screenshots
- [x] 3. Scene 4: the essentials tour with its looping illustrations
- [x] 4. Scene 5 defaults, scene 6 and the outro, Help › Welcome to Bow… and the Command Bar replay, reduced motion
- [x] 5. check-onboarding.mjs (23 checks); screenshots (light/dark, 640×400 and 1280×820) and a slowed recording; polish pass

### 5.2 Onboarding v2 (the user's review, 2026-10-29: Arc's first launch and the D'arce onboarding as references)
- [x] 1. Its own window (70 % of the screen, the browser hidden until it ends) with its own preload and channels;
      replay from Help; the overlay welcome removed; check-app and check-onboarding adapted
- [x] 2. Imports read first, then bring the chosen parts (counts before importing, "Choose what comes over", progress
      per part); every supported browser with its real icon (drawn by macOS from the installed app); the sidebar
      preview that fills in
- [x] 3. The cleaner look: bold sans titles, left column with a live preview, the whole window takes the picked colour,
      "Make Bow your browser?" with a message bubble, "You're all set."; no dashes in any text (done with 2: the
      import scene needed the new layout; check-onboarding 33 checks with real imports from a made-up home folder)
- [x] 4. The startup: a glow on the desktop that grows into the onboarding window, Bow's mark drawing itself; the
      onboarding fading into the browser window (and, from the user's note: every browser's real logo, shipped with
      Bow, Arc's included; no "Not on this Mac" text under the dimmed ones)
- [x] 5. Screenshots and a recording for the user; polish
- [x] 6. A startup as clean as Arc's (the user, 2026-10-29: "nowhere clean like Arc"): the desktop dims, one soft blob in
      Bow's violet-blue breathes, swells and flows into the window (blurred from outside its shape, so the edge stays
      soft), the window wears Bow's saturated look until a color is picked, the mark draws as a thin outline, holds and
      lifts, "Welcome to Bow." sweeps in from the left, then a small glass button
- [ ] 7. Live check on the real desktop with the user's go: the see-through dim, the window's real corner radius (the
      sheet's is 16 px), the traffic lights arriving, the window above the intro while the dimming lifts
- [x] 8. Release v0.1.1 (2026-10-29): tag at 7e926ea (onboarding v2, Dia and Opera import, the color picker, the Reader
      view form fix); full e2e and check-package 22 on that commit; built, signed and notarized by `npm run release` in
      the user's Terminal (notarytool's saved login is not visible to Claude's processes); published as Latest, and
      releases/latest/download/update-darwin-arm64.json now says 0.1.1
- [x] 9. Dia showed 4 spaces but brought over 1 (the user, after 0.1.1): a browser with several profiles now comes over
      all at once, each profile as its own Space with its own profile (the user's choice: separate sign-ins, like Dia);
      rows per profile in the onboarding, "Dia, all 4 spaces…" in the File menu; check-onboarding 38 with four made-up
      Dia spaces
- [ ] 10. Google sign-in refused (the user, 2026-10-29, "Couldn't sign you in. This browser or app may not be
      secure"): with Bow's Chrome user agent Google runs desktop Chrome's sign-in (GlifWebSignIn), which Electron fails;
      its sign-in pages now get Electron's own user agent in headers and scripts, and Google serves WebLiteSignIn
      (check-google-sign-in 11). Left: the user's real sign-in on a fresh profile, then release 0.1.2

## Review (2026-10-28, an unattended night: open source, releases, auto-update, speed, polish)
- **Works and verified:** open-source setup and repo rename; `npm run release` up to Apple's notarization (signing,
  hardened runtime, DMG checked by hand; notarization waits for the user's credentials); auto-update (a real signed
  0.1.0 → 0.1.1 update by hand; check-package and check-windows cover the rest); sleeping tabs incl. calls
  (check-tab-sleep 7); Firefox import (unit tests on a real SQLite file; the user's own Firefox folder was not read);
  saves and pushes batched, startup symbol cache and deferred Dock icon (measured); toast, Peek menu navigation,
  overlay scroll knob, Library polish, peek toolbar fix. Last full run: `npm test` 376, check-app 47, check-overlay
  88, check-extensions 35, permission-check, check-motion 9, check-live-folders 21, check-performance 7,
  check-windows 52, check-tab-sleep 7, check-package 19.
- **Not verified:** notarization itself (no credentials yet); the move to Applications answered with Move (only the
  offer was seen, from a mounted disk image); website notifications on a real site.
- **Open:** see `.handoffs/2026-10-28-night.md` › Decisions for the user and Next.

## Review (2026-10-27, polish tour and Arc fixes 3–7 from the live comparison, 3.7)
- **Works and verified:** background-window icon fading, toolbar strengths, planet, tab title weight, New Tab pitch,
  floating peek panel (`7211ac4`); Arc's tab tooltip (`fa4360b`); Arc import sets the sidebar width (`f85eebe`, also
  run once against the user's real Arc files in a throwaway profile: 247); Arc's Peek (`9fe877e`); the Library in
  the sidebar column (`49827f6`); the closed-folder list. Each compared on the real screen with the user's Arc
  (captures and recording frames). Suites on the last run: `npm test` 335, `check-app` 47, `check-overlay` 79,
  `check-extensions` 35, `permission-check`, `check-motion` 8, `check-live-folders` 21, `check-performance` 4,
  `check-windows` 51.
- **Not verified:** the active-window look of the new pieces on the real screen (unattended runs never get the
  focus; the active tokens were checked by forcing `data-window="active"`); light Spaces against Arc (no capture).
- **Open:** AppleScript (needs a decision), releases + notarization, Spaces spread over the window (Library).

## Review (2026-10-27, multiple windows closer to Arc, 3.6)
- **Works and verified:** per-window sidebar (⌘S, width, peek), Pinned sections and folders; new windows from the
  last closed window's sidebar; Notes and Easels one window at a time with a lossless hand-over; dragging tabs,
  folders and splits between windows' sidebars. Suites: `npm test` 310, `check-app` 47, `check-overlay` 68,
  `check-extensions` 20, `permission-check`, `check-motion` 6, `check-live-folders` 21, `check-performance` 4,
  `check-windows` 50.
- **Not verified:** a real OS drag between two windows (Playwright's drag hangs in Electron; simulated drag events
  in both pages are checked instead).

## Review (2026-10-27, multiple main windows)
- **Works and verified:** ⌘N, a Space and selection per window, "Open in another window" + Move to This Window, a
  page let go of returning to the window that still selects it, actions and panels in the window they came from,
  menus on the focused window, ⇧⌘W, restart with both windows (place, Space, selection, focus), quitting with the
  last window and the next start opening it. Suites: `npm test` 301, `check-app` 47, `check-overlay` 68,
  `check-extensions` 20, `permission-check`, `check-motion` 6, `check-live-folders` 21, `check-performance` 4,
  `check-windows` 30, `check-package` 12.
- **Known limits:** in `.handoffs/2026-10-27-multiple-windows.md` (extensions keep a tab's first window). The other
  limits listed at first (⌘S and width global, two note editors, no drag between windows) were fixed in 3.6.

## Review (2026-10-26, end of the Arc-parity session)
- **Works and verified:** everything in README "What works". Suites: `npm test` 166, `check-app` 36,
  `check-overlay` 40, `check-extensions` 19, `permission-check` 17, `check-package` 12 (after `npm run package`).
- **Verified on real data, read-only:** Arc import (3 Spaces, 22 tabs, 243 archived, 1,279 history pages,
  15 extensions with Arc's on/off); a Web Store install whose key matches Arc's copy byte for byte; a real update
  check that downloads, verifies and unpacks.
- **Known limits:** content scripts can miss the page restored at startup under heavy disk load (Electron has no
  "scripts ready" signal; reload fixes it). `navigator.permissions.query` says "denied" for sites that have not
  asked (Electron has no "prompt" state); real requests still prompt. Some extensions need Chrome-only APIs (side
  panel, tab capture). Screen sharing (getDisplayMedia) is not wired up.

## Later
- [ ] Ghidra pass when RAM allows (Command Bar ranking, Peek triggers, sync merge, Easel captures)
- [x] Easels, Notes, tab hover previews, built-in ad blocking, screen sharing (macOS's sharing picker)
- [x] Multiple main windows (⌘N opens a second window, like Arc): built 2026-10-27, see 3.5 and
      `.handoffs/2026-10-27-multiple-windows.md`. (It had been deferred because every StorableWindows snapshot in the
      user's Arc backup holds 0 or 1 window; the user asked for it.)
- [x] Multiple windows follow-ups: see 3.6
- [x] Open-source setup (2026-10-27): repo renamed to Rektoooooo/bow, MIT LICENSE, CONTRIBUTING, CODE_OF_CONDUCT,
      SECURITY (private vulnerability reporting on), issue forms, PR template, CI (build + unit tests), README
- [x] Release pipeline: `npm run release` (Developer ID signing with hardened runtime checked: e2e/check-package
      passes on the signed app)
- [ ] First release v0.1.0: the draft exists on GitHub (notes only). Left: the user saves notarytool credentials
      (profile "bow-notary"), `npm run release` from a clean checkout of origin/main, upload
      release/Bow-0.1.0-arm64.dmg, Bow-0.1.0-arm64.zip and update-darwin-arm64.json to the draft, the user says
      publish
- [x] Auto-update (2026-10-27, `appUpdates.ts`): GitHub release feed + Squirrel.Mac, sidebar notice, menu and
      Command Bar; verified with a real signed 0.1.0 → 0.1.1 update from a local feed
- [x] Adding a Web Store extension to a second profile re-downloads into the folder the first profile has loaded;
      reuse the existing copy instead (rare). Fixed 2026-10-27: a second profile shares the copy
      (`findExtensionCopy`); one that asks while the download runs waits for it and gets the same copy.
- [x] Toolbar "Adding…" state resets on any redraw during the download (cosmetic; one download only). Fixed
      2026-10-27: main sends it as a runtime fact (`RuntimeState.extensionsBeingAdded`), per profile.
