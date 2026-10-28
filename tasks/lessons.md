# Lessons

Rules learned while working on this repo, so the same mistake is not made twice.

## Version control
- **Commit and push after every verified step.** The user wants proper version control on GitHub, not one big push at
  the end (2026-10-26). A step counts as verified when build, unit tests, e2e and the permission check pass.
- Commit as the repo-local author (Rektoooooo noreply). A fresh clone does not have it: set it before the first commit.
- Never stage personal data: the user's Arc bookmarks/titles, their real name, `reference/` screenshots. Grep the
  staged diff before each push.
- Push in its own command, only after reading the suite's summary. Never chain `git push` after a command that
  merely prints the results: on 2026-10-27 a grep of an e2e log (3 FAIL lines, exit 1) and the push ran in one call,
  and a red run went to GitHub. Read the summary, then push.
- A push gets a command of its own too, and its result is read before anything builds on it: on 2026-10-28
  `git push … | tail -1 && npm run release` built and notarized a commit GitHub had refused (the owner had edited the
  README on github.com meanwhile), and the release could not point at it. `git fetch` first, and check
  `git merge-base --is-ancestor <commit> origin/main` before a release or a tag.
- The same for the personal-data grep: run it alone, read it, then push. On 2026-10-28 the grep printed two hits (the
  signing team's id and company name in a handoff's runbook) in the same call as the push, and they went public.
  Team ids, certificate names and Apple IDs never go into the repo, not even in docs: write placeholders.
- Comments count as personal data too: a comment that named the user's tab titles as measurement samples had to be
  reworded before a push. Write "three of the user's titles", never the titles.

## Testing
- Check that what should be seen is visible, not only where it is: a picture-in-picture video passed "fixed and
  filling the window" while a broader selector had made it `visibility: hidden` (2026-10-28; the test tone has no
  picture, so nothing else could notice). In injected style sheets full of `!important`, specificity decides: write the
  winning rule's selector so it is more specific than the rule it must beat.
- Synthetic drag events (and Playwright's) prove nothing about a real macOS drag: our HTML drag and drop passed every
  test while the user could not pick a tab up at all (2026-10-27). Sidebar items now move with pointer events, which
  Playwright's mouse drives for real; keep it that way.
- Playwright's mouse leaves each page's pointer where it last was, and a hover-driven panel that later opens under
  that spot gets a `mouseenter` (removing an unrelated click made the ⌃Tab switcher start on the wrong card). Move
  the pointer somewhere neutral before checking anything that reacts to hover.
- Window dragging cannot be driven from a test (Playwright's mouse never reaches the native window, and posting real
  mouse events needs a permission we do not have). Check drag regions with `ELECTRON_DEBUG_DRAGGABLE_REGIONS=1`
  (Electron 44.3+): it paints the regions main hit-tests on the page, and a window capture shows them. Since
  Electron 44 `-webkit-app-region` is inherited, so a no-drag container makes everything inside it no-drag.
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
- A check that needs a real site's address must not load the real site: the Web Store sends a made-up extension id
  to Google's consent page within a second, so the toolbar pill vanished and looked like a bug. Network emulation
  "offline" does not stop page navigations; `session.protocol.handle("https", …)` serving a stand-in page does
  (plus `app.on("session-created")` for profiles made during the check). Main's `net.fetch` can be replaced from
  `app.evaluate` (checked 2026-10-27), which is how check-extensions serves its CRX.

- This checkout can be shared with other sessions that leave uncommitted edits. Stage explicit paths only (never
  `git add -A` or a file you did not change: one commit swept in another session's CLAUDE.md edit), and when their
  edits block a pull, integrate in a temporary `git worktree` on origin/main (symlink node_modules), test there and
  push from it, instead of stashing their work.
- Rerun a lone `check-performance` failure before suspecting the code: under heavy machine load (load average ~28)
  a redraw measured 22 ms, then 8 ms twice on the same build.

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

## Electron APIs
- `webContents.removeInsertedCSS(key)` only removes **author** style sheets: a sheet inserted with
  `cssOrigin: "user"` stays for good (the picture-in-picture takeover left pages blank). Insert author sheets with
  `!important`, and scope injected rules to a mark you can take off, so the page recovers even if removal fails.
- A view's corner radius is all four corners or none (`View.setBorderRadius`), and a rounded plain `View` does not
  clip a `WebContentsView` inside it on macOS (tried 2026-10-27). Hiding a corner behind a sampled colour fails
  whenever the colour is unknown or the page dims or changes its top; draw what lies behind instead (cornerMasks.ts).
- `ELECTRON_DEBUG_DRAGGABLE_REGIONS=1` froze the app when a `type: "panel"` window opened; check drag regions in other
  windows only.
- Electron hit-tests the drag regions of **every** view in a window, whatever lies on top (`NativeWindow::
  NonClientHitTest` loops over all providers): a button in the overlay above the sidebar's `app-region: drag` toolbar
  moves the window instead of being clicked. Turn the regions underneath to `no-drag` while a floating layer covers
  them. Playwright's clicks go to the page directly and never meet this, so e2e checks cannot catch it.
- Playwright's mouse never moves the system pointer: `screen.getCursorScreenPoint()` is wherever the real mouse is.
  Code that needs "what was clicked" should ask the page (by address, focus) and use the pointer only as a hint.

## Dependencies
- Check a package's license **per version** and diff a just-published release against the previous one before
  adding it (electron-chrome-extensions 4.9 was GPL with a runtime license check; 4.10, one day old, is MIT and only
  removed that check). Pin exact versions.

## This Mac
- Never `pkill -f` with a pattern that also appears in the command line running it: it kills its own shell (happened
  twice on 2026-10-27). Find the pid with `pgrep` first and `kill` that pid.
- Two macOS accounts; facts differ per account (Homebrew owner, Node location, gh accounts). Check `whoami` and the
  "This Mac" section of `CLAUDE.md` before installing anything.
