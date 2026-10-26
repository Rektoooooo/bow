# Handoff — 2026-10-26 (second session) — Arc parity

The previous handoff (`2026-10-26-arc-teardown.md`) covers milestone 1 and the first Arc research. This one covers
the long second session on the account that actually uses Arc. The user's instruction: "work however long you need,
try your best to fully reverse engineer Arc, every decision is on you", plus "commit and push for proper version
control". Their Arc screenshots are the visual reference (`reference/arc-ui/`, git-ignored: personal bookmarks).

## Where things stand

- **All green at the last commit:** `npm run build`, `npm test` (117+ unit tests), `npm run e2e`
  (`check-app.mjs` 34 checks, `check-overlay.mjs` 22 checks, `permission-check.mjs`).
- **Research:** the five open auto-archive questions are answered from runtime evidence (no Ghidra needed): default
  12 h (Little Arc 6 h), sweep every 5 min, visible tab refreshed every 60 s, archive capped at 250, inactivity
  restarts at launch. Arc's on-disk data model is written up. See `docs/research/arc-findings.md` §2–§4 and
  `docs/research/arc-data-model.md`.
- **Browser:** Arc-style window and nearly every everyday Arc feature, listed in README.md "What works".
- **Arc data backup:** `~/Arc-Backup-2026-10-26/` on the Arc account (1 GB; personal; never commit).

## Session log (what was decided and why)

1. **Setup on this account.** Clone at `~/Developer/sidebar-browser` (another identical clone exists at
   `~/Documents/GitHub/sidebar-browser`). Node 24 via nvm (`.nvmrc`); Homebrew Node 23 is rejected by Vitest 5.
   Repo-local git author set. `CLAUDE.md` "This Mac" now covers both macOS accounts.
2. **Runtime research instead of Ghidra** (swap was full): schema dump of `StorableSidebar.json` (shapes only),
   statistics on `StorableArchiveItems.json` (idle time at archive, batch spacing, count), a 25-minute live sampler
   of the sidebar file (only the visible tab's `timeLastActiveAt` changes, +60.0 s), preferences key names, the
   help center (Wayback copies), and a strings / Swift-metadata pass (Command Bar ranking features, Peek rules,
   Split View model, sidebar modes, menu titles). Arc's favicon cache files are named `md5(item id)`.
3. **Data model v2** (`src/shared/types.ts`): Arc-like items (tab / folder / split), ordered id lists only,
   profiles with Favorites (max 12), Spaces with theme + profile, migration from v1 (`migrate.ts`).
4. **Arc-style window**: sidebar (Favorites tiles, Space title, Pinned tree with folders, divider + Clear, New Tab,
   Today, bottom bar), toolbar above the page (the user's Arc has `topBarURLEnabled`), per-Space themes with grain,
   drag and drop, native menus, page right-click menu, Arc's keyboard shortcuts as menu accelerators.
5. **Import from Arc** (File menu): sidebar (Spaces, Favorites, folders incl. the GitHub live folder, tabs,
   themes), Arc's cached favicons, archive (newest 250), browsing history (Chromium `History` via `/usr/bin/sqlite3`
   on a temporary copy). Verified read-only on the backup: 3 Spaces, 22 tabs, 2 folders, 4 Favorites, 243 archived
   tabs, 1,279 history pages; a second import adds nothing.
6. **Overlay layer** for floating UI (Command Bar, Library, site controls, Find, Peek frame), added on top only while
   open. **Command Bar ranking** follows Arc's shape: per-feature match scores + boosts + dedupe + current page
   ranked down (`commandBar.ts`), DuckDuckGo suggestions arrive after local results.
7. **Peek** (pinned/Favorite link to another site, or Shift-click), **Little Window** (Little Arc), **Split View**,
   **hover-to-reveal** hidden sidebar (page slides, no reflow), **media player** for background audio, **automatic
   Picture-in-Picture**, downloads, history.
8. **Archive retention changed to Arc's rule** (newest 250) so an imported 60-day archive is not half-deleted.
9. **main.ts split** into `browserCore.ts` (the one state + `applyChange`), `actionRunner.ts`,
   `appMenuCommands.ts`, `tabActions.ts`, `overlayController.ts`, `peek.ts`, `littleWindow.ts`, `media.ts`,
   `arcImportController.ts`.

## Lessons (also in `tasks/lessons.md`)

- Electron's `findInPage({ findNext })`: **true starts a new search** (the name suggests the opposite).
- Playwright inside Electron: `dragAndDrop` hangs (simulate drag events in the page); clicking a link whose
  navigation we cancel hangs (use real mouse events); `capturePage` is how screenshots work without Screen Recording.
- Chromium keeps a paused background tab "audible" for a while; the media player trusts the page's answer.
- Electron 44's clipboard API is async and W3C-style (`clipboard.write([new ClipboardItem(...)])`).

## Next steps (pick in this order)

1. Done since this handoff was first written: profiles UI (Space menu › Profile), private windows (⇧⌘N), resizable
   sidebar (drag the edge; far left hides it), unread dot (Arc's `isUnread`), window bounds remembered.
2. Boosts (per-site CSS), Air Traffic Control (link routing rules to Spaces), Command Bar site search (Tab).
3. Ghidra pass when RAM allows: `itemsToExclude`, cleanup timer interval, Command Bar weights.

## How to verify quickly

```bash
source ~/.nvm/nvm.sh && nvm use && npm test && npm run e2e
node e2e/window-shot.mjs      # regenerates docs/screenshot-*.png from sample data
```
