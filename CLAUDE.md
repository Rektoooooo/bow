# CLAUDE.md — Sidebar Browser

An Arc-style desktop browser in Electron + TypeScript, built after studying Arc 1.170.0 with REA.
Public repo: https://github.com/Rektoooooo/sidebar-browser

## Start here

1. Read the newest file in `.handoffs/` (`2026-10-27-multiple-windows.md`, then `2026-10-26-arc-look.md`,
   `2026-10-26-arc-parity.md` and the oldest).
   They have the history, decisions, how the look is measured, status and next steps.
2. Arc research: `docs/research/arc-findings.md` (text), `docs/research/arc-data-model.md` (how Arc stores the
   sidebar and archive on disk) and `docs/arc-teardown.html` (feature map, all 54 features, with what is built here).
3. Reverse-engineering tools and how to resume the Ghidra pass: `docs/research/reverse-engineering-setup.md`.
4. Open work: `tasks/todo.md`.

## Commands

```bash
source ~/.nvm/nvm.sh && nvm use   # Arc account only: Node 24 from .nvmrc
npm install
npm start            # build + open the browser
npm test             # Vitest unit tests (pure state rules, ranking, importers)
npm run e2e          # build + drive the real app: check-app, check-overlay, check-extensions, permission-check,
                     # check-motion (layout changes glide instead of jumping), check-live-folders (local feed + fake
                     # GitHub via --github-origin), check-performance (331-tab sidebar redraws within a frame),
                     # check-windows (⌘N, a Space and selection per window, restart restores every window)
node e2e/window-shot.mjs   # README screenshots from sample data → docs/screenshot-*.png
node e2e/arc-compare.mjs   # side-by-side crops with the user's Arc screenshots (reference/, local only) → e2e/output
npm run package      # release/Sidebar Browser-darwin-arm64/Sidebar Browser.app (ad-hoc signed, git-ignored)
node e2e/check-package.mjs # checks that packaged app (Info.plist, menu, links from other apps)
tools/make-icon.sh   # redraws build/icon.icns from tools/make-icon.cjs (our own icon design)
```

`npm run e2e` opens real windows on screen for a few minutes and uses throwaway `--user-data-dir` folders under
`e2e/output/`, so the real state in `~/Library/Application Support/Sidebar Browser/` is never touched (the folder
is named after `productName`; `npm start` and the packaged app share it).
Playwright's `dragAndDrop` and `click` on links that open a Peek hang in Electron; see `tasks/lessons.md`.

## Architecture rules (keep them)

- **Pure core.** `state.ts`, `spaces.ts`, `split.ts`, `tree.ts`, `windows.ts`, `autoArchive.ts`, `commandBar.ts`,
  `history.ts`, `layout.ts`, `migrate.ts` and the Arc importers take data in and return a changed copy. No Electron, no
  `Date.now()` inside; `now` is a parameter. Return the *same object* when nothing changed.
- **Data model** (`src/shared/types.ts`, version 4) follows Arc's: every sidebar object is an item; order lives only
  in ordered id lists (profile Favorites, Space Pinned / Today, folder and split children). No parent pointers.
  A saved-shape change needs a version bump and an upgrade step in `migrate.ts`.
- **One way to change state.** Only `applyChange()` in `src/main/browserCore.ts` replaces the state; it saves, calls
  `syncTabViews()`, keeps floating layers (overlay, Peek) on top and pushes state to the sidebar. Runtime facts that
  are not saved (loading, sound, downloads, media, sidebar peek) go out separately as `RuntimeState`.
- **Several main windows** (⌘N, `mainWindows.ts`). The focused window's Space and selection are the usual
  `activeSpaceId` / `selectedTabIdBySpace`, so every pure function acts on "the focused window"; the other windows'
  are parked in `otherWindows` and swapped in on focus (`windows.ts`). Each sidebar gets the state projected for its
  window. `getWindow()` is the last focused main window (never `BrowserWindow.getFocusedWindow()`). A page view has
  one parent: it stays with the window that shows it, another window shows "Open in another window" (Notes and
  Easels follow the same one-window rule). The overlay, Peek and status bubble move to the focused window when they
  open. Each window also has its own sidebar (shown or hidden, width), collapsed Pinned sections and open folders,
  like Arc's StorableWindows; a new window takes the last closed window's sidebar. Items can be dragged from one
  window's sidebar into another's (main carries the dragged item's id between the windows).
- **Actions.** The sidebar sends one `BrowserAction` (`src/shared/actions.ts`) on one channel; `ipc.ts` checks every
  field (`parseAction`) and only from our own pages; `actionRunner.ts` runs it. Menu items live in `appMenu.ts`
  (accelerators = Arc's shortcuts) and `appMenuCommands.ts`; the Command Bar's actions reuse them.
- **Reconcile.** `syncTabViews()` (`tabViews.ts`) makes the web views match the state. Views are lazy: a tab gets a
  `WebContentsView` the first time it is shown, in its profile's session partition (`profiles.ts`).
- **Floating UI** lives in one transparent overlay view (`overlay.ts` / `overlayController.ts`, pages in
  `src/overlay`): Command Bar, Library, site controls, Find, the Peek frame. Peek's page is its own view above it
  (`peek.ts`). Little Windows are separate windows (`littleWindow.ts`, bar page in `src/little`).
- **Render from state.** `src/renderer/sidebar.ts` redraws the sidebar and toolbar on every state; redraws wait while
  a drag is in progress.
- **Constants** live in `src/shared/settings.ts` with a comment on where each value comes from (measured from Arc,
  Arc's help center, or "our choice").
- **Channel names** live in `src/shared/ipcChannels.ts` and `src/shared/overlay.ts`. Sandboxed preloads cannot import
  our files, so they repeat the names typed as `typeof …` (the build fails on a mismatch).
- **Extensions.** `extensionList.ts` (pure, `BrowserState.extensions`, per profile) says what should run;
  `extensionHost.ts` makes each profile session match it on every state change (`onStateChanged`) and loads before
  the first page at startup. Electron runs content scripts and MV3 service workers; `electron-chrome-extensions`
  (MIT since 4.10.0, pinned; 4.9 and older are GPL with a license check) adds tabs, popups and context menus. Its
  `api` is private in the typings; we call `api.browserAction.activateClick` for our own toolbar menu. Test
  extensions are synthetic (`e2e/fixtures/`), never copied from a real profile. Web Store installs and updates are
  our own (`crx.ts` verifies CRX3 signatures, `webStoreInstall.ts` unpacks with `/usr/bin/unzip`, refuses symlinks
  and non-Chrome versions, writes the key so the id stays the Web Store id); copies live in
  `<userData>/Extensions/<id>/<version>/` and are deleted only one by one when nothing uses them.
- **Security:** web pages stay sandboxed and get no preload, except in a profile that has extensions: there the
  extension library's preload runs in an isolated world (page scripts see nothing new); website permissions are
  installed per session in `profiles.ts`: `fullscreen` and `clipboard-sanitized-write` are allowed, camera,
  microphone, location, notifications and clipboard reading go to a prompt (`permissionPrompts.ts`, answers in
  `BrowserState.sitePermissions` per profile and origin; private windows never save), screen sharing goes to
  macOS's sharing picker (`setDisplayMediaRequestHandler` with `useSystemPicker`), everything else and anything
  from our own pages is refused. Our pages block `will-navigate` and `window.open`. `e2e/permission-check.mjs`
  proves it. Keep it passing.
- Build output: `dist/node` (main + preloads, CommonJS) and `dist/web` (sidebar, overlay and Little Window pages,
  ES modules).

## Code style

The owner must be able to explain every line to a reviewer:

- Full descriptive names; no single letters or abbreviations.
- At most two levels of nesting; use early returns.
- No clever one-liners or chained calls on computed values; use named intermediate variables.
- No helper or abstraction before the third repetition.
- Comments explain why, not what. Every file starts with a header: WHY this file exists / Data source / Data flow.
- No magic numbers; name them in `settings.ts` (or at the top of the file) with their source.

## Working with this user

- Once a plan or skeleton is approved, implement it in one go, then build, test, run the app, and report once.
  No per-function explain-back checkpoints (the user asked for this explicitly).
- Commit and push after every verified step (build + `npm test` + `npm run e2e` green), so GitHub always has a
  working version. The user asked for this explicitly (2026-10-26). Before each push, check that no personal data
  (the user's Arc bookmarks, names, `reference/` screenshots) is staged.
- Still ask before other outward-facing steps (publishing releases, installing new tools).

## Git and GitHub

- `main` tracks `origin` = `https://github.com/Rektoooooo/sidebar-browser.git` (public).
- Commits in this repo use the repo-local author `Rektoooooo <95218813+Rektoooooo@users.noreply.github.com>`
  (already set in `.git/config`). Do not commit with the machine's global identity, which is a work address.
- Run `gh auth status` first. On the Arc account (below) the only gh account is Rektoooooo, so
  plain `git push` works. On the other account, gh has two accounts and the **active one is a work account** that
  must stay active: do not `gh auth switch`; use the personal token per command:

  ```bash
  GH_TOKEN="$(gh auth token --user Rektoooooo)" gh repo view Rektoooooo/sidebar-browser
  GH_TOKEN="$(gh auth token --user Rektoooooo)" git -c credential.helper= \
    -c 'credential.helper=!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f' push
  ```

## This Mac (gotchas)

One Mac, two macOS accounts. Check which one you are on (`whoami`).

- **The Arc account** (the one that uses Arc and owns Homebrew; clone at `~/Developer/sidebar-browser`):
  Homebrew works. The default `node` is Homebrew 23.10, which Vitest 5 rejects; Node 24 is installed with nvm,
  which the shell does not load. Prefix commands with
  `source ~/.nvm/nvm.sh && nvm use` (reads `.nvmrc`). Arc's real data is here; a full copy is in
  `~/Arc-Backup-2026-10-26/` (personal, never commit it). REA and Ghidra are not installed on this account.
- **The other account** (where milestone 1 was built): Homebrew belongs to the Arc account, so `brew install`
  fails. Tools live in `~/.local` (Node 24.22.1 first on PATH, JDK 21, Ghidra 12.1.4, REA).
- 16 GB RAM and swap is often full. Check `sysctl vm.swapusage` before heavy work like a Ghidra import.
- Screenshots: `e2e/window-shot.mjs` composites window captures, so it works without Screen Recording permission.
- `reference/` (git-ignored) holds the user's Arc screenshots. They show personal bookmarks: never commit them.

## Arc material

Use Arc only to understand behavior. Never copy Arc's code, icons, Lottie files, sounds, videos, shaders, or rule
lists (tidy titles, ad-block list, keepalive list) into this project, and never use Arc's name or logo for it.
