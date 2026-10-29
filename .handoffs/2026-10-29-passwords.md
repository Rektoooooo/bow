# Handoff — 2026-10-29 — Onboarding v2, 0.1.1, Google sign-in, Bow Passwords, Favorites per Space

Previous handoffs: `2026-10-28-night.md` (newest before this one), `2026-10-27-arc-polish.md`,
`2026-10-27-multiple-windows.md`, `2026-10-26-arc-look.md`, `2026-10-26-arc-parity.md`, `2026-10-26-arc-teardown.md`.
Open work: `tasks/todo.md` (Milestones 5.2, 6 and 7).

## What changed

**Onboarding v2 and release 0.1.1** (Milestone 5.2, on origin/main): the first start in its own window, the intro
glow, imports that read first and bring the chosen parts, every supported browser's logo (Arc's included, the user's
choice), the color picker, Dia and Opera import. 0.1.1 was built, signed and notarized by `npm run release` in the
user's own Terminal (notarytool's saved login is not visible to Claude's processes) and published as Latest.

**Dia: every space at once** (`b872d66`): Dia keeps each space as a Chromium profile; a browser with several profiles
now comes over in one go, each profile as its own Space with its own Bow profile (separate sign-ins, the user's choice).

**Google sign-in works again** (`42ce3a2`, on main, not released yet): Google answered "Couldn't sign you in. This
browser or app may not be secure" (rrk=46). With Bow's Chrome user agent Google runs desktop Chrome's sign-in
(GlifWebSignIn), which Electron fails; with Electron's own user agent it serves WebLiteSignIn, which works (measured on
accounts.google.com; the Mise browser found the same on 2026-10-12). accounts.google.com and what its pages load get
Electron's user agent in the header (onBeforeSendHeaders) and in navigator.userAgent (googleSignInPreload.ts, through
contextBridge.executeInMainWorld). Per-page `webContents.setUserAgent` was tried and is unusable in Electron 44: in
did-start-navigation it crashes the main process (SIGTRAP), in will-navigate it restarts navigations, in did-navigate
it reloads the page. check-google-sign-in (11) needs the network and prints SKIP offline. **Not yet confirmed by a real
sign-in**: the user tests it with everything else.

**Bow Passwords** (Milestone 6, steps 1 to 9; steps 1 to 5 on origin/main): save prompt after a typed sign-in, the list
under a field with filling on a pick, form memory, Library › Passwords with Touch ID for Show / Copy / Edit, CSV
import from the Library, the File menu and the onboarding. Architecture and security rules are in CLAUDE.md ("Bow
Passwords", "Security"). check-passwords: 60 checks.

**Favorites per Space** (Milestone 7, saved data version 5): every Space has its own Favorites, also when Spaces share
a profile (the user's choice after it was explained that Arc keeps them per profile and that each of the user's Arc
Spaces has its own profile). The upgrade gives a shared row to the active Space, keeps the file as it was next to it
(`browser-state.version-4-<time>.json`), and Sync skips a peer from an older Bow with a notice.

## Watch out

- **Data version 5**: once a build with it ran on the real data folder, the installed 0.1.1 can't read the state any
  more (it would set it aside and start empty; the pre-upgrade copy lets it go back). Test builds use a separate
  `--user-data-dir` until a release with version 5 is installed.
- **Keychain**: the first run of a build with another signature than the one that created "Bow Safe Storage" (npm
  start after the packaged app, or a local ad-hoc package) shows macOS's Keychain "allow" prompt once; Developer ID
  releases keep access across updates. A vault that can't be opened is never written.
- **Touch ID without a sensor**: `systemPreferences.promptTouchID` asks for user presence; whether macOS offers the Mac
  password on a Mac without Touch ID is not verified (this Mac has a sensor). The Library fails closed.
- e2e: Playwright's `keyboard.press` does not reach `before-input-event`; the list's keys are tested with
  `webContents.sendInputEvent`. The load average on this Mac reached 60 during runs; two overlay checks
  (Control Center refresh, ⌃Tab pictures) failed once each under that load and passed on re-runs.

## Next

- The user's own test of everything (Google sign-in, passwords, Favorites per Space) on a build with a separate data
  folder, then a release (0.1.2 or 0.2.0) only with the user's go; `npm run release` runs in the user's Terminal.
- Live checks by hand: the real Keychain item and Touch ID in a packaged build; the onboarding intro on the real desktop.
- Later for passwords: Peek and Little Windows, sign-in forms inside iframes, a password generator, export, passkeys
  (Electron 45 and an Apple entitlement).
