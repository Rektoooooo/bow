#!/bin/zsh
# Builds build/icon.icns from our own icon drawing (tools/make-icon.cjs). Run once after changing the drawing.
# usage: tools/make-icon.sh
set -e
cd "$(dirname "$0")/.."
work_folder="$(mktemp -d)"
npx electron tools/make-icon.cjs "$work_folder/icon-1024.png"
iconset="$work_folder/icon.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z $size $size "$work_folder/icon-1024.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z $double $double "$work_folder/icon-1024.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o build/icon.icns
cp "$work_folder/icon-1024.png" build/icon-1024.png
rm -rf "$work_folder"
echo "build/icon.icns written"
