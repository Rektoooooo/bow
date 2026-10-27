# Handoff — 2026-10-27 — Multiple main windows (⌘N, like Arc)

Previous handoffs: `2026-10-26-arc-look.md` (milestone 3, newest before this one), `2026-10-26-arc-parity.md`,
`2026-10-26-arc-teardown.md`. This one covers `tasks/todo.md` 3.5. Multiple main windows had been deferred (the
user's Arc never had more than one); the user asked what it was, and it was built 1:1 with Arc's behavior.

## What it does

- File › New Window (⌘N, also in the Command Bar) opens another full window: the same Spaces, Favorites, Pinned and
  Today lists, its own active Space and its own selected tab per Space. It opens on the Space the focused window
  shows, with nothing selected and the Command Bar open for a new tab (our choice: a new window is for something
  new; a copied selection could only show placeholders). It cascades 22 pt from the window it came from.
- A WebContentsView has one parent, so a page is on screen in one window at a time. It stays with the window that
  shows it; another window selecting it gets "Open in another window" with **Move to This Window** (action
  `moveTabToThisWindow`). A page let go of (the window selected something else) goes to a window that still selects
  it in the same change.
- Menus, shortcuts, the Command Bar actions and sidebar actions act on the focused window. The overlay (Command Bar,
  Library, Control Center, Find, prompts), Peek and the status bubble go into the focused window when they open,
  and close when another main window takes the focus (a click there is a click outside; a permission prompt closed
  this way is refused once, nothing saved).
- File › Close Window (⇧⌘W) closes the window in front (a Little Window too). The app quits with the last main
  window. ⌘Q keeps every window for the next start; closing a window by hand removes it, except the last one.
- Little Windows' Open in Space, links routed by Air Traffic Control and a second launch go to the last focused
  main window.
- The window list is restored at start: each window's Space and selection from `browser-state.json`, its place from
  `window-state.json` (now a map of window id → bounds; the old single rectangle belongs to `window-1`).

## Closer to Arc (3.6, same day)

The user's Arc backup (StorableWindows snapshots, read only) shows what Arc keeps per window: `sidebarMode`
(anchored / noChrome), `sidebarWidth`, `spacesWithCollapsedPinnedSections` and `expandedItems` (open folders). The
top-level `sidebarViewPreferences` is not updated on every toggle (three snapshots have one open window that
differs from it); every snapshot fits "the sidebar of the last window closed", and new windows start from it.

- **Piece 1 (saved shape v4):** `ParkedWindow` (was `WindowSelection`) also holds `isSidebarVisible`,
  `sidebarWidth`, `collapsedPinnedSpaceIds` and `openFolderIds`. The focused window's values stay in
  `settings.isSidebarVisible` / `sidebarWidth`, `Space.isPinnedOpen` and `FolderItem.isOpen`, so ⌘S, the width drag,
  the Pinned header and folder toggles act on the focused window with the same pure functions; `windows.ts` swaps
  them on focus and projects them for each sidebar. `newWindowSidebar` = the last closed window's sidebar (Arc's
  sidebarViewPreferences); a new window takes it, and the Pinned sections and folders of the window it came from
  (our choice). `getLayoutOptions(windowId)` and the sidebar peek read each window's own sidebar. `migrate.ts`
  v3 → v4 copies the shared values into every parked window.

- **Piece 2 (Notes and Easels):** chosen: the same "Open in another window" card as pages, since Arc's notes are
  tab content too and a tab is in one window at a time (the alternative, two live editors synced through main, could
  still lose keystrokes typed in both). `tabViews.ts` now owns editor tabs per window like page views (no view, no
  pane); a window may draw an editor only when no other window's sidebar reports it open
  (`RuntimeState.editorTabIdsHere`). The sidebar page reports open and closed editors (`reportOpenEditor`); a closing
  editor saves its pending change first, and the report follows on the same IPC channel, so the next window always
  reads the newest file. `check-windows` types into a note and moves it at once; with the flush and the hand-over
  disabled that check fails ("First window" without the last words).

- **Piece 3 (drag between windows):** an HTML drag's data stays in the page it started in, so the sidebar tells main
  when a drag starts and ends (`beginItemDrag` / `endItemDrag`, never focusing a window) and main gives the other
  windows the item in `RuntimeState.itemDraggedInOtherWindow`; their `dragDrop.ts` accepts it like its own (and
  shows the Favorites end zone). The drop sends the usual `moveItem` / `moveItemToSpace` from the target window, then
  `takeItemFromOtherWindow` (not on a Space button): `windows.ts takeItemIntoFocusedWindow` selects a dropped tab or
  split there, and every window that selected it lets go (its most recently used other tab), so the page moves
  over. Our choice where Arc could not be checked: the source window lets go instead of showing the placeholder.
  Verified with simulated drag events in two pages (Playwright's real drag hangs in Electron); a real OS drag between
  two windows was not exercised.

## How it is built

- **Saved shape v3** (`src/shared/types.ts`): `focusedWindowId` and `otherWindows: WindowSelection[]` (id, Space,
  selection), most recently focused first. The focused window's choices stay in `activeSpaceId` /
  `selectedTabIdBySpace`, so state.ts, spaces.ts and every caller keep acting on "the focused window". v2 files get
  `focusedWindowId: "window-1"` (`migrate.ts upgradeFromVersion2`, v1 goes v1 → v2 → v3).
- **Pure `src/main/windows.ts`:** `projectStateForWindow` (what a window's sidebar draws), `focusWindow` (a swap; no
  lastActiveAt), `openWindow`, `closeWindow` (the most recently focused other window takes over; the last stays),
  `repairOtherWindows` (applyChange runs it after every change: a parked window on a deleted Space moves to the
  first Space; a parked selection that is gone is replaced like `repairSelections` does), and
  `collectSelectedTabIdsOfAllWindows` (live folders keep every window's page).
- **`src/main/mainWindows.ts`** (new): creates windows (moved out of main.ts), `restoreMainWindows` (focused one
  last, so it is in front), `openNewWindow`, focus → close panels → `focusWindow`, close → floating views and pages
  leave the window → `closeWindow` unless quitting (`before-quit` flag) → quit after the last.
- **`browserCore.ts`:** a window registry; `getWindow()` = the state's focused window, never
  `BrowserWindow.getFocusedWindow()` (null between blur and focus, and can be a Little Window). Pushes go to every
  window with its projected state; `RuntimeState` is per window (`isSidebarPeeking`, `isNewTabPending` only in the
  focused one, new `tabIdsInOtherWindows`). Layout options take a window id (the sidebar drag preview applies to
  the focused window only).
- **`tabViews.ts`:** shown views per window; `syncTabViews(targets)` takes every window (focused first), assigns each
  wanted tab to a window (keeps, requested moves, then first come), takes views out of every window before putting
  any in (release before claim), then lays out. `getShownTabIds()` is the union (auto-archive's in-use check,
  `isOnScreen`, media, snapshots). `destroyTabView(tabId)` finds the window itself.
- **IPC:** `getState` / `getRuntimeState` / `dispatch` answer per sending window; any main window's sidebar is
  trusted. `actionRunner.runActionFromWindow`: an action from a background window's sidebar focuses it first;
  pointer actions (sidebar peek, previews) never bring a window forward (the peek is per window, previews only in
  the focused one).
- Facts checked with a throwaway Electron script (Electron 44): `addChildView` into another window moves the view
  (it leaves the old parent), and closing a window does not destroy its child views' pages.

## Tests

- `npm test`: `tests/windows.test.ts` (project, focus round trip, open, close, repair, all-window selections) and
  `tests/migrate.test.ts` (v2 → v3, v1 chain).
- `e2e/check-windows.mjs` (in `npm run e2e`): ⌘N, own Space and selection per window, the placeholder and Move to
  This Window, a let-go page returning, actions and the Command Bar in the window they came from, a menu acting on
  the focused window only, Close Window, restart restoring both windows (place, Space, selection, focus), quitting
  with the last window and the next start opening that one, and an old one-rectangle `window-state.json` placing
  the first window; since 3.6 also per-window sidebars, Pinned sections and folders, Notes/Easels hand-over and
  drags between windows (50 checks). `E2E_DEBUG=1` streams the main process's output. `check-package` (packaged app, not
  part of `npm run e2e`) is green too (12).

## Known limits (our choices or not done)

- Extensions: a tab belongs to the window it was first shown in for `chrome.tabs` / `chrome.windows` (the library
  cannot move a tab between windows without its removeTab, which would close our tab).
- A window with nothing selected shows the empty card; Arc's exact new-window state was not observed.
