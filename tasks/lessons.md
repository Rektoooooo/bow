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

- Load-dependent races: reproduce them with `for n in $(seq 1 12); do (yes > /dev/null &); done` around the run
  (then `pkill -x yes`), and record the observed value in the check's detail so a failure says what it saw.
- Electron's session `extension-ready` fires in the same tick `loadExtension` resolves; neither means the content
  scripts are ready. Test what we guarantee (loaded before the window), not Chromium's internal timing.

- An uncaught exception in the main process shows a modal error dialog, and that dialog keeps the app from quitting.
  Page events still arrive while quitting: `getWindow()` returns null once the window is destroyed; never hold a
  `BrowserWindow` reference across that without `isDestroyed()`. Install an `uncaughtException` listener in a
  throwaway check to see the stack.
- On macOS, `getUserMedia` waits on the system's camera/microphone dialog before our permission handler runs, so
  e2e checks use notifications for the prompt flow.

- `webContents.executeJavaScript` on a window that is closing never resolves, so an `app.evaluate` that asks every
  window something hangs the whole check (no timeout, no output). Skip destroyed windows and race such calls with a
  short timeout (`describeWindows` in `e2e/check-windows.mjs`). Pipe a check through `| tail` and a hang shows nothing
  at all: write to a log file and watch it instead (`E2E_DEBUG=1` streams the main process there).
- Electron 44 facts, checked with a throwaway script: `addChildView` into another window moves the view out of its
  old parent, and closing a window does not destroy its child views' pages.

- A saved-shape version bump also breaks `e2e/check-app.mjs`, which asserts the upgraded file's version: grep
  `e2e/` for `version ===` with every bump (missed twice on 2026-10-27).

## Matching Arc from screenshots
- Screen captures: Claude Desktop runs our commands through its own "Claude Code" app (com.anthropic.claude-code,
  started via a `disclaimer` helper), so Screen Recording must be granted to that app, not only to Claude. The list
  in System Settings may not show it after adding; test with `screencapture -l <window number>` (the number is in
  `BrowserWindow.getMediaSourceId()`). Captures carry the display's colour profile while the reference shots are
  sRGB: convert with PIL's ImageCms before comparing pixel values.
- When a reference screenshot shows a state I don't recognize, ask the user what it shows before deriving a feature
  from it. (Shot 5 was Arc's per-site Developer Mode; I had planned it as a global "Show full URL" option.)
- The user's screenshots are 1 px per point (macOS window shadow: window at 56, 38). Measure with
  `node e2e/arc-compare.mjs` and pixel scans, never by eye; a wrong scale (I first assumed 0.985) shifts everything.
- Chromium blends translucent colors in the display's color space, so an rgba overlay comes out brighter than the
  sRGB arithmetic says. Calibrate alphas against the reference pixels, not by computing them.
- `View.setBounds(…, { animate })` reports the end place at once and cannot be verified without screen recording;
  step the bounds ourselves when motion must be provable.
- Check the traffic lights before calibrating colors: grey lights mean the window was inactive. All five of the
  user's shots are inactive, so every token is matched to an inactive Arc; what Arc changes when active is unknown
  until there is an active shot. Ask for one before tuning "too dim" / "too bright" differences.
- Compare every state a shot shows, not only the resting one: with the Command Bar or Control Center open, Arc's
  frame stays #313131 (no dimming). I had a 30 % backdrop under both for a whole session; measuring the frame pixel
  of shots 3 and 4 found it.

## Dependencies
- Check a package's license **per version** and diff a just-published release against the previous one before
  adding it (electron-chrome-extensions 4.9 was GPL with a runtime license check; 4.10, one day old, is MIT and only
  removed that check). Pin exact versions.

## This Mac
- Two macOS accounts; facts differ per account (Homebrew owner, Node location, gh accounts). Check `whoami` and the
  "This Mac" section of `CLAUDE.md` before installing anything.
