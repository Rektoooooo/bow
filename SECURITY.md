# Security

A browser is security-sensitive software, so reports are very welcome.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub:
[Report a vulnerability](https://github.com/Rektoooooo/bow/security/advisories/new).

Include what an attacker can do, the steps to reproduce it (a small test page helps), and the Bow version
(**Bow › About Bow**). You will get an answer within a week; once a fix is released, the report is published with
credit to you unless you prefer otherwise.

## Supported versions

Only the newest release gets security fixes. Bow is built on Electron; Chromium security fixes reach Bow when we move
to a newer Electron release.

## What Bow promises

- Web pages run sandboxed and cannot talk to the app. They get no preload script, except in a profile with
  extensions, where the extension library's preload runs in an isolated world.
- Camera, microphone, location, notifications and clipboard reading need your Allow, remembered per profile and
  site; screen sharing goes through macOS's own picker; everything else is refused.
- Bow's own pages accept only their own messages, every field is checked, and they cannot navigate away or open
  windows.
- Extensions from the Chrome Web Store are checked like Chrome checks them (signed with the extension's own key)
  before anything is unpacked.

`e2e/permission-check.mjs` tests these promises. A way around any of them is a vulnerability.
