#!/bin/zsh
# Draws the picture of the downloaded disk image's window (tools/make-dmg-background.cjs) and saves it as
# build/dmg-background.tiff, holding a 1x and a 2x page so Retina screens get a sharp picture. Run once after changing
# the drawing or tools/dmg-layout.cjs; tools/make-dmg.sh puts the file in every disk image.
# usage: tools/make-dmg-background.sh
set -e
cd "$(dirname "$0")/.."
work_folder="$(mktemp -d)"
trap 'rm -rf "$work_folder"' EXIT
npx electron tools/make-dmg-background.cjs "$work_folder"
tiffutil -cathidpicheck "$work_folder/background.png" "$work_folder/background@2x.png" -out build/dmg-background.tiff
echo "build/dmg-background.tiff written"
