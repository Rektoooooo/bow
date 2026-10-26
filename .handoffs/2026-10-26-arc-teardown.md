# Handoff — 2026-10-26 — From mapping Arc to our own browser

## Where things stand

- **Sidebar Browser milestone 1 is done and public**: https://github.com/Rektoooooo/sidebar-browser
  (Electron 44 + TypeScript). Sidebar, two Spaces, pinned/today tabs, inset page card, Archive with reasons,
  auto-archive, saving between runs, locked-down permissions.
- **Verified**: `npm run build` clean, `npm test` 20/20, `npm run e2e` 23/23 (stable over 4 runs) + permission check passing.
- **Arc research**: feature map of 52 features, architecture, auto-archive design from Swift metadata.
  Ghidra decompilation of Arc never completed (the Mac ran out of memory), so 5 auto-archive questions stay open.
- **Next**: see [Next steps](#next-steps). Nothing is half-edited; the working tree is committed.

## What the user asked for, in order

1. "Arc is shutting down; map every feature and design, then reverse engineer it with https://github.com/morluto/rea."
2. Install Node 24 and run the REA setup for Claude Code.
3. Set up Ghidra with JDK 21 in the home folder and connect it to REA.
4. Thin Arc's main binary to arm64 and trace how auto-archive works.
5. After the memory problem: skip Ghidra for now; build the sidebar and auto-archive in our own browser.
6. Approved the skeleton, then: "One shot please, no need to ask me for checkpoints."
7. `git init` + first commit; create a public repo "as rektoooooo".
8. Push every step and every finding into the repo so a new Claude session can continue. (This file.)

## Step-by-step log

### 1. Mapping Arc (read-only)

- Read REA's README and disclaimer. REA is an MCP server + CLI for reverse engineering; native analysis needs
  Hopper, Ghidra or IDA. Its disclaimer forbids copying proprietary code/assets; we follow that.
- Inspected `/Applications/Arc.app` 1.170.0 (89123): `Info.plist`, frameworks, plug-ins, 48 `ARC_*` feature bundles,
  bundled JSON/JS (`web_content_behavior.json`, `command_bar_behavior.json`, `SelectorPicker.js`, …), `Arc.sdef`,
  source paths in the binary (`Browser/...`). Architecture: Swift/AppKit shell → ADK bridge → `ArcCore.framework` (Chromium).
- Found this macOS account has **no Arc data** (only `NativeMessagingHosts`); Arc was installed from another account.
  `StorableSidebar.json` lives on the account where Arc is used.
- Published the feature map as a private claude.ai artifact; the same page is `docs/arc-teardown.html`.
  52 features in 10 groups, each tagged Observe / Static / Binary, plus build paths and ground rules.
- Full findings: `docs/research/arc-findings.md`.

### 2. Node 24 + REA

- `brew install node@24` failed: `/opt/homebrew` belongs to another macOS account. Did **not** chown it.
- Installed official Node v24.22.1 (SHA-256 checked) to `~/.local/share/node/…`, symlinked into `~/.local/bin`
  (ahead of Homebrew on PATH). This made Node 24 the default for this macOS account.
- `npx -y rea-agents@latest setup --client claude_code --yes` → MCP server `rea` (`npx -y rea-agents@6.8.0 mcp`)
  in `~/.claude.json` (backup `~/.claude.json.rea.backup`) + skill `~/.claude/skills/reverse-engineer-anything`.
- Smoke test: `inspect-desktop-application /Applications/Arc.app` scanned 1,955 entries.

### 3. Ghidra + JDK 21

- Temurin JDK 21.0.13+9 and Ghidra 12.1.4 (REA accepts 12.1.x only; 12.2 was out) downloaded from their official
  releases, SHA-256 checked, unpacked under `~/.local/share/`.
- The download had no Apple Silicon decompiler; built it from Ghidra's source
  (`make ghidra_opt ARCH_TYPE="-arch arm64" OSDIR=mac_arm_64`, about 3 minutes).
- REA has no setup flag for Ghidra paths; added `GHIDRA_INSTALL_DIR`, `JAVA_HOME`,
  `REA_GHIDRA_STARTUP_TIMEOUT_MS=1800000` to the `rea` MCP entry with `claude mcp add-json` (backup
  `~/.claude.json.pre-ghidra.backup`); `rea setup` then re-saved it and kept the env. All `ghidra-*` doctor checks healthy.
- Found: Ghidra through REA refuses **universal** Mach-O files → use `lipo -thin arm64`.
- Test: Arc's Dock plugin (arm64 slice) → 502 functions, 997 strings in ~1 min; decompile returned Swift pseudocode.
- Details: `docs/research/reverse-engineering-setup.md`.

### 4. Auto-archive trace

- `lipo -thin arm64` of Arc's main binary → 76 MB, SHA-256 `77be289e…c52d`, only 862 symbols.
- `strings` found the source files (`Archive/ArchiveState+AutoArchive.swift`, …), the threshold options
  (1 h, 6 h, 12 h, 24 h, 7 d, 30 d, never, debug 20 s) and log strings.
- Swift reflection metadata (`__swift5_reflstr`, now `tools/swift-reflstr.py`) gave the state, actions, timers,
  archive record and per-profile/synced settings. All listed in `docs/research/arc-findings.md` §2.
- Corrected an earlier claim: the bundled keepalive list is most likely about keeping pages running, not archive exemptions.
- REA's CLI re-imports for every command, so wrote `tools/rea-driver` to keep one MCP/Ghidra session open.
  `open_binary` worked; the first `search_strings` started the import, but the Mac was out of memory
  (swap 27.4 / 28.7 GB, two accounts logged in) and Ghidra sat at ~2% CPU for 10 minutes. Stopped it cleanly.
- The user logged out and closed apps, but the other account was still signed in (Xcode etc.), swap 22.9/23.5 GB,
  so Ghidra was not restarted. The user then chose to skip Ghidra for now.
- **Open questions** (need Ghidra): timer intervals, `itemsToExclude`, which tabs refresh last-active dates,
  archive retention, default threshold.

### 5. Building Sidebar Browser

- Choices (asked): Electron + TypeScript; real skeleton files; "in use" = visible OR audible OR picture-in-picture;
  new folder `~/Documents/GitHub/sidebar-browser`.
- Skeleton (code-preview workflow) approved; then implemented everything in one pass at the user's request.
- Tooling: plain `tsc` with two configs (main/preload → CommonJS in `dist/node`; sidebar → ES modules in `dist/web`),
  no bundler. Electron 44.9.3, TypeScript 6.0.3, Vitest 5.0.5, playwright-core 1.64.0 (e2e only).
- Our own values (Arc's are unknown): refresh in-use every 1 min, sweep every 5 min, prune hourly, keep archive
  30 days, default threshold 12 h. Inactivity is measured from the later of last use and app launch.
- Rules decided while building: closing a tab archives it ("manual"); when the selected tab leaves, the most recently
  used tab in that Space is selected; restored tabs come back unpinned at the top of Today; tab views load lazily.
- Security review found and fixed: Electron grants all website permissions by default → now refused except
  fullscreen + clipboard writes; sidebar page could be navigated by a dropped link → blocked.
- Verification: unit tests, Playwright `_electron` e2e (drives the real app, uses a throwaway `--user-data-dir`),
  permission check (geolocation/camera/mic/notifications all "denied"), dark-mode screenshot composited
  (`docs/screenshot-dark.png`) because the shell may not record the screen.
- e2e flakiness found and fixed: on relaunch the restored tab's page can open before the sidebar page, so
  `firstWindow()` sometimes returned the tab. The script now finds the sidebar by URL.

### 6. Publishing

- `git init` on `main`; first commit `4db1f70` (27 files). Repo-local author set to the Rektoooooo noreply address
  (the machine's global git identity is a work address and must not appear in this public repo).
- `gh` has two accounts; the active one is a work account and was left active. Created
  `Rektoooooo/sidebar-browser` (public) and pushed using the Rektoooooo token for those commands only.
- Second commit: this handoff, `CLAUDE.md`, `docs/research/*`, `tools/*`, `e2e/*`, `npm run e2e`.

## Next steps

1. **Browser, milestone 2** (pick with the user):
   - Keyboard shortcuts + app menu (⌘T/⌘L focus address box, ⌘W close, ⌘D pin, ⌃1–9 Spaces). Note: keys pressed
     while a web page has focus go to that page, so shortcuts must be menu accelerators in the main process.
   - Real favicons (`page-favicon-updated` event), back/forward/reload controls, links that open a new tab.
   - Create / rename / recolor Spaces; drag-and-drop ordering; folders in Pinned.
   - Then the bigger Arc features: Command Bar, Peek, Little Arc, Split View (see the feature map).
2. **Ghidra pass on auto-archive** when RAM allows: follow `docs/research/reverse-engineering-setup.md`
   ("Rerunning the Ghidra pass"); answer the 5 open questions; update `arc-findings.md` and the teardown page.
3. **Back up Arc data** from the account that actually uses Arc (`StorableSidebar.json`) before Arc stops working.

## Blockers

- Ghidra on Arc's 76 MB binary needs free RAM: the other macOS account must be logged out and big apps closed.
- Pushing needs the Rektoooooo token (see `CLAUDE.md` → Git and GitHub).

## Key files

- App: `src/main/{main,state,autoArchive,activity,tabViews,store,ipc,urls}.ts`, `src/preload/sidebarPreload.ts`,
  `src/renderer/{index.html,sidebar.ts,sidebar.css}`, `src/shared/{types,settings,ipcChannels}.ts`
- Tests: `tests/*.test.ts`, `e2e/*.mjs`
- Research: `docs/arc-teardown.html`, `docs/research/arc-findings.md`, `docs/research/reverse-engineering-setup.md`
- Tools: `tools/rea-driver/`, `tools/swift-reflstr.py`
- Plan: `tasks/todo.md`
