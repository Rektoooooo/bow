#!/bin/zsh
# Builds the disk image people download: Bow and a link to Applications in a window with our picture
# (build/dmg-background.tiff), each icon where the picture expects it (tools/dmg-layout.cjs), and Bow's icon on the
# disk itself. Finder lays the window out once on a writable copy and keeps that layout in the disk's .DS_Store; the
# copy is then compressed into the final image. Signing and notarizing stay in release-mac.sh.
# Finder is told what to do with AppleScript, so the first run asks once to let the terminal control Finder.
# usage: tools/make-dmg.sh <Bow.app> <output.dmg>
set -e
cd "$(dirname "$0")/.."
app_path="$1"
dmg_path="$2"
if [[ ! -d "$app_path" || -z "$dmg_path" ]]; then
  echo "usage: tools/make-dmg.sh <Bow.app> <output.dmg>"
  exit 1
fi
read_layout() {
  node -p "require('./tools/dmg-layout.cjs').$1"
}
window_width="$(read_layout windowWidth)"
window_height="$(read_layout windowHeight)"
title_bar_height="$(read_layout titleBarHeight)"
icon_size="$(read_layout iconSize)"
text_size="$(read_layout textSize)"
app_icon_x="$(read_layout appIcon.x)"
app_icon_y="$(read_layout appIcon.y)"
applications_icon_x="$(read_layout applicationsIcon.x)"
applications_icon_y="$(read_layout applicationsIcon.y)"
# Where the window opens on screen while Finder lays it out (it opens there for people too). Our choice.
window_left=200
window_top=120
# Room for what Finder writes into the writable copy (the layout, its index). Our choice: far more than it needs.
spare_megabytes=20

work_folder="$(mktemp -d)"
mount_point=""
cleanup() {
  if [[ -n "$mount_point" ]]; then
    hdiutil detach "$mount_point" -force -quiet || true
  fi
  rm -rf "$work_folder"
}
trap cleanup EXIT

disk_folder="$work_folder/Bow"
mkdir -p "$disk_folder/.background"
ditto "$app_path" "$disk_folder/Bow.app"
ln -s /Applications "$disk_folder/Applications"
cp build/dmg-background.tiff "$disk_folder/.background/background.tiff"

writable_dmg="$work_folder/writable.dmg"
content_megabytes="$(du -sm "$disk_folder" | cut -f 1)"
hdiutil create -volname "Bow" -srcfolder "$disk_folder" -fs HFS+ -format UDRW \
  -size "$((content_megabytes + spare_megabytes))m" "$writable_dmg" -quiet
attach_output="$(hdiutil attach "$writable_dmg" -readwrite -noverify -noautoopen)"
mount_point="$(echo "$attach_output" | grep -o '/Volumes/.*$' | head -n 1)"
# "Bow", or "Bow 1" while another Bow disk is open: Finder knows the disk by that name.
disk_name="$(basename "$mount_point")"
window_right=$((window_left + window_width))
window_bottom=$((window_top + window_height + title_bar_height))
osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "$disk_name"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set pathbar visible of container window to false
    set bounds of container window to {$window_left, $window_top, $window_right, $window_bottom}
    set viewOptions to icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to $icon_size
    set text size of viewOptions to $text_size
    set label position of viewOptions to bottom
    set shows item info of viewOptions to false
    set shows icon preview of viewOptions to false
    set background picture of viewOptions to file ".background:background.tiff"
    set position of item "Bow.app" of container window to {$app_icon_x, $app_icon_y}
    set position of item "Applications" of container window to {$applications_icon_x, $applications_icon_y}
    close
    open
    update without registering applications
    delay 2
    close
  end tell
end tell
APPLESCRIPT

# Finder writes the layout when the window closes; wait for it before the disk goes away.
for attempt in {1..20}; do
  [[ -f "$mount_point/.DS_Store" ]] && break
  sleep 0.5
done
if [[ ! -f "$mount_point/.DS_Store" ]]; then
  echo "Finder did not save the window's layout on the disk image."
  exit 1
fi
# The disk shows Bow's icon: the icon file, marked as an icon file, and the disk marked as having a custom icon. Done after
# Finder's layout: copied before it, the icon file was gone from the finished image (hdiutil also leaves a
# .VolumeIcon.icns out of the source folder, so it never goes in there).
cp build/icon.icns "$mount_point/.VolumeIcon.icns"
SetFile -c icnC "$mount_point/.VolumeIcon.icns"
SetFile -a C "$mount_point"
rm -rf "$mount_point/.fseventsd"
sync
hdiutil detach "$mount_point" -quiet
mount_point=""
rm -f "$dmg_path"
hdiutil convert "$writable_dmg" -format UDZO -imagekey zlib-level=9 -o "$dmg_path" -quiet
echo "Built $dmg_path"
