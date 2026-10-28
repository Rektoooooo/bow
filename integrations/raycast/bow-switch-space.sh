#!/bin/bash

# Switches Bow to a Space, by its name (or the start of it) or its number (bow://space, src/main/bowUrls.ts).
#
# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Switch Bow Space
# @raycast.mode silent
#
# Optional parameters:
# @raycast.icon 🏹
# @raycast.packageName Bow
# @raycast.argument1 { "type": "text", "placeholder": "Space name or number" }
# @raycast.description Switches Bow to the Space you name.

encode() {
  osascript -l JavaScript -e 'function run(argv) { return encodeURIComponent(argv[0] || "") }' "$1"
}

open "bow://space?name=$(encode "$1")"
