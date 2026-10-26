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

## This Mac
- Two macOS accounts; facts differ per account (Homebrew owner, Node location, gh accounts). Check `whoami` and the
  "This Mac" section of `CLAUDE.md` before installing anything.
