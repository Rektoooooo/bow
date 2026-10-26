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
- [ ] Keyed, in-place sidebar rendering (rows created once per key, updated on push) + delegated events
- [ ] CSS motion system: hover/selection transitions, row enter/leave + FLIP, folder open/close, Space slide,
      theme cross-fade, reduced motion
- [ ] Native view motion: animated bounds for ⌘S, sidebar peek, split, Peek grow/shrink
- [ ] Overlay open/close animations (incl. Command Bar, Library), no stale-frame flash, no re-animating site controls

### 3.2 Arc's look 1:1
- [ ] SF Symbols rendered by macOS for every icon (CSS mask, tintable); native menu icons
- [ ] Palette engine (frame #313131 for black/dark, white/black overlay alphas) + Arc theme import (windowTheme)
- [ ] Card with the toolbar inside, hairline, per-site toolbar tint (50-site cache), "Show full URL" option
- [ ] Sidebar to the measurements (tiles, rows, Space title, divider/Clear, New Tab, bottom bar)
- [ ] Command Bar (shot 3), Control Center (shot 4), Library, Peek frame, Find, prompts, editors, Little Window

### 3.3 Remaining Arc features
- [ ] Tab hover previews · [ ] Recent-tab switcher (⌃Tab) · [ ] Inline URL autocomplete · [ ] Tidy titles
- [ ] Capture + Library Media · [ ] Library Spaces/Boosts · [ ] Notes · [ ] Easels · [ ] Boost fonts/colors/JS
- [ ] Sound effects · [ ] Alternate app icons · [ ] Ad & tracker blocking · [ ] Translate page · [ ] Handoff
- [ ] Import from Chrome/Brave/Edge/Safari · [ ] First-run onboarding

### 3.4 Verification
- [ ] e2e/arc-compare.mjs (side-by-side with the reference, sampled colors/sizes within tolerance)
- [ ] Motion checks (intermediate frames, long-task probe, 300-tab sidebar)
- [ ] Hands-on runs of the packaged app; all suites green; docs + teardown page current

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
- [ ] Easels, Notes, multiple main windows, tab hover previews, built-in ad blocking, screen sharing
- [ ] Sign and notarize the app (needs a Developer ID) so it runs on other Macs
- [ ] Adding a Web Store extension to a second profile re-downloads into the folder the first profile has loaded;
      reuse the existing copy instead (rare)
- [ ] Toolbar "Adding…" state resets on any redraw during the download (cosmetic; one download only)
