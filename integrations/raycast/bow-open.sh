#!/bin/bash

# Opens an address or a search in Bow, in a Space when you name one (bow://open, src/main/bowUrls.ts).
#
# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Open in Bow
# @raycast.mode silent
#
# Optional parameters:
# @raycast.icon 🏹
# @raycast.packageName Bow
# @raycast.argument1 { "type": "text", "placeholder": "Address or search" }
# @raycast.argument2 { "type": "text", "placeholder": "Space", "optional": true }
# @raycast.description Opens an address or a search in Bow, in the Space you name.

# macOS's own JavaScript encodes the text for the address (no other tools needed).
encode() {
  osascript -l JavaScript -e 'function run(argv) { return encodeURIComponent(argv[0] || "") }' "$1"
}

open "bow://open?url=$(encode "$1")&space=$(encode "$2")"
