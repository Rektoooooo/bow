# Sidebar Browser

A desktop browser built with Electron and TypeScript, modeled on how Arc works: tabs in a vertical sidebar,
Spaces, the page shown as an inset card, and auto-archive for tabs you stop using.

![The browser in dark mode: Personal Space with a pinned Wikipedia tab, one tab today, the Archive, and a page in the inset card](docs/screenshot-dark.png)

## Run it

```bash
npm install
npm start      # builds, then opens the window
npm test       # unit tests (Vitest)
```

Needs Node.js 22.23+ or 24.22+.

## What works

- **Sidebar** with a Space heading, Pinned and Today sections, and an address box that takes a URL or a search.
- **Spaces**: Personal and Work, each with its own tabs, selection and frame color.
- **Pin / unpin**. A pinned tab remembers its home URL and never auto-archives.
- **Close, Clear and Archive**. Closed and cleared tabs go to the Archive, and each one can be restored.
- **Auto-archive**. Unpinned tabs move to the Archive after the chosen time without use: 1 hour, 6 hours,
  12 hours (default), 24 hours, 7 days, 30 days, or never.
- **Saved between runs** in `~/Library/Application Support/sidebar-browser/browser-state.json`.

## How auto-archive decides

A tab counts as **in use** while it is visible, playing sound, or in picture-in-picture. Those tabs get their
last-active time refreshed every minute. Every 5 minutes, any unpinned tab unused for longer than the threshold
is archived. Time while the app was closed does not count: inactivity is measured from the later of the tab's
last use and the app's launch. Archive entries are deleted after 30 days.

These intervals are our own choices. The threshold menu copies the options Arc offers.

## How the code is organized

| Folder | Runs in | What it holds |
|---|---|---|
| `src/main` | Electron's main process | State changes (`state.ts`, `autoArchive.ts`), tab web views, saving, IPC, timers |
| `src/preload` | The sidebar page, before it loads | The one safe bridge, `window.browserApi` |
| `src/renderer` | The sidebar page | Drawing the sidebar from the current state |
| `src/shared` | Both | Data types, named settings, IPC channel names |
| `tests` | Vitest | Rules for state changes and auto-archive |
| `docs` | — | Screenshot, and `arc-teardown.html`: the map of Arc's features this project works from |

Three ideas keep it simple:

1. **Pure state functions.** `state.ts` and `autoArchive.ts` take data in and return a changed copy. No Electron, no clock.
2. **One way to change state.** `applyChange()` in `main.ts` saves, updates the web views and redraws the sidebar.
3. **Reconcile, then render.** `syncTabViews()` makes the web views match the state, and the sidebar redraws from the newest state.

## Security

- Web pages run sandboxed with no preload and cannot talk to the app.
- Website permission requests are refused except fullscreen and clipboard writes, until a permission prompt exists.
- The sidebar page cannot navigate away or open windows, and only loads its own script.
