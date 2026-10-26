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
- [ ] Unit tests for every pure module; e2e rewritten for the new UI; permission check still passing
- [ ] README screenshot, CLAUDE.md (this Mac's facts), new handoff, commit + push

## Later
- [ ] Ghidra pass when RAM allows (Command Bar ranking, Peek triggers, sync merge, Easel captures)
- [ ] Easels, Notes, multiple main windows, tab hover previews, built-in ad blocking
