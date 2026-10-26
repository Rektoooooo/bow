# 2026-10-26 · Arc teardown

## Done
- Inspected /Applications/Arc.app (1.170.0, build 89123) read-only: bundle layout, Info.plist, Arc.sdef,
  48 ARC_* feature bundles, bundled JSON configs (web_content_behavior.json, command_bar_behavior.json).
- Published the feature map: https://claude.ai/code/artifact/e8ba659b-13e9-4f46-b52a-d157ccb8a345
  (local file: arc-teardown.html). 52 features, each tagged Observe / Static / Binary.

## Findings
- Arc = Swift/AppKit shell ("Browser/…" targets, ARCUI) -> ADK bridge -> ArcCore.framework (Chromium, 591 MB).
- Services: Firebase Auth + Firestore, CloudKit, LaunchDarkly, Sentry, Datadog, Sparkle, Lottie, Metal.
- This macOS account has no Arc sidebar data (only User Data/NativeMessagingHosts). StorableSidebar.json
  lives on the account where Arc is actually used.

## Blockers
- Node here is 23.10.0; REA needs 22.23.4+, 24.22.1+ or 26.12.1+.
- `npx rea-agents setup` changes Claude Code's MCP config; needs the user's OK and a restart.
- Binary deep dives need Ghidra (free, JDK) or Hopper (paid/demo).

## Next
- User picks a build path (Electron suggested) and approves Node 24 + REA setup.
- Then trace the Binary features: auto-archive, Command Bar ranking, Peek triggers, sync merge,
  Easel live captures, BlockListClient.

## Update: Node 24 + REA installed
- Homebrew (/opt/homebrew) is owned by the other macOS account; `brew install` failed with permission errors.
  Did NOT chown it. Instead installed official Node v24.22.1 (darwin-arm64, SHA-256 verified) to
  ~/.local/share/node/node-v24.22.1-darwin-arm64 and symlinked node/npm/npx/corepack into ~/.local/bin,
  which is ahead of /opt/homebrew/bin on PATH. Undo: remove those four symlinks.
- Ran `npx -y rea-agents@latest setup --client claude_code --yes`: added `rea` MCP server
  (`npx -y rea-agents@6.8.0 mcp`) to ~/.claude.json (backup: ~/.claude.json.rea.backup) and the skill at
  ~/.claude/skills/reverse-engineer-anything. `rea doctor`: node + host healthy, claude_code registration aligned.
- Smoke test: `inspect-desktop-application /Applications/Arc.app` OK (1,955 entries, coverage complete).
- Pending: restart Claude Code so the REA MCP tools load. No decompiler yet (Ghidra needs JDK 21; only openjdk@17 is on PATH).

## Update: Ghidra connected to REA
- JDK: Temurin 21.0.13+9 aarch64 (SHA-256 verified) at ~/.local/share/jdk/jdk-21.0.13+9/Contents/Home.
  Not on PATH; openjdk@17 from Homebrew is still first on PATH, so JAVA_HOME must be set for REA.
- Ghidra 12.1.4 (REA accepts 12.1.x only; 12.2 is out but unsupported), SHA-256 verified,
  at ~/.local/share/ghidra/ghidra_12.1.4_PUBLIC. Built the missing mac_arm_64 decompiler with
  `make ghidra_opt ARCH_TYPE="-arch arm64" OSDIR=mac_arm_64` (2m46s) and installed it to Decompiler/os/mac_arm_64/decompile.
- REA entry in ~/.claude.json now has env GHIDRA_INSTALL_DIR, JAVA_HOME, REA_GHIDRA_STARTUP_TIMEOUT_MS=1800000;
  `rea setup` re-saved it (env kept) and now plans no changes. Backup before this edit: ~/.claude.json.pre-ghidra.backup.
- `rea doctor`: all ghidra-* checks healthy.
- Gotcha: Ghidra via REA refuses universal Mach-O ("analyze a thinned Mach-O slice"). Use `lipo -thin arm64`.
- Test: DockTilePlugIn (arm64 slice) analyze = 502 procedures / 997 strings in ~1 min; decompile 0x13d0 returned Swift pseudocode.
- Disk is ~98% full (~7 GB free). Analyzing the 166 MB Arc binary will need several GB for the Ghidra project.
- Next: restart Claude Code (REA MCP tools + Ghidra env), thin Arc's main binary, start on auto-archive.

## Update: auto-archive trace (partial)
- Thin binary: `lipo -thin arm64` -> scratchpad thin/Arc-arm64 (76 MB, sha256 77be289e16a13905...). Only 862 defined symbols,
  so Ghidra function names will mostly be FUN_*; anchor on strings / Swift metadata instead.
- Static pass (strings + __swift5_reflstr field names) mapped the design; published as the "Auto-archive teardown" section.
  Key names: ArchiveState+AutoArchive.swift; actions didLaunch/runAutoArchive/autoArchiveItems/removeExpiredItems/willTerminate/
  simulateAutoArchive; timers autoArchiveTimer + cleanupTimer; window itemLastActiveDates + itemLastActiveDateUpdateTimer;
  thresholds twentySeconds..thirtyDays/never; per-profile + synced; reasons auto/manual/clearButton/clearTabGroup.
- Corrected the map: keepaliveAllowList is web-content config, not proven to be an archive exemption.
- Ghidra via REA MCP: REA CLI re-imports per command, so I drove `npx rea-agents@6.8.0 mcp` with a small stdio driver
  (scratchpad driver/rea-driver.mjs, request files in rea-session/req). open_binary OK, first search_strings triggered import.
- BLOCKER: Mac out of memory. Swap 27.4/28.7 GB used, ~55 MB free RAM; two macOS accounts logged in with apps in both.
  Ghidra JVM (-Xmx8G) sat at ~2% CPU for 10 min (thrashing). Stopped it cleanly.
- Next: user frees RAM (log out other account / quit apps), then rerun the driver and resolve: timer intervals,
  itemsToExclude contents, which tabs refresh last-active dates, archive retention. Start from xrefs to
  "Auto archived %d tabs", "Archiving %s: %s" and the ArchiveState+AutoArchive.swift path string.

## Update: own browser started (skeleton, awaiting approval)
- Ghidra pass skipped by the user for now (memory). Decisions: Electron + TypeScript, real skeleton files,
  "in use" = visible OR audible OR picture-in-picture.
- New project: ~/Documents/GitHub/sidebar-browser (not a git repo yet; nothing installed yet).
- Skeleton (code-preview Phase 1): src/shared/{types,settings,ipcChannels}.ts, src/main/{main,state,autoArchive,
  activity,tabViews,store,urls,ipc}.ts, src/preload/sidebarPreload.ts, src/renderer/{index.html,sidebar.ts,sidebar.css},
  tests/{autoArchive,state}.test.ts (it.todo), package.json (electron 44.9.3, typescript 6.0.3, vitest 5.0.5), two tsconfigs.
- Patterns: pure state functions (state.ts, autoArchive.ts) + thin Electron shell; applyChange() single source of truth;
  syncTabViews() reconcile; sidebar renders from state.
- Our own values (not Arc's): refresh in-use every 1 min, sweep every 5 min, prune hourly, keep archive 30 days, default 12 h.
- Next: user approves skeleton (or edits) → npm install → implement one function at a time with explain-back.

## Update: implementation started
- Skeleton approved. `npm install` done (electron 44.9.3, typescript 6.0.3, vitest 5.0.5, @types/node 24.19.2; 0 vulnerabilities).
- Implemented getInactiveDurationMs (autoArchive.ts) + its 2 tests: `npx vitest run tests/autoArchive.test.ts` → 2 passed, 8 todo.
- Waiting on the user's explain-back before the next function (findTabsToArchive).
- Still not a git repo; git init needs the user's explicit yes.

## Update: milestone 1 implemented and verified (one shot, per user request)
- User asked for one-shot implementation without explain-back checkpoints (saved to memory).
- Implemented all skeleton functions. Small signature changes: createInitialState() takes no args; openTab returns
  BrowserState; new private helpers (updateTab, findMostRecentlyUsedTabId, hideShownTab, showTab, layoutShownTabView,
  handleIdMessage, isAllowedArchiveAfter, looksLikeBrowserState, keepBrokenFile, renderArchiveRow, ...).
  Rule change: when the selected tab is archived, the most recently used tab in that Space is selected.
- Tab web views load lazily (only when first shown). Address box lives in index.html so redraws never wipe typing.
- Security added after review: website permissions denied except fullscreen + clipboard-sanitized-write;
  sidebar page blocks will-navigate and window.open.
- Verified: `npm run build` clean; `npm test` 20/20; Playwright _electron end-to-end 23/23 (open, title sync,
  inset bounds 248,8, pin, search, close→archive, view destroyed, restore, setting, Clear, Space switch, frame color,
  persistence across restart); permission check: geolocation/camera/mic/notifications denied, sidebar navigation blocked.
  E2E used a throwaway --user-data-dir; the real ~/Library/Application Support/sidebar-browser was never created.
- Added README.md + docs/screenshot-dark.png.
- Not done: git init (needs user's yes), keyboard shortcuts / app menu, favicons, split view, Command Bar, Peek, Little Arc,
  new-tab-from-link (popups load in the same tab), Space create/rename, drag-and-drop ordering.
