// WHY this file exists:
//   The disk image's window is a picture with two icons placed on it: Bow on the left, Applications on the right, an
//   arrow between them. The picture (make-dmg-background.cjs) and the script that lays out the window (make-dmg.sh)
//   read their sizes and places from here, so the icons always land where the picture expects them.
// Data source:
//   Our choice. Finder's icon view takes positions as icon centres, in points from the window's top left corner.
// Data flow:
//   this file → make-dmg-background.cjs → build/dmg-background.tiff
//   this file → make-dmg.sh → Finder window bounds, icon size and icon positions in the disk image
module.exports = {
  // The window's content area. The picture is this wide and pictureSpare taller (twice that for Retina screens), so a
  // title bar a few points off the estimate below never leaves an empty strip at the bottom.
  windowWidth: 660,
  windowHeight: 400,
  pictureSpare: 40,
  // Finder's title bar with the toolbar hidden, added to the window's height (macOS 26; Finder's own tab bar, when
  // someone turned it on, takes a little more and the picture's spare covers it).
  titleBarHeight: 28,
  // Big enough to read as an installer, small enough that the arrow between the two fits.
  iconSize: 128,
  textSize: 13,
  appIcon: { x: 175, y: 205 },
  applicationsIcon: { x: 485, y: 205 },
};
