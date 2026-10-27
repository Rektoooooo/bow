# Handoff — 2026-10-27 — Polish against the real screen, and Arc's fixes 3, 6, 7

Previous handoffs: `2026-10-27-multiple-windows.md` (newest before this one), `2026-10-26-arc-look.md`,
`2026-10-26-arc-parity.md`, `2026-10-26-arc-teardown.md`. This one covers `tasks/todo.md` 3.7 after the active-window
look (1) and the theme editor / icon picker (2): a polish tour of our own window against the user's Arc, then the
approved fixes Peek (3), tab tooltip (6) and sidebar width (7). The user was away and asked for a report at the end.

## What changed (on origin/main)

- `7211ac4` Polish against the real screen:
  - Icons fade in a background window while text does not, like Arc's AppKit controls (measured: Arc's sidebar
    toggle, Archive and + 25–30 % white in the background, 56–57 % active; switcher dots 9 % / 17 %; the current
    Space's switcher icon 47 % / 94 %; toolbar buttons 25 % in the background, disabled or not, 65 % active).
  - Toolbar address 74 % white (Arc 73–75 % in both states; ours was 92 %).
  - The Space title's icon is near-white (93 %) like Arc's, not grey like the name; our planet drawing refitted to
    Arc's proportions (sphere 12 pt, ring 24°, a gap where the ring passes in front); solid icon parts have no
    outline.
  - Tab titles at weight 450 (Arc's render lighter than Chromium's medium; ink measured on three titles).
  - New Tab keeps the row pitch right after Pinned (Arc's shot 4).
  - The peeking sidebar is a floating panel like Arc's: 5 pt from the window edges, 12 pt corners, a light rim;
    its header stays level with the native traffic lights.
- `fa4360b` Arc's tab tooltip instead of our page preview card: title, plus "Double-click to rename" on the selected
  tab only (Arc's other tabs show the title alone), 29 / 44 pt tall, black, beside the pointer, gone as soon as the
  pointer moves (the overlay view is removed at once so it never catches a click).
- `f85eebe` Import from Arc carries the sidebar width over: StorableWindows.json `sidebarWidth` reaches the page
  card (254 → card at x = 254), ours stops 7 pt earlier, so the first import sets 247. **Only on a first import**:
  a profile that already has Arc's Spaces keeps its width (drag the edge, or import into a fresh profile).
- `9fe877e` Arc's Peek: the card hangs from the window's top edge with its own 44 pt toolbar row (back, forward,
  reload, address) in the frame's color, 80 % of the page card wide, 12 pt above the bottom; only the page card
  dims (black 55 %); round black Close / Open as Tab / Split buttons stacked right of it. (Its first suite run had
  three Capture failures — a live YouTube page loading slowly — and was pushed by mistake before the summary was
  read; the rerun passed everything. Lesson in `tasks/lessons.md`.)
- `49827f6` Arc's Library in the sidebar column: the column widens to 410 pt (card at 417) at any sidebar width, a
  112 pt rail (Media, Downloads, Spaces, Boosts, Archived Tabs, then our History, Extensions, Settings) with the
  list beside it; the overlay is exactly the column and draws see-through over the sidebar's frame; the page glides
  aside (`check-motion`). Spaces spread over the window in columns: not done (Library › Spaces is a list).
- Closed-folder list (after `027a559`): rest on a closed folder → its tabs beside the sidebar, newest first, "1 minute
  ago", a focused search field; closes 300 ms after the pointer left the row and the list (each page reports its
  side to main; a cursor poll could not be tested, since Playwright never moves the real cursor).

- Our own picture-in-picture window (the user did not like Chromium's controls; Electron 44 has no Document
  Picture-in-Picture). `main/pictureInPicture.ts`: leaving a tab whose video plays with sound moves **the tab's own
  page view** into a frameless `BaseWindow` (`type: "panel"`, not focusable, floating on every Space, system rounded
  corners and shadow, aspect ratio of the video, 400 pt wide bottom-right, last place remembered for the run). An
  author style sheet (`!important`, every rule scoped to a mark on `<html>`) makes the marked video fill the page and
  hides the rest; a see-through controls view (`src/pip`, own preload) lies on top: title pill, Back to Tab
  (`pip.exit`), close, play / pause, mute (the tab's mute), progress with seek, time. Hover comes from a 100 ms cursor
  poll, because the background is a drag region. Back to Tab selects the tab (the main window takes the view back)
  and brings the app forward; Close pauses the video, like Chromium's. `check-overlay` drives it at its end.
- Sound effects removed (the user: "no one does that"): `renderer/sounds.ts`, the Library switch, the action and the
  optional `areSoundEffectsOn` setting are gone; a stray key in an old saved file is ignored, so no version bump.

## How it was measured (keep doing it this way)

- Our window: `screencapture -x -o -l <windowNumber>` (the number comes from `getMediaSourceId()`), converted from
  the display's profile to sRGB with PIL ImageCms. Arc: `reference/arc-live/test-window.png` (a live capture of the
  user's Arc, background window, already sRGB) and the user's screen recordings (`reference/arc-live/recording*/`,
  active window, frames named fNNNN.png; `sheet-*.png` are contact sheets). All git-ignored, personal.
- A throwaway script launched our app at Arc's window size (1920 × 1049, sidebar 254) with a sidebar shaped like the
  user's, pages from a local HTTP server, and captured each state (rest, hover, Command Bar, Control Center, Library,
  sidebar hidden / peeking, Find, a light page, tooltip, Peek). It is not in the repo because it held the user's tab
  titles; rebuild it from `e2e/window-shot.mjs` with made-up titles.
- Compare strengths as "fraction of white over the background" (peak − background) / (255 − background), and text
  weight as summed ink normalized by the peak (coverage); widths from ink extents. Our captures while nobody is at the
  keyboard are always background windows (macOS gives no focus); force `data-window="active"` on the sidebar page to
  check the active tokens.

## Known limits

- The Peek's page keeps rounded top corners under its toolbar row (Electron gives a view one radius for all corners).
- ⌘[ / ⌘] / ⌘R from the menu act on the selected tab, not on a Peek (only the Peek's own row buttons act on it).
- Light Spaces: the new icon tokens were set by analogy; no light Arc capture exists to measure against.
- Picture-in-picture: YouTube would not play under automation (it pauses a start it did not make), so the style
  takeover was proven on a local page with a sticky header and a transformed container, not on YouTube itself. The
  drag region was not tried with a real drag (no event posting here; the debug paint mode froze the panel). Videos
  inside iframes (embedded players) and shadow DOM are not found; one window at a time, a new one pauses the old.
- Arc's peeking sidebar is darker than its frame (a material over the page); ours keeps the frame's gradient.

## Next (approved order)

AppleScript (the user drives Arc from Raycast), then GitHub releases with auto-update and notarization (credentials
only in the user's keychain, never in this public repo).

AppleScript needs more than Electron offers: the standard suite (open a URL) works through `open-url`, but Raycast's
Arc commands use Arc's own dictionary (windows, tabs, Spaces, `make new tab`, `URL of active tab`). An Electron app
can ship an `.sdef` and `NSAppleScriptEnabled` in Info.plist, but answering custom Apple Events needs native code
(an Objective-C addon registering NSScriptCommand handlers, or `NSAppleEventManager` handlers that forward to main).
Decide with the user: a small native addon (build tooling, signing) or a URL-scheme / CLI bridge that Raycast script
commands can call instead.

## Shared checkout

Another session (the repository review) had uncommitted edits in `e2e/check-extensions.mjs`,
`e2e/fixtures/extension-native/background.js` and `src/overlay/siteControls.ts`; they were never staged. Local `main`
carries the same trees as origin under different hashes (each step was committed locally, then cherry-picked onto
origin/main in a temporary worktree, tested there and pushed). `origin/main` is the one to trust; a plain `git pull`
will not fast-forward the local branch.
