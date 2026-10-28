#!/bin/bash

# Searches Bow's open tabs in every Space: Bow comes forward with tab search (⇧⌘A) and your words typed in
# (bow://search-tabs, src/main/bowUrls.ts).
#
# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Search Bow Tabs
# @raycast.mode silent
#
# Optional parameters:
# @raycast.icon 🏹
# @raycast.packageName Bow
# @raycast.argument1 { "type": "text", "placeholder": "Words", "optional": true }
# @raycast.description Searches the tabs open in Bow, in every Space.

encode() {
  osascript -l JavaScript -e 'function run(argv) { return encodeURIComponent(argv[0] || "") }' "$1"
}

open "bow://search-tabs?q=$(encode "$1")"
