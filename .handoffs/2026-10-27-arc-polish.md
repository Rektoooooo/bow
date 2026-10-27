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
  dims (black 55 %); round black Close / Open as Tab / Split buttons stacked right of it.

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
- Arc's peeking sidebar is darker than its frame (a material over the page); ours keeps the frame's gradient.

## Next (approved order)

4. Library in the sidebar column (see `tasks/todo.md` 3.7 for the measured spec), 5. closed-folder hover list,
then AppleScript, GitHub releases with auto-update, notarization (credentials only in the user's keychain).

## Shared checkout

Another session (the repository review) had uncommitted edits in `e2e/check-extensions.mjs`,
`e2e/fixtures/extension-native/background.js` and `src/overlay/siteControls.ts`; they were never staged. Local `main`
carries the same trees as origin under different hashes (each step was committed locally, then cherry-picked onto
origin/main in a temporary worktree, tested there and pushed). `origin/main` is the one to trust; a plain `git pull`
will not fast-forward the local branch.
