# Handoff — 2026-11-28 — Moving Bow to another Mac, and 0.2.1

Previous handoff: `2026-11-03-chrome-gaps.md`. Open work: `tasks/todo.md` (Milestone 9, its fixes list, "Later").

## Why

The user got a new MacBook and restored a Bow backup there; passwords and extensions were missing, because a backup
leaves them out on purpose (a vault needs this Mac's Keychain key; extensions are code). Earlier in November the user
also hit two crashes on their own build: a page that closes itself (NetSuite's MCP sign-in) and an endless select loop
with the extension library after closing one of several windows.

## What changed

- **Export passwords** (`passwordExport.ts`, Library › Passwords): Chrome's CSV (`buildPasswordsCsv`, round-trips through
  the import), Touch ID every time with its own reason, a new owner-only file moved into place, Downloads by default.
- **Install Extensions from Backup** (File menu, Command Bar, and an off-by-default box in the restore question):
  `readBackupExtensions` checks each entry, `planBackupExtensionInstalls` sorts them, `addFromWebStoreQuietly` installs
  one at a time into each profile, on or off as listed (an off one never loads). Rule in CLAUDE.md: a backup only names
  extensions; nothing from the file is installed.
- **Fixes since 0.2.0:**
  - Self-closing pages (`liveContents.ts`, check-self-closing).
  - The extension select loop.
  - Spaces kept apart (Command Bar, findOpenTabForUrl).
  - New Spaces get their own profile, which follows the Space's name.
  - Escape after a Peek became a tab.
  - check-certificates restarts on a page that loads.
- **0.2.1** published 2026-11-28 with the user's yes. It includes the user's own six commits from GitHub: fullscreen
  video, Bow staying open without windows, the sidebar edge, SF Symbol sizes.

## Watch out

- Both macOS accounts on this Mac run the same `/Applications/Bow.app`; look for this account's processes with
  `pgrep -u "$(whoami)"` (tasks/lessons.md).
- Deleting a Space leaves its profile (and its cookies on disk) behind; cleaning that up needs a question first, since
  it deletes sign-ins and saved passwords (tasks/todo.md, Later).
- Widevine (DRM video) is still its own step (castLabs, the user's account).
