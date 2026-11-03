# Handoff — 2026-11-03 — What Chrome and Arc do that Bow didn't (Milestone 8)

Previous handoff: `2026-10-29-passwords.md` (onboarding v2, Google sign-in, Bow Passwords, Favorites per Space,
0.2.0 released 2026-11-01). Open work: `tasks/todo.md` (Milestone 8, its "Later" list).

## Why

The user, on 0.2.0 every day: downloads gave no feedback ("it just opens a little black window"), F1 TV wouldn't play,
Claude's sign-in from another app broke in a Little Window ("JS errors"), typed form values weren't remembered. Each was
measured first with throwaway probes (nothing typed), then the whole Electron-vs-Chrome gap was audited.

## What changed

- **Downloads**: a card above the sidebar's bottom bar (progress, then Downloaded with Open / Show in Finder / ×),
  macOS's quarantine attribute on every finished download (Electron never set it, so Gatekeeper never checked downloaded
  apps), views a file link opened close again (`linkDownloads.ts`), Download Linked File / Save Link As / Save Image As /
  View Page Source in the page menu, page colors behind Little Window and Peek pages (no black).
- **Sign-in popups** (`windowOpenRule.ts`): sized `window.open` keeps `window.opener` from Peek and Little Windows too.
  Measured live: claude.ai's "Continue with Google" in a Little Window used to log `[GSI_LOGGER]: Failed to open popup
  window`; it now opens Google's sign-in as a popup.
- **Form memory like Chrome's autocomplete** (built in its own session, branch `form-memory-autocomplete`, merged):
  any plain text field is remembered by its own name and offered on any site with that name; privacy rules in CLAUDE.md.
- **Bow Passwords beyond tabs** (`pageHosts.ts`): Little Windows, the Peek page and sign-in popups get the list, fills,
  form memory and the save offer (a native sheet in Peek and Little Windows; the overlay card for a tab's popup).
- **HTTP sign-in card** (`httpSignIn.ts`), **certificate warning** (`certificateErrors.ts`, `src/certificate/`, Try
  Again), **Wait / Close Page** sheet for a hung tab (`unresponsivePages.ts`, code-reviewed only: Chromium never fired
  `unresponsive` with the e2e windows invisible).
- New checks: check-downloads, check-popups, check-http-sign-in, check-certificates, check-passwords-windows.

## Watch out

- **Widevine (F1 TV, Netflix, Disney+, Spotify web)** is still missing: stock Electron has no CDM. The user chose to do
  it as its own step: castLabs ECS (an Electron 44 build exists) + EVS VMP signing *before* Apple's codesign, with the
  user's own free castLabs account (they sign up themselves), and `com.apple.security.cs.disable-library-validation`
  so the CDM loads. Security updates trail upstream Electron by about a month.
- A probe once saved a test file into the real ~/Downloads (see tasks/lessons.md): seed the download folder in the
  state file, like check-downloads.
- The overlay's four prompt cards (permission, password offer, sign-in, certificate) each have their own queue: a
  shared one is a listed follow-up.
- Not checked by hand yet: geolocation and media keys in a packaged build, the hung-page sheet on a real page.
