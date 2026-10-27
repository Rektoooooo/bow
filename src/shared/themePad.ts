/**
 * WHY this file exists:
 *   Arc's theme editor picks a Space's colors by dragging handles on a dotted pad. Arc's exact mapping is not known;
 *   ours puts black in the middle (the user's black Space sits in the middle in their Arc), goes around the middle
 *   through the hues (red at the top, clockwise) and outward to full strength: hue = angle, and saturation = value =
 *   distance from the middle (HSV). These pure functions turn a point on the pad into a color and back.
 *
 * Data source:
 *   A point on the pad (x and y from -1 to 1, the middle at 0, y down) or a #rrggbb color.
 *
 * Data flow:
 *   overlay/themeEditor.ts drag → colorAtPadPoint() → the theme's color
 *   the theme's color → padPointOfColor() → where its handle is drawn
 */

/** A point on the pad: x and y from -1 to 1, the middle at 0, y growing downward. */
export interface PadPoint {
  x: number;
  y: number;
}

/** Degrees in a full turn. */
const FULL_TURN_DEGREES = 360;

/** Hue sectors of the HSV model (60° each). */
const HUE_SECTOR_DEGREES = 60;

/**
 * Two hex digits for a channel from 0 to 255.
 */
function toHexChannel(channel: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(channel)));
  return clamped.toString(16).padStart(2, "0");
}

/**
 * The RGB channels (0…255) of a hue (degrees), saturation and value (0…1).
 */
function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const chroma = value * saturation;
  const sector = (((hue % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES) / HUE_SECTOR_DEGREES;
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
  const lowest = value - chroma;
  const sectorChannels: [number, number, number][] = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ];
  const channels = sectorChannels[Math.floor(sector) % sectorChannels.length] as [number, number, number];
  return [(channels[0] + lowest) * 255, (channels[1] + lowest) * 255, (channels[2] + lowest) * 255];
}

/**
 * The hue (degrees), saturation and value (0…1) of a #rrggbb color; black for anything else.
 */
function hexToHsv(color: string): { hue: number; saturation: number; value: number } {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  const digits = match === null ? "000000" : (match[1] as string);
  const red = parseInt(digits.slice(0, 2), 16) / 255;
  const green = parseInt(digits.slice(2, 4), 16) / 255;
  const blue = parseInt(digits.slice(4, 6), 16) / 255;
  const highest = Math.max(red, green, blue);
  const lowest = Math.min(red, green, blue);
  const chroma = highest - lowest;
  let hue = 0;
  if (chroma > 0 && highest === red) {
    hue = HUE_SECTOR_DEGREES * (((green - blue) / chroma + 6) % 6);
  } else if (chroma > 0 && highest === green) {
    hue = HUE_SECTOR_DEGREES * ((blue - red) / chroma + 2);
  } else if (chroma > 0) {
    hue = HUE_SECTOR_DEGREES * ((red - green) / chroma + 4);
  }
  const saturation = highest === 0 ? 0 : chroma / highest;
  return { hue: hue, saturation: saturation, value: highest };
}

/**
 * The color at a point of the pad. Points beyond the edge count as on the edge.
 * Examples: { x: 0, y: 0 } → "#000000"; { x: 0, y: -1 } → "#ff0000"; { x: 1, y: 0 } → a full green-yellow
 */
export function colorAtPadPoint(point: PadPoint): string {
  const distance = Math.min(1, Math.hypot(point.x, point.y));
  // Clockwise from the top: atan2 measured from straight up, toward the right.
  const angleDegrees = (Math.atan2(point.x, -point.y) * 180) / Math.PI;
  const channels = hsvToRgb(angleDegrees, distance, distance);
  return `#${toHexChannel(channels[0])}${toHexChannel(channels[1])}${toHexChannel(channels[2])}`;
}

/**
 * Where a color's handle sits on the pad: its hue gives the direction, its value the distance (a pale color that
 * the pad cannot show exactly sits at its hue and brightness).
 * Examples: "#000000" → { x: 0, y: 0 }; "#ff0000" → { x: 0, y: -1 }
 */
export function padPointOfColor(color: string): PadPoint {
  const hsv = hexToHsv(color);
  const angleRadians = (hsv.hue * Math.PI) / 180;
  // "0 -" rather than a minus sign, so the middle comes out as +0 (not -0).
  return { x: Math.sin(angleRadians) * hsv.value, y: 0 - Math.cos(angleRadians) * hsv.value };
}
