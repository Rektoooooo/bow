# Lessons

Rules learned while working on this repo, so the same mistake is not made twice.

## Version control
- **Commit and push after every verified step.** The user wants proper version control on GitHub, not one big push at
  the end (2026-10-26). A step counts as verified when build, unit tests, e2e and the permission check pass.
- Commit as the repo-local author (Rektoooooo noreply). A fresh clone does not have it: set it before the first commit.
- Never stage personal data: the user's Arc bookmarks/titles, their real name, `reference/` screenshots. Grep the
  staged diff before each push.

## Testing
- Playwright's `dragAndDrop` hangs inside Electron on macOS (it starts a real OS drag). Simulate HTML drag events in
  the page instead (`simulateDrag` in `e2e/check-app.mjs`).
- Vitest picks up test files in agent worktrees under `.claude/`; `vitest.config.ts` excludes them.
- Chromium logs a 404 for a missing `/favicon.ico` as a console error; that is expected, not a page bug.
- Electron's `findInPage` option `findNext` means "start a new find session": **true for the first request**, false
  for next/previous. Passing false on the first request makes Chromium silently ignore it (no `found-in-page` at all).
  Read the option's doc comment in `node_modules/electron/electron.d.ts` before trusting a name.
- When the same failure survives two different fixes, stop changing remedies: run an experiment that splits the
  possibilities (same object? same call? same options?), and compare a working call with the failing one field by field.
- example.com's body text no longer contains "Example" (only its title does); search for "domain" in tests.
- `webContents.removeInsertedCSS()` does not remove CSS inserted with `{ cssOrigin: "user" }` (Electron 44). Insert
  Boost CSS with the default author origin, and serialize insert/remove per page.

- `addAfterSyncHook` hooks run only when the set of *shown page views* changes, not on every state change. Anything
  that must follow the state (extensions turning on/off) listens with `onStateChanged` in `browserCore.ts`.
- An e2e check that passes without the fix it is meant to cover proves nothing: run it against the old code first.
  Playwright's separate `fill` and `press` calls are slower than our IPC, so "fast typing" races need same-tick
  events, and a stale result only matters if its id also exists in the new results.

## Dependencies
- Check a package's license **per version** and diff a just-published release against the previous one before
  adding it (electron-chrome-extensions 4.9 was GPL with a runtime license check; 4.10, one day old, is MIT and only
  removed that check). Pin exact versions.

## This Mac
- Two macOS accounts; facts differ per account (Homebrew owner, Node location, gh accounts). Check `whoami` and the
  "This Mac" section of `CLAUDE.md` before installing anything.
