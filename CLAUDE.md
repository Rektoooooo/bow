# CLAUDE.md — Sidebar Browser

An Arc-style desktop browser in Electron + TypeScript, built after studying Arc 1.170.0 with REA.
Public repo: https://github.com/Rektoooooo/sidebar-browser

## Start here

1. Read the newest file in `.handoffs/`. It has the full history, decisions, status and next steps.
2. Arc research: `docs/research/arc-findings.md` (text) and `docs/arc-teardown.html` (feature map, all 52 features).
3. Reverse-engineering tools and how to resume the Ghidra pass: `docs/research/reverse-engineering-setup.md`.
4. Open work: `tasks/todo.md`.

## Commands

```bash
npm install
npm start            # build + open the browser
npm test             # 20 Vitest unit tests (state + auto-archive rules)
npm run e2e          # build + drive the real app with Playwright (23 checks + permission check)
node e2e/window-shot.mjs   # dark-mode README screenshot → e2e/output/real-window-dark.png
```

`npm run e2e` opens real windows on screen for about a minute and uses a throwaway `--user-data-dir` under
`e2e/output/`, so the real state in `~/Library/Application Support/sidebar-browser/` is never touched.

## Architecture rules (keep them)

- **Pure core.** `src/main/state.ts` and `src/main/autoArchive.ts` take state in and return a changed copy.
  No Electron, no `Date.now()` inside; `now` is a parameter. Return the *same object* when nothing changed.
- **One way to change state.** Only `applyChange()` in `src/main/main.ts` replaces the state; it saves,
  calls `syncTabViews()` and pushes the state to the sidebar.
- **Reconcile.** `syncTabViews()` (`src/main/tabViews.ts`) makes the web views match the state. Views are lazy:
  a tab gets a `WebContentsView` the first time it is shown. Closed tabs call `webContents.close()`.
- **Render from state.** `src/renderer/sidebar.ts` rebuilds `#sidebar-content` and `#sidebar-footer` on every state.
  The address box lives in `index.html` so a redraw never wipes typing.
- **Constants** live in `src/shared/settings.ts` with a comment on where each value comes from.
- **IPC channel names** live in `src/shared/ipcChannels.ts`. The sandboxed preload cannot import our files,
  so `src/preload/sidebarPreload.ts` repeats them typed as `typeof IPC_CHANNELS` (the build fails on a mismatch).
- **Security:** web pages get no preload and stay sandboxed; website permissions are refused except
  `fullscreen` and `clipboard-sanitized-write`; the sidebar page blocks `will-navigate` and `window.open`.
  `e2e/permission-check.mjs` proves it. Keep it passing.
- Build output: `dist/node` (main + preload, CommonJS) and `dist/web` (sidebar page, ES modules).

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
- Still ask before outward-facing steps (pushing, publishing, installing new tools).

## Git and GitHub

- `main` tracks `origin` = `https://github.com/Rektoooooo/sidebar-browser.git` (public).
- Commits in this repo use the repo-local author `Rektoooooo <95218813+Rektoooooo@users.noreply.github.com>`
  (already set in `.git/config`). Do not commit with the machine's global identity, which is a work address.
- `gh` on this Mac has two accounts; the **active one is a work account** and must stay active. Do not
  `gh auth switch`. Use the personal token per command:

  ```bash
  GH_TOKEN="$(gh auth token --user Rektoooooo)" gh repo view Rektoooooo/sidebar-browser
  GH_TOKEN="$(gh auth token --user Rektoooooo)" git -c credential.helper= \
    -c 'credential.helper=!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f' push
  ```

## This Mac (gotchas)

- Homebrew belongs to another macOS account: `brew install` fails. Install tools into `~/.local` instead
  (Node 24.22.1 is there and first on PATH).
- 16 GB RAM, often two macOS accounts logged in and swap nearly full. Check `sysctl vm.swapusage` before heavy
  work like a Ghidra import.
- The shell has no Screen Recording permission: `screencapture` fails; `e2e/window-shot.mjs` composites instead.

## Arc material

Use Arc only to understand behavior. Never copy Arc's code, icons, Lottie files, sounds, videos, shaders, or rule
lists (tidy titles, ad-block list, keepalive list) into this project, and never use Arc's name or logo for it.
