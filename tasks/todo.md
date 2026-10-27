# Sidebar Browser — to-do

## Done

- [x] Map Arc's bundle, features and architecture (`docs/arc-teardown.html`, `docs/research/arc-findings.md`)
- [x] Choose a build path: Electron + TypeScript
- [x] Node 24 + REA 6.8.0 installed and registered with Claude Code (other macOS account)
- [x] Ghidra 12.1.4 + JDK 21 installed, Apple Silicon decompiler built, connected to REA, test decompile OK (other macOS account)
- [x] Auto-archive design mapped from Arc's Swift metadata
- [x] Milestone 1: sidebar, Spaces, pinned/today tabs, inset card, Archive, auto-archive, saving, permission lockdown
- [x] Tests: 20 unit, 23 end-to-end + permission check
- [x] Public repo: https://github.com/Rektoooooo/sidebar-browser
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

- [x] Media: sidebar player for a tab playing in the background; automatic Picture-in-Picture when leaving a playing video
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
- [ ] Glide for split panes and Peek grow/shrink
- [x] Panels animate in (centering moved to `translate`), the Command Bar highlight moves without rebuilding rows,
      the Control Center redraws in place instead of animating in again
- [ ] Panels animate out (needs a "closing" round trip before the overlay view is removed)

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
- [x] Sound effects (our own synthesized) · [x] Alternate app icons (Dock while running; Finder icon needs a Dock
      tile plug-in Electron cannot ship) · [x] Ad & tracker blocking (own engine, EasyList/EasyPrivacy downloaded)
- [x] Translate page (Google Translate, labelled) · [x] Handoff (unverified: needs signing and a second device)
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
- [ ] Sidebar scrollbar: thin overlay scrollbar while scrolling → check ours
- New window: the purple window in the first recording was most likely incognito (⇧⌘N; the user is not sure), so
  Arc's ⌘N window and its "open in another window" placeholder are still unobserved; no change planned
- [ ] AppleScript dictionary (the user runs Raycast, which talks to Arc through AppleScript; ours has none yet)

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
- [ ] Sign and notarize the app (needs a Developer ID) so it runs on other Macs
- [x] Adding a Web Store extension to a second profile re-downloads into the folder the first profile has loaded;
      reuse the existing copy instead (rare). Fixed 2026-10-27: a second profile shares the copy
      (`findExtensionCopy`); one that asks while the download runs waits for it and gets the same copy.
- [x] Toolbar "Adding…" state resets on any redraw during the download (cosmetic; one download only). Fixed
      2026-10-27: main sends it as a runtime fact (`RuntimeState.extensionsBeingAdded`), per profile.
